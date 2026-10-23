// Explicit real-account integration check. Consumes Google quota; never retries a task.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';

const data=resolve(process.env.HELMDESK_DATA_DIR??'.helmdesk');
const projectPath=resolve(process.argv[2]??'.helmdesk/antigravity-probe-project');
const model='gemini-3.8-flash-high';
const client=new Client({name:'helmdesk-antigravity-check',version:'1'});
const transport=new StdioClientTransport({command:process.execPath,args:[resolve('dist/cli.js'),'mcp','--data-dir',data,'--autostart-service','--concurrency','2'],stderr:'pipe'});
async function call(name,args={}) {
  const result=await client.callTool({name,arguments:args});
  if(result.isError)throw Error(result.content?.[0]?.text??'MCP error');
  return JSON.parse(result.content[0].text);
}
try {
  await client.connect(transport);
  const primary=await call('model_preference_get');
  const catalog=await call('models_list',{agent:'antigravity'});
  assert.ok(catalog.options.some(o=>o.id===model));
  await call('model_preference_set',{agent:'antigravity',model,makePrimary:false});
  assert.deepEqual(await call('model_preference_get'),primary);
  const before=execFileSync('/usr/bin/git',['-C',projectPath,'status','--porcelain'],{encoding:'utf8'});
  assert.equal(before,'','The dedicated probe repository must be clean.');
  const task=await call('task_submit',{agent:'antigravity',mode:'probe',title:'Gemini 辅助执行器 MCP 连通与用量验收',projectPath,maxTurns:1,timeoutSeconds:120,allowedFiles:[],prompt:'Only reply with exactly HELMDESK_GEMINI_MCP_OK. Do not use any tools, read files, run commands, or schedule work.',acceptanceCriteria:['Gemini 3.8 Flash High returns the exact marker','No file changes or tool actions','Google token usage is recorded separately; Qoder primary is unchanged']});
  console.log(JSON.stringify({taskId:task.id,state:task.state}));
  let result;
  for(let i=0;i<3;i++) {
    result=await call('task_wait',{taskId:task.id,after:result?.cursor??0,timeoutMs:45000});
    if(['completed','failed','waiting_user','cancelled'].includes(result.task.state))break;
  }
  writeFileSync(join(data,'antigravity-mcp-last-run.json'),JSON.stringify(result,null,2),{mode:0o600});
  assert.equal(result.task.state,'completed',result.task.error);
  assert.equal(result.task.reportedModel,model);
  assert.equal(result.task.summary.trim(),'HELMDESK_GEMINI_MCP_OK');
  assert.deepEqual(result.task.changes,[]);
  assert.equal(execFileSync('/usr/bin/git',['-C',projectPath,'status','--porcelain'],{encoding:'utf8'}),'');
  assert.deepEqual(await call('model_preference_get'),primary);
  const usage=await call('usage_get',{taskId:task.id});
  assert.equal(usage.task.taskCredits,null);
  assert.equal(usage.task.usd,null);
  assert.equal(usage.account.source,'Antigravity');
  const evidence='Exact marker returned by gemini-3.8-flash-high in strict headless mode; task completed with no file changes, dedicated original repository remains clean, Qoder primary unchanged. Google tokens are retained, Credits/USD remain unknown.';
  await call('task_verify',{taskId:task.id,status:'passed',command:'node scripts/antigravity-smoke.mjs <dedicated-probe-repository>',evidence});
  const accepted=await call('task_review',{taskId:task.id,acceptance:'accepted',note:evidence});
  const report={at:new Date().toISOString(),taskId:task.id,state:accepted.state,acceptance:accepted.acceptance,model,primary,auxiliary:await call('model_preference_get',{agent:'antigravity'}),usage,checks:{exactReply:true,noFileChanges:true,primaryUnchanged:true,separateUsage:true}};
  writeFileSync(join(data,'antigravity-mcp-evidence.json'),JSON.stringify(report,null,2),{mode:0o600});
  console.log(JSON.stringify(report));
} finally {await client.close();}
