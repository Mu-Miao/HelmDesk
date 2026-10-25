import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCipheriv,createHash,randomBytes} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync,lstatSync} from 'node:fs';
import {homedir,tmpdir,userInfo} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {Scheduler} from '../src/scheduler.js';
import {Store} from '../src/store.js';
import {modelPreference,saveModelPreference} from '../src/model-selection.js';
import {agentIdSchema,executionPolicySchema} from '../src/schema.js';
import {decodeZcodeCredential,zcodeRequestAuth} from '../src/zcode-auth.js';
import {parseZcodeModels,prepareZcodeState,zcodeDefaultModel} from '../src/zcode.js';
import {ZcodeExecutor,validateZcodeTask,zcodeResult} from '../src/zcode-executor.js';
import {zcodeFailure} from '../src/zcode-protocol.js';
import type {Task,Submission} from '../src/types.js';
import type {Sharing} from '../src/sharing.js';

const providerId='account:bigmodel-start-plan';
const catalog={schemaVersion:1,revision:1,config:{providerConfigRules:{providerRules:[{providerId,config:{builtinModelIds:['GLM-5.3-Flash','GLM-5.2']}}]}}};
function encrypt(value:string) {
  const key=createHash('sha256').update(`zcode-credential-fallback:${process.platform}:${homedir()}:${userInfo().username}`).digest(),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),bytes=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return `enc:v1:${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${bytes.toString('base64url')}`;
}
test('ZCode catalog is strict and only exposes the implemented fixed-model contract',()=>{
  assert.deepEqual(parseZcodeModels(JSON.stringify(catalog),providerId),[{id:zcodeDefaultModel,label:zcodeDefaultModel,kind:'platform'}]);
  for(const value of [{...catalog,schemaVersion:2},{...catalog,config:{}},{...catalog,config:{providerConfigRules:{providerRules:[...catalog.config.providerConfigRules.providerRules,...catalog.config.providerConfigRules.providerRules]}}}])assert.throws(()=>parseZcodeModels(JSON.stringify(value),providerId));
});
test('ZCode preferences persist independently of the primary executor',()=>{
  const dir=mkdtempSync(join(tmpdir(),'helm-zcode-pref-'));let store=new Store(dir);
  try{
    saveModelPreference(store,[{id:'Qwen3.8-Flash',label:'Qwen',kind:'platform'}],'Qwen3.8-Flash','xhigh');
    assert.equal(modelPreference(store,'zcode').model,zcodeDefaultModel);
    saveModelPreference(store,[{id:zcodeDefaultModel,label:zcodeDefaultModel,kind:'platform'}],zcodeDefaultModel,undefined,'zcode');
    store.close();store=new Store(dir);
    assert.equal(modelPreference(store).agent,'qoder-cn');assert.equal(modelPreference(store).reasoningEffort,'xhigh');
    assert.equal(modelPreference(store,'zcode').model,zcodeDefaultModel);
    assert.equal(agentIdSchema.parse('zcode'),'zcode');
    assert.throws(()=>executionPolicySchema.parse({budgets:[{agent:'zcode',model:zcodeDefaultModel,maxCredits:1}]}));
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});
test('ZCode cannot receive file authority, delivery inputs, Qoder effort or extra user turns',()=>{
  const base={agent:'zcode',mode:'probe',allowedFiles:[],maxTurns:1} as unknown as Submission;
  assert.doesNotThrow(()=>validateZcodeTask(base));
  for(const patch of [{mode:'files'},{allowedFiles:['out.md']},{inputs:[{taskId:'x',paths:['a']}]},{reasoningEffort:'xhigh'},{maxTurns:2},{capabilities:{skills:['private'],tools:[]}}])assert.throws(()=>validateZcodeTask({...base,...patch} as Submission));
  assert.doesNotThrow(()=>validateZcodeTask({...base,mode:'shared',capabilities:{skills:['approved'],tools:[]}}));
});
test('local encrypted credentials decode only the official verified format and auth stays in memory',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'helm-zcode-auth-')),file=join(dir,'credentials.json'),token='fixture-product-jwt-not-a-live-credential';
  writeFileSync(file,JSON.stringify({zcodejwttoken:encrypt(token),unrelated:'do-not-forward'}),{mode:0o600});
  const before=readFileSync(file,'utf8');
  try{
    assert.equal(decodeZcodeCredential(encrypt(token)),token);
    for(const value of ['plaintext','enc:v1:bad','','enc:v1:AA.BB.CC'])assert.throws(()=>decodeZcodeCredential(value));
    assert.deepEqual(await zcodeRequestAuth(file,providerId,AbortSignal.timeout(1000)),{headersApplied:true,requestAuth:{apiKey:token}});
    await assert.rejects(zcodeRequestAuth(file,'account:bigmodel-individual-coding-plan',AbortSignal.timeout(1000)));
    const controller=new AbortController();controller.abort();await assert.rejects(zcodeRequestAuth(file,providerId,controller.signal));
    assert.equal(readFileSync(file,'utf8'),before);
    const task=join(dir,'task');prepareZcodeState(task);
    assert.equal(JSON.stringify(readdirSync(join(task,'zcode-state/.zcode/v2'))).includes('credentials'),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('success requires matching account/model, complete stop reason and no pending tools',()=>{
  const value={selection:{providerId,modelId:zcodeDefaultModel},text:'ok',finishReason:'stop',usage:{inputTokens:10,outputTokens:2,totalTokens:12}};
  assert.equal(zcodeResult(value,zcodeDefaultModel,providerId).result,'ok');
  for(const patch of [{selection:{providerId,modelId:'GLM-5.3'}},{selection:{providerId:'other',modelId:zcodeDefaultModel}},{finishReason:'length'},{finishReason:undefined},{toolCalls:[{name:'Bash'}]},{text:null}])assert.throws(()=>zcodeResult({...value,...patch},zcodeDefaultModel,providerId));
  assert.equal(zcodeResult({...value,usage:{}},zcodeDefaultModel,providerId).usage.input_tokens,null);
  assert.match(zcodeFailure('request has been blocked due to unusual activity.'),/风控/);
  assert.match(zcodeFailure('[1113] balance insufficient'),/额度/);
  assert.equal(zcodeFailure('private-token-secret'),zcodeFailure('other unknown error'));
});

async function fixture(run:(value:{task:Task;executor:ZcodeExecutor;root:string;events:[string,any][];gatewayCalls:()=>number})=>Promise<void>,behavior='success',shared=false) {
  const root=mkdtempSync(join(tmpdir(),'helm-zcode-executor-')),previousHome=process.env.HOME,previousCLI=process.env.HELMDESK_ZCODE_CLI;
  const home=join(root,'home'),runtime=join(root,'runtime/zcode.cjs'),data=join(root,'data'),id='fixture-task',workspace=join(data,'tasks',id,'workspace'),credentials=join(home,'.zcode/v2/credentials.json');
  for(const dir of [join(home,'.zcode/v2'),join(root,'runtime/provider'),workspace])mkdirSync(dir,{recursive:true});
  process.env.HOME=home;process.env.HELMDESK_ZCODE_CLI=runtime;
  const secret='fixture-auth-'+randomBytes(12).toString('hex');
  writeFileSync(credentials,JSON.stringify({zcodejwttoken:encrypt(secret)}),{mode:0o600});writeFileSync(join(home,'.zcode/v2/setting.json'),JSON.stringify({providerFamilyDomain:'bigmodel'}));
  writeFileSync(join(workspace,'original.txt'),'untouched');
  writeFileSync(join(root,'runtime/provider/zcode-builtin.json'),JSON.stringify(catalog));
  // Real subprocess + real OS sandbox, with deterministic upstream protocol instead of paid inference.
  writeFileSync(runtime,`const fs=require('fs');if(process.argv.includes('--version')){console.log('0.17.0');process.exit(0)}
let buffer='',request,step=0;const output=v=>process.stdout.write(JSON.stringify(v)+'\\n');
process.stdin.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\\n'))>=0){const value=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);
if(value.method==='provider/updateAccountConfig'){if(${JSON.stringify(behavior)}==='config-failure'){output({id:value.id,error:{message:'invalid protocol setup'}});continue;}output({id:value.id,result:{status:'received'}});continue;}
if(value.method==='workspace/generateText'){request=value;step++;if(${JSON.stringify(behavior)}==='malformed'){output({id:value.id});continue;}if(${JSON.stringify(behavior)}==='risk'){output({id:value.id,error:{message:'blocked due to unusual activity private-unrelated-credential'}});continue;}
for(const p of ${JSON.stringify([credentials,join(workspace,'original.txt')])}){try{fs.readFileSync(p);output({id:value.id,error:{message:'sandbox-read-failed'}});process.exit(9)}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e;}}
if(value.params.selection.modelId!=='GLM-5.3-Flash'||value.params.selection.providerId!==${JSON.stringify(providerId)}||value.params.tools.length!==${shared?1:0})process.exit(10);
output({id:900+step,method:'interaction/requestProviderRuntimeHeaders',params:{providerId:${JSON.stringify(providerId)},modelSelection:value.params.selection,workspace:value.params.workspace}});continue;}
if(value.id===900+step){if(value.result?.requestAuth?.apiKey!==${JSON.stringify(secret)})process.exit(11);
const selection=${behavior==='mismatch'?JSON.stringify({providerId,modelId:'GLM-5.3'}):'request.params.selection'};
const pending=${shared?'step===1':'false'};
output({id:request.id,result:{text:pending?'':'HELMDESK_FIXTURE_OK\\u2028tail',selection,finishReason:pending?'tool-calls':'stop',usage:{inputTokens:10,outputTokens:2,totalTokens:12},...(pending?{toolCalls:[{id:'tool-1',name:'read_skill',input:{skillId:'fixture',path:'SKILL.md'}}]}:{})}});}
}});`);
  let calls=0;const server=createServer((req,res)=>{calls++;assert.equal(req.url,'/gateway/fixture/read-skill');let body='';req.on('data',c=>body+=c);req.on('end',()=>{assert.deepEqual(JSON.parse(body),{skillId:'fixture',path:'SKILL.md'});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({content:[{type:'text',text:'approved fixture skill'}]}));});});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as {port:number};
  const gateway={url:`http://127.0.0.1:${address.port}/gateway/fixture`,token:'fixture-token',skills:[{id:'fixture',files:['SKILL.md']}],tools:[]};
  const sharing={open:async()=>({gateway,run:{skills:[],tools:[],sourceChecks:[]}}),gateway:()=>gateway,close:async()=>undefined} as unknown as Sharing;
  const task={id,agent:'zcode',mode:shared?'shared':'probe',model:zcodeDefaultModel,allowedFiles:[],maxTurns:1,timeoutSeconds:10,workspace,prompt:'fixture prompt'} as unknown as Task,executor=new ZcodeExecutor(data,shared?sharing:undefined),events:[string,any][]=[];
  try{await executor.verify();await executor.prepare(task);await run({task,executor,root,events,gatewayCalls:()=>calls});assert.equal(readFileSync(join(workspace,'original.txt'),'utf8'),'untouched');}
  finally{await executor.finalize(task);await new Promise<void>(resolve=>server.close(()=>resolve()));if(previousHome===undefined)delete process.env.HOME;else process.env.HOME=previousHome;if(previousCLI===undefined)delete process.env.HELMDESK_ZCODE_CLI;else process.env.HELMDESK_ZCODE_CLI=previousCLI;rmSync(root,{recursive:true,force:true});}
}
test('sandboxed ZCode executes the exact protocol, hides credentials/project and preserves LF framing',async()=>{
  await fixture(async({task,executor,events})=>{const execution=executor.start(task,(type,value)=>events.push([type,value]));assert.equal((await execution.finished).code,0);const result=events.find(([type])=>type==='result')?.[1];assert.equal(result.result,'HELMDESK_FIXTURE_OK\u2028tail');assert.equal(result.usage.input_tokens,10);});
});
test('ZCode shared mode forwards only the selected read-only gateway and accumulates tokens once',async()=>{
  await fixture(async({task,executor,events,gatewayCalls})=>{await executor.start(task,(type,value)=>events.push([type,value])).finished;assert.equal(gatewayCalls(),1);assert.equal(events.filter(([type])=>type==='zcode_tool').length,1);assert.equal(events.find(([type])=>type==='result')?.[1].usage.input_tokens,20);},'success',true);
});
test('model mismatch and upstream risk errors fail closed without fallback or success result',async()=>{
  for(const behavior of ['mismatch','risk'])await fixture(async({task,executor,events,gatewayCalls})=>{await assert.rejects(executor.start(task,(type,value)=>events.push([type,value])).finished,behavior==='risk'?/风控/:/不符/);assert.equal(events.some(([type])=>type==='result'),false);assert.equal(gatewayCalls(),0);},behavior);
});

test('malformed ZCode output releases the scheduler slot and permits the next independent task', {timeout:5000},async()=>{
  await fixture(async({executor,root})=>{
    const data=join(root,'data'),projectPath=join(root,'project');mkdirSync(projectPath);writeFileSync(join(projectPath,'README.md'),'fixture');
    const store=new Store(data),scheduler=new Scheduler(store,executor,[projectPath],1);
    try{
      for(let i=0;i<2;i++){
        const task=scheduler.submit({agent:'zcode',title:'malformed fixture',prompt:'fixture',projectPath,model:zcodeDefaultModel,mode:'probe',allowedFiles:[],acceptanceCriteria:['fixture'],dependencies:[],maxTurns:1,timeoutSeconds:10});
        const result=await scheduler.wait(task.id,0,1500);assert.equal(result.task.state,'failed');assert.match(result.task.error??'',/无效/);
        await new Promise<void>(resolve=>setImmediate(resolve));
        assert.equal(scheduler.queue().active,0);
      }
    }finally{scheduler.stop();store.close();}
  },'malformed');
});
test('configuration rejection cleans up immediately without waiting for the task timeout',{timeout:2000},async()=>{
  await fixture(async({task,executor})=>{await assert.rejects(executor.start(task,()=>{}).finished,/拒绝/);},'config-failure');
});
