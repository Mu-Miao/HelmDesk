import{test}from'node:test';import assert from'node:assert/strict';import{createServer}from'node:http';
import{localOllamaModels,ollamaResult}from'../src/ollama.js';import{ollamaGateway}from'../src/ollama-gateway.js';import{validateOllamaTask}from'../src/ollama-executor.js';import type{Task}from'../src/types.js';import{buildProjectSummaries}from'../src/project-summary.js';
const digest='a'.repeat(64);
test('only exact installed local identities are offered, without cloud models or duplicates',()=>{
 assert.deepEqual(localOllamaModels({models:[{name:'qwen2.5:1.5b',digest},{name:'remote:cloud',digest},{name:'remote-alias',digest,remote_host:'https://example.test'}]}).map(x=>x.id),['qwen2.5:1.5b']);
 for(const value of [{}, {models:[{name:'-flags',digest}]},{models:[{name:'../../private',digest}]},{models:[{name:'local',digest:'bad'}]},{models:[{name:'a',digest},{name:'a',digest}]}])assert.throws(()=>localOllamaModels(value));
});
test('CLI result must be a complete strict summary object',()=>{
 assert.equal(ollamaResult('{"summary":"ok"}').result,'ok');
 for(const text of ['plain text','{}','[]','{"summary":""}','{"summary":"ok","success":true}'])assert.throws(()=>ollamaResult(text));
});
test('Ollama cannot acquire file tools, inputs, Qoder effort or multiple turns',()=>{
 const task={mode:'probe',allowedFiles:[],model:'local',maxTurns:1}as unknown as Task;assert.doesNotThrow(()=>validateOllamaTask(task));
 for(const patch of [{mode:'files'},{allowedFiles:['out.txt']},{reasoningEffort:'xhigh'},{maxTurns:2},{inputs:[{taskId:'a',paths:['x']}]},{capabilities:{skills:['x'],tools:[]}}])assert.throws(()=>validateOllamaTask({...task,...patch}as Task));
});
test('gateway refuses model download, extra generation, other models, images and browser origins',async()=>{
 let generated=0;const upstream=createServer((req,res)=>{if(req.url==='/api/version'){res.end(JSON.stringify({version:'fixture'}));return;}if(req.url==='/api/generate'){generated++;res.setHeader('Content-Type','application/x-ndjson');res.end(JSON.stringify({model:'local',done:true,prompt_eval_count:12,eval_count:3})+'\n');return;}res.end('{}');});
 await new Promise<void>(r=>upstream.listen(0,'127.0.0.1',r));const gateway=await ollamaGateway('local',`http://127.0.0.1:${(upstream.address()as{port:number}).port}`);
 const post=(path:string,value:object,headers={})=>fetch(gateway.url+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(value)});
 try{
  assert.equal((await post('/api/pull',{model:'local'})).status,403);assert.equal((await post('/api/generate',{model:'other'})).status,400);assert.equal((await post('/api/generate',{model:'local',images:['secret']})).status,400);assert.equal((await post('/api/generate',{model:'local'},{Origin:'https://foreign.test'})).status,403);
  assert.equal((await fetch(gateway.url,{method:'HEAD'})).status,200);
  assert.equal((await post('/api/show',{model:'',name:'local'})).status,200);
  assert.equal((await post('/api/show',{model:'local',name:'other'})).status,400);
  const accepted=await post('/api/generate',{model:'local',prompt:'fixture'});await accepted.text();assert.equal(accepted.status,200);assert.deepEqual(gateway.receipt(),{model:'local',inputTokens:12,outputTokens:3});assert.equal((await post('/api/generate',{model:'local'})).status,400);assert.equal(generated,1);
  assert.equal((await(await fetch(gateway.url+'/api/version')).json()).version,'fixture');
 }finally{await gateway.close();upstream.closeAllConnections();await new Promise<void>(r=>upstream.close(()=>r()));}
});
test('same model text on different executors never merges project usage',()=>{
 const task={id:'a',projectPath:'/p',title:'same',state:'completed',acceptance:'pending',model:'local',createdAt:'2026-10-17',updatedAt:'2026-10-17'};
 const p=buildProjectSummaries([task,{...task,id:'b',agent:'ollama'}])[0]!;assert.equal(p.models.length,2);assert.deepEqual(p.models.map(m=>[m.agent??'qoder-cn',m.taskCount]),[['ollama',1],['qoder-cn',1]]);
});
