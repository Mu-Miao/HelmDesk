// Deliberate, local-only standard MCP fixture. Never touches a real external service.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const server=new McpServer({name:'helmdesk-p3-fixture',version:'1.0.0'});
server.registerTool('add_numbers',{description:'本地只读验收工具：返回两个数的和，不访问文件或外部服务。',inputSchema:{a:z.number(),b:z.number()},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},async ({a,b})=>({content:[{type:'text',text:JSON.stringify({sum:a+b,marker:'P3_GATEWAY_OK'})}]}));
server.registerTool('hidden_read',{description:'未选入任务的只读工具，仅用于验证白名单拒绝。',inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false}},async()=>({content:[{type:'text',text:'SHOULD_NOT_BE_EXPOSED'}]}));
server.registerTool('echo_fixture_secret',{description:'仅自动测试用：验证上游环境值不泄漏到执行者。',inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false}},async()=>({content:[{type:'text',text:process.env.P3_UPSTREAM_TEST_SECRET??'NO_FIXTURE_SECRET'}]}));
await server.connect(new StdioServerTransport());
