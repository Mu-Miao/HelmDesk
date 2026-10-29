import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {Scheduler} from '../src/scheduler.js';
import {createApp} from '../src/server.js';
import type {CLIInstaller,CLIInstallerSnapshot} from '../src/cli-installation.js';

test('installation is native-owner only, validates fixed targets, and preserves task/default boundaries',async()=>{
  const root=mkdtempSync(join(tmpdir(),'helm-installer-http-')),data=join(root,'data'),project=join(root,'project');
  mkdirSync(data);mkdirSync(project);
  const store=new Store(data),scheduler=new Scheduler(store,{async verify(){throw Error('No real model');},start(){throw Error('No real model');}},[project]);
  scheduler.stop();
  const preference={agent:'qoder-cn',model:'Qwen3.8-Flash',reasoningEffort:'xhigh',kind:'platform',updatedAt:'fixture'};
  store.snapshot('modelPreference',preference);
  let starts=0,refreshes=0,cancels=0;
  const state:CLIInstallerSnapshot={checking:false,homebrew:{supported:true,available:true,path:'/fixture/brew',version:'Homebrew fixture',reason:'fixture'},tools:[],job:null};
  const installer={snapshot:()=>structuredClone(state),refresh:async()=>{refreshes++;return structuredClone(state);},
    start:async(targets:unknown)=>{starts++;state.job={id:'fixture',state:'running',targets:targets as ['ollama'],activeTarget:'ollama',completedTargets:[],message:'fixture',log:'',startedAt:'now',finishedAt:null};return structuredClone(state);},
    cancel:async()=>{cancels++;if(state.job)state.job.state='cancelled';return structuredClone(state);}} as unknown as CLIInstaller;
  let app:ReturnType<typeof createApp>;
  const server=createServer((req,res)=>app(req,res));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const port=(server.address() as {port:number}).port,base=`http://127.0.0.1:${port}`,owner={Authorization:'Bearer installer-owner-fixture'};
  app=createApp(store,scheduler,port,'installer-owner-fixture',undefined,undefined,undefined,()=>{},installer);
  const post=(route:string,input:unknown={},headers:Record<string,string>=owner)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(input)});
  try {
    const ticket=await(await post('/api/browser-ticket')).json();
    const session=await(await post('/api/session',{ticket:ticket.ticket},{Origin:base})).json();
    const browser={Origin:base,'X-HelmDesk-Session':session.browserToken,'X-HelmDesk-CSRF':session.csrf};
    for(const action of ['installer-status','installer-refresh','installer-start','installer-cancel']) {
      assert.equal((await post('/api/desktop/'+action,{targets:['ollama']},{})).status,401);
      assert.equal((await post('/api/desktop/'+action,{targets:['ollama']},browser)).status,403);
      assert.equal((await post('/api/desktop/'+action,{}, {...owner,Origin:'https://foreign.test'})).status,403);
    }
    assert.equal(starts+refreshes+cancels,0);
    assert.equal((await post('/api/desktop/installer-refresh',{unexpected:true})).status,400);
    assert.equal((await post('/api/desktop/installer-refresh')).status,200);
    assert.equal(refreshes,1);
    for(const input of [{targets:['ollama;bad']},{targets:['--force']},{targets:['ollama'],command:'bad'}, {targets:[]},{targets:'ollama'}, {targets:['ollama'],url:'https://foreign.test/script'}]) {
      assert.equal((await post('/api/desktop/installer-start',input)).status,400);
    }
    assert.equal(starts,0);
    assert.equal((await post('/api/tool/installer-start',{targets:['ollama']})).status,400);
    assert.equal((await post('/api/desktop/installer-start',{targets:['ollama']})).status,200);
    assert.equal(starts,1);
    assert.equal((await post('/api/desktop/installer-start',{targets:['ollama']})).status,400);
    assert.equal((await post('/api/desktop/stop')).status,400);
    assert.equal((await post('/api/desktop/installer-cancel')).status,200);
    assert.equal(cancels,1);
    const task=store.create({title:'queued fixture',prompt:'fixture',model:'Auto',projectPath:project,mode:'probe',allowedFiles:[],acceptanceCriteria:['fixture'],dependencies:[],timeoutSeconds:10});
    assert.equal((await post('/api/desktop/installer-start',{targets:['ollama']})).status,400);
    assert.equal(starts,1);
    assert.equal(store.get(task.id).state,'queued');
    assert.deepEqual(store.snapshot('modelPreference'),preference);
  } finally {server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));store.close();rmSync(root,{recursive:true,force:true});}
});
