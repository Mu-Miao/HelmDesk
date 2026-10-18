import type {Task} from './types.js';
import type {RevisionFamily,RevisionItem} from './revision-types.js';
export function revisionFamily(tasks:Task[],taskId:string):RevisionFamily{
  const index=new Map(tasks.map(task=>[task.id,task])),current=index.get(taskId);
  if(!current)throw Error('任务不存在');
  function rootOf(task:Task){
    const seen=new Set<string>();let node=task;
    while(node.revision){
      if(seen.has(node.id)||seen.size>=20)throw Error('修订链存在循环或超过 20 层');seen.add(node.id);
      const parent=index.get(node.revision.sourceTaskId);if(!parent)throw Error('修订来源记录缺失');node=parent;
    }
    return node.id;
  }
  const item=(task:Task):RevisionItem=>({id:task.id,title:task.title,state:task.state,acceptance:task.acceptance,verification:task.verification?.status??null,model:task.modelLabel??task.requestedModel,effort:task.reasoningEffort??null,sourceTaskId:task.revision?.sourceTaskId??null,createdAt:task.createdAt});
  try{
    const rootTaskId=rootOf(current),family:Task[]=[];
    for(const task of tasks){try{if(rootOf(task)===rootTaskId)family.push(task);}catch{/* Unrelated invalid lineage is not part of this family. */}}
    family.sort((a,b)=>a.createdAt<b.createdAt?-1:a.createdAt>b.createdAt?1:a.id<b.id?-1:a.id>b.id?1:0);
    return{currentTaskId:taskId,rootTaskId,items:family.map(item)};
  }catch(error){return{currentTaskId:taskId,rootTaskId:taskId,items:[item(current)],problem:error instanceof Error?error.message:'修订记录异常'};}
}
