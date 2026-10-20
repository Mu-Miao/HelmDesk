import {test}from'node:test';import assert from'node:assert/strict';import{createServer}from'node:http';import{mkdtempSync,rmSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
import{Store}from'../src/store.js';import{Scheduler}from'../src/scheduler.js';import{createApp}from'../src/server.js';
test('classification route requires host authentication or session CSRF and leaves original task and queue untouched',async()=>{
 const root=mkdtempSync(join(tmpdir(),'helmdesk-disposition-http-')),store=new Store(root),scheduler=new Scheduler(store,{async verify(){throw Error('No model requests');},start(){throw Error('No model requests');}});scheduler.stop();
 const task=store.create({title:'HTTP fixture',prompt:'fixture',projectPath:root,allowedFiles:[],acceptanceCriteria:[],dependencies:[],model:'Fixture',mode:'probe',timeoutSeconds:30});store.patch(task.id,{state:'failed',error:'original failure',failureKind:'process'});
 const original=store.get(task.id);let app:ReturnType<typeof createApp>;const server=createServer((req,res)=>app(req,res));await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address()as{port:number}).port,base=`http://127.0.0.1:${port}`;app=createApp(store,scheduler,port,'fixture-service-token');
 const send=(args:object,headers:Record<string,string>={})=>fetch(base+'/api/tool/task_disposition_set',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(args)});
 const input={taskId:task.id,status:'deferred',reason:'Wait for user configuration'};
 try{
  assert.equal((await fetch(base+'/favicon.ico')).status,204);
  assert.equal((await send(input)).status,401);assert.equal((await send(input,{Authorization:'Bearer wrong'})).status,401);
  const session=await fetch(base+'/api/session',{headers:{Authorization:'Bearer fixture-service-token'}}),{browserToken,csrf}=await session.json();
  assert.equal((await send(input,{'X-HelmDesk-Session':browserToken})).status,403);
  assert.equal((await send(input,{'X-HelmDesk-Session':browserToken,'X-HelmDesk-CSRF':csrf,Origin:'https://foreign.invalid'})).status,403);
  const result=await send(input,{'X-HelmDesk-Session':browserToken,'X-HelmDesk-CSRF':csrf,Origin:base});assert.equal(result.status,200);assert.equal((await result.json()).disposition.status,'deferred');
  const state=await(await fetch(base+'/api/state',{headers:{'X-HelmDesk-Session':browserToken}})).json();assert.equal(state.tasks[0].disposition.status,'deferred');assert.equal(state.tasks[0].error,original.error);assert.equal(state.queue.entries.length,0);
  assert.equal((await send({...input,status:'accepted'},{Authorization:'Bearer fixture-service-token'})).status,400);
  assert.equal((await send({...input,status:'unclassified',reason:'Review again'},{Authorization:'Bearer fixture-service-token'})).status,200);
  assert.deepEqual(store.get(task.id),original);assert.equal(store.events(0,task.id).filter(e=>e.type==='disposition').length,2);
 }finally{scheduler.stop();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();rmSync(root,{recursive:true,force:true});}
});
