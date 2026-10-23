import {detectAgent,listModels} from './qoder.js';
import {detectOllama,listOllamaModels} from './ollama.js';
import type {AgentId,AgentInfo} from './agent-types.js';
import type {Executor} from './executor.js';
import {QoderExecutor} from './executor.js';
import {OllamaExecutor} from './ollama-executor.js';
import type {Sharing} from './sharing.js';
import type {Task} from './types.js';
import {detectAntigravity,listAntigravityModels} from './antigravity.js';
import {AntigravityExecutor} from './antigravity-executor.js';
export {agentName} from './agent-types.js';
export function agentModels(agent:AgentId='qoder-cn'){
  if(agent==='antigravity')return listAntigravityModels();
  if(agent==='ollama')return listOllamaModels();
  if(agent==='qoder-cn')return listModels();
  throw Error('未知执行器，拒绝自动切换');
}
export async function agentCatalog():Promise<AgentInfo[]>{
  const [q,o,a]=await Promise.allSettled([detectAgent(),detectOllama(),detectAntigravity()]);
  const qoder=q.status==='fulfilled'?q.value:null;
  return[{id:'qoder-cn',label:'Qoder CN',available:qoder?.available??false,version:qoder?.version??null,modes:['probe','shared','files'],reason:qoder?.available?'主要执行器；隔离文件任务和无工具任务；认证与额度以实际调用为准':'未发现可用 Qoder CN CLI',source:qoder?.runtime?.source??'本机发现'},o.status==='fulfilled'?o.value:{id:'ollama',label:'Ollama 本地',available:false,version:null,modes:[],reason:'执行器发现失败',source:'本机 CLI'},a.status==='fulfilled'?a.value:{id:'antigravity',label:'Antigravity · 辅助',available:false,version:null,modes:[],reason:'执行器发现失败',source:'本机 CLI'}];
}
export class AgentExecutor implements Executor{
  private readonly qoder:QoderExecutor;private readonly ollama:OllamaExecutor;private readonly antigravity:AntigravityExecutor;
  constructor(dataDir:string,sharing?:Sharing){this.qoder=new QoderExecutor(dataDir,sharing);this.ollama=new OllamaExecutor(dataDir);this.antigravity=new AntigravityExecutor(dataDir,sharing);}
  private executor(task?:Task){
    if(task?.agent==='antigravity')return this.antigravity;
    if(task?.agent==='ollama')return this.ollama;
    if(!task?.agent||task.agent==='qoder-cn')return this.qoder;
    throw Error('未知执行器，拒绝自动切换');
  }
  verify(task?:Task){return this.executor(task).verify();}
  prepare(task:Task){return this.executor(task).prepare(task);}
  finalize(task:Task){return this.executor(task).finalize(task);}
  start(task:Task,event:(type:string,data:any)=>void){return this.executor(task).start(task,event);}
}
