import {z} from 'zod';
import {idSchema} from './schema.js';
import {canClassifyTask} from './disposition-types.js';
import type {Task} from './types.js';
export const dispositionSchema=z.object({
  taskId:idSchema,status:z.enum(['resolved','expected_failure','deferred','unclassified']),
  reason:z.string().trim().min(1,'请填写处理原因').max(2000),replacementTaskId:idSchema.optional(),
}).strict();
export function validateDisposition(input:z.infer<typeof dispositionSchema>,task:Task,replacement?:Task){
  if(!canClassifyTask(task))throw Error('只能整理已结束的失败、取消或验收需返工记录；不改变执行状态');
  if(input.replacementTaskId){
    if(input.status!=='resolved')throw Error('只有已解决记录可以关联后续替代任务');
    if(input.replacementTaskId===task.id)throw Error('不能关联任务自身');
    if(!replacement||replacement.state!=='completed'||replacement.verification?.status!=='passed'||replacement.acceptance!=='accepted')throw Error('替代任务必须执行完成、验证通过且验收接受');
  }
}
