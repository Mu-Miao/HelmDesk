import {constants,openSync,closeSync,fstatSync,readSync,lstatSync,realpathSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve,sep,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import type {Task} from './types.js';
import {assertDeliveryVersion,assertVerifiedDelivery} from './verified-delivery.js';
import type {InputFile,InputSelection} from './input-types.js';
import {INPUT_DIRECTORY} from './input-types.js';
import {inputPlan} from './input-policy.js';

interface StagedInput {file:InputFile;content:Buffer}
function digest(content:Buffer) {return createHash('sha256').update(content).digest('hex');}
function checkedRoot(path:string) {
  if(lstatSync(path).isSymbolicLink()||!lstatSync(path).isDirectory())throw new Error('交付输入根目录必须是实际目录');
  return realpathSync(path);
}
function readChecked(root:string,path:string,file:InputFile):Buffer {
  const target=resolve(root,path);
  if(!target.startsWith(root+sep)||lstatSync(root).isSymbolicLink()) throw new Error('交付输入路径无效');
  let current=root;
  for(const part of path.split('/')){
    current=join(current,part);const stat=lstatSync(current);
    if(stat.isSymbolicLink()||(current!==target&&!stat.isDirectory())) throw new Error('交付输入含符号链接或非目录路径');
  }
  const fd=openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const stat=fstatSync(fd);
    if(!stat.isFile()||stat.size!==file.bytes||stat.size>1_000_000) throw new Error('交付文件大小与验收记录不一致');
    const buffer=Buffer.alloc(file.bytes+1);let length=0;
    while(length<buffer.length){const count=readSync(fd,buffer,length,buffer.length-length,length);if(!count)break;length+=count;}
    const content=buffer.subarray(0,length);
    if(length!==file.bytes||fstatSync(fd).size!==file.bytes||digest(content)!==file.sha256) throw new Error('交付文件摘要与验收记录不一致，拒绝交接');
    return content;
  } finally {closeSync(fd);}
}
export function stageInputs(selections:InputSelection[],lookup:(id:string)=>Task,dataDir:string):StagedInput[] {
  const plan=inputPlan(selections,lookup),root=realpathSync(dataDir);
  return plan.map(file=>{
    const task=lookup(file.taskId),expected=join(root,'tasks',task.id,'workspace');
    try {assertVerifiedDelivery(task,dataDir);}catch(error){throw Error(`来源工作目录或交付校验未通过：${(error as Error).message}`);}
    if(!task.workspace||realpathSync(task.workspace)!==expected) throw new Error('来源工作目录不属于任务，拒绝交接');
    return {file,content:readChecked(expected,file.path,file)};
  });
}
export function pinInputs(taskId:string,staged:StagedInput[],dataDir:string) {
  if(!staged.length)return undefined;
  const root=join(dataDir,'tasks',taskId,'input-snapshot');mkdirSync(root,{recursive:true,mode:0o700});
  for(const {file,content}of staged){const target=join(root,file.taskId,file.path);mkdirSync(dirname(target),{recursive:true,mode:0o700});writeFileSync(target,content,{flag:'wx',mode:0o400});}
  return {files:staged.map(({file})=>({...file})),isolationVerified:false,integrity:'pinned' as const};
}
export function inputRoots(task:Task,dataDir:string):string[] {
  return task.inputRun?.files.length&&task.workspace?[join(dataDir,'tasks',task.id,'input-snapshot'),join(task.workspace,INPUT_DIRECTORY)]:[];
}
export function validateInputSources(task:Task,lookup:(id:string)=>Task) {
  if(!task.inputRun?.files.length)return;
  for(const source of new Set(task.inputRun.files.map(file=>file.taskId))) {
    try {assertDeliveryVersion(lookup(source));}catch(error){throw Error(`来源校验未通过：${(error as Error).message}`);}
  }
  const pinned=task.inputRun.files,current=inputPlan(task.inputs??[],lookup);
  if(current.length!==pinned.length||current.some(f=>!pinned.some(p=>p.taskId===f.taskId&&p.path===f.path&&p.sha256===f.sha256&&p.bytes===f.bytes)))throw new Error('来源交付记录与固定输入快照不一致，拒绝启动');
}
export function materializeInputs(task:Task,dataDir:string) {
  if(!task.inputRun?.files.length)return;
  if(!task.workspace)throw new Error('交付输入缺少目标工作目录');
  const stage=join(dataDir,'tasks',task.id,'input-snapshot'),mount=join(task.workspace,INPUT_DIRECTORY);
  mkdirSync(mount,{mode:0o700});
  for(const file of task.inputRun.files){
    const content=readChecked(checkedRoot(stage),`${file.taskId}/${file.path}`,file),target=join(mount,file.taskId,file.path);
    mkdirSync(dirname(target),{recursive:true,mode:0o700});writeFileSync(target,content,{flag:'wx',mode:0o400});
  }
}
export function auditInputs(task:Task,dataDir:string) {
  if(!task.inputRun?.files.length)return undefined;
  try {
    if(!task.workspace)throw new Error('输入工作目录缺失');
    const expected=join(realpathSync(dataDir),'tasks',task.id,'workspace');
    if(realpathSync(task.workspace)!==expected)throw new Error('输入工作目录来源异常');
    for(const root of inputRoots(task,dataDir))for(const file of task.inputRun.files)readChecked(checkedRoot(root),`${file.taskId}/${file.path}`,file);
    return {...task.inputRun,integrity:'verified' as const};
  }catch(error){return {...task.inputRun,integrity:'failed' as const,error:error instanceof Error?error.message:String(error)};}
}
