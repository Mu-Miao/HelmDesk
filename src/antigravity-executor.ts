import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,realpathSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import type {Executor} from './executor.js';
import type {Submission, Task} from './types.js';
import type {Sharing} from './sharing.js';
import type {WorkerGateway} from './capability-types.js';
import {sharedPrompt} from './shared-prompt.js';
import {checkIsolation, protectedSourceRoots, sandboxProfile} from './isolation.js';
import {watchOwnedProcess} from './process.js';
import {errorText} from './redact.js';
import {antigravityAgent, antigravityEnvironment, antigravityResult, antigravityUsage, detectAntigravity, findAntigravity, listAntigravityModels, prepareAntigravityState,validateAntigravityInit} from './antigravity.js';

export function validateAntigravityTask(task: Submission) {
  if (!['probe','shared'].includes(task.mode) || task.allowedFiles.length || task.inputs?.length || task.mode==='probe'&&(task.capabilities?.skills.length || task.capabilities?.tools.length) || task.reasoningEffort || task.maxTurns !== undefined && task.maxTurns !== 1) throw Error('Antigravity 仅支持单轮提示词或共享只读任务，不修改项目文件或套用 Qoder 思考深度');
}

export function validateAntigravityStep(step:any, sessionId:string, gateway?:WorkerGateway) {
  if(!step||step.conversation_id!==sessionId)throw Error('agy 步骤会话不符');
  if(step.step_type==='error_message')throw Error('agy 上游返回错误步骤；已终止，不自动重试');
  if(['user_input','agent_response','checkpoint'].includes(step.step_type))return;
  if(step.step_type==='tool'&&gateway) {
    const names=[...(gateway.skills.length?['read_skill']:[]),...(gateway.tools.length?['call']:[])];
    const name=step.tool_name??step.tool_info?.name;
    if(names.some(tool=>[`mcp__helm__${tool}`,`mcp_helm_${tool}`,`helm/${tool}`].includes(name)))return;
    const params=step.tool_info?.parameters;
    if(name==='mcp_tool'&&params?.server_name==='helm'&&names.includes(params?.tool_name))return;
    if(name==='call_mcp_tool'&&params?.ServerName==='helm'&&names.includes(params?.ToolName))return;
  }
  throw Error(`辅助执行器出现未授权工具或未知步骤：${String(step.step_type).slice(0,60)}`);
}

export function antigravitySandboxProfile(directory:string, workspace:string, runtime:string) {
  const state=join(directory,'agy-state');
  const protectedRoots=protectedSourceRoots([join(homedir(),'.gemini'),join(homedir(),'.qoder-cn'),workspace]);
  const codeRoot=fileURLToPath(new URL('.',import.meta.url));
  const reads=['/System','/usr','/Library','/private/etc','/private/var/db','/dev',directory,dirname(runtime),dirname(realpathSync(process.execPath)),codeRoot,join(codeRoot,'../node_modules'),join(codeRoot,'../package.json'),join(homedir(),'Library/Keychains'),join(homedir(),'Library/Preferences/com.apple.security.plist')].map(p=>existsSync(p)?realpathSync(p):p);
  const immutable=[workspace,join(directory,'capabilities'),join(state,'antigravity-cli/settings.json')].filter(existsSync);
  const config=join(state,'config'),projects=join(config,'projects');
  // A fresh CLI must create its task-local project record. Keep all other configuration
  // immutable, including its parent, rather than allowing writes to the whole config tree.
  const configurationWrites=`(deny file-write* (require-all (subpath ${JSON.stringify(config)}) (require-not (subpath ${JSON.stringify(projects)}))))`;
  const readable=`(require-all (require-any (literal "/") ${reads.map(p=>`(subpath ${JSON.stringify(p)})`).join(' ')}) ${protectedRoots.map(p=>`(require-not (subpath ${JSON.stringify(p)}))`).join(' ')})`;
  return sandboxProfile(directory,protectedRoots,immutable)+`\n${configurationWrites}\n(deny file-read-data)\n(allow file-read-data ${readable})\n`;
}

