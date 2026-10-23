import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {antigravityDefaultModel,antigravityResult,antigravityUsage,detectAntigravity,parseAntigravityModels,prepareAntigravityState,validateAntigravityInit} from '../src/antigravity.js';
import {antigravitySandboxProfile,validateAntigravityTask} from '../src/antigravity-executor.js';
import {runCommand} from '../src/qoder.js';
import {Store} from '../src/store.js';
import {modelPreference,saveModelPreference} from '../src/model-selection.js';
import {agentIdSchema,modelPreferenceSchema,executionPolicySchema} from '../src/schema.js';
import type {Submission} from '../src/types.js';

test('agy model identities come from complete native tab-separated rows',()=>{
  assert.deepEqual(parseAntigravityModels('gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)\n'),[{id:antigravityDefaultModel,label:'Gemini 3.8 Flash (Medium)',kind:'platform'}]);
  for(const text of ['', 'Fetching models...', 'model Model', '-flag\tBad','gemini\tOne\ngemini\tTwo','model\tlabel\tsecret'])assert.throws(()=>parseAntigravityModels(text));
});

test('native help on stderr is accepted without mixing model stdout with diagnostics',async()=>{
  const root=mkdtempSync(join(tmpdir(),'helm-agy-help-')),runtime=join(root,'agy');
  const previous=process.env.HELMDESK_AGY_CLI;
  writeFileSync(runtime,'#!/bin/sh\ncase "$1" in\n--version) echo 1.4.6;;\n--help) echo "--input-format --output-format --agent --disable-slash-commands" >&2;;\nesac\n');chmodSync(runtime,0o700);
  process.env.HELMDESK_AGY_CLI=runtime;
  try {assert.equal((await detectAntigravity()).available,true);}
  finally {if(previous===undefined)delete process.env.HELMDESK_AGY_CLI;else process.env.HELMDESK_AGY_CLI=previous;rmSync(root,{recursive:true,force:true});}
});

