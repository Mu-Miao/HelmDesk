import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,realpathSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {homedir} from 'node:os';
import {createInterface} from 'node:readline';
import type {Executor} from './executor.js';
import type {Submission, Task} from './types.js';
import {checkIsolation, protectedSourceRoots, sandboxProfile} from './isolation.js';
import {watchOwnedProcess} from './process.js';
import {errorText} from './redact.js';
import {antigravityAgent, antigravityEnvironment, antigravityResult, antigravityUsage, detectAntigravity, findAntigravity, listAntigravityModels, prepareAntigravityState,validateAntigravityInit} from './antigravity.js';

export function validateAntigravityTask(task: Submission) {
  if (task.mode !== 'probe' || task.allowedFiles.length || task.inputs?.length || task.capabilities?.skills.length || task.capabilities?.tools.length || task.reasoningEffort || task.maxTurns !== undefined && task.maxTurns !== 1) throw Error('Antigravity 辅助执行器只支持单轮提示词任务，不修改文件、共享能力或套用 Qoder 思考深度');
}

export function antigravitySandboxProfile(directory:string, workspace:string, runtime:string) {
  const state=join(directory,'agy-state');
  const protectedRoots=protectedSourceRoots([join(homedir(),'.gemini'),join(homedir(),'.qoder-cn')]);
  const reads=['/System','/usr','/Library','/private/etc','/private/var/db','/dev',directory,dirname(runtime),join(homedir(),'Library/Keychains'),join(homedir(),'Library/Preferences/com.apple.security.plist')].map(p=>existsSync(p)?realpathSync(p):p);
  const immutable=[workspace,join(state,'config/agents'),join(state,'config/mcp_config.json'),join(state,'antigravity-cli/settings.json')];
  return sandboxProfile(directory,protectedRoots,immutable)+`\n(deny file-read-data)\n(allow file-read-data (literal "/") ${reads.map(p=>`(subpath ${JSON.stringify(p)})`).join(' ')})\n`;
}

export class AntigravityExecutor implements Executor {
  constructor(private readonly dataDir: string) {}
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
    prepareAntigravityState(join(directory, 'agy-state'));
    mkdirSync(join(directory, 'agy-workspace'), {recursive:true, mode:0o700});
    mkdirSync(join(directory, 'tmp'), {recursive:true, mode:0o700});
    return {};
  }
  async finalize() {return {};}
  start(task: Task, event: (type:string, data:any)=>void) {
    validateAntigravityTask(task);
    const runtime = findAntigravity(); if (!runtime) throw Error('agy CLI 不可用');
    const directory = join(this.dataDir, 'tasks', task.id), state = join(directory, 'agy-state'), cwd = join(directory, 'agy-workspace');
    // The prompt is the only project input. No source workspace, global skills, hooks or MCP configuration is readable.
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
          event('execution_limits',{maxTurns:1, source:'agy single stdin turn; strict headless permissions', note:'工具目录不等于授权；任务禁用工具，任何工具步骤均终止。一轮用户任务不表示底层模型请求次数或费用硬上限。'});
          child.stdin.end(JSON.stringify({event:'user', message:{content:task.prompt}})+'\n');
        } else if (value.event === 'step_update') {
          if (!['user_input','agent_response','checkpoint'].includes(value.step_update?.step_type)) throw Error('辅助执行器出现工具或未知操作，已终止');
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
