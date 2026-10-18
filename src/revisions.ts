import {createHash} from 'node:crypto';
import type {Task} from './types.js';
import type {ModelOption} from './model-types.js';
import type {RevisionDraft,RevisionRequest} from './revision-types.js';
import {revisionFamily} from './revision-family.js';
import {submissionSchema} from './schema.js';
import {selectModel} from './model-selection.js';
import {resolveReasoningEffort} from './reasoning.js';
import {validateScope} from './workspace.js';
import {inputPlan} from './input-policy.js';
export const revisionHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function revisionDraft(tasks:Task[],request:RevisionRequest,options:ModelOption[]):RevisionDraft{
  const source=tasks.find(task=>task.id===request.taskId);if(!source)throw Error('原任务不存在');
  if(!['completed','failed','cancelled'].includes(source.state))throw Error('原任务尚未结束；等待处理的任务须先核实并取消，不能直接重新执行');
  const family=revisionFamily(tasks,source.id);if(family.problem)throw Error(family.problem);
  if(source.inputs?.length||source.inputRun?.files.length){
    if(!source.inputRun?.files.length)throw Error('原任务缺少固定输入证据，请显式创建独立任务');
    const currentInputs=inputPlan(source.inputs??[],id=>{const parent=tasks.find(t=>t.id===id);if(!parent)throw Error('输入来源不存在');return parent;});
    const pinned=source.inputRun.files;
    if(currentInputs.length!==pinned.length||currentInputs.some(file=>!pinned.some(p=>p.taskId===file.taskId&&p.path===file.path&&p.sha256===file.sha256&&p.bytes===file.bytes)))throw Error('来源交付已偏离原任务固定输入，请显式重新选择，不能静默更新');
  }
  if(family.items.filter(t=>['queued','preparing','running','waiting_user'].includes(t.state)).length)throw Error('同一修订链仍有未结束任务，请先处理，避免重复执行');
  let depth=0,node=source;
  while(node.revision){if(++depth>=19)throw Error('修订链已达到上限，请创建独立任务');node=tasks.find(t=>t.id===node.revision!.sourceTaskId)!;}
  const model=selectModel(options,request.model??source.model,source.mode==='probe');
  const reasoningEffort=resolveReasoningEffort(model.id,request.reasoningEffort??(model.id===source.model?source.reasoningEffort:undefined));
  const feedback=request.feedback.trim();if(!feedback||feedback.length>4000)throw Error('修订要求须为 1–4000 字符');
  const prompt=`这是一次显式创建的修订任务，使用原项目的新独立副本。上一任务的工作文件不会自动带入。\n\n原始任务说明（背景）：\n${source.prompt}\n\n本次修订要求（优先执行）：\n${feedback}\n\n仍须遵守本任务的文件范围和验收条件，不得扩大权限。`;
  const input=submissionSchema.parse({title:`修订：${source.title.replace(/^修订[：:]\s*/,'')}`.slice(0,120),prompt,projectPath:source.projectPath,allowedFiles:[...source.allowedFiles],acceptanceCriteria:[...source.acceptanceCriteria],dependencies:[...source.dependencies],inputs:(source.inputs??[]).map(s=>({taskId:s.taskId,paths:[...s.paths]})),model:model.id,reasoningEffort,capabilities:{skills:[],tools:[]},mode:source.mode,timeoutSeconds:source.timeoutSeconds});
  validateScope(input.allowedFiles);if(input.mode==='files'&&!input.allowedFiles.length)throw Error('原文件任务缺少明确修改范围');
  const submission={...input,agent:source.agent,maxTurns:source.maxTurns,probePurpose:source.probePurpose,model:model.id,modelLabel:model.label,revision:{sourceTaskId:source.id,rootTaskId:family.rootTaskId,feedback}};
  const fingerprint=revisionHash({source,submission});
  return{sourceTaskId:source.id,sourceUpdatedAt:source.updatedAt,fingerprint,submission,notes:[
    '创建新的独立任务，保留原任务的状态、交付、用量和验收记录；原任务不会自动重试。',
    '文件范围、项目、模式、时限、验收条件和原有依赖保持固定；来源交付输入重新验证，共享 Skills/MCP 默认清空。',
    '从原项目重新建立副本，不继承未验收的工作文件。修订关系仅用于追踪，不把原任务加入执行依赖。',
    '提交会启动新的模型请求，可能消耗额度；相同请求编号重复提交只返回同一个任务。',
  ]};
}
