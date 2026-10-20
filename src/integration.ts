import {constants,openSync,closeSync,fstatSync,readSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import type {Task} from './types.js';
import type {FileStamp,IntegrationObservation,IntegrationPreview,IntegrationPatch} from './integration-types.js';
import {planIntegration} from './integration-policy.js';
import {pathAllowed,validateScope} from './workspace.js';
import {safeJson} from './redact.js';
import {assertDeliveryVersion} from './verified-delivery.js';
import {protectedDirectoryNames,protectedProjectEntry} from './protected-paths.js';

const MAX_FILES=20, MAX_FILE_BYTES=1_000_000, MAX_TOTAL_BYTES=4_000_000;
const reserved=new Set(['.git','.helmdesk','.helmdesk-inputs','.codex','.agents','.aws','.ssh','.qoder','.qoder-cn','.qoderworkcn','node_modules','dist','.DS_Store']);
const protectedRoots=protectedDirectoryNames;
const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const stamp=(bytes:Buffer):FileStamp=>({sha256:hash(bytes),bytes:bytes.length});
function matches(bytes:Buffer|null,expected:FileStamp|null){return bytes===null?expected===null:expected!==null&&bytes.length===expected.bytes&&hash(bytes)===expected.sha256;}
function validStamp(sha256:unknown,bytes:unknown):FileStamp|null{
  return typeof sha256==='string'&&/^[a-f0-9]{64}$/.test(sha256)&&typeof bytes==='number'&&Number.isSafeInteger(bytes)&&bytes>=0&&bytes<=MAX_FILE_BYTES?{sha256,bytes}:null;
}
function validatePath(path:string){
  if(typeof path!=='string'||!path||path.length>500||/[\x00-\x1f\x7f\\]/.test(path)||path.startsWith('/')||path.split('/').some(p=>!p||p==='.'||p==='..'||reserved.has(p)||p.startsWith('.env')||protectedProjectEntry(p)))throw Error('整合路径必须为安全的项目内文件路径');
}
function checkedRoot(path:string){
  const root=resolve(path),stat=lstatSync(root),canonical=realpathSync(root);
  if(stat.isSymbolicLink()||!stat.isDirectory()||canonical.split(sep).some(p=>protectedRoots.has(p.toLowerCase())))throw Error('整合目录包含符号链接、配置来源或不是实际目录');
  return canonical;
}
function readOptional(root:string,path:string,budget:{bytes:number}):Buffer|null{
  let target=root;
  for(const part of path.split('/')){
    target=join(target,part);
    let stat;try{stat=lstatSync(target);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw Error('整合文件路径无法读取');}
    if(stat.isSymbolicLink())throw Error('文件或父目录含符号链接，拒绝读取');
    if(target!==join(root,path)&&!stat.isDirectory())throw Error('文件父路径不是目录');
  }
  const fd=openSync(target,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=fstatSync(fd);
    if(!before.isFile()||before.nlink!==1)throw Error('仅支持普通单链接文件');
    if(before.mode&0o111)throw Error('可执行文件需另行检查权限，暂不提供补丁');
    if(before.size>MAX_FILE_BYTES)throw Error('单文件超过 1MB 预检上限');
    budget.bytes+=before.size;if(budget.bytes>MAX_TOTAL_BYTES)throw Error('所选文件读取总量超过 4MB 上限');
    const buffer=Buffer.alloc(before.size+1);let length=0;
    while(length<buffer.length){const n=readSync(fd,buffer,length,buffer.length-length,length);if(!n)break;length+=n;}
    const after=fstatSync(fd),current=lstatSync(target);
    if(length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||current.isSymbolicLink()||current.dev!==before.dev||current.ino!==before.ino||realpathSync(target)!==target||realpathSync(root)!==root)throw Error('文件在读取期间发生变化，请重新检查');
    const bytes=buffer.subarray(0,length);
    if(bytes.includes(0)||!Buffer.from(bytes.toString('utf8'),'utf8').equals(bytes))throw Error('二进制或非 UTF-8 文件暂不提供补丁');
    return bytes;
  }finally{closeSync(fd);}
}
function filePatch(path:string,before:Buffer|null,after:Buffer|null){
  const a=JSON.stringify(`a/${path}`),b=JSON.stringify(`b/${path}`);
  let result=`diff --git ${a} ${b}\n`;
  if(before===null)result+='new file mode 100644\n';
  if(after===null)result+='deleted file mode 100644\n';
  if(!before?.length&&!after?.length)return result;
  const lines=(bytes:Buffer|null)=>{if(!bytes?.length)return [];const rows=bytes.toString('utf8').split('\n');if(rows.at(-1)==='')rows.pop();return rows;};
  const old=lines(before),next=lines(after);
  const block=(rows:string[],prefix:string,bytes:Buffer|null)=>rows.map(row=>prefix+row+'\n').join('')+(bytes?.length&&bytes.at(-1)!==10?'\\ No newline at end of file\n':'');
  result+=`--- ${before===null?'/dev/null':a}\n+++ ${after===null?'/dev/null':b}\n@@ -${old.length?1:0},${old.length} +${next.length?1:0},${next.length} @@\n`;
  return result+block(old,'-',before)+block(next,'+',after);
}
function inspect(task:Task,dataDir:string,paths?:string[]){
  if(task.state!=='completed'||task.acceptance!=='accepted'||task.verification?.status!=='passed')throw Error('仅已完成、验证通过且验收通过的交付可以整合预检');
  assertDeliveryVersion(task);
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(task.id)||task.mode!=='files')throw Error('整合预检需要有效文件任务');
  const changes=task.changes??[],selected=paths??changes.map(c=>c.path);
  if(selected.length>MAX_FILES||new Set(selected).size!==selected.length)throw Error('选择 0–20 个不同的交付文件');
  const records=selected.map(path=>{validatePath(path);validateScope([path]);if(!pathAllowed(path,task.allowedFiles))throw Error('文件超出原任务允许范围');const found=changes.filter(c=>c.path===path);if(found.length!==1)throw Error('文件未记录或交付记录重复');return found[0]!;});
  let project='',workspace='',rootProblem='';
  try{project=checkedRoot(task.projectPath);const expected=join(checkedRoot(dataDir),'tasks',task.id,'workspace');if(!task.workspace||checkedRoot(task.workspace)!==expected)throw Error('隔离工作目录不属于本任务');workspace=expected;}
  catch(error){rootProblem=error instanceof Error&&!(error as NodeJS.ErrnoException).code?error.message:'项目或隔离工作目录缺失，无法预检';}
  const budget={bytes:0},contents=new Map<string,{before:Buffer|null;after:Buffer|null}>();
  const observations:IntegrationObservation[]=records.map(change=>{
    if(!['added','modified','deleted'].includes(change.kind))throw Error('不支持的改动类型');
    const kind=change.kind as IntegrationObservation['kind'];
    const baseline=kind==='added'?null:validStamp(change.beforeSha256,change.beforeBytes),delivered=kind==='deleted'?null:validStamp(change.sha256,change.bytes);
    const item:IntegrationObservation={path:change.path,kind,baseline,delivered,current:null};
    try{
      if(rootProblem)throw Error(rootProblem);
      if(kind!=='added'&&!baseline)throw Error('缺少完整原始基线摘要；旧交付需重新创建并验证');
      if(kind!=='deleted'&&!delivered)throw Error('缺少完整验收输出摘要，无法导出补丁');
      const after=readOptional(workspace,change.path,budget);
      if(!matches(after,delivered))throw Error('隔离工作文件与验收记录不一致，已阻止导出');
      const before=readOptional(project,change.path,budget);item.current=before===null?null:stamp(before);
      if(matches(before,baseline)&&!matches(before,delivered)){
        const patch=filePatch(change.path,before,after);
        if(JSON.parse(safeJson(patch))!==patch)throw Error('补丁文本会被安全脱敏，无法保证完整字节；请手动整合');
      }
      contents.set(change.path,{before,after});
    }catch(error){item.problem=error instanceof Error&&!(error as NodeJS.ErrnoException).code?error.message:'整合文件读取失败，请核对目录和权限';}
    return item;
  });
  const plan=planIntegration(observations);
  const fingerprint=hash(JSON.stringify({taskId:task.id,updatedAt:task.updatedAt,project:task.projectPath,workspace:task.workspace,projectRoot:project,workspaceRoot:workspace,baseline:task.baseline,files:plan.files}));
  const preview:IntegrationPreview={schemaVersion:1,taskId:task.id,checkedAt:new Date().toISOString(),fingerprint,...plan,limitations:[
    '这是所选文件在检查时的内容比对，不会写入原项目，也不会改变验证或验收状态。',
    '补丁只包含标为可整合的文件；已有冲突或不支持文件时整组选项不可导出，可调整明确选择后重查。',
    '导出时重新核对原文件和交付摘要；文件在检查后变化会拒绝旧预览。实际应用前仍需复核现场。',
    '当前支持普通 UTF-8 文本文件，最多 20 个，单文件 1MB、读取总量 4MB；不处理权限变化、可执行文件、硬链接或二进制文件。',
    '若补丁文本会被既有安全脱敏规则改写，则拒绝导出，避免生成损坏或泄露凭据的补丁。',
  ]};
  return {preview,contents};
}
export function integrationPreview(task:Task,dataDir:string,paths?:string[]):IntegrationPreview{return inspect(task,dataDir,paths).preview;}
export function integrationPatch(task:Task,dataDir:string,paths:string[]|undefined,fingerprint:string):IntegrationPatch{
  const {preview,contents}=inspect(task,dataDir,paths);
  if(preview.fingerprint!==fingerprint)throw Error('预检已过期，文件或任务记录发生变化，请重新检查');
  if(!preview.canExport)throw Error('当前选择有阻塞或没有可整合文件，无法导出补丁');
  const patch=preview.files.filter(f=>f.status==='ready').map(file=>{const content=contents.get(file.path)!;return filePatch(file.path,content.before,content.after);}).join('');
  if(JSON.parse(safeJson(patch))!==patch)throw Error('补丁文本无法完整通过安全传输，拒绝导出');
  return {filename:`helmdesk-${task.id}-${fingerprint.slice(0,12)}.patch`,patch,sha256:hash(patch),preview};
}
