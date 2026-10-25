import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Store } from './store.js';
import { Scheduler } from './scheduler.js';
import { QoderExecutor } from './executor.js';
import { detectAgent, listModels } from './qoder.js';
import { submissionSchema, idSchema, modelPreferenceSchema, integrationSelectionSchema, integrationExportSchema, revisionRequestSchema, revisionSubmitSchema,agentIdSchema,executionPolicySchema } from './schema.js';
import { safeJson, errorText } from './redact.js';
import { modelPreference, saveModelPreference, selectModel } from './model-selection.js';
import { Sharing } from './sharing.js';
import { deliveryReport } from './delivery-report.js';
import { integrationPreview, integrationPatch } from './integration.js';
import {buildProjectSummaries} from './project-summary.js';
import {revisionDraft,revisionHash} from './revisions.js';
import {revisionFamily} from './revision-family.js';
import {agentCatalog,agentModels,AgentExecutor} from './agents.js';
import {executionPolicy,policyView} from './execution-policy.js';
import {modelCompatibility} from './model-compatibility.js';
import { appIdentity, type AppIdentity } from './app-runtime.js';
import {DesktopService} from './desktop-service.js';
import {desktopConfiguration} from './desktop-config.js';
import {BrowserTickets,BrowserSessions} from './browser-session.js';

