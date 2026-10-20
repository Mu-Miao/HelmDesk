import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {Scheduler} from '../src/scheduler.js';
import {createApp} from '../src/server.js';

test('browser bootstrap needs owner authorization, consumes a short-lived ticket once and preserves CSRF/native boundaries',async()=>{
  const root=mkdtempSync(join(tmpdir(),'helm-browser-owner-')),store=new Store(root);
  const scheduler=new Scheduler(store,{async verify(){throw Error('No model');},start(){throw Error('No model');}});scheduler.stop();
  let app:ReturnType<typeof createApp>;
  const server=createServer((req,res)=>app(req,res));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const port=(server.address() as {port:number}).port,base=`http://127.0.0.1:${port}`;
  app=createApp(store,scheduler,port,'owner-fixture-only');
  const post=(path:string,body:object,headers:Record<string,string>={})=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  try {
    assert.equal((await fetch(base+'/api/session')).status,401);
    assert.equal((await fetch(base+'/api/state')).status,401);
    assert.equal((await post('/api/browser-ticket',{})).status,401);
    assert.equal((await post('/api/browser-ticket',{},{Authorization:'Bearer wrong'})).status,401);
    const minted=await post('/api/browser-ticket',{},{Authorization:'Bearer owner-fixture-only'});
    assert.equal(minted.status,200); const entry=await minted.json();
    assert.match(entry.ticket,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(entry).includes('owner-fixture-only'));
    assert.ok(Date.parse(entry.expiresAt)-Date.now()<=60_000);
    assert.equal((await post('/api/session',{ticket:entry.ticket},{Origin:'https://foreign.invalid'})).status,403);
    assert.equal((await post('/api/session',{ticket:'f'.repeat(64)},{Origin:base})).status,401);
    const exchange=await post('/api/session',{ticket:entry.ticket},{Origin:base});assert.equal(exchange.status,200);
    assert.equal(exchange.headers.get('set-cookie'),null);
    const {browserToken,csrf}=await exchange.json();
    assert.match(browserToken,/^[a-f0-9]{64}$/);
    const cookie=`helmdesk_${port}=${browserToken}`;
    for(const path of ['/api/state','/api/session','/api/events'])assert.equal((await fetch(base+path,{headers:{Cookie:cookie}})).status,401);
    assert.equal((await post('/api/tool/task_list',{},{Cookie:cookie,Origin:base,'X-HelmDesk-CSRF':csrf})).status,401);
    assert.equal((await post('/api/session',{ticket:entry.ticket},{Origin:base})).status,401);
    assert.equal((await fetch(base+'/api/state',{headers:{'X-HelmDesk-Session':browserToken}})).status,200);
    assert.equal((await fetch(base+'/api/session',{headers:{'X-HelmDesk-Session':browserToken}})).status,200);
    assert.equal((await post('/api/browser-ticket',{},{'X-HelmDesk-Session':browserToken,Origin:base,'X-HelmDesk-CSRF':csrf})).status,401);
    assert.equal((await post('/api/desktop/status',{},{'X-HelmDesk-Session':browserToken,Origin:base,'X-HelmDesk-CSRF':csrf})).status,403);
    assert.equal((await post('/api/tool/task_list',{},{'X-HelmDesk-Session':browserToken,Origin:base})).status,403);
    assert.equal((await post('/api/tool/task_list',{},{'X-HelmDesk-Session':browserToken,Origin:base,'X-HelmDesk-CSRF':csrf})).status,200);
    assert.equal(store.list().length,0);
  } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));store.close();rmSync(root,{recursive:true,force:true});}
});
