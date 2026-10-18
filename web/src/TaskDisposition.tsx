import React,{useEffect,useState} from 'react';
import type {Task} from '../../src/types.js';
import {canClassifyTask,dispositionLabels} from '../../src/disposition-types.js';
import {states,failures,tool} from './api.js';

export function TaskDisposition({task,tasks,onSelect,csrf,onRefresh,onError}:{task:Task;tasks:Task[];onSelect:(id:string)=>void;csrf:string;onRefresh:()=>Promise<unknown>;onError:(message:string)=>void}){
  const record=task.disposition;
  const [status,setStatus]=useState<string>(record?.status??'resolved'),[reason,setReason]=useState(record?.reason??''),[replacement,setReplacement]=useState(record?.replacementTaskId??''),[busy,setBusy]=useState(false),[saved,setSaved]=useState('');
  useEffect(()=>{setStatus(record?.status??'resolved');setReason(record?.reason??'');setReplacement(record?.replacementTaskId??'');},[task.id,record?.recordedAt]);
  if(!canClassifyTask(task)&&!record)return null;
  const next=tasks.find(t=>t.id===record?.replacementTaskId);
  const replacements=tasks.filter(t=>t.id!==task.id&&t.state==='completed'&&t.verification?.status==='passed'&&t.acceptance==='accepted');
  async function save(event:React.SubmitEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setSaved('');
    try{await tool('task_disposition_set',{taskId:task.id,status,reason,...(status==='resolved'&&replacement?{replacementTaskId:replacement}:{})},csrf);await onRefresh();setSaved('处理结论已保存，原始执行与验收记录未改动。');}
    catch(error){onError(error instanceof Error?error.message:'保存处理结论失败');}finally{setBusy(false);}
  }
  return <section className="task-disposition" aria-label="历史处理结论">
    <div className="disposition-heading"><h4>处理结论</h4><span className={`disposition-badge disposition-${record?.status??'unclassified'}`}>{record?dispositionLabels[record.status]:'待归类'}</span></div>
    {record?<><p className="disposition-reason">{record.reason}</p><p className="caption">标记于 {new Date(record.recordedAt).toLocaleString('zh-CN')} · 执行、验证和验收状态保留</p>{record.replacementTaskId?<button className="text-button" onClick={()=>onSelect(record.replacementTaskId!)}>查看后续替代任务：{next?.title??record.replacementTaskId}</button>:null}</>:<p className="caption">这条记录尚无处理结论；请核对原始证据后分类。</p>}
    <details className="original-failure"><summary>原始执行记录（保留）</summary><p>执行：{states[task.state]} · {failures[task.failureKind??'']??'未记录失败类型'}</p><p>原更新时间：{new Date(task.updatedAt).toLocaleString('zh-CN')}</p><pre>{task.error??'没有原始错误文本。'}</pre></details>
    <details className="disposition-editor"><summary>{record?'修改处理结论':'标记处理结论'}</summary><form onSubmit={event=>void save(event)}>
      <label>处理分类<select aria-label="处理分类" value={status} onChange={event=>{setStatus(event.target.value);setSaved('');}}>{Object.entries(dispositionLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}<option value="unclassified">重新待处理（撤销分类）</option></select></label>
      <label>处理原因<textarea aria-label="处理原因" required maxLength={2000} value={reason} onChange={event=>{setReason(event.target.value);setSaved('');}} placeholder="说明如何解决、为何属于预期失败，或为什么暂缓处理。"/></label>
      {status==='resolved'?<label>后续替代任务（可选）<select aria-label="后续替代任务" value={replacement} onChange={event=>setReplacement(event.target.value)}><option value="">无替代任务，由宿主处理</option>{replacements.map(t=><option value={t.id} key={t.id}>{t.title} · {t.id.slice(0,8)}</option>)}</select></label>:null}
      <p className="caption">分类只整理历史，不触发重试、验收或整合。撤销分类同样保留时间线记录。</p><button className="outline" disabled={busy||!csrf||!reason.trim()}>{busy?'保存中…':'保存处理结论'}</button>
    </form></details>{saved?<p className="caption" role="status">{saved}</p>:null}
  </section>;
}