import {briefSchema,taskBrief,briefPage,watchBriefs} from './review.js';
export function sameSecret(actual: string | undefined, expected: string) {
  const a = Buffer.from(actual ?? ''), b = Buffer.from(expected); return a.length === b.length && timingSafeEqual(a, b);
}
export function createApp(store: Store, scheduler: Scheduler, port: number, token: string, discoverModels = listModels, sharing = new Sharing(store,`http://127.0.0.1:${port}`), identity: AppIdentity = appIdentity(store.directory, port), stop?:()=>void) {
  const desktop=new DesktopService(store,scheduler,stop,port);
  const discoverFor=async(agent:import('./agent-types.js').AgentId)=>{const catalog=await(agent==='qoder-cn'?discoverModels():agentModels(agent));return{...catalog,options:agent==='qoder-cn'?modelCompatibility(catalog.options,store.list()):catalog.options};};
  const browserTickets = new BrowserTickets(), browserSessions = new BrowserSessions();
  const hostname = `127.0.0.1:${port}`, origin = `http://${hostname}`;
  async function execute(name: string, args: any): Promise<unknown> {
    const id = () => idSchema.parse(args.taskId);
    switch (name) {
      case 'agents_list': { const agents=await agentCatalog();store.snapshot('agents',agents);store.snapshot('agent',agents[0]);return agents; }
      case 'models_list': { const input=z.object({agent:agentIdSchema.optional()}).strict().parse(args),agent=input.agent??modelPreference(store).agent??'qoder-cn';const catalog=await discoverFor(agent); store.snapshot('models', {...catalog,agent}); return { ...catalog,agent, preference: modelPreference(store),agentPreference:modelPreference(store,agent) }; }
      case 'model_preference_get': {const input=z.object({agent:agentIdSchema.optional()}).strict().parse(args);return modelPreference(store,input.agent);}
      case 'model_preference_set': { const input = modelPreferenceSchema.parse(args),agent=input.agent??'qoder-cn'; const catalog = await discoverFor(agent); const preference = saveModelPreference(store, catalog.options, input.model, input.reasoningEffort,agent,input.makePrimary??(agent!=='antigravity'&&agent!=='zcode')); store.snapshot('models', {...catalog,agent}); return preference; }
      case 'execution_policy_get':return policyView(store);
      case 'execution_policy_set':{
        const input=executionPolicySchema.parse(args);if(input.budgets.length){const catalog=await discoverModels();for(const rule of input.budgets)selectModel(catalog.options,rule.model);}
        store.snapshot('executionPolicy',input);store.event('system','execution_policy',input);scheduler.kick();return policyView(store);
      }
      case 'task_brief_get':return taskBrief(store.get(briefSchema.parse(args).taskId));
      case 'task_briefs_list':return briefPage(store.list(),args);
      case 'tasks_watch':return watchBriefs(store,args);
      case 'task_list': return store.list();
      case 'project_summary_get': {
        const input=z.object({projectPath:z.string().min(1).max(2000).optional()}).strict().parse(args);
        return{sampledAt:new Date().toISOString(),projects:buildProjectSummaries(store.list()).filter(p=>!input.projectPath||p.path===input.projectPath),scope:'仅领航台记录的任务，模型分别统计；不是账号余额或完整消费账单'};
      }
      case 'task_revision_history': return revisionFamily(store.list(),id());
      case 'task_revision_prepare': {
        const input=revisionRequestSchema.parse(args),catalog=await discoverFor(store.get(input.taskId).agent??'qoder-cn');return revisionDraft(store.list(),input,catalog.options);
      }
      case 'task_revision_submit': {
        const input=revisionSubmitSchema.parse(args),requestHash=revisionHash(input);
        const previous=store.requestTask(input.requestId,requestHash);if(previous)return previous;
        const catalog=await discoverFor(store.get(input.taskId).agent??'qoder-cn');
        const afterCatalog=store.requestTask(input.requestId,requestHash);if(afterCatalog)return afterCatalog;
        const draft=revisionDraft(store.list(),input,catalog.options);if(draft.fingerprint!==input.fingerprint)throw Error('修订预览已过期，请重新准备');
        const capabilityPins=await sharing.select({skills:[],tools:[]});
        const afterSelection=store.requestTask(input.requestId,requestHash);if(afterSelection)return afterSelection;
        const current=revisionDraft(store.list(),input,catalog.options);if(current.fingerprint!==input.fingerprint)throw Error('修订预览已过期，请重新准备');
        const task=scheduler.submit({...current.submission,capabilityPins},{key:input.requestId,hash:requestHash});
        store.event(task.id,'revision_created',{sourceTaskId:input.taskId,rootTaskId:task.revision!.rootTaskId});
        store.event(input.taskId,'revision_spawned',{taskId:task.id});return task;
      }
      case 'queue_get': return scheduler.queue();
      case 'task_submit': {
        const parsed = submissionSchema.parse(args);
        const input={...parsed,mode:parsed.mode??'files'};
        const configurationRevision=desktopConfiguration(store.directory).revision;
        const preference = modelPreference(store);
        const agent=input.agent??preference.agent??'qoder-cn',catalog=await discoverFor(agent);
        if((agent==='antigravity'||agent==='zcode')&&parsed.mode===undefined) input.mode='shared';
        const requested=input.model??(agent===(preference.agent??'qoder-cn')?preference.model:(agent==='antigravity'||agent==='zcode')?modelPreference(store,agent).model:undefined);if(!requested)throw Error('指定其他执行器时须明确选择模型');
        const model = selectModel(catalog.options,requested,input.mode==='probe');
        const reasoningEffort = input.reasoningEffort ?? (agent===(preference.agent??'qoder-cn')&&model.id === preference.model ? preference.reasoningEffort : undefined);
        const maxTurns=input.maxTurns??(agent==='ollama'||agent==='antigravity'||agent==='zcode'?1:executionPolicy(store).maxTurns);
        if(input.mode==='probe'&&(input.capabilities?.skills.length||input.capabilities?.tools.length)) throw new Error('禁用工具的探测任务不能共享能力');
        const capabilities=sharing.selection(agent,input.mode,input.capabilities);
        const capabilityPins=await sharing.select(capabilities);
        if(configurationRevision!==desktopConfiguration(store.directory).revision)throw Error('执行设置在派发准备期间变化，请重新确认后派发');
        return scheduler.submit({ ...input,agent,maxTurns, model: model.id, modelLabel: model.label, reasoningEffort, capabilities, capabilityPins });
      }
      case 'task_get': return store.get(id());
      case 'task_disposition_set':return store.classifyTask(args);
      case 'task_export': return deliveryReport(store.get(id()));
      case 'task_integration_check': {
        const input=integrationSelectionSchema.parse(args),preview=integrationPreview(store.get(input.taskId),store.directory,input.paths);
        store.event(input.taskId,'integration_check',{paths:preview.files.map(f=>f.path),status:preview.status,counts:preview.counts,fingerprint:preview.fingerprint});
        return preview;
      }
      case 'task_patch_export': {
        const input=integrationExportSchema.parse(args),result=integrationPatch(store.get(input.taskId),store.directory,input.paths,input.fingerprint);
        store.event(input.taskId,'patch_export',{paths:result.preview.files.filter(f=>f.status==='ready').map(f=>f.path),sha256:result.sha256,filename:result.filename,fingerprint:result.preview.fingerprint});
        return result;
      }
      case 'task_events': { const after = z.number().int().min(0).parse(args.after ?? 0); store.get(id()); const events = store.events(after, id()); return { events, cursor: events.at(-1)?.seq ?? after }; }
      case 'task_wait': return scheduler.wait(id(), z.number().int().min(0).parse(args.after ?? 0), z.number().int().min(0).max(55000).parse(args.timeoutMs ?? 30000));
      case 'task_cancel': return scheduler.cancel(id());
      case 'task_verify': return scheduler.verifyTask(id(), { status: z.enum(['passed', 'failed', 'not_run']).parse(args.status), command: z.string().max(2000).parse(args.command ?? ''), evidence: z.string().min(1).max(8000).parse(args.evidence) });
      case 'task_review': return scheduler.review(id(), z.enum(['accepted', 'changes_requested']).parse(args.acceptance), z.string().min(1).max(4000).parse(args.note));
      case 'usage_get': { const task = args.taskId ? store.get(id()) : null; return { task: task?.usage ?? null, account: task?.agent==='zcode'?{available:false,source:'ZCode',reason:'尚未取得 ZCode 套餐余额；ZCode Tokens 与 Qoder Credits 分开'}:task?.agent==='antigravity'?{available:false,source:'Antigravity',reason:'尚未取得 Google 套餐额度快照；Qoder Credits 不代表 Google 余额'}:store.snapshot('quota') ?? { available: false, reason: '尚未取得官方用量接口快照' }, note: '每任务为新建会话，任务用量与会话累计不能相加；不汇总不同服务商余额' }; }
      case 'capabilities_list': return sharing.view();
      case 'capabilities_refresh': return sharing.refresh();
      default: throw new Error('未知工具');
    }
  }
  function send(res: ServerResponse, code: number, value: unknown) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(safeJson(value)); }
  const handle=async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (req.headers.host !== hostname || req.headers.origin && req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') { send(res, 403, { error: '仅允许本机同源请求' }); return; }
    let url:URL;
    try{url=new URL(req.url??'/',origin);if(url.origin!==origin)throw Error('foreign request target');}
    catch{send(res,400,{error:'请求地址无效'});return;}
    if(url.pathname.startsWith('/gateway/')) {
      const match=/^\/gateway\/([0-9a-f-]{36})\/(read-skill|call)$/.exec(url.pathname);
      if(!match||req.method!=='POST'||!sharing.authorized(match[1]!,req.headers.authorization?.replace(/^Bearer /,'')??'')) {send(res,401,{error:'任务网关身份无效或已撤销'});return;}
      if(!req.headers['content-type']?.startsWith('application/json')) {send(res,415,{error:'需要 application/json'});return;}
      try {let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>20000) throw new Error('网关请求过大');}send(res,200,await sharing.dispatch(match[1]!,match[2]!,JSON.parse(body)));}
      catch(error){send(res,400,{error:errorText(error)});}return;
    }
    const browserSession = browserSessions.get(req.headers['x-helmdesk-session']);
    const mcpSession = sameSecret(req.headers.authorization, `Bearer ${token}`);
    if (url.pathname === '/api/browser-ticket') {
      if (!mcpSession) { send(res, 401, {error:'网页入口需要本机私有身份授权'}); return; }
      if (req.method !== 'POST' || !req.headers['content-type']?.startsWith('application/json')) { send(res, 415, {error:'需要 POST application/json'}); return; }
      try {
        let body=''; for await (const chunk of req) { body+=chunk; if(Buffer.byteLength(body)>1024)throw Error('请求过大'); }
        z.object({}).strict().parse(JSON.parse(body));
        send(res,200,{...browserTickets.issue(),instanceId:identity.instanceId});
      } catch(error) { send(res,400,{error:errorText(error)}); } return;
    }
    if (req.method === 'POST' && url.pathname === '/api/session') {
      if (req.headers.origin !== origin || !req.headers['content-type']?.startsWith('application/json')) { send(res,403,{error:'网页入口需要同源 JSON 请求'}); return; }
      try {
        let body=''; for await (const chunk of req) { body+=chunk; if(Buffer.byteLength(body)>1024)throw Error('请求过大'); }
        const input=z.object({ticket:z.string().length(64).regex(/^[a-f0-9]{64}$/)}).strict().parse(JSON.parse(body));
        if(!browserTickets.consume(input.ticket)){send(res,401,{error:'网页入口已使用或过期，请从应用重新打开'});return;}
        send(res,200,browserSessions.issue());
      }catch(error){send(res,400,{error:errorText(error)});}return;
    }
    if (req.method === 'GET' && url.pathname === '/api/session') {
      if(!browserSession&&!mcpSession){send(res,401,{error:'请从领航台应用的“浏览器”按钮或本机 CLI 网页入口打开'});return;}
      send(res,200,mcpSession?browserSessions.issue():{csrf:browserSession!.csrf}); return;
    }
    if(req.method==='GET'&&url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname.startsWith('/assets/'))) {
      const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const root = fileURLToPath(new URL('../web/dist/', import.meta.url));
      const path = resolve(root, file);
      if (!path.startsWith(root.endsWith(sep) ? root : root + sep) || !['.html', '.js', '.css', '.svg', '.png', '.woff2'].includes(extname(path))) { send(res, 404, { error: '资源不存在' }); return; }
      const mime: Record<string,string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
      res.setHeader('Content-Type', mime[extname(path)]!);
      try { res.end(readFileSync(path)); } catch { send(res, 503, { error: '网页资源尚未构建' }); } return;
    }
    if (!browserSession && !mcpSession) { send(res, 401, { error: '需要领航台本机会话' }); return; }
    if(url.pathname.startsWith('/api/desktop/')) {
      if(!mcpSession){send(res,403,{error:'原生管理操作需要本机私有身份，网页会话无权调用'});return;}
      if(req.method!=='POST'||!req.headers['content-type']?.startsWith('application/json')){send(res,415,{error:'需要 POST application/json'});return;}
      try {
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>32000)throw Error('管理请求过大');}
        send(res,200,await desktop.execute(url.pathname.slice('/api/desktop/'.length),JSON.parse(body)));
      }catch(error){send(res,400,{error:errorText(error)});}return;
    }
    if (req.method === 'GET' && url.pathname === '/api/runtime') {
      send(res, 200, { ...identity, activeTasks: scheduler.queue().active }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/state') { const tasks=store.list();send(res, 200, { tasks, projects:buildProjectSummaries(tasks), queue:scheduler.queue(), agent: store.snapshot('agent'),agents:store.snapshot('agents')??[],executionPolicy:policyView(store), quota: store.snapshot('quota'), capabilities: sharing.view(), modelPreference: modelPreference(store), models: store.snapshot('models'), cursor: store.latestSequence() }); return; }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      const after = Number(req.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0);
      if (!Number.isSafeInteger(after) || after < 0) { send(res, 400, { error: '游标无效' }); return; }
      let cursor = after;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      res.flushHeaders();
      const flush = () => {
        for (const event of store.events(cursor, undefined, 1000)) { if (!res.write(`id: ${event.seq}\ndata: ${safeJson(event)}\n\n`)) { res.end(); break; } cursor = event.seq; }
      };
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
      const expiry=browserSession&&!mcpSession?setTimeout(()=>res.end(),Math.max(0,browserSession.expiresAt-Date.now())):undefined;
      store.on('change', flush); flush();
      req.on('close', () => { clearInterval(heartbeat);if(expiry)clearTimeout(expiry);store.off('change', flush); }); return;
    }
    if (req.method !== 'POST' || !url.pathname.startsWith('/api/tool/')) { send(res, 404, { error: '地址不存在' }); return; }
    if (!mcpSession && (!browserSession || req.headers.origin !== origin || !sameSecret(req.headers['x-helmdesk-csrf'] as string, browserSession.csrf))) { send(res, 403, { error: '写操作需要同源会话和 CSRF 校验' }); return; }
    if (!req.headers['content-type']?.startsWith('application/json')) { send(res, 415, { error: '需要 application/json' }); return; }
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 100_000) { send(res, 413, { error: '请求过大' }); return; } }
      const args: unknown = JSON.parse(body);
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('参数必须为对象');
      send(res, 200, await execute(url.pathname.slice('/api/tool/'.length), args));
    } catch (error) { send(res, 400, { error: errorText(error) }); }
  };
  return (req:IncomingMessage,res:ServerResponse)=>{
    void handle(req,res).catch(()=>{
      try{if(res.headersSent)res.destroy();else send(res,500,{error:'请求处理失败'});}
      catch{res.destroy();}
    });
  };
}

