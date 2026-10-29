import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, realpathSync, writeFileSync} from 'node:fs';
import {delimiter, join} from 'node:path';
import {homedir} from 'node:os';
import {dataDirectory} from './config.js';
import {cleanEnvironment} from './executor.js';
import {watchOwnedProcess} from './process.js';
import {errorText} from './redact.js';
import type {ModelOption} from './model-types.js';
import type {AgentInfo} from './agent-types.js';
import type {WorkerGateway} from './capability-types.js';
import {fileURLToPath} from 'node:url';

export const antigravityDefaultModel = 'gemini-3.8-flash-high';
export const antigravityAgent = 'helmdesk-helper';

export function findAntigravity(): string | null {
  const override = process.env.HELMDESK_AGY_CLI;
  if (override) {
    if (!existsSync(override)) throw Error('HELMDESK_AGY_CLI 路径不存在');
    return realpathSync(override);
  }
  const candidates = [...(process.env.PATH ?? '').split(delimiter).filter(p=>p.startsWith('/')).map(p => join(p, 'agy')), '/opt/homebrew/bin/agy','/usr/local/bin/agy',join(homedir(), '.local/bin/agy')];
  const found = candidates.find(p => existsSync(p));
  return found ? realpathSync(found) : null;
}

export function antigravityEnvironment(temporary?: string): NodeJS.ProcessEnv {
  return {...cleanEnvironment(), AGY_CLI_DISABLE_AUTO_UPDATE:'1', AGY_CLI_NONINTERACTIVE_HEADLESS:'1', BROWSER:'/usr/bin/false', CI:'1', NO_COLOR:'1', TERM:'dumb', ...(temporary ? {TMPDIR:temporary, TMP:temporary, TEMP:temporary, XDG_CACHE_HOME:temporary} : {})};
}

/** Generated configuration only; account credentials remain in the OS keychain. */
export function prepareAntigravityState(root: string, gateway?:WorkerGateway) {
  const config = join(root, 'config'), cli = join(root, 'antigravity-cli');
  mkdirSync(join(config, 'agents', antigravityAgent), {recursive:true, mode:0o700});
  mkdirSync(cli, {recursive:true, mode:0o700});
  const descriptor=join(config,'gateway.json');
  if(gateway)writeFileSync(descriptor,JSON.stringify(gateway),{mode:0o600});
  writeFileSync(join(config, 'mcp_config.json'), JSON.stringify({mcpServers:gateway?{helm:{command:realpathSync(process.execPath),args:[fileURLToPath(new URL('./shared-mcp.js',import.meta.url)),descriptor]}}:{}}), {mode:0o600});
  writeFileSync(join(cli, 'settings.json'), JSON.stringify({
    model:'Gemini 3.8 Flash (High)', toolPermission:'strict', useG1Credits:false,
    allowNonWorkspaceAccess:false, disableSlashCommands:true, historySize:0,
    permissions:{deny:['command(*)','read_file(*)','write_file(*)','read_url(*)','execute_url(*)',...(!gateway?['mcp(*)']:[])],allow:gateway?[...(gateway.skills.length?['mcp(helm/read_skill)']:[]),...(gateway.tools.length?['mcp(helm/call)']:[])]:[]}
  }), {mode:0o600});
  writeFileSync(join(config, 'agents', antigravityAgent, 'agent.md'), `---\nname: ${antigravityAgent}\ndescription: HelmDesk auxiliary assistant\nmainAgent: true\nsubagent: false\nmodel: inherit\ntools: []\nmcpServers: []\ninheritMcp: ${!!gateway}\nskills: []\nplugins: []\ncommandExecutionPolicy: off\n---\nYou are HelmDesk's auxiliary assistant. Codex owns planning and review; Qoder owns primary implementation. ${gateway?'Use only the task-scoped helm MCP gateway for selected skill texts and read-only tools.':'Answer only from the supplied prompt. Do not use tools.'} Do not access project files, run commands, browse the web, delegate work, or create scheduled tasks.\n`, {mode:0o600});
  return root;
}