export class AntigravityExecutor implements Executor {
  constructor(private readonly dataDir: string, private readonly sharing?:Sharing) {}
  async verify() {
    const isolation = await checkIsolation(this.dataDir), agent = await detectAntigravity();
    if (!isolation.verified) throw Error(`Antigravity macOS 隔离未验证：${isolation.reason}`);
    if (!agent.available) throw Error(`Antigravity CLI 未验证：${agent.reason}`);
    return {isolation, agent};
  }
  async prepare(task: Task) {
    validateAntigravityTask(task);
    const catalog = await listAntigravityModels();
    if (!catalog.options.some(o=>o.id===task.model)) throw Error('指定模型不在 agy 当前账号目录中，拒绝自动替换');
    const directory = join(this.dataDir, 'tasks', task.id);
    if(task.mode==='shared'&&!this.sharing)throw Error('共享只读执行器缺少宿主网关');
    const opened=task.mode==='shared'?await this.sharing!.open(task):undefined;
    prepareAntigravityState(join(directory, 'agy-state'),opened?.gateway);
    mkdirSync(join(directory, 'agy-workspace'), {recursive:true, mode:0o700});
    mkdirSync(join(directory, 'tmp'), {recursive:true, mode:0o700});
    return opened?{capabilityRun:opened.run}:{};
  }
  async finalize(task:Task) {const run=await this.sharing?.close(task.id);return run?{capabilityRun:run}:{};}
  start(task: Task, event: (type:string, data:any)=>void) {
    validateAntigravityTask(task);
    const runtime = findAntigravity(); if (!runtime) throw Error('agy CLI 不可用');
    const directory = join(this.dataDir, 'tasks', task.id), state = join(directory, 'agy-state'), cwd = join(directory, 'agy-workspace');
    const gateway=task.mode==='shared'?this.sharing?.gateway(task.id):undefined;
    // Only task-selected snapshots are exposed through the gateway. Host configuration stays unreadable.
    const profile=antigravitySandboxProfile(directory,task.workspace!,runtime);
    const child = spawn('/usr/bin/sandbox-exec', ['-p',profile,runtime,'--gemini_dir',state,'--log-file',join(directory,'agy.log'),'--model',task.model,'--agent',antigravityAgent,'--input-format','stream-json','--output-format','stream-json','--disable-slash-commands','--print-timeout',`${task.timeoutSeconds}s`], {cwd, detached:true, stdio:['pipe','pipe','pipe'], env:antigravityEnvironment(join(directory,'tmp'))});
    const watched = watchOwnedProcess(child, error=>event('cleanup_error',{message:errorText(error)}), undefined, result=>event('cleanup',result));
    let initialized = false, sessionId='',result:ReturnType<typeof antigravityResult>|undefined, protocolError = '', stderr = '', lines = 0,bytes=0;
    const fail = (message:string) => {protocolError=message; watched.cancel();};
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>2_000_000)fail('agy 输出总量超出限制');});
    createInterface({input:child.stdout}).on('line', line=>{
      if(protocolError)return;
      if (++lines > 5000 || line.length > 500000) {fail('agy 输出超出限制'); return;}
      try {
        const value = JSON.parse(line);
        if (value.event === 'init') {
          event('antigravity_init',{model:value.init?.model,agent:value.init?.agent,advertisedToolCount:value.init?.tools?.length,cwd:value.init?.cwd,permissionMode:value.init?.permission_mode});
          if(initialized)throw Error('agy 初始化事件重复');
          sessionId=validateAntigravityInit(value,task.model,cwd);
          initialized=true; event('session',{modelReported:value.init.model, sessionId:value.conversation_id});
          event('execution_limits',{maxTurns:1, source:'agy single stdin turn; strict headless permissions', note:'仅授权任务网关；probe 禁用工具。一轮用户任务不表示底层模型请求次数或费用硬上限。'});
          child.stdin.end(JSON.stringify({event:'user', message:{content:sharedPrompt(gateway,true)+task.prompt}})+'\n');
        } else if (value.event === 'step_update') {
          event('antigravity_step',{stepType:value.step_update?.step_type,toolName:value.step_update?.tool_name,state:value.step_update?.state});
          validateAntigravityStep(value.step_update,sessionId,gateway);
        } else if (value.event === 'result') {
          if (!initialized || result) throw Error(errorText(value.result?.error || 'agy 结果缺少初始化证据或重复'));
          try{result=antigravityResult(value.result,sessionId);}
          catch(error){
            event('result',{subtype:'error',is_error:true,result:'',session_id:sessionId,errors:[errorText(error)],permission_denials:Array.isArray(value.result?.denied_actions)?value.result.denied_actions:[],...antigravityUsage(value.result)});
            throw error;
          }
        } else throw Error('agy 返回错误或未知协议事件');
      } catch (error) {fail(errorText(error));}
    });
    child.stderr.on('data', chunk=>{if (stderr.length < 8000) stderr += String(chunk);});
    child.stdin.on('error',()=>{});
    const finished = watched.finished.then(exit=>{
      if (protocolError) throw Error(protocolError);
      if (exit.code !== 0 || !result) throw Error(errorText(stderr || 'agy 未取得结构化成功结果；请检查 Google 登录与额度'));
      event('result',result); return exit;
    });
    return {...watched, finished};
  }
}