test('auxiliary preferences survive restart without replacing the Qoder primary',()=>{
  const directory=mkdtempSync(join(tmpdir(),'helm-agy-preferences-'));
  let store=new Store(directory);
  try {
    saveModelPreference(store,[{id:'primary',label:'Primary',kind:'custom'}],'primary');
    saveModelPreference(store,parseAntigravityModels(`${antigravityDefaultModel}\tGemini 3.8 Flash (Medium)`),antigravityDefaultModel,undefined,'antigravity');
    assert.equal(modelPreference(store).model,'primary');
    assert.equal(modelPreference(store,'antigravity').model,antigravityDefaultModel);
    store.close();store=new Store(directory);
    assert.equal(modelPreference(store).model,'primary');
    assert.equal(modelPreference(store,'antigravity').model,antigravityDefaultModel);
    assert.throws(()=>saveModelPreference(store,[{id:antigravityDefaultModel,label:'Flash',kind:'platform'}],antigravityDefaultModel,'xhigh','antigravity'));
    assert.equal(modelPreference(store).model,'primary');
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('auxiliary tasks cannot obtain files, inputs, shared tools, Qoder effort or extra user turns',()=>{
  const base={agent:'antigravity',mode:'probe',model:antigravityDefaultModel,allowedFiles:[],maxTurns:1} as unknown as Submission;
  assert.doesNotThrow(()=>validateAntigravityTask(base));
  for(const patch of [{mode:'files'},{allowedFiles:['out.md']},{inputs:[{taskId:'source',paths:['in.md']}]},{capabilities:{skills:[],tools:['a/b']}},{capabilities:{skills:['a'],tools:[]}},{reasoningEffort:'low'},{maxTurns:2}])assert.throws(()=>validateAntigravityTask({...base,...patch} as Submission));
  assert.equal(agentIdSchema.parse('antigravity'),'antigravity');
  assert.equal(modelPreferenceSchema.parse({agent:'antigravity',model:antigravityDefaultModel,makePrimary:false}).makePrimary,false);
  assert.throws(()=>executionPolicySchema.parse({budgets:[{agent:'antigravity',model:antigravityDefaultModel,maxCredits:1}]}));
});

test('native success and usage are accepted only with complete single-turn evidence',()=>{
  const value={status:'SUCCESS',conversation_id:'fixture',response:'ok',num_turns:1,usage:{input_tokens:12,output_tokens:3,thinking_tokens:2,cache_read_tokens:0,total_tokens:15}};
  const result=antigravityResult(value);
  assert.equal(result.result,'ok');
  assert.deepEqual(result.usage,{input_tokens:12,output_tokens:3});
  assert.deepEqual(result.antigravityUsage,{thinkingTokens:2,cacheReadTokens:0,totalTokens:15});
  assert.deepEqual(antigravityResult({...value,usage:{}}).usage,{input_tokens:null,output_tokens:null});
  assert.equal(antigravityResult({...value,usage:{input_tokens:-1}}).usage.input_tokens,null);
  for(const patch of [{status:'ERROR'},{status:'INCOMPLETE'},{response:''},{num_turns:2},{conversation_id:''},{denied_actions:[{tool:'run_command'}]},{error:'quota'}])assert.throws(()=>antigravityResult({...value,...patch}));
  assert.throws(()=>antigravityResult(value,'other-session'));
  assert.deepEqual(antigravityUsage({...value,status:'ERROR'}).usage,{input_tokens:12,output_tokens:3});
});

test('the prompt gate requires exact CLI model, agent, workspace, conversation and strict mode',()=>{
  const value={conversation_id:'fixture',init:{model:antigravityDefaultModel,agent:'helmdesk-helper',cwd:'/task/empty',permission_mode:'strict'}};
  assert.equal(validateAntigravityInit(value,antigravityDefaultModel,'/task/empty'),'fixture');
  for(const patch of [{model:'other'},{agent:'default'},{cwd:'/source'},{permission_mode:'always-proceed'}])assert.throws(()=>validateAntigravityInit({...value,init:{...value.init,...patch}},antigravityDefaultModel,'/task/empty'));
  assert.throws(()=>validateAntigravityInit({...value,conversation_id:''},antigravityDefaultModel,'/task/empty'));
});

test('generated agy state contains no host configuration, scripts, MCP or credentials',()=>{
  const root=mkdtempSync(join(tmpdir(),'helm-agy-state-'));
  try {
    prepareAntigravityState(root);
    const settings=JSON.parse(readFileSync(join(root,'antigravity-cli/settings.json'),'utf8'));
    assert.equal(settings.useG1Credits,false);
    assert.equal(settings.allowNonWorkspaceAccess,false);
    assert.ok(settings.permissions.deny.includes('command(*)'));
    assert.deepEqual(JSON.parse(readFileSync(join(root,'config/mcp_config.json'),'utf8')),{mcpServers:{}});
    assert.match(readFileSync(join(root,'config/agents/helmdesk-helper/agent.md'),'utf8'),/tools: \[\]/);
    assert.ok(!Object.hasOwn(settings,'statusLine'));
    assert.ok(!Object.hasOwn(settings,'modelProvider'));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('agy OS boundary allows task state but refuses host reads, source writes and permission changes',{skip:process.platform!=='darwin'},async()=>{
  const parent=realpathSync(mkdtempSync(join(tmpdir(),'helm-agy-os-'))),directory=join(parent,'task'),workspace=join(directory,'workspace');
  mkdirSync(workspace,{recursive:true});prepareAntigravityState(join(directory,'agy-state'));
  const outside=join(parent,'host-source');writeFileSync(outside,'fixture');
  const settings=join(directory,'agy-state/antigravity-cli/settings.json');
  try {
    const program=`const fs=require('fs');fs.writeFileSync(${JSON.stringify(join(directory,'allowed'))},'ok');let blocked=0;for(const [action,path] of ${JSON.stringify([['read',outside],['write',join(workspace,'blocked')],['write',settings]])}){try{if(action==='read')fs.readFileSync(path);else{const fd=fs.openSync(path,fs.constants.O_WRONLY|fs.constants.O_CREAT);fs.closeSync(fd)}process.exit(9)}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e;blocked++}}console.log(blocked);`;
    const result=await runCommand('/usr/bin/sandbox-exec',['-p',antigravitySandboxProfile(directory,workspace,process.execPath),process.execPath,'-e',program]);
    assert.equal(result.code,0,result.stderr);assert.equal(result.stdout.trim(),'3');
    assert.equal(readFileSync(outside,'utf8'),'fixture');
    assert.equal(JSON.parse(readFileSync(settings,'utf8')).toolPermission,'strict');
  }finally{rmSync(parent,{recursive:true,force:true});}
});
