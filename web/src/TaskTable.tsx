import React,{ useState } from 'react';
import type { Task } from '../../src/types.js';
import { states, acceptance, failures, clock, number } from './api.js';
import { Icon } from './Icon.js';
import {dispositionLabels,matchesDisposition,canClassifyTask,type DispositionFilter} from '../../src/disposition-types.js';
export function TaskTable({ tasks, selected, onSelect, all,project,onProject }: { tasks: Task[]; selected?: string; onSelect: (id: string) => void; all: boolean;project:string;onProject:(path:string)=>void }) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState('');
  const [handling,setHandling]=useState<DispositionFilter>('all');
  const projects = Array.from(new Set(tasks.map(task => task.projectPath)));
  const matched=tasks.filter(task => (!status || (status === 'pending' ? task.state === 'completed' && task.acceptance === 'pending'&&!task.disposition : task.state === status)) && (!all || !project || project === task.projectPath) && `${task.title} ${task.id} ${task.projectPath} ${task.disposition?.reason??''}`.toLowerCase().includes(query.toLowerCase()));
  const filtered=matched.filter(task=>matchesDisposition(task,handling));
  return <section className="task-section">
    <div className="section-heading"><div><h2>{all ? '任务列表' : '任务动态'}</h2><p>执行状态与处理结论分开记录，历史错误和交付保留。</p></div>
      <div className="filters">{all ? <select aria-label="按项目筛选" value={project} onChange={e => onProject(e.target.value)}><option value="">全部项目</option>{projects.map(p => <option key={p} value={p}>{projects.some(other => other !== p && other.split('/').at(-1) === p.split('/').at(-1)) ? p : p.split('/').at(-1)}</option>)}</select> : null}
        <select aria-label="按状态筛选" value={status} onChange={e => setStatus(e.target.value)}><option value="">全部状态</option>{Object.entries(states).map(([key,label]) => <option value={key} key={key}>{label}</option>)}<option value="pending">等待验收</option></select>
        <select aria-label="按处理结论筛选" value={handling} onChange={e=>setHandling(e.target.value as DispositionFilter)}><option value="all">全部处理结论</option><option value="unclassified">待归类</option>{Object.entries(dispositionLabels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
        <label className="search"><Icon name="search"/><input aria-label="搜索任务" placeholder="搜索任务" value={query} onChange={e => setQuery(e.target.value)}/></label>
      </div>
    </div>
    <div className="disposition-filters" role="group" aria-label="历史处理分类">{([['all','全部记录'],['unclassified','待归类'],...Object.entries(dispositionLabels)] as [DispositionFilter,string][]).map(([key,label])=><button type="button" key={key} aria-pressed={handling===key} onClick={()=>setHandling(key)}>{label}<span>{matched.filter(t=>matchesDisposition(t,key)).length}</span></button>)}</div>
    <div className="table-scroll"><table><thead><tr><th>任务</th><th>执行者 / 模型</th><th>执行状态</th><th>处理结论</th><th>任务用量</th><th>更新时间</th></tr></thead>
      <tbody>{filtered.map(task => <tr className={selected === task.id ? 'selected' : ''} key={task.id}>
        <td><div className="task-label">{task.title.match(/^P\d+\s/) ? <span className="task-badge">{task.title.split(' ')[0]}</span> : null}<div><button className="task-name" onClick={() => onSelect(task.id)}>{task.title.replace(/^P\d+\s/, '')}</button><small>{task.acceptanceCriteria[0] ?? task.projectPath.split('/').at(-1)}</small></div></div></td>
        <td>{task.agent==='ollama'?'Ollama 本地':'Qoder CN'}<small>{task.modelLabel ?? task.requestedModel}</small></td>
        <td><span className={`status status-${task.state}`}>{states[task.state]}</span><small>{task.disposition?'原始执行状态保留':task.state === 'completed' ? acceptance[task.acceptance] : failures[task.failureKind ?? ''] ?? (task.dependencies.length ? `${task.dependencies.length} 项依赖` : '独立任务')}</small></td>
        <td className="disposition-cell">{task.disposition?<><span className={`disposition-badge disposition-${task.disposition.status}`}>{dispositionLabels[task.disposition.status]}</span><small className="disposition-reason-preview" title={task.disposition.reason}>{task.disposition.reason}</small>{task.disposition.replacementTaskId?<button className="text-button" onClick={()=>onSelect(task.disposition!.replacementTaskId!)}>查看后续任务</button>:null}</>:<small>{canClassifyTask(task)?'待归类':'—'}</small>}</td>
        <td className="numeric">{number(task.usage?.taskCredits)}{task.usage?.taskCredits != null ? ' Credits' : ''}</td><td className="numeric">{clock(task.updatedAt)}</td>
      </tr>)}</tbody></table></div>
    {filtered.length === 0 ? <div className="empty"><h3>{tasks.length ? '没有匹配的任务' : '等待 Codex 派发第一个任务'}</h3><p>{tasks.length ? '调整搜索内容或筛选条件。' : '接入领航台 MCP 后，任务会在这里实时出现。'}</p></div> : null}
  </section>;
}