export async function serve(directory: string, port: number, concurrency=1) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('端口须为 1024–65535');
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>2)throw new Error('并发数必须为 1 或 2');
  const lockPath = join(directory, 'service.lock');
  if (existsSync(lockPath)) {
    const pid = Number(readFileSync(lockPath, 'utf8'));
    try { process.kill(pid, 0); throw new Error('该数据目录已有服务运行'); }
    catch (error: any) { if (error.code !== 'ESRCH') throw error; }
    unlinkSync(lockPath);
  }
  writeFileSync(lockPath, String(process.pid), { flag: 'wx', mode: 0o600 });
  const store = new Store(directory); store.recover();
  const desktopConfig=desktopConfiguration(directory).configuration;
  if(desktopConfig.qoderCLI)process.env.HELMDESK_QODER_CLI=desktopConfig.qoderCLI;
  const sharing=new Sharing(store,`http://127.0.0.1:${port}`);
  const scheduler = new Scheduler(store, new AgentExecutor(directory,sharing),[...desktopConfig.projectRoots,join(directory,'probe-project')],concurrency);
  const token = randomBytes(32).toString('hex');
  const identity = appIdentity(directory, port);
  const server = createServer(createApp(store, scheduler, port, token,undefined,sharing,identity,()=>shutdown()));
  server.requestTimeout = 65000;
  try { await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
  catch (error) { unlinkSync(lockPath); store.close(); throw error; }
  writeFileSync(join(directory, 'connection.json'), JSON.stringify({ ...identity, pid: process.pid, token }), { mode: 0o600 });
  const shutdown = () => { scheduler.stop(); server.close(); server.closeAllConnections(); void sharing.shutdown().finally(()=>{unlinkSync(lockPath); unlinkSync(join(directory, 'connection.json')); setTimeout(() => process.exit(), 250).unref();}); };
  process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
  console.log(`领航台已启动： http://127.0.0.1:${port}\n数据目录：${directory}\n隔离执行槽位：${concurrency}`);
  void agentCatalog().then(agents=>{store.snapshot('agents',agents);store.snapshot('agent',agents[0]);}).catch(() => {});
  scheduler.kick();
}
