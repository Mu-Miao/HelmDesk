import { randomBytes, createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, mkdirSync, lstatSync } from 'node:fs';
import { join, isAbsolute, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Ajv } from 'ajv';
import { z } from 'zod';
import type { Store } from './store.js';
import type { Task } from './types.js';
import type { CapabilityCatalog, CapabilityRun, CapabilitySelection, SharedTool, WorkerGateway } from './capability-types.js';
import { analyzeSkillCompatibility } from './skill-compatibility.js';
import { readSkillTree, snapshotSkill, safeResourcePath } from './skill-snapshot.js';
import { mcpSandboxProfile, verifyTaskIsolation, protectedSourceRoots } from './isolation.js';
import { errorText, safeJson } from './redact.js';

const id = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
const sharingSchema = z.object({ version:z.literal(1), skills:z.array(z.object({id, path:z.string().min(1), version:z.string().min(1).max(80), approved:z.literal(true)}).strict()).max(20).default([]),
  servers:z.array(z.object({id, source:z.string().min(1).max(300), approved:z.literal(true), command:z.string().min(1), args:z.array(z.string()).max(30).default([]), readRoots:z.array(z.string().min(1)).max(15).default([]), tools:z.array(z.string().regex(/^[A-Za-z0-9_-]{1,80}$/)).max(20), envFrom:z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).max(10).default([])}).strict()).max(10).default([])
}).strict();
type ServerSource = z.infer<typeof sharingSchema>['servers'][number];
const ajv = new Ajv({strict:false,allErrors:false});
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const forbiddenTools = /(^|_)(task_brief_get|task_briefs_list|tasks_watch|task_submit|task_cancel|task_review|task_integration_check|task_patch_export|task_revision_prepare|task_revision_submit|model_preference_set|execution_policy_set|exec|execute|shell|bash|write|delete|remove|install|send|publish|memory)(_|$)/i;
interface Session { token:string; run:CapabilityRun; snapshotRoot:string; clients:Map<string,Client>; tools:Map<string,SharedTool>; calls:number; closed:boolean; busy:boolean; }

