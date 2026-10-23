import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {antigravitySandboxProfile} from '../src/antigravity-executor.js';
import type {WorkerGateway} from '../src/capability-types.js';

test('native stdio bridge forwards only selected read-only tools under agy OS isolation',{skip:process.platform!=='darwin'},async()=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'helm-shared-bridge-'))),workspace=join(root,'workspace');mkdirSync(workspace);
  let calls=0,revoked=false;
  const server=createServer(async(req,res)=>{
    assert.equal(req.headers.authorization,'Bearer '+'a'.repeat(64));
    let body='';for await(const chunk of req)body+=chunk;
    assert.deepEqual(JSON.parse(body),{skillId:'guide',path:'SKILL.md'});
    assert.equal(req.url,'/gateway/00000000-0000-0000-0000-000000000000/read-skill');calls++;
    res.writeHead(revoked?403:200,{'Content-Type':'application/json'});res.end(JSON.stringify(revoked?{error:'revoked'}:{content:[{type:'text',text:'IMMUTABLE_GUIDE'}]}));
  });
  const client=new Client({name:'host-verifier',version:'1'});
  try {
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
    const port=(server.address() as {port:number}).port;
    const gateway:WorkerGateway={url:`http://127.0.0.1:${port}/gateway/00000000-0000-0000-0000-000000000000`,token:'a'.repeat(64),skills:[{id:'guide',source:'/fixture',version:'1',sha256:'b'.repeat(64),fileCount:1,bytes:5,files:['SKILL.md']}],tools:[]};
    const descriptor=join(root,'gateway.json');writeFileSync(descriptor,JSON.stringify(gateway),{mode:0o400});
    const transport=new StdioClientTransport({command:'/usr/bin/sandbox-exec',args:['-p',antigravitySandboxProfile(root,workspace,process.execPath),process.execPath,'--import',import.meta.resolve('tsx'),resolve('src/shared-mcp.ts'),descriptor],cwd:root,env:{PATH:process.env.PATH??'/usr/bin:/bin',TMPDIR:root,TMP:root,TEMP:root,TSX_DISABLE_CACHE:'1'},stderr:'pipe'});
    let diagnostics='';transport.stderr?.on('data',chunk=>{diagnostics+=String(chunk).slice(0,2000);});
    try{await client.connect(transport,{timeout:10000});}catch(error){throw Error(`Bridge did not connect: ${diagnostics}`,{cause:error});}
    const catalog=await client.listTools();assert.deepEqual(catalog.tools.map(t=>t.name),['read_skill']);
    assert.equal(catalog.tools[0]?.annotations?.readOnlyHint,true);
    assert.ok(!JSON.stringify(catalog).includes(gateway.token));
    const reply=await client.callTool({name:'read_skill',arguments:{skillId:'guide',path:'SKILL.md'}});
    assert.deepEqual(reply.content,[{type:'text',text:'IMMUTABLE_GUIDE'}]);assert.equal(calls,1);
    const denied=await client.callTool({name:'read_skill',arguments:{skillId:'other',path:'SKILL.md'}});assert.equal(denied.isError,true);assert.equal(calls,1);
    const missing=await client.callTool({name:'call',arguments:{tool:'other/write',arguments:{}}});assert.equal(missing.isError,true);assert.equal(calls,1);
    revoked=true;
    const closed=await client.callTool({name:'read_skill',arguments:{skillId:'guide',path:'SKILL.md'}});assert.equal(closed.isError,true);assert.equal(calls,2);
  }finally{await client.close();await new Promise<void>(r=>server.close(()=>r()));rmSync(root,{recursive:true,force:true});}
});
