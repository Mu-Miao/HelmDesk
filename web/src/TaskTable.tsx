import { useState } from 'react';
import type { Task } from '../../src/types';
import { states, acceptance, failures, clock, number } from './api';
import { Icon } from './Icon';
export function TaskTable({ tasks, selected, onSelect, all,project,onProject }: { tasks: Task[]; selected?: string; onSelect: (id: string) => void; all: boolean;project:string;onProject:(path:string)=>void }) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState('');
  const projects = Array.from(new Set(tasks.map(task => task.projectPath)));
  const filtered = tasks.filter(task => (!status || (status === 'pending' ? task.state === 'completed' && task.acceptance === 'pending' : task.state === status)) && (!all || !project || project === task.projectPath) && `${task.title} ${task.id} ${task.projectPath}`.toLowerCase().includes(query.toLowerCase()));
  return <section className="task-section">
    <div className="section-heading"><div><h2>{all ? '任务列表' : '任务动态'}</h2><p>执行完成后，由 Codex 审查交付。</p></div>
      <div className="filters">{all ? <select aria-label="按项目筛选" value={project} onChange={e => onProject(e.target.value)}><option value="">全部项目</option>{projects.map(p => <option key={p} value={p}>{projects.some(other => other !== p && other.split('/').at(-1) === p.split('/').at(-1)) ? p : p.split('/').at(-1)}</option>)}</select> : null}
        <select aria-label="按状态筛选" value={status} onChange={e => setStatus(e.target.value)}><option value="">全部状态</option>{Object.entries(states).map(([key,label]) => <option value={key} key={key}>{label}</option>)}<option value="pending">等待验收</option></select>
        <label className="search"><Icon name="search"/><input aria-label="搜索任务" placeholder="搜索任务" value={query} onChange={e => setQuery(e.target.value)}/></label>
      </div>
    </div>
    <div className="table-scroll"><table><thead><tr><th>任务</th><th>执行者 / 模型</th><th>执行状态</th><th>任务用量</th><th>更新时间</th></tr></thead>
      <tbody>{filtered.map(task => <tr className={selected === task.id ? 'selected' : ''} key={task.id}>
        <td><div className="task-label">{task.title.match(/^P\d+\s/) ? <span className="task-badge">{task.title.split(' ')[0]}</span> : null}<div><button className="task-name" onClick={() => onSelect(task.id)}>{task.title.replace(/^P\d+\s/, '')}</button><small>{task.acceptanceCriteria[0] ?? task.projectPath.split('/').at(-1)}</small></div></div></td>
        <td>{task.agent==='ollama'?'Ollama 本地':'Qoder CN'}<small>{task.modelLabel ?? task.requestedModel}</small></td>
        <td><span className={`status status-${task.state}`}>{states[task.state]}</span><small>{task.state === 'completed' ? acceptance[task.acceptance] : failures[task.failureKind ?? ''] ?? (task.dependencies.length ? `${task.dependencies.length} 项依赖` : '独立任务')}</small></td>
        <td className="numeric">{number(task.usage?.taskCredits)}{task.usage?.taskCredits != null ? ' Credits' : ''}</td><td className="numeric">{clock(task.updatedAt)}</td>
      </tr>)}</tbody></table></div>
    {filtered.length === 0 ? <div className="empty"><h3>{tasks.length ? '没有匹配的任务' : '等待 Codex 派发第一个任务'}</h3><p>{tasks.length ? '调整搜索内容或筛选条件。' : '接入领航台 MCP 后，任务会在这里实时出现。'}</p></div> : null}
  </section>;
}
