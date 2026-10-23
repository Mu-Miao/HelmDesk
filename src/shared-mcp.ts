import {readFileSync} from 'node:fs';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import type {WorkerGateway} from './capability-types.js';

// Task-owned immutable descriptor; never load global MCP configuration or host credentials.
const gateway=JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as WorkerGateway;
const url=new URL(gateway.url);
if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash||!/^\/gateway\/[a-f0-9-]{36}$/.test(url.pathname)||!/^[a-f0-9]{64}$/.test(gateway.token))throw Error('Invalid task gateway');
const server=new McpServer({name:'helm',version:'0.1.0'});
async function forward(action:string,args:unknown) {
  try {
    const response=await fetch(`${gateway.url}/${action}`,{method:'POST',headers:{Authorization:`Bearer ${gateway.token}`,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(15000),redirect:'error'});
    const text=await response.text();
    if(!response.ok||text.length>64000)throw Error('Gateway rejected request');
    return JSON.parse(text);
  } catch {return {isError:true,content:[{type:'text' as const,text:'任务只读网关拒绝调用或暂不可用'}]};}
}
const metadata={annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false},_meta:{'antigravity/alwaysLoad':true}};
if(gateway.skills.length)server.registerTool('read_skill',{...metadata,description:'读取本任务已选择的只读技能快照和引用文本。',inputSchema:z.object({skillId:z.enum(gateway.skills.map(s=>s.id) as [string,...string[]]),path:z.string().min(1).max(500)}).strict()},args=>forward('read-skill',args));
if(gateway.tools.length)server.registerTool('call',{...metadata,annotations:{...metadata.annotations,openWorldHint:true},description:'调用本任务白名单内的只读 MCP；arguments 必须符合任务提示中的工具 schema。',inputSchema:z.object({tool:z.enum(gateway.tools.map(t=>t.id) as [string,...string[]]),arguments:z.record(z.string(),z.unknown())}).strict()},args=>forward('call',args));
await server.connect(new StdioServerTransport());