export class Sharing {
  private readonly configPath:string;
  private readonly configuration:z.infer<typeof sharingSchema>;
  private readonly configHash:string;
  private catalog?:CapabilityCatalog;
  private readonly sessions = new Map<string,Session>();
  constructor(readonly store:Store, private readonly baseUrl:string) {
    this.configPath=join(store.directory,'sharing.json');
    const raw=existsSync(this.configPath)?readFileSync(this.configPath,'utf8'):'{"version":1}';
    this.configuration=sharingSchema.parse(JSON.parse(raw)); this.configHash=digest(raw);
    const ids=[...this.configuration.skills.map(s=>s.id),...this.configuration.servers.map(s=>s.id)];
    if(new Set(ids).size!==ids.length) throw new Error('共享来源 ID 重复');
    for(const source of this.configuration.servers) {
      if(!isAbsolute(source.command) || !lstatSync(source.command).isFile()) throw new Error('本地 MCP 必须使用明确的可执行文件绝对路径');
      if(realpathSync(source.command)!==realpathSync(process.execPath)||!source.args[0]||!isAbsolute(source.args[0])||!/[.](mjs|cjs|js)$/.test(source.args[0])) throw new Error('首版本地 MCP 仅支持 Node 和明确的脚本入口，不运行 npx 安装器或 Shell');
      if(source.readRoots.some(path=>!isAbsolute(path)||['/',homedir(),store.directory].includes(realpathSync(path)))) throw new Error('MCP 只允许明确且有限的代码资源目录');
      if(source.envFrom.some(key=>/^(NODE_|DYLD_|LD_|QODER|QODERCN|HELMDESK|HOME$|PATH$)/.test(key))) throw new Error('MCP 不允许继承运行控制或执行者认证变量');
      if(source.tools.some(tool=>forbiddenTools.test(tool))) throw new Error('第一版网关只共享选定的只读工具，不允许派活、执行、写入或通信工具');
    }
  }
  roots() { return protectedSourceRoots([...this.configuration.skills.map(s=>s.path),...this.configuration.servers.map(s=>dirname(s.args[0]!))]); }
  private serverDigest(source:ServerSource) {
    const entry=source.args[0]!, stat=lstatSync(entry);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2_000_000) throw new Error('MCP 入口必须是小型常规脚本文件');
    return digest(JSON.stringify(source)+readFileSync(entry,'utf8'));
  }
  private redactUpstream(serverId:string,text:string) {
    const source=this.configuration.servers.find(server=>server.id===serverId);
    for(const key of source?.envFrom??[]) {const value=process.env[key];if(value) text=text.replaceAll(value,'[REDACTED]');}
    return text;
  }
  private scrubUpstream(serverId:string,value:unknown):unknown {
    if(typeof value==='string') return this.redactUpstream(serverId,value);
    if(Array.isArray(value)) return value.map(item=>this.scrubUpstream(serverId,item));
    if(value&&typeof value==='object') return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,this.scrubUpstream(serverId,item)]));
    return value;
  }
  view():CapabilityCatalog {
    return this.catalog ?? {enabled:false,direction:'Codex → 选定快照／只读网关 → 执行者',reason:'尚未刷新共享目录；仅使用启动时明确配置的来源，不自动导出 Codex 配置。',sampledAt:new Date().toISOString(),skills:[],servers:[],exclusions:this.exclusions()};
  }
  private exclusions() { return ['不共享领航台派活工具、Shell、写入型 MCP、安装或记忆工作流','应用托管连接器与 OAuth 授权不自动迁移；无正式入口时由 Codex 调用','兼容性分类只是提示；实际权限由任务白名单、网关与 OS 沙箱执行']; }
  private checkConfig() {
    const raw=existsSync(this.configPath)?readFileSync(this.configPath,'utf8'):'{"version":1}';
    if(digest(raw)!==this.configHash) throw new Error('共享配置已变化，请重启服务加载；不会静默扩大已有任务权限');
  }
  private async connect(source:ServerSource, directory:string, taskDirectory:string) {
    mkdirSync(directory,{recursive:true,mode:0o700});
    const client=new Client({name:'helmdesk-readonly-gateway',version:'0.1.0'});
    const env:Record<string,string>={PATH:process.env.PATH??'/usr/bin:/bin',HOME:directory,TMPDIR:directory,XDG_CACHE_HOME:directory,CI:'1'};
    for(const key of source.envFrom) if(process.env[key]) env[key]=process.env[key]!;
    const protectedRoots=[...protectedSourceRoots(this.configuration.skills.map(s=>s.path)),join(homedir(),'.qoder-cn'),join(homedir(),'.qoderworkcn'),join(homedir(),'.ssh'),join(homedir(),'.aws')];
    const workspace=join(taskDirectory,'workspace');
    const transport=new StdioClientTransport({command:'/usr/bin/sandbox-exec',args:['-p',mcpSandboxProfile(directory,existsSync(workspace)?workspace:directory,source.readRoots,protectedRoots),realpathSync(source.command),...source.args],env,cwd:directory,stderr:'pipe',maxBufferSize:256_000});
    transport.stderr?.on('data',()=>{}); // Never forward credentials or upstream stderr to the model/UI.
    try { await client.connect(transport,{timeout:10000}); return client; }
    catch(error) { await client.close(); throw new Error('本地 MCP 连接失败（请在宿主检查来源和兼容性）'); }
  }
  private async listTools(client:Client, source:ServerSource):Promise<SharedTool[]> {
    const listed=await client.listTools({}, {timeout:10000});
    return source.tools.map(name=>{
      const tool=listed.tools.find(t=>t.name===name);
      if(!tool || tool.annotations?.readOnlyHint!==true || tool.annotations?.destructiveHint===true) throw new Error('选定工具不存在或没有明确只读声明');
      if(forbiddenTools.test(name)) throw new Error('拒绝共享有副作用的工具');
      const text=JSON.stringify(tool.inputSchema); if(text.length>16000 || tool.description && tool.description.length>4000) throw new Error('MCP 工具描述超过限制');
      ajv.compile(tool.inputSchema);
      return {id:`${source.id}/${name}`,serverId:source.id,name,description:tool.description??name,inputSchema:tool.inputSchema,sourceSha256:this.serverDigest(source)};
    });
  }
  async refresh():Promise<CapabilityCatalog> {
    this.checkConfig();
    const skills=this.configuration.skills.map(source=>{
      try {
        if(!isAbsolute(source.path)) throw new Error('技能来源须为绝对目录');
        const tree=readSkillTree(source.path);
        const analysis=analyzeSkillCompatibility([...tree.files].map(([path,bytes])=>({path,content:bytes.toString('utf8')})));
        return {id:source.id,source:tree.root,version:source.version,sha256:tree.sha256,fileCount:tree.files.size,bytes:tree.bytes,...analysis};
      } catch(error) { return {id:source.id,source:resolve(source.path),version:source.version,sha256:'',fileCount:0,bytes:0,status:'blocked' as const,reasons:[errorText(error)]}; }
    });
    const servers:CapabilityCatalog['servers']=[];
    for(const source of this.configuration.servers) {
      const root=join(this.store.directory,'catalog-mcp',source.id); let client:Client|undefined;
      try {client=await this.connect(source,root,root); servers.push({id:source.id,source:source.source,status:'ready',tools:await this.listTools(client,source)});}
      catch(error) {servers.push({id:source.id,source:source.source,status:'unavailable',reason:errorText(error),tools:[]});}
      finally {await client?.close();}
    }
    this.catalog={enabled:skills.some(s=>s.status==='compatible')||servers.some(s=>s.status==='ready'),direction:'Codex → 选定快照／只读网关 → 执行者',reason:'仅列出明确选择的来源；每项任务另行选择，默认不共享。',sampledAt:new Date().toISOString(),skills,servers,exclusions:this.exclusions()};
    this.store.snapshot('capabilities',this.catalog); return this.catalog;
  }
  async select(selection:CapabilitySelection):Promise<Record<string,string>> {
    if(new Set(selection.skills).size!==selection.skills.length || new Set(selection.tools).size!==selection.tools.length) throw new Error('共享能力选择重复');
    if(!selection.skills.length&&!selection.tools.length) return {};
    const catalog=await this.refresh(), pins:Record<string,string>={};
    for(const id of selection.skills) {const skill=catalog.skills.find(s=>s.id===id); if(!skill||skill.status!=='compatible') throw new Error('技能不可直接共享，请在工具来源页检查兼容状态'); pins[id]=skill.sha256;}
    for(const id of selection.tools) {const tool=catalog.servers.flatMap(s=>s.tools).find(t=>t.id===id); if(!tool) throw new Error('MCP 工具不在已批准的只读目录'); pins[id]=digest(JSON.stringify(tool));}
    return pins;
  }
  async open(task:Task):Promise<{run:CapabilityRun;gateway?:WorkerGateway}> {
    this.checkConfig();
    const selection=task.capabilities??{skills:[],tools:[]};
    const directory=join(this.store.directory,'tasks',task.id), snapshotRoot=join(directory,'capabilities');
    mkdirSync(snapshotRoot,{recursive:true,mode:0o700});
    const run:CapabilityRun={skills:[],tools:[],sourceChecks:[]};
    const session:Session={token:randomBytes(32).toString('hex'),run,snapshotRoot,clients:new Map(),tools:new Map(),calls:0,closed:false,busy:false};
    this.sessions.set(task.id,session);
    try {
      for(const id of selection.skills) {
        const source=this.configuration.skills.find(s=>s.id===id); if(!source) throw new Error('技能来源已移除');
        const pin=task.capabilityPins?.[id]; if(!pin) throw new Error('缺少技能固定摘要');
        const skill=snapshotSkill(id,source.path,source.version,join(snapshotRoot,id),pin); run.skills.push(skill); run.sourceChecks.push({id,before:pin});
      }
      const serverIds=new Set(selection.tools.map(t=>t.split('/')[0]!));
      for(const serverId of serverIds) {
        const source=this.configuration.servers.find(s=>s.id===serverId); if(!source) throw new Error('MCP 来源已移除');
        const client=await this.connect(source,join(directory,'mcp',serverId),directory); session.clients.set(serverId,client);
        for(const tool of await this.listTools(client,source)) if(selection.tools.includes(tool.id)) {
          if(digest(JSON.stringify(tool))!==task.capabilityPins?.[tool.id]) throw new Error('MCP 工具描述已变化，请重新创建任务');
          session.tools.set(tool.id,tool); run.tools.push(tool);
        }
        run.sourceChecks.push({id:`mcp/${serverId}`,before:this.serverDigest(source)});
      }
      if(run.tools.length!==selection.tools.length) throw new Error('任务 MCP 白名单不完整');
      run.sourceChecks.push({id:'sharing-config',before:this.configHash});
      run.isolation=await verifyTaskIsolation(directory,this.roots(),snapshotRoot);
      if(!run.isolation.verified) throw new Error('P3 任务的只读快照／来源隔离验证失败');
      return {run,gateway:selection.skills.length||selection.tools.length?{url:`${this.baseUrl}/gateway/${task.id}`,token:session.token,skills:run.skills,tools:run.tools}:undefined};
    } catch(error) {await this.close(task.id); throw error;}
  }
  gateway(taskId:string) {
    const session=this.sessions.get(taskId); if(!session||session.closed) return undefined;
    return {url:`${this.baseUrl}/gateway/${taskId}`,token:session.token,skills:session.run.skills,tools:session.run.tools};
  }
  authorized(taskId:string,token:string) {const expected=this.sessions.get(taskId)?.token;return !!expected&&Buffer.byteLength(token)===Buffer.byteLength(expected)&&timingEqual(token,expected);}
  async dispatch(taskId:string, action:string, input:unknown) {
    const session=this.sessions.get(taskId), task=this.store.get(taskId);
    if(!session||session.closed||!['preparing','running'].includes(task.state)) throw new Error('任务网关已撤销');
    if(session.busy || ++session.calls>50) throw new Error('任务网关调用频率或总量超过限制');
    session.busy=true;
    let label='invalid';
    try {
      if(action==='read-skill') {
        const args=z.object({skillId:id,path:z.string().min(1).max(500)}).strict().parse(input); label=`${args.skillId}/${args.path}`;
        const skill=session.run.skills.find(s=>s.id===args.skillId);
        if(!skill || !safeResourcePath(args.path) || !skill.files.includes(args.path)) throw new Error('技能文件不在任务快照白名单');
        const tree=readSkillTree(join(session.snapshotRoot,args.skillId)); if(tree.sha256!==skill.sha256) throw new Error('只读快照摘要不符');
        const bytes=tree.files.get(args.path)!; if(bytes.includes(0)||bytes.length>64000) throw new Error('只通过网关返回小型文本资源');
        this.store.event(taskId,'gateway',{action,tool:label,allowed:true});
        return {content:[{type:'text',text:bytes.toString('utf8')}]};
      }
      if(action!=='call') throw new Error('网关操作不在白名单');
      const args=z.object({tool:z.string().max(140),arguments:z.record(z.string(),z.unknown())}).strict().parse(input); label=args.tool;
      const tool=session.tools.get(args.tool); if(!tool) throw new Error('MCP 工具不在任务白名单');
      if(!ajv.validate(tool.inputSchema,args.arguments)) throw new Error('MCP 参数不符合固定 schema');
      const result=await session.clients.get(tool.serverId)!.callTool({name:tool.name,arguments:args.arguments},undefined,{timeout:10000});
      if(session.closed) throw new Error('任务网关已撤销');
      const text=safeJson(this.scrubUpstream(tool.serverId,result)); if(text.length>64000) throw new Error('MCP 结果超过大小限制');
      this.store.event(taskId,'gateway',{action,tool:label,allowed:true,isError:result.isError===true});
      return JSON.parse(text);
    } catch(error) {const message=this.redactUpstream(label.split('/')[0]??'',errorText(error));this.store.event(taskId,'gateway',{action,tool:label,allowed:false,reason:message});throw new Error(message);}
    finally {session.busy=false;}
  }
  async close(taskId:string):Promise<CapabilityRun|undefined> {
    const session=this.sessions.get(taskId); if(!session) return undefined;
    session.closed=true; this.sessions.delete(taskId);
    await Promise.allSettled([...session.clients.values()].map(c=>c.close()));
    for(const check of session.run.sourceChecks) {
      try {
        const source=this.configuration.skills.find(s=>s.id===check.id),server=this.configuration.servers.find(s=>`mcp/${s.id}`===check.id);
        check.after=source?readSkillTree(source.path).sha256:server?this.serverDigest(server):digest(existsSync(this.configPath)?readFileSync(this.configPath,'utf8'):'{"version":1}');
        check.unchanged=check.after===check.before;
      } catch(error) {check.unchanged=false;check.error=errorText(error);}
    }
    this.store.event(taskId,'capability_audit',session.run);
    return session.run;
  }
  async shutdown() {await Promise.allSettled([...this.sessions.keys()].map(id=>this.close(id)));}
}

import { timingSafeEqual } from 'node:crypto';
function timingEqual(a:string,b:string) {return timingSafeEqual(Buffer.from(a),Buffer.from(b));}
