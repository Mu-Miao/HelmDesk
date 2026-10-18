// Explicit host-only setup. Never called by an executor or normal service startup.
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {existsSync,readFileSync,writeFileSync,copyFileSync,chmodSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const data=resolve('.helmdesk'),entry=resolve('dist/cli.js'),node=process.execPath;
const cli='/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
if(!existsSync(cli))throw Error('未发现本机官方 Codex CLI');
const legacyArgs=[entry,'mcp','--data-dir',data],args=[...legacyArgs,'--autostart-service','--concurrency','2'];
const client=new Client({name:'helmdesk-registration-check',version:'1'});
await client.connect(new StdioClientTransport({command:node,args,stderr:'pipe'}));
let names;
try{
 names=(await client.listTools()).tools.map(t=>t.name);
 assert.ok(names.includes('task_submit')&&names.includes('task_revision_prepare'));
 const r=await client.callTool({name:'queue_get',arguments:{}});assert.ok(!r.isError,'本地 MCP 无法连接调度服务');
}finally{await client.close();}
const read=()=>{try{return JSON.parse(execFileSync(cli,['mcp','get','helmdesk','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));}catch(error){if(error.status===1)return null;throw error;}};
const same=r=>r?.transport?.command===node&&JSON.stringify(r.transport.args)===JSON.stringify(args)&&r.enabled!==false;
let registered=read();
const legacy=r=>r?.transport?.command===node&&[legacyArgs,[...legacyArgs,'--autostart-service']].some(a=>JSON.stringify(r.transport.args)===JSON.stringify(a))&&r.enabled!==false;
if(registered&&!same(registered)&&!legacy(registered))throw Error('已存在不同 helmdesk 配置，拒绝覆盖');
if(!process.argv.includes('--apply')){console.log(JSON.stringify({ready:true,alreadyRegistered:!!registered,command:node,args,tools:names.length,applyFlag:'--apply'}));}
else{
 const config=join(process.env.CODEX_HOME??join(homedir(),'.codex'),'config.toml');
 let backup=null,before=null;
 if(!registered||legacy(registered)){
  if(existsSync(config)){before=readFileSync(config);backup=join(data,`codex-config-before-registration-${randomUUID()}.toml`);copyFileSync(config,backup);chmodSync(backup,0o600);}
  execFileSync(cli,['mcp','add','helmdesk','--',node,...args],{stdio:['ignore','pipe','pipe'],timeout:15000});
  registered=read();
 }
 assert.ok(same(registered),'官方 CLI 未确认预期注册内容');
 const priorPath=join(data,'p6-mcp-registration.json'),prior=existsSync(priorPath)?JSON.parse(readFileSync(priorPath,'utf8')):null;
const evidence={at:new Date().toISOString(),registered:true,enabled:registered.enabled!==false,command:node,args,tools:names.length,officialCLI:cli,backup:backup??prior?.backup??null,beforeSha256:before?createHash('sha256').update(before).digest('hex'):prior?.beforeSha256??null,afterSha256:createHash('sha256').update(readFileSync(config)).digest('hex'),currentChatToolLoaded:prior?.currentChatToolLoaded??null,note:'官方 CLI 已确认注册，本机 MCP 握手和只读调用通过；当前聊天工具目录是否刷新须以实际工具可用性为准。'};
 writeFileSync(join(data,'p6-mcp-registration.json'),JSON.stringify(evidence,null,2),{mode:0o600});
 console.log(JSON.stringify({registered:true,tools:names.length,currentChatToolLoaded:evidence.currentChatToolLoaded}));
}
