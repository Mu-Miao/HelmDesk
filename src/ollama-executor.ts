import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {homedir} from 'node:os';
import type {Executor} from './executor.js';
import {cleanEnvironment} from './executor.js';
import {findOllama,listOllamaModels,ollamaResult,ollamaOrigin} from './ollama.js';
import {mcpSandboxProfile,protectedSourceRoots,checkIsolation} from './isolation.js';
import {watchOwnedProcess} from './process.js';
import type {Task} from './types.js';
import {ollamaGateway} from './ollama-gateway.js';
export function validateOllamaTask(task:Task){
  if(task.mode!=='probe'||task.allowedFiles.length||task.inputs?.length||task.capabilities?.skills.length||task.capabilities?.tools.length||task.reasoningEffort||task.maxTurns&&task.maxTurns!==1)throw Error('Ollama 当前仅支持单轮无工具任务，不能修改文件、共享能力或套用 Qoder 深度');
}
export class OllamaExecutor implements Executor{
  private readonly gateways=new Map<string,Awaited<ReturnType<typeof ollamaGateway>>>();
  constructor(private readonly dataDir:string){}
  async verify(){const isolation=await checkIsolation(this.dataDir);if(!isolation.verified)throw Error('Ollama 写入隔离未验证');await listOllamaModels();return{isolation,agent:'ollama',mode:'probe'};}
  async prepare(task:Task){validateOllamaTask(task);if(!(await listOllamaModels()).options.some(o=>o.id===task.model))throw Error('所选 Ollama 本地模型不存在，拒绝自动下载或替换');this.gateways.set(task.id,await ollamaGateway(task.model));return{};}
  async finalize(task:Task){const gateway=this.gateways.get(task.id);if(gateway){this.gateways.delete(task.id);await gateway.close();}return{};}
  start(task:Task,event:(type:string,data:any)=>void){
    validateOllamaTask(task);const runtime=findOllama();if(!runtime)throw Error('Ollama CLI 不可用');
    const directory=join(this.dataDir,'tasks',task.id),tmp=join(directory,'tmp');mkdirSync(tmp,{recursive:true});
    const gateway=this.gateways.get(task.id);if(!gateway)throw Error('缺少固定模型的任务网关');
    // Only this CLI, task files and its existing local authentication key can be read.
    const profile=mcpSandboxProfile(directory,task.workspace!,[dirname(runtime),join(homedir(),'.ollama/id_ed25519'),join(homedir(),'.ollama/id_ed25519.pub')],protectedSourceRoots(),gateway.port);
    const child=spawn('/usr/bin/sandbox-exec',['-p',profile,runtime,'run',task.model,'--format','json','--hidethinking','--nowordwrap','--keepalive','0'],{cwd:task.workspace,detached:true,stdio:['pipe','pipe','pipe'],env:{...cleanEnvironment(),OLLAMA_HOST:gateway.url,OLLAMA_NOHISTORY:'1',TMPDIR:tmp,NO_COLOR:'1',TERM:'dumb'}});
    const watched=watchOwnedProcess(child,error=>event('cleanup_error',{message:error.message}),undefined,result=>event('cleanup',result));
    let stdout='',stderr='',overflow=false;
    child.stdout.on('data',chunk=>{if(stdout.length+chunk.length>1_000_000){overflow=true;watched.cancel();}else stdout+=String(chunk);});
    child.stderr.on('data',chunk=>{if(stderr.length<8000)stderr+=String(chunk);});
    child.stdin.on('error',()=>{});
    child.stdin.end(`Return exactly one JSON object with only the string property summary. No tools or file access. Follow this task inside summary:\n${task.prompt}`);
    event('execution_limits',{maxTurns:1,source:'Ollama CLI + single-request local gateway'});
    const finished=watched.finished.then(exit=>{
      if(overflow)throw Error('Ollama 输出超出限制');
      if(exit.code!==0)throw Error(`Ollama CLI 失败：${stderr.slice(-2000)}`);
      const receipt=gateway.receipt();if(!receipt)throw Error('Ollama 未取得完整服务端完成证据');
      event('session',{modelReported:receipt.model});
      event('result',{...ollamaResult(stdout),usage:{input_tokens:receipt.inputTokens,output_tokens:receipt.outputTokens}});return exit;
    }).finally(()=>event('ollama_gateway',{requests:gateway.requests(),routes:gateway.routes()}));
    return{...watched,finished};
  }
}
