import {existsSync,realpathSync} from 'node:fs';
import {join,delimiter} from 'node:path';
import {runCommand} from './qoder.js';
import type {ModelOption} from './model-types.js';
export const ollamaOrigin='http://127.0.0.1:11434';
export function findOllama(){
  const override=process.env.HELMDESK_OLLAMA_CLI;
  if(override){if(!existsSync(override))throw Error('HELMDESK_OLLAMA_CLI 路径不存在');return realpathSync(override);}
  return[...(process.env.PATH??'').split(delimiter).filter(p=>p.startsWith('/')).map(p=>join(p,'ollama')),'/opt/homebrew/bin/ollama','/usr/local/bin/ollama','/Applications/Ollama.app/Contents/Resources/ollama'].find(p=>existsSync(p))??null;
}
export function localOllamaModels(value:unknown):ModelOption[]{
  if(!value||typeof value!=='object'||!Array.isArray((value as any).models))throw Error('Ollama 模型目录格式变化');
  const seen=new Set<string>(),options:ModelOption[]=[];
  for(const item of (value as any).models){
    if(typeof item?.name!=='string'||!item.name.match(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,149}$/)||item.name.includes('..')||typeof item.digest!=='string'||!item.digest.match(/^[a-f0-9]{64}$/i))throw Error('Ollama 模型身份无法验证');
    if(item.remote_host||item.remote_model||item.name.endsWith(':cloud'))continue;
    if(seen.has(item.name))throw Error('Ollama 模型目录重复');seen.add(item.name);
    options.push({id:item.name,label:item.name,kind:'platform'});
  }
  return options.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}
export async function listOllamaModels(){
  if(!findOllama())throw Error('未安装 Ollama CLI');
  const response=await fetch(`${ollamaOrigin}/api/tags`,{signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw Error('Ollama 本地服务不可用');
  const text=await response.text();if(text.length>1_000_000)throw Error('Ollama 模型目录过大');
  const options=localOllamaModels(JSON.parse(text));
  return{source:'Ollama 本机 /api/tags',sampledAt:new Date().toISOString(),models:options.map(o=>o.id),options,availability:'仅已存在的本地模型；不下载、不调用云模型；目前只支持无工具任务'};
}
export async function detectOllama(){
  const runtime=findOllama();if(!runtime)return{id:'ollama' as const,label:'Ollama 本地',available:false,version:null,modes:[] as ('probe'|'files')[],source:'本机 CLI',reason:'未安装 Ollama CLI'};
  let version:string|null=null;
  try{const r=await runCommand(runtime,['--version']);version=(r.stdout+r.stderr).match(/(?:version is |version )(\S+)/)?.[1]??null;const catalog=await listOllamaModels();return{id:'ollama' as const,label:'Ollama 本地',available:catalog.options.length>0,version,modes:['probe'] as ('probe'|'files')[],source:runtime,reason:catalog.options.length?'只运行已安装本地模型的无工具任务；不共享 Skills/MCP，也不修改项目文件':'本地服务没有可用模型'};}
  catch{return{id:'ollama' as const,label:'Ollama 本地',available:false,version,modes:['probe'] as ('probe'|'files')[],source:runtime,reason:'CLI 已安装，本机 127.0.0.1:11434 服务尚未启动或目录读取失败'};}
}
export function ollamaResult(text:string){
  const value=JSON.parse(text);
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>k!=='summary')||typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>100000)throw Error('Ollama 未返回完整的受限 JSON 结果');
  return{subtype:'success',is_error:false,result:value.summary,permission_denials:[]};
}
