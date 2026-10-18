import {createHash} from 'node:crypto';
import {z} from 'zod';
import {idSchema} from './schema.js';
import type {Task} from './types.js';
import type {Store} from './store.js';
import {buildReviewCard} from './review-card.js';
import type {TaskBrief} from './review-types.js';
export const briefSchema=z.object({taskId:idSchema}).strict();
export const briefListSchema=z.object({projectPath:z.string().min(1).max(2000).optional(),attention:z.enum(['review','rework','intervention']).optional(),limit:z.number().int().min(1).max(25).default(10),cursor:z.string().min(1).max(500).optional()}).strict();
export const watchSchema=z.object({targets:z.array(z.object({taskId:idSchema,version:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict()).min(1).max(8).refine(a=>new Set(a.map(t=>t.taskId)).size===a.length,'任务不可重复'),timeoutMs:z.number().int().min(0).max(55000).default(30000)}).strict();
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function taskBrief(task:Task):TaskBrief{return{...buildReviewCard(task),version:hash(task)};}
export function briefPage(tasks:Task[],args:unknown){
 const input=briefListSchema.parse(args),scope={projectPath:input.projectPath??null,attention:input.attention??null,limit:input.limit};
 const rows=tasks.filter(t=>!input.projectPath||t.projectPath===input.projectPath).map(taskBrief).filter(t=>!input.attention||t.attention===input.attention).sort((a,b)=>a.updatedAt===b.updatedAt?b.id.localeCompare(a.id):b.updatedAt.localeCompare(a.updatedAt));
 const fingerprint=hash({scope,versions:rows.map(r=>[r.id,r.version])});let offset=0;
 if(input.cursor){
  try{const raw=JSON.parse(Buffer.from(input.cursor,'base64url').toString('utf8'));const c=z.object({v:z.literal(1),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),offset:z.number().int().positive()}).strict().parse(raw);if(c.fingerprint!==fingerprint||c.offset>=rows.length||c.offset%input.limit!==0)throw Error();offset=c.offset;}catch{throw Error('摘要分页游标无效或已过期，请从第一页重新读取');}
 }
 const items=rows.slice(offset,offset+input.limit),end=offset+items.length;
 return{items,total:rows.length,nextCursor:end<rows.length?Buffer.from(JSON.stringify({v:1,fingerprint,offset:end})).toString('base64url'):null,note:'紧凑摘要不是完整审核证据；按需读取 task_get/task_events，不自动验收或合并'};
}
export async function watchBriefs(store:Store,args:unknown){
 const {targets,timeoutMs}=watchSchema.parse(args);
 const changed=()=>targets.map(t=>({target:t,task:store.get(t.taskId)})).filter(({target,task})=>target.version!==hash(task)).map(({task})=>taskBrief(task));
 // Validate all IDs before installing a listener. Events alone do not imply a changed task.
 const initial=changed();if(initial.length||timeoutMs===0)return{items:initial,timedOut:!initial.length};
 return new Promise<{items:TaskBrief[];timedOut:boolean}>((resolve,reject)=>{
  let timer:ReturnType<typeof setTimeout>;
  const finish=(items:TaskBrief[],timedOut:boolean)=>{clearTimeout(timer);store.off('change',check);resolve({items,timedOut});};
  const check=()=>{try{const items=changed();if(items.length)finish(items,false);}catch(e){clearTimeout(timer);store.off('change',check);reject(e);}};
  store.on('change',check);timer=setTimeout(()=>{try{const items=changed();finish(items,!items.length);}catch(e){store.off('change',check);reject(e);}},timeoutMs);check();
 });
}
