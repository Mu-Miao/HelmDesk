import {detectAgent,listModels} from './qoder.js';
import {detectOllama,listOllamaModels} from './ollama.js';
import type {AgentId,AgentInfo} from './agent-types.js';
import type {Executor} from './executor.js';
import {QoderExecutor} from './executor.js';
import {OllamaExecutor} from './ollama-executor.js';
import type {Sharing} from './sharing.js';
import type {Task} from './types.js';
export const agentName=(id?:string)=>id==='ollama'?'Ollama 本地':'Qoder CN';
export function agentModels(agent:AgentId='qoder-cn'){return agent==='ollama'?listOllamaModels():listModels();}
export async function agentCatalog():Promise<AgentInfo[]>{
  const [q,o]=await Promise.allSettled([detectAgent(),detectOllama()]);
  const qoder=q.status==='fulfilled'?q.value:null;
  return[{id:'qoder-cn',label:'Qoder CN',available:qoder?.available??false,version:qoder?.version??null,modes:['probe','files'],reason:qoder?.available?'隔离文件任务和无工具任务；认证与额度以实际调用为准':'未发现可用 Qoder CN CLI',source:qoder?.runtime?.source??'本机发现'},o.status==='fulfilled'?o.value:{id:'ollama',label:'Ollama 本地',available:false,version:null,modes:[],reason:'执行器发现失败',source:'本机 CLI'}];
}
export class AgentExecutor implements Executor{
  private readonly qoder:QoderExecutor;private readonly ollama:OllamaExecutor;
  constructor(dataDir:string,sharing?:Sharing){this.qoder=new QoderExecutor(dataDir,sharing);this.ollama=new OllamaExecutor(dataDir);}
  private executor(task?:Task){return task?.agent==='ollama'?this.ollama:this.qoder;}
  verify(task?:Task){return this.executor(task).verify();}
  prepare(task:Task){return this.executor(task).prepare(task);}
  finalize(task:Task){return task.agent==='ollama'?this.ollama.finalize(task):this.qoder.finalize(task);}
  start(task:Task,event:(type:string,data:any)=>void){return this.executor(task).start(task,event);}
}
