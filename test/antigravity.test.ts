import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {antigravityDefaultModel,antigravityResult,antigravityUsage,detectAntigravity,parseAntigravityModels,prepareAntigravityState,validateAntigravityInit} from '../src/antigravity.js';
import {antigravitySandboxProfile,validateAntigravityTask,validateAntigravityStep} from '../src/antigravity-executor.js';
import {runCommand} from '../src/qoder.js';
import {Store} from '../src/store.js';
import {modelPreference,saveModelPreference} from '../src/model-selection.js';
import {agentIdSchema,modelPreferenceSchema,executionPolicySchema,submissionSchema} from '../src/schema.js';
import type {Submission} from '../src/types.js';
import type {WorkerGateway} from '../src/capability-types.js';

test('MCP parsing preserves an omitted mode so the host can select the agent default',()=>{
  const input={agent:'antigravity',title:'shared fixture',prompt:'fixture',projectPath:'/fixture',acceptanceCriteria:['fixture']};
  assert.equal(Object.hasOwn(submissionSchema.parse(input),'mode'),false);
  for(const mode of ['probe','shared','files'])assert.equal(submissionSchema.parse({...input,mode}).mode,mode);
});

test('agy model identities come from complete native tab-separated rows',()=>{
  assert.deepEqual(parseAntigravityModels('gemini-3.8-flash-high\tGemini 3.8 Flash (High)\n'),[{id:antigravityDefaultModel,label:'Gemini 3.8 Flash (High)',kind:'platform'}]);
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
    saveModelPreference(store,parseAntigravityModels(`${antigravityDefaultModel}\tGemini 3.8 Flash (High)`),antigravityDefaultModel,undefined,'antigravity');
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

test('shared agy grants only selected gateway tools and rejects unrelated or cross-session steps',()=>{
  const root=mkdtempSync(join(tmpdir(),'helm-agy-shared-'));
  const gateway:WorkerGateway={url:'http://127.0.0.1:4317/gateway/00000000-0000-0000-0000-000000000000',token:'a'.repeat(64),skills:[{id:'guide',files:['SKILL.md'],source:'/fixture',version:'1',sha256:'b'.repeat(64),fileCount:1,bytes:5}],tools:[]};
  try {
    prepareAntigravityState(root,gateway);
    const settings=JSON.parse(readFileSync(join(root,'antigravity-cli/settings.json'),'utf8'));
    assert.deepEqual(settings.permissions.allow,['mcp(helm/read_skill)']);
    assert.ok(settings.permissions.deny.includes('read_file(*)'));
    assert.ok(settings.permissions.deny.includes('command(*)'));
    const mcp=JSON.parse(readFileSync(join(root,'config/mcp_config.json'),'utf8'));
    assert.deepEqual(Object.keys(mcp.mcpServers),['helm']);
    assert.equal(mcp.mcpServers.helm.command,realpathSync(process.execPath));
    assert.equal(JSON.stringify(mcp).includes(gateway.token),false);
    const agent=readFileSync(join(root,'config/agents/helmdesk-helper/agent.md'),'utf8');
    assert.match(agent,/mcpServers: \[\]\ninheritMcp: true/);
    const task={mode:'shared',allowedFiles:[],capabilities:{skills:['guide'],tools:[]},maxTurns:1} as unknown as Submission;
    assert.doesNotThrow(()=>validateAntigravityTask(task));
    for(const patch of [{allowedFiles:['x']},{inputs:[{taskId:'x',paths:['x']}]},{maxTurns:2}])assert.throws(()=>validateAntigravityTask({...task,...patch} as Submission));
    const step={conversation_id:'session',step_type:'tool',tool_name:'mcp__helm__read_skill'};
    assert.doesNotThrow(()=>validateAntigravityStep(step,'session',gateway));
    const lazy={...step,tool_name:'call_mcp_tool',tool_info:{name:'call_mcp_tool',parameters:{ServerName:'helm',ToolName:'read_skill',Arguments:{skillId:'guide',path:'SKILL.md'}}}};
    assert.doesNotThrow(()=>validateAntigravityStep(lazy,'session',gateway));
    for(const parameters of [{ServerName:'other',ToolName:'read_skill'},{ServerName:'helm',ToolName:'call'}])assert.throws(()=>validateAntigravityStep({...lazy,tool_info:{...lazy.tool_info,parameters}},'session',gateway),/未授权/);
    assert.throws(()=>validateAntigravityStep(step,'other',gateway),/会话/);
    assert.throws(()=>validateAntigravityStep(step,'session'),/未授权/);
    for(const tool_name of ['run_command','read_file','mcp__helm__call','mcp__other__read_skill'])assert.throws(()=>validateAntigravityStep({...step,tool_name},'session',gateway),/未授权/);
    assert.throws(()=>validateAntigravityStep({...step,step_type:'error_message'},'session',gateway),/上游/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('agy OS boundary allows task state but refuses host reads, source writes and permission changes',{skip:process.platform!=='darwin'},async()=>{
  const parent=realpathSync(mkdtempSync(join(tmpdir(),'helm-agy-os-'))),directory=join(parent,'task'),workspace=join(directory,'workspace');
  mkdirSync(workspace,{recursive:true});prepareAntigravityState(join(directory,'agy-state'));
  const outside=join(parent,'host-source');writeFileSync(outside,'fixture');
  const source=join(workspace,'project-source');writeFileSync(source,'private project fixture');
  const settings=join(directory,'agy-state/antigravity-cli/settings.json'),config=join(directory,'agy-state/config'),projects=join(config,'projects');
  try {
    const program=`const fs=require('fs');fs.writeFileSync(${JSON.stringify(join(directory,'allowed'))},'ok');fs.mkdirSync(${JSON.stringify(projects)});fs.writeFileSync(${JSON.stringify(join(projects,'default-cli-project.json'))},'{}');let blocked=0;for(const [action,path] of ${JSON.stringify([['read',outside],['read',source],['write',join(workspace,'blocked')],['write',settings],['write',join(config,'mcp_config.json')],['write',join(config,'agents/helmdesk-helper/agent.md')],['write',join(config,'unauthorized.json')],['rename',config]])}){try{if(action==='read')fs.readFileSync(path);else if(action==='rename')fs.renameSync(path,path+'-moved');else{const fd=fs.openSync(path,fs.constants.O_WRONLY|fs.constants.O_CREAT);fs.closeSync(fd)}process.exit(9)}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e;blocked++}}console.log(blocked);`;
    const result=await runCommand('/usr/bin/sandbox-exec',['-p',antigravitySandboxProfile(directory,workspace,process.execPath),process.execPath,'-e',program]);
    assert.equal(result.code,0,result.stderr);assert.equal(result.stdout.trim(),'8');
    assert.equal(readFileSync(join(projects,'default-cli-project.json'),'utf8'),'{}');
    assert.equal(readFileSync(outside,'utf8'),'fixture');
    assert.equal(JSON.parse(readFileSync(settings,'utf8')).toolPermission,'strict');
  }finally{rmSync(parent,{recursive:true,force:true});}
});
