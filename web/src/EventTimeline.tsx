import React, { useState } from 'react';
import type { TaskEvent } from '../../src/types.js';
import { clock,states } from './api.js';
import {dispositionLabels} from '../../src/disposition-types.js';
function record(value:unknown):Record<string,unknown>{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
const labels:Record<string,string>={cleanup:'进程组核验',execution_limits:'执行限制',execution_policy:'运行限制更新',policy:'权限检查',assistant:'执行者消息',tool_result:'工具返回',result:'执行结果',session:'会话就绪',initialized:'执行端就绪',preflight:'隔离预检',reasoning:'推理档位确认',update:'记录更新',quota:'额度快照',stderr:'执行日志',error:'执行异常',cleanup_error:'清理异常',format_error:'格式异常',integration_check:'整合预检',patch_export:'补丁导出',revision_created:'修订任务创建',revision_spawned:'已派发修订'};
function describe(event:TaskEvent){
 const d=record(event.data);let summary='';
 if(event.type==='disposition')summary=`${d.status==='unclassified'?'重新待处理':dispositionLabels[d.status as keyof typeof dispositionLabels]??'处理结论'} · ${String(d.reason??'')}`;
 else if(event.type==='state')summary=states[String(d.state)]??String(d.state??'状态更新');
 else if(event.type==='policy')summary=`${String(d.tool??'工具')} · ${d.allowed===true?'允许':'拒绝'} · ${String(d.reason??'')}`;
 else if(event.type==='reasoning')summary=`${String(d.label??'')} · ${String(d.effort??'')}`;
 else if(event.type==='integration_check'){const counts=record(d.counts);summary=`可整合 ${String(counts.ready??0)} · 冲突 ${String(counts.conflict??0)} · 已一致 ${String(counts.alreadyApplied??0)} · 不支持 ${String(counts.blocked??0)}`;}
 else if(event.type==='patch_export')summary=String(d.filename??'已导出补丁，未应用到原项目');
 else if(event.type==='revision_created')summary=`来源任务 ${String(d.sourceTaskId??'')}`;
 else if(event.type==='revision_spawned')summary=`新任务 ${String(d.taskId??'')}`;
 else if(event.type==='cleanup')summary=d.status==='absent'?'进程组已不存在':d.status==='zombies_only'?'仅剩不可执行的待回收进程':'已向自有进程组发送终止信号';
 else if(event.type==='execution_limits')summary=`最大轮数 ${d.maxTurns??'未设置'} · ${String(d.source??'')}`;
 else if(event.type==='assistant'&&Array.isArray(d.content))summary=d.content.map(record).map(p=>p.type==='tool_use'?`${String(p.name)} · ${String(record(p.input).file_path??record(p.input).path??'')}`:String(p.text??'')).filter(Boolean).join('；');
 else if(typeof event.data==='string')summary=event.data;
 else summary=String(d.message??d.reason??d.result??d.modelReported??d.summary??'');
 return{label:event.type==='disposition'?'历史处理结论':event.type==='state'?'任务状态':labels[event.type]??event.type,summary:summary.replace(/\s+/g,' ').slice(0,180)};
}
export function EventTimeline({events}:{events:TaskEvent[]}){
 const [limit,setLimit]=useState(40);
 const visible=events.filter(e=>!(e.type==='assistant'&&Array.isArray(record(e.data).content)&&(record(e.data).content as unknown[]).length===0));
 return <div className="event-log"><p className="caption">{visible.length} 条事件{visible.length>limit?` · 当前显示最近 ${limit} 条`:''}</p>{visible.length>limit?<button className="text-button" onClick={()=>setLimit(n=>n+40)}>显示更早的事件</button>:null}
  <ol className="timeline">{visible.slice(-limit).map(event=>{const item=describe(event);return <li key={event.seq}><time>{clock(event.at)}</time><div><strong>{item.label}</strong>{item.summary?<p className="event-summary">{item.summary}</p>:null}<details className="event-raw"><summary>原始记录 · #{event.seq}</summary><pre>{JSON.stringify(event.data,null,2)}</pre></details></div></li>;})}</ol>
  {!visible.length?<p className="caption">暂时没有可展示的事件。</p>:null}
 </div>;
}
