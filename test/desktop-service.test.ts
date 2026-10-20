import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,rmSync,realpathSync,readFileSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {Scheduler} from '../src/scheduler.js';
import {createApp} from '../src/server.js';
import {desktopConfiguration,saveDesktopConfiguration} from '../src/desktop-config.js';

test('native management requires private bearer identity, rejects stale edits and blocks configuration/restart with queued work',async()=>{
  const root=mkdtempSync(join(tmpdir(),'helm-desktop-')),data=join(root,'data'),project=join(root,'project');mkdirSync(data);mkdirSync(project);
  const originalCLI=process.env.HELMDESK_QODER_CLI;
  const store=new Store(data),scheduler=new Scheduler(store,{async verify(){throw Error('No real model');},start(){throw Error('No real model');}},[project]);scheduler.stop();
  let app:ReturnType<typeof createApp>,stopped=false;
  const server=createServer((req,res)=>app(req,res));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const port=(server.address() as {port:number}).port,base=`http://127.0.0.1:${port}`;
  app=createApp(store,scheduler,port,'native-test-only',undefined,undefined,undefined,()=>{stopped=true;});
  const post=(action:string,input:unknown={},headers:Record<string,string>={Authorization:'Bearer native-test-only'})=>fetch(base+'/api/desktop/'+action,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(input)});
  try {
    assert.equal((await post('status',{},{})).status,401);
    const session=await fetch(base+'/api/session',{headers:{Authorization:'Bearer native-test-only'}}),{browserToken,csrf}=await session.json();
    assert.equal((await post('status',{}, {'X-HelmDesk-Session':browserToken,Origin:base,'X-HelmDesk-CSRF':csrf})).status,403);
    assert.equal((await post('status',{}, {Authorization:'Bearer native-test-only',Origin:'https://foreign.test'})).status,403);
    const initial=await(await post('status')).json();assert.equal(initial.data.tasks,0);assert.equal(initial.data.schemaVersion,3);
    const configuration={qoderCLI:null,projectRoots:[project],preferredPort:port};
    assert.equal((await post('configure',{configuration,expectedRevision:'0'.repeat(64)})).status,400);
    assert.equal((await post('configure',{configuration:{...configuration,projectRoots:[homedir()]},expectedRevision:initial.revision})).status,400);
    assert.equal((await post('configure',{configuration:{...configuration,qoderCLI:'/missing/cli'},expectedRevision:initial.revision})).status,400);
    const task=store.create({title:'queued fixture',prompt:'fixture',model:'Auto',projectPath:project,mode:'probe',allowedFiles:[],acceptanceCriteria:['fixture'],dependencies:[],timeoutSeconds:10});
    assert.equal((await post('configure',{configuration,expectedRevision:initial.revision})).status,400);
    assert.equal((await post('stop')).status,400);
    store.patch(task.id,{state:'cancelled'});
    const saved=await post('configure',{configuration,expectedRevision:initial.revision});assert.equal(saved.status,200);
    const status=await(await post('status')).json();assert.deepEqual(status.configuration.projectRoots,[realpathSync(project)]);assert.equal(status.restartRequired,false);
    assert.equal(statSync(join(data,'desktop-config.json')).mode&0o777,0o600);
    assert.equal((await post('configure',{configuration,expectedRevision:initial.revision})).status,400);
    const denied=join(root,'outside');mkdirSync(denied);
    assert.throws(()=>scheduler.submit({...task,id:undefined,projectPath:denied} as any),/允许的根目录/);
    const backup=await(await post('backup')).json();assert.equal(backup.tasks,1);
    const verified=await(await post('verify-backup',{name:backup.name})).json();assert.equal(verified.valid,true);
    assert.equal((await post('verify-backup',{name:'../outside'})).status,400);
    assert.equal((await post('status',{unexpected:true})).status,400);
    assert.equal((await post('stop')).status,200);
    assert.throws(()=>scheduler.submit(task),/正在停止/);
    await new Promise(r=>setTimeout(r,180));assert.equal(stopped,true);
    assert.equal(store.get(task.id).state,'cancelled');
  } finally {
    server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));store.close();rmSync(root,{recursive:true,force:true});
    if(originalCLI===undefined)delete process.env.HELMDESK_QODER_CLI;else process.env.HELMDESK_QODER_CLI=originalCLI;
  }
});

test('desktop configuration rejects credential roots, aliases, non-private files and invalid ports without overwriting prior settings',()=>{
  const root=mkdtempSync(join(tmpdir(),'helm-desktop-config-')),data=join(root,'data'),project=join(root,'project');mkdirSync(data);mkdirSync(project);
  try {
    const initial=desktopConfiguration(data),config={qoderCLI:null,projectRoots:[project],preferredPort:4317};
    for(const preferredPort of [0,80,65536,1.5])assert.throws(()=>saveDesktopConfiguration(data,{...config,preferredPort},initial.revision));
    const secret=join(root,'.ssh');mkdirSync(secret);const alias=join(root,'alias');symlinkSync(secret,alias);
    assert.throws(()=>saveDesktopConfiguration(data,{...config,projectRoots:[alias]},initial.revision),/凭据目录/);
    const saved=saveDesktopConfiguration(data,config,initial.revision),bytes=readFileSync(join(data,'desktop-config.json'));
    assert.throws(()=>saveDesktopConfiguration(data,{...config,projectRoots:['/']},saved.revision));
    assert.deepEqual(readFileSync(join(data,'desktop-config.json')),bytes);
    rmSync(join(data,'desktop-config.json'));symlinkSync(join(root,'outside.json'),join(data,'desktop-config.json'));writeFileSync(join(root,'outside.json'),'{}');
    assert.throws(()=>desktopConfiguration(data));
  } finally {rmSync(root,{recursive:true,force:true});}
});
