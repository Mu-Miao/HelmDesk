import type {Task} from './types.js';
export const dispositionLabels={resolved:'已解决',expected_failure:'预期失败',deferred:'暂缓处理'} as const;
export type DispositionStatus=keyof typeof dispositionLabels;
export interface TaskDisposition {status:DispositionStatus;reason:string;recordedAt:string;replacementTaskId?:string}
export function canClassifyTask(task:Pick<Task,'state'|'acceptance'|'verification'>){
  return task.state==='failed'||task.state==='cancelled'||task.state==='completed'&&(task.verification?.status==='failed'||task.acceptance==='changes_requested');
}
export type DispositionFilter='all'|'unclassified'|DispositionStatus;
export function matchesDisposition(task:Task,filter:DispositionFilter){
  return filter==='all'||(filter==='unclassified'?canClassifyTask(task)&&!task.disposition:task.disposition?.status===filter);
}
