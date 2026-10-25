import { realpathSync, statSync, existsSync } from 'node:fs';
import { isAbsolute, join, sep, delimiter, resolve } from 'node:path';
import { Store, type SubmissionReceipt } from './store.js';
import type { Submission, Task } from './types.js';
import { prepareWorkspace, collectChanges, validateScope } from './workspace.js';
import type { Execution, Executor } from './executor.js';
import { classifyFailure } from './executor.js';
import { errorText } from './redact.js';
import { terminalStates } from './config.js';
import { queueReport, nextRunnableTaskIds } from './queue-policy.js';
import {stageInputs,pinInputs,materializeInputs,auditInputs,validateInputSources} from './task-inputs.js';
import {resolveReasoningEffort} from './reasoning.js';
import {taskBudget} from './execution-policy.js';
import {validateOllamaTask} from './ollama-executor.js';
import {deliveryVersion,assertDeliveryVersion,assertVerifiedDelivery} from './verified-delivery.js';
import {protectedDirectoryNames} from './protected-paths.js';
import {validateZcodeTask} from './zcode-executor.js';
import {validateAntigravityTask} from './antigravity-executor.js';

interface ActiveTask { id:string; execution?:Execution; cancelled:boolean }

export class Scheduler {
  private readonly active=new Map<string,ActiveTask>();
  private pumpQueued=false;
  private stopped = false;
  private refusingSubmissions = false;
  constructor(readonly store: Store, readonly executor: Executor, private allowedRoots = process.env.HELMDESK_PROJECT_ROOTS?.split(delimiter).map(p => realpathSync(p)) ?? [realpathSync(process.cwd()), join(store.directory, 'probe-project')], readonly concurrency=1) {
    if(!Number.isInteger(concurrency)||concurrency<1||concurrency>2) throw new Error('并发数必须为 1 或 2');
  }
  queue() {
    const tasks=this.store.list().reverse(),report=queueReport(tasks,new Set(this.active.keys()),this.concurrency);
    for(const entry of report.entries){const task=tasks.find(t=>t.id===entry.taskId)!,decision=taskBudget(this.store,task);if(decision&&!decision.allowed){entry.blockers.push({taskId:task.id,code:'budget',reason:decision.reason});entry.ready=false;}}
    for(const entry of report.entries)for(const id of tasks.find(task=>task.id===entry.taskId)!.dependencies) {
      const source=tasks.find(task=>task.id===id);
      if(source?.state==='completed'&&source.acceptance==='accepted')try{assertDeliveryVersion(source);}catch{entry.blockers.push({taskId:id,code:'awaiting_acceptance',reason:'依赖交付需要当前版本的宿主验证'});entry.ready=false;}
    }
    report.ready=report.entries.filter(e=>e.ready).length;report.blocked=report.entries.length-report.ready;return report;
  }
  submit(input: Submission,receipt?:SubmissionReceipt): Task {
    if(this.refusingSubmissions)throw Error('执行端正在停止，拒绝新的派发');
    const previous=receipt?this.store.requestTask(receipt.key,receipt.hash):null;
    if(previous)return previous;
    if(input.agent==='ollama')validateOllamaTask(input as Task);
    if(input.agent==='zcode')validateZcodeTask(input);
    if(input.agent==='antigravity')validateAntigravityTask(input);
    input={...input,reasoningEffort:input.agent&&input.agent!=='qoder-cn'?undefined:resolveReasoningEffort(input.model,input.reasoningEffort)};
    if (!isAbsolute(input.projectPath) || !statSync(input.projectPath).isDirectory()) throw new Error('项目路径必须是存在的绝对目录');
    input = { ...input, projectPath: realpathSync(input.projectPath) };
    if (!this.allowedRoots.some(value => { const root = existsSync(value) ? realpathSync(value) : resolve(value); return input.projectPath === root || input.projectPath.startsWith(root + sep); })) throw new Error('项目路径不在领航台启动时允许的根目录中；请通过 HELMDESK_PROJECT_ROOTS 明确配置');
    if (input.projectPath.split(sep).some(p => protectedDirectoryNames.has(p.toLowerCase()))) throw new Error('禁止把配置或凭据目录作为任务项目');
    validateScope(input.allowedFiles);
    if (input.mode === 'files' && input.allowedFiles.length === 0) throw new Error('文件任务必须指定允许修改的文件范围');
    if (input.mode === 'shared' && (input.allowedFiles.length || input.inputs?.length)) throw new Error('共享只读任务不能修改项目或接收文件输入');
    if (input.dependencies.length !== new Set(input.dependencies).size) throw new Error('依赖任务重复');
    for (const id of input.dependencies) this.store.get(id);
    if(input.mode==='probe'&&input.inputs?.length)throw new Error('禁用工具的探测任务不能接收交付输入');
    const staged=stageInputs(input.inputs??[],id=>this.store.get(id),this.store.directory);
    input={...input,dependencies:[...new Set([...input.dependencies,...staged.map(s=>s.file.taskId)])]};
    if(input.dependencies.length>20)throw new Error('含交付来源的依赖不能超过 20 项');
    const task = this.store.create(input,receipt);
    try{const inputRun=pinInputs(task.id,staged,this.store.directory);if(inputRun)this.store.patch(task.id,{inputRun});}
    catch(error){this.store.patch(task.id,{state:'failed',error:errorText(error),finishedAt:new Date().toISOString()});throw error;}
    this.kick(); return this.store.get(task.id);
  }
  kick() {
    if(this.stopped||this.pumpQueued)return;
    this.pumpQueued=true;
    queueMicrotask(()=>{this.pumpQueued=false;this.pump();});
  }
  private pump() {
    if(this.stopped)return;
    const ids=this.queue().entries.filter(e=>e.ready).map(e=>e.taskId).slice(0,this.concurrency-this.active.size);
    for(const id of ids) {
      if(taskBudget(this.store,this.store.get(id))?.allowed===false)continue;
      const active:ActiveTask={id,cancelled:false};this.active.set(id,active);
      void this.run(this.store.get(id),active);
    }
  }
  private async run(task:Task,active:ActiveTask) {
    let timer: NodeJS.Timeout | undefined;
    let expired = false, result: any, emittedError = '', invalidFormat = false;
    let finalized=false, sourceAuditFailed=false;
    try {
      this.store.patch(task.id, { state: 'preparing', startedAt: new Date().toISOString() });
      const verified = await this.executor.verify(task); this.store.event(task.id, 'preflight', verified);
      if (active.cancelled) return;
      const prepared = await prepareWorkspace(task, this.store.directory);
      this.store.patch(task.id, { workspace: prepared.workspace, baseline: prepared.baseline, workspaceKind: prepared.workspaceKind });
      if(active.cancelled)return;
      try{materializeInputs(this.store.get(task.id),this.store.directory);}
      catch(error){const run=this.store.get(task.id).inputRun;if(run)this.store.patch(task.id,{inputRun:{...run,integrity:'failed',error:errorText(error)}});throw error;}
      if(this.executor.prepare) this.store.patch(task.id,await this.executor.prepare(this.store.get(task.id)));
      if (active.cancelled) return;
      validateInputSources(this.store.get(task.id),id=>this.store.get(id));
      for(const id of task.dependencies)assertVerifiedDelivery(this.store.get(id),this.store.directory);
      const budget=taskBudget(this.store,this.store.get(task.id));
      if(budget&&!budget.allowed){this.store.patch(task.id,{state:'waiting_user',failureKind:'budget',error:budget.reason});return;}
      this.store.patch(task.id,{executionRequested:true});
      active.execution = this.executor.start({ ...this.store.get(task.id) }, (type, data) => {
        this.store.event(task.id, type, data);
        if (type === 'session') this.store.patch(task.id, { reportedModel: data.modelReported, sessionId: data.sessionId });
        if (type === 'reasoning') this.store.patch(task.id,{reasoningRun:data});
        if (type === 'quota') this.store.snapshot('quota', data);
        if (type === 'result') {result = data;this.recordUsage(task.id,data);}
        if (type === 'error') emittedError = data.message;
        if (type === 'format_error') invalidFormat = true;
      });
      this.store.patch(task.id, { state: 'running', pid: active.execution.pid });
      timer = setTimeout(() => { expired = true; active.execution?.cancel(); }, task.timeoutSeconds * 1000);
      const exit = await active.execution.finished;
      const inputRun=auditInputs(this.store.get(task.id),this.store.directory);
      if(inputRun){this.store.patch(task.id,{inputRun});if(inputRun.integrity==='failed')throw new Error('只读交付输入摘要异常，交付已阻止验收');}
      if(this.executor.finalize) {const audit=await this.executor.finalize(this.store.get(task.id));finalized=true;this.store.patch(task.id,audit);sourceAuditFailed=!!audit.capabilityRun?.sourceChecks.some(check=>check.unchanged===false);}
      if (active.cancelled) return;
      if (expired) throw new Error('任务达到时限，进程树已终止；在途请求仍可能产生用量');
      const denials = result?.permission_denials;
      if(sourceAuditFailed) throw new Error('能力来源摘要发生变化；交付已阻止验收，请检查来源');
      if (denials?.length) throw new Error(`需要权限确认：${JSON.stringify(denials)}`);
      if (exit.code !== 0 || !result || result.subtype !== 'success' || result.is_error !== false || typeof result.result !== 'string' || invalidFormat) throw new Error(emittedError || result?.errors?.join('\n') || (invalidFormat ? '结构化输出格式变化' : `执行进程退出 (${exit.code})，未取得完整成功结果`));
      const changes = collectChanges(prepared.workspace, prepared.before, task.allowedFiles);
      this.store.patch(task.id, { state: 'completed', summary: result.result, changes, finishedAt: new Date().toISOString(), pid: undefined });
    } catch (error) {
      if (!active.cancelled) {
        const message = errorText(error), kind = expired ? 'timeout' : classifyFailure(message);
        this.store.patch(task.id, { state: ['authentication', 'permission'].includes(kind) ? 'waiting_user' : 'failed', failureKind: kind, error: message, finishedAt: new Date().toISOString(), pid: undefined });
      }
    } finally {
      if (timer) clearTimeout(timer);
      if(!finalized&&this.executor.finalize) try {this.store.patch(task.id,await this.executor.finalize(this.store.get(task.id)));} catch(error) {this.store.event(task.id,'capability_audit_error',{message:errorText(error)});}
      this.active.delete(task.id);
      this.store.event('system','queue_changed',{concurrency:this.concurrency,active:this.active.size});
      this.kick();
    }
  }
  private recordUsage(id:string,result:any) {
    const agent=this.store.get(id).agent,local=agent==='ollama',google=agent==='antigravity',zcode=agent==='zcode';
    const numeric=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
    const credits=numeric(result.total_credits);
    this.store.patch(id,{sessionId:result.session_id,usage:{taskCredits:local||google||zcode?null:credits,sessionCredits:local||google||zcode?null:credits,inputTokens:numeric(result.usage?.input_tokens),outputTokens:numeric(result.usage?.output_tokens),usd:local||google||zcode?null:numeric(result.total_cost_usd),...(zcode?{thinkingTokens:numeric(result.zcodeUsage?.thinkingTokens),cacheReadTokens:numeric(result.zcodeUsage?.cacheReadTokens),totalTokens:numeric(result.zcodeUsage?.totalTokens)}:google?{thinkingTokens:numeric(result.antigravityUsage?.thinkingTokens),cacheReadTokens:numeric(result.antigravityUsage?.cacheReadTokens),totalTokens:numeric(result.antigravityUsage?.totalTokens)}:{}),tokenNote:zcode?'Tokens 来自 ZCode 官方模型请求完成事件；套餐余额、Credits 和货币费用未提供，保留未知':google?'Tokens 来自 agy 完成事件；Google 套餐额度与 Qoder Credits 分开，费用未提供，保留未知':local?'Tokens 来自本地服务完成事件；CLI 未提供 Credits 或货币金额，保留未知':'CLI 返回的 0 不代表没有消耗 Tokens；美元为 0 不代表未扣 Credits',source:zcode?'official-zcode.workspace/generateText；任务内请求用量累计一次':google?'official-agy.result；本任务为新建单轮会话':local?'official-ollama.generate；单次本地 CLI 请求':'official-sdk.result；本任务为新建单会话，累计值只记录一次'}});
  }
  cancel(id: string) {
    const task = this.store.get(id);
    if (['completed', 'failed', 'cancelled'].includes(task.state)) return task;
    const active=this.active.get(id);if(active){
      active.cancelled=true;const cleanup=active.execution?.cancel();
      if(cleanup&&cleanup.confirmed===false)return this.store.patch(id,{state:'waiting_user',failureKind:'cleanup',error:cleanup.error??'进程清理未确认；不能标记为已取消，请核实当前执行进程。'});
    }
    return this.store.patch(id, { state: 'cancelled', finishedAt: new Date().toISOString(), pid: undefined });
  }
  review(id: string, acceptance: Task['acceptance'], note: string) {
    const task = this.store.get(id);
    if (task.state !== 'completed') throw new Error('仅执行完成的任务可以验收');
    if(acceptance==='accepted'&&task.verification?.status==='failed')throw Error('验证失败的任务不能验收通过');
    if (acceptance === 'accepted') assertVerifiedDelivery(task,this.store.directory);
    const updated = this.store.patch(id, { acceptance, reviewNote: note }); this.kick(); return updated;
  }
  verifyTask(id: string, input: Pick<NonNullable<Task['verification']>, 'status' | 'command' | 'evidence'>) {
    const task = this.store.get(id);
    if (task.state !== 'completed') throw new Error('仅执行完成的任务可以记录交付验证');
    const updated=this.store.patch(id, { verification: { ...input, recordedAt: new Date().toISOString(),...(input.status==='passed'?{deliveryVersion:deliveryVersion(task)}:{}) }, ...(input.status === 'failed' ? { acceptance: 'changes_requested' as const } : {}) });
    this.kick();return updated;
  }
  async wait(id: string, after: number, timeoutMs: number) {
    const started = Date.now();
    while (true) {
      const task = this.store.get(id), events = this.store.events(after, id);
      if (terminalStates.has(task.state) || Date.now() - started >= timeoutMs) return { task, events, cursor: events.at(-1)?.seq ?? after };
      await new Promise<void>(resolve => { const done = () => { clearTimeout(timer); this.store.off('change', done); resolve(); }; const timer = setTimeout(done, Math.min(1000, timeoutMs - (Date.now() - started))); this.store.once('change', done); });
    }
  }
  stop() { this.stopped = true; for(const id of this.active.keys()) this.cancel(id); }
  setAllowedRoots(roots:string[]) { this.allowedRoots=[...roots]; }
  beginShutdown() {this.refusingSubmissions=true;this.stop();}
}