export async function runAntigravity(args: string[], timeoutMs = 15000, includeDiagnostics = false) {
  const runtime = findAntigravity();
  if (!runtime) throw Error('未安装 Antigravity CLI（agy）');
  const child = spawn(runtime, args, {env:antigravityEnvironment(), detached:true, stdio:['ignore','pipe','pipe']});
  const watched = watchOwnedProcess(child, () => {});
  let stdout = '', stderr = '', overflow = false, expired = false;
  const timer = setTimeout(() => {expired=true; watched.cancel();}, timeoutMs);
  child.stdout.on('data', chunk => {if (stdout.length + chunk.length > 1_000_000) {overflow=true; watched.cancel();} else stdout += String(chunk);});
  child.stderr.on('data', chunk => {if (stderr.length < 8000) stderr += String(chunk);});
  try {
    const exit = await watched.finished;
    if (overflow || expired) throw Error(overflow ? 'agy 输出超出限制' : 'agy 目录检查超时');
    if (exit.code !== 0) throw Error(errorText(stderr || stdout || 'agy 命令失败'));
    return includeDiagnostics ? stdout + stderr : stdout;
  } finally {clearTimeout(timer);}
}

export function parseAntigravityModels(text: string): ModelOption[] {
  const options: ModelOption[] = [], seen = new Set<string>();
  for (const line of text.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).filter(s => s.trim())) {
    const row = /^([a-z][a-z0-9._-]{0,149})\t([^\t\r\n]+)$/.exec(line);
    if (!row || seen.has(row[1]!)) throw Error('agy 模型目录格式变化或身份重复，拒绝猜测模型');
    seen.add(row[1]!);
    options.push({id:row[1]!, label:row[2]!, kind:'platform'});
  }
  if (!options.length) throw Error('agy 未返回可用模型，请先运行 agy 登录');
  return options;
}

export async function listAntigravityModels() {
  const root = join(dataDirectory(), 'antigravity', 'catalog');
  prepareAntigravityState(root);
  const options = parseAntigravityModels(await runAntigravity(['--gemini_dir', root, '--log-file', join(root, 'catalog.log'), 'models'],30000));
  return {source:'agy models（本账号实时目录）', sampledAt:new Date().toISOString(), models:options.map(o=>o.id), options,
    defaultModel:antigravityDefaultModel, availability:'辅助分析与共享只读任务；沿用系统钥匙串登录，不修改项目文件、不自动换模型；Google 额度独立记录'};
}

export async function detectAntigravity(): Promise<AgentInfo> {
  const runtime = findAntigravity();
  const base = {id:'antigravity' as const, label:'Antigravity · 辅助', version:null, source:runtime ?? '本机 CLI', modes:['probe','shared'] as ('probe'|'shared'|'files')[]};
  if (!runtime) return {...base, available:false, reason:'未安装官方 agy CLI'};
  try {
    const version = (await runAntigravity(['--version'])).trim();
    const help = await runAntigravity(['--help'],15000,true);
    if (!/^\d+\.\d+\.\d+$/.test(version) || !['--input-format','--output-format','--agent','--disable-slash-commands'].every(flag=>help.includes(flag))) throw Error('CLI 缺少受限执行接口');
    return {...base, version, available:true, reason:'辅助分析与摘要；默认 Gemini 3.8 Flash（High）；登录、模型权限以实时目录与实际调用为准'};
  } catch (error) {return {...base, available:false, reason:errorText(error)};}
}

export function antigravityUsage(value:any) {
  const count = (v:unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
  return {usage:{input_tokens:count(value?.usage?.input_tokens),output_tokens:count(value?.usage?.output_tokens)},antigravityUsage:{thinkingTokens:count(value?.usage?.thinking_tokens),cacheReadTokens:count(value?.usage?.cache_read_tokens),totalTokens:count(value?.usage?.total_tokens)}};
}

export function validateAntigravityInit(value:any, model:string, cwd:string) {
  if(value?.init?.model!==model||value.init.agent!==antigravityAgent||value.init.cwd!==cwd||value.init.permission_mode!=='strict'||typeof value.conversation_id!=='string'||!value.conversation_id)throw Error('agy 未确认固定模型、辅助 Agent、工作目录或严格权限边界');
  return value.conversation_id as string;
}

export function antigravityResult(value: any, sessionId?:string) {
  if (!value || value.status !== 'SUCCESS' || typeof value.response !== 'string' || !value.response.trim() || value.response.length > 100000 || typeof value.conversation_id !== 'string' || !value.conversation_id || sessionId!==undefined&&value.conversation_id!==sessionId || value.num_turns !== 1 || value.error || value.denied_actions!==undefined&&(!Array.isArray(value.denied_actions)||value.denied_actions.length)) throw Error(errorText(value?.error || 'agy 未返回完整的单轮成功结果，或存在被拒绝的操作'));
  return {subtype:'success', is_error:false, result:value.response, session_id:value.conversation_id,
    permission_denials:[],...antigravityUsage(value)};
}
