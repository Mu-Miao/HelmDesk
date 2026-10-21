import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, realpathSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { sandboxProfile, checkIsolation, verifyAuthenticationReference,verifyInputIsolation,protectedSourceRoots } from './isolation.js';
import { detectAgent, findRuntime } from './qoder.js';
import { errorText } from './redact.js';
import type { Task } from './types.js';
import { watchOwnedProcess } from './process.js';
import type { Sharing } from './sharing.js';
import {inputRoots} from './task-inputs.js';
import { providerModelOptions, providerSettingsPath } from './provider-models.js';

export interface Execution {
  finished: Promise<{ code: number | null }>;
  pid?: number;
  cancel(): void | {confirmed:boolean;error?:string};
}
export interface Executor { verify(task?:Task): Promise<unknown>; prepare?(task:Task):Promise<Partial<Task>>; finalize?(task:Task):Promise<Partial<Task>>; start(task: Task, onEvent: (type: string, data: any) => void): Execution; }
export class QoderExecutor implements Executor {
  constructor(private readonly dataDir: string, private readonly sharing?:Sharing) {}
  private async prepareInputs(task:Task):Promise<Partial<Task>> {
    if(!task.inputRun?.files.length)return {};
    const roots=inputRoots(task,this.dataDir),files=roots.flatMap(root=>task.inputRun!.files.map(file=>join(root,file.taskId,file.path)));
    if(!roots.length||!await verifyInputIsolation(join(this.dataDir,'tasks',task.id),roots,files,this.sharing?.roots()??protectedSourceRoots()))throw new Error('交付输入的操作系统只读隔离未验证，拒绝启动');
    return {inputRun:{...task.inputRun,isolationVerified:true}};
  }
  async prepare(task:Task):Promise<Partial<Task>> {
    if(!this.sharing) return this.prepareInputs(task);
    const {run}=await this.sharing.open(task);
    run.configDirectory=join(this.dataDir,'tasks',task.id,'agent-config'); mkdirSync(run.configDirectory,{recursive:true,mode:0o700});
    const loginRoot=realpathSync(process.env.HELMDESK_QODER_LOGIN_DIR??join(homedir(),'.qoder-cn'));
    const authentication=join(loginRoot,'.auth');
    // Reuse the existing authentication state through a read-only reference, never copy credentials.
    // Settings, sessions, plugins, memories, caches and logs stay in agent-config / task tmp.
    if(existsSync(authentication)) symlinkSync(realpathSync(authentication),join(run.configDirectory,'.auth'),'dir');
    run.authentication={mode:'read-only-existing-login',verified:await verifyAuthenticationReference(join(this.dataDir,'tasks',task.id),authentication,join(run.configDirectory,'.auth'),this.sharing.roots())};
    if(!run.authentication.verified) throw new Error('现有登录的只读引用验证失败；拒绝启动执行者');
    // Custom model IDs are resolved from the official per-user model registry.
    // Reference it read-only; never copy or inspect provider credentials here.
    if (/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(task.model)) {
      const models = join(loginRoot, '.models');
      if (!existsSync(models)) throw new Error('官方自定义模型目录不存在');
      const source = realpathSync(models), alias = join(run.configDirectory, '.models');
      symlinkSync(source, alias, 'dir');
      if (!await verifyInputIsolation(join(this.dataDir,'tasks',task.id), [source], [], this.sharing.roots())) throw new Error('自定义模型目录只读隔离未验证');
      run.modelConfiguration = { mode: 'read-only-existing-models', verified: true };
    } else if (task.model.startsWith('qoder-custom-')) {
      const source = realpathSync(providerSettingsPath()), alias = join(run.configDirectory, 'provider-settings.json');
      if (!providerModelOptions(source).some(option => option.id === task.model)) throw new Error('所选自定义模型不存在；拒绝猜测供应商或回退');
      symlinkSync(source, alias, 'file');
      if (!await verifyInputIsolation(join(this.dataDir,'tasks',task.id), [loginRoot], [source,alias], this.sharing.roots())) throw new Error('自定义供应商配置只读隔离未验证');
      run.modelConfiguration = { mode: 'read-only-existing-provider', verified: true };
    }
    return {capabilityRun:run,...await this.prepareInputs(task)};
  }
  async finalize(task:Task):Promise<Partial<Task>> {const run=await this.sharing?.close(task.id);return run?{capabilityRun:run}:{};}
  async verify() {
    const isolation = await checkIsolation(this.dataDir);
    if (!isolation.verified) throw new Error(`写入隔离未验证：${isolation.reason}`);
    const agent = await detectAgent();
    if (!agent.available || !agent.capabilities?.strictMcp || !agent.capabilities?.tools) throw new Error('CLI 不支持受限执行所需参数');
    return { isolation, agent };
  }
  start(task: Task, onEvent: (type: string, data: any) => void): Execution {
    const runtime = findRuntime(); if (!runtime) throw new Error('CLI 不可用');
    const directory = join(this.dataDir, 'tasks', task.id);
    const temporary = join(directory, 'tmp'); mkdirSync(temporary, { recursive: true });
  const specFile = join(directory, 'request.json');
    const gateway=this.sharing?.gateway(task.id);
    writeFileSync(specFile, JSON.stringify({ prompt: task.prompt, cwd: task.workspace, runtime: runtime.path, model: task.model, maxTurns:task.maxTurns,reasoningEffort:task.reasoningEffort, mode: task.mode, allowedFiles: task.allowedFiles, gateway, inputs:task.inputRun?.files, configDirectory:task.capabilityRun?.configDirectory }), { mode: 0o600 });
    const worker = fileURLToPath(new URL('./worker.js', import.meta.url));
    const readOnlyRoots=this.sharing?[join(directory,'capabilities'),join(task.capabilityRun!.configDirectory!,'.auth')]:[];
    if(task.capabilityRun?.modelConfiguration) readOnlyRoots.push(join(task.capabilityRun.configDirectory!,task.capabilityRun.modelConfiguration.mode==='read-only-existing-provider'?'provider-settings.json':'.models'));
    readOnlyRoots.push(...inputRoots(task,this.dataDir));
    const child: ChildProcess = spawn('/usr/bin/sandbox-exec', ['-p', sandboxProfile(directory,this.sharing?.roots(),readOnlyRoots), process.execPath, worker, specFile], {
      cwd: task.workspace, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...cleanEnvironment(), CI: '1', TMPDIR: temporary, TMP: temporary, TEMP: temporary, XDG_CACHE_HOME: temporary }
    });
    let count = 0;
    const output = createInterface({ input: child.stdout! });
    output.on('line', line => {
      if (++count > 5000 || line.length > 500_000) { onEvent('error', { message: '执行日志超出限制，已终止进程' }); cancel(); return; }
      try { const event = JSON.parse(line); if (typeof event.type !== 'string') throw new Error('missing event type'); onEvent(event.type, event.data); }
      catch { onEvent('format_error', { message: 'SDK 输出格式变化；拒绝将非结构化输出认定为成功', line: line.slice(0, 4000) }); }
    });
    child.stderr?.on('data', chunk => onEvent('stderr', String(chunk).slice(0, 8000)));
    const execution = watchOwnedProcess(child, error => onEvent('cleanup_error', {message:errorText(error)}),undefined,result=>onEvent('cleanup',{...result}));
    const cancel = execution.cancel;
    return execution;
  }
}

export function cleanEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ['HOME', 'USER', 'LOGNAME', 'PATH', 'LANG', 'LC_ALL', 'SHELL', 'SYSTEMROOT', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) if (process.env[key]) result[key] = process.env[key];
  // No parent MCP, model API keys, NODE_OPTIONS, or arbitrary provider env.
  return result;
}

export function classifyFailure(message: string) {
  if (/login|log in|sign.?in|unauthori[sz]ed|authentication|未登录|登录|401/i.test(message)) return 'authentication';
  if (/quota|credits?.*(exhaust|insufficient)|额度|余额|402/i.test(message)) return 'quota';
  if (/permission|approval|denied|权限|确认/i.test(message)) return 'permission';
  if (/格式|protocol|未知字段|format/i.test(message)) return 'format';
  return 'process';
}
