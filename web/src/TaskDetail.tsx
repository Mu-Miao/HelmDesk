import { useEffect, useState } from 'react';
import type { Task, TaskEvent } from '../../src/types';
import { number, tool, acceptance } from './api';
import { Icon } from './Icon';
import type { DeliveryReport } from '../../src/report-types';
import { TaskInputs } from './TaskInputs';
import {ResultSummary} from './ResultSummary';
import {EventTimeline} from './EventTimeline';
import {DiffView} from './DiffView';
import {reasoningLabels} from '../../src/reasoning';
import {IntegrationPanel} from './IntegrationPanel';
import {revisionFamily} from '../../src/revision-family';
import {RevisionTrail} from './RevisionTrail';
import {TaskDisposition} from './TaskDisposition';
import {agentName} from '../../src/agent-types.js';
const tabs = ['结果摘要', '时间线', '文件改动', '用量'];
export function TaskDetail({ task,tasks,onSelect, csrf, agent, onRefresh, onError }: { task: Task;tasks:Task[];onSelect:(id:string)=>void; csrf: string; agent: any; onRefresh: () => Promise<unknown>; onError: (error: string) => void }) {
  const [tab, setTab] = useState('结果摘要'), [events, setEvents] = useState<TaskEvent[]>([]), [cursor, setCursor] = useState(0), [busy, setBusy] = useState(false), [expanded, setExpanded] = useState(false);
  const [report, setReport] = useState<DeliveryReport | null>(null), [exporting, setExporting] = useState(false);
  const [exportName, setExportName] = useState('');
  useEffect(() => { setReport(null); setExportName(''); }, [task.id, task.updatedAt]);
  async function exportReport(format: 'md' | 'json') {
    setExporting(true);
    try {
      const result = await tool<DeliveryReport>('task_export', {taskId:task.id}, csrf);
      setReport(result);
      const contents = format === 'md' ? result.markdown : JSON.stringify({schemaVersion:result.schemaVersion,record:result.record,limitations:result.limitations}, null, 2);
      const url = URL.createObjectURL(new Blob([contents], {type:format === 'md' ? 'text/markdown;charset=utf-8' : 'application/json;charset=utf-8'}));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = format === 'md' ? result.filename : result.filename.replace(/\.md$/, '.json');
      setExportName(anchor.download);
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) { onError(e.message); } finally { setExporting(false); }
  }
  useEffect(() => { setEvents([]); setCursor(0); setExpanded(false); }, [task.id]);
  useEffect(() => {
    let disposed = false;
    if (tab === '时间线') void tool('task_events', { taskId: task.id, after: 0 }, csrf).then(data => { if (!disposed) { setEvents(data.events); setCursor(data.cursor); } }).catch(e => onError(e.message));
    return () => { disposed = true; };
  }, [task.id, task.updatedAt, tab, csrf]);
  async function cancel() { setBusy(true); try { await tool('task_cancel', { taskId: task.id }, csrf); await onRefresh(); } catch (e: any) { onError(e.message); } finally { setBusy(false); } }
  return <section className="detail" aria-label="任务详情">
    <div className="detail-heading"><h3>{task.title.match(/^P\d+\s/) ? <span className="task-badge">{task.title.split(' ')[0]}</span> : null}{task.title.replace(/^P\d+\s/, '')}</h3><button className="text-button" onClick={() => setExpanded(v => !v)}>{expanded ? '收起详情' : '查看详情'}<Icon name="arrow" size={17}/></button></div>
    <TaskDisposition task={task} tasks={tasks} onSelect={onSelect} csrf={csrf} onRefresh={onRefresh} onError={onError}/>
    <div className="tabs" role="tablist" aria-label="任务详情类别">{tabs.map(label => <button key={label} role="tab" aria-selected={label === tab} onClick={() => setTab(label)}>{label}</button>)}</div>
    <div role="tabpanel" className="tab-panel">
      {tab === '结果摘要' ? <><ResultSummary text={task.summary || task.error || '任务尚未返回结果。'} error={!!task.error}/><p className="caption">{task.requestedModel.toLowerCase() === 'auto' && (!task.reportedModel || task.reportedModel.toLowerCase() === 'auto') ? 'Auto，实际模型未提供。' : `请求模型：${task.requestedModel} · ${task.agent==='antigravity'?'CLI 确认':'服务端报告'}：${task.reportedModel ?? '未提供'}`}</p></> : null}
      {tab === '时间线' ? <><EventTimeline events={events}/><button className="outline" onClick={() => { void tool('task_events', { taskId: task.id, after: cursor }, csrf).then(data => { setEvents(current => [...current, ...data.events.filter((e: TaskEvent) => !current.some(item => item.seq === e.seq))]); setCursor(data.cursor); }).catch(e => onError(e.message)); }}>读取后续事件</button></> : null}
      {tab === '文件改动' ? task.changes?.length ? <DiffView changes={task.changes}/> : <div className="result">{task.state === 'completed' ? '本任务没有文件改动。' : '执行结束后生成改动证据。'}</div> : null}
      {tab === '用量' ? <><dl className="usage-grid"><div><dt>本任务</dt><dd>{number(task.usage?.taskCredits)} Credits</dd></div><div><dt>CLI 会话累计</dt><dd>{number(task.usage?.sessionCredits)} Credits</dd></div><div><dt>输入 / 输出 Tokens</dt><dd>{number(task.usage?.inputTokens)} / {number(task.usage?.outputTokens)}</dd></div><div><dt>金额（USD）</dt><dd>{number(task.usage?.usd)}</dd></div>{task.agent==='antigravity'?<><div><dt>总 Tokens</dt><dd>{number(task.usage?.totalTokens)}</dd></div><div><dt>思考 Tokens（可能已含于输出）</dt><dd>{number(task.usage?.thinkingTokens)}</dd></div><div><dt>缓存读取 Tokens</dt><dd>{number(task.usage?.cacheReadTokens)}</dd></div></>:null}</dl><p className="caption">{task.usage?.tokenNote ?? '尚未取得官方用量数据。'}。任务与会话消耗不重复相加。</p></> : null}
    </div>
    {task.reasoningEffort?<p className="caption">思考深度：{reasoningLabels[task.reasoningEffort]}（{task.reasoningEffort}）· {task.reasoningRun?'CLI 目录已确认支持，按此档位请求':'等待 CLI 请求参数校验'}</p>:null}
    {task.maxTurns?<p className="caption">最大轮数：{task.maxTurns} · 请求上限，实际用量以返回记录为准</p>:null}
    <TaskInputs run={task.inputRun}/>
    <RevisionTrail family={revisionFamily(tasks,task.id)} onSelect={onSelect}/>
    <IntegrationPanel task={task} csrf={csrf} onError={onError}/>
    <div className="delivery-export" aria-label="交付审核报告"><div><h4>交付审核报告</h4><p>记录模型、验证、验收与已存差异；完整文件保留在独立工作目录。</p></div><div className="delivery-actions"><button className="outline" disabled={exporting || !csrf || !['completed','failed','cancelled'].includes(task.state)} onClick={() => void exportReport('md')}>导出 Markdown</button><button className="text-button" disabled={exporting || !csrf || !['completed','failed','cancelled'].includes(task.state)} onClick={() => void exportReport('json')}>导出 JSON</button></div>{report ? <p className="caption" role="status">已生成 {exportName} · {report.record.changes.length} 项改动{report.record.changes.some(c => c.incomplete) ? ' · 含不完整差异，请查看完整工作文件' : ''}</p> : !['completed','failed','cancelled'].includes(task.state) ? <p className="caption">任务结束后可导出。</p> : null}</div>
    {expanded ? <div className="expanded"><dl><dt>任务编号</dt><dd>{task.id}</dd><dt>项目</dt><dd>{task.projectPath}</dd><dt>独立工作目录</dt><dd>{task.workspace ?? '尚未准备'}</dd><dt>验证结果</dt><dd>{task.verification ? ({passed:'通过',failed:'失败',not_run:'未运行'})[task.verification.status] : '未记录'}{task.verification ? ` · ${task.verification.evidence}` : ''}</dd><dt>验收状态</dt><dd>{acceptance[task.acceptance]}{task.reviewNote ? ` · ${task.reviewNote}` : ''}</dd><dt>验收条件</dt><dd><ul>{task.acceptanceCriteria.map(item => <li key={item}>{item}</li>)}</ul></dd><dt>允许改动</dt><dd>{task.allowedFiles.join('、') || '无（禁用工具）'}</dd></dl>{!['completed','failed','cancelled'].includes(task.state) ? <button className="outline danger" disabled={busy} onClick={cancel}>取消任务</button> : null}</div> : null}
    {task.capabilityRun?<details className="capability-audit"><summary>本任务能力与隔离证据</summary><p>Skills：{task.capabilityRun.skills.map(s=>s.id).join('、')||'未选择'} · MCP：{task.capabilityRun.tools.map(t=>t.id).join('、')||'未选择'}</p><p>OS 隔离：{task.capabilityRun.isolation?.verified?'已验证':'未验证'}</p><ul>{task.capabilityRun.sourceChecks.map(check=><li key={check.id}>{check.id} · {check.unchanged===true?'来源摘要一致':check.unchanged===false?'来源异常':'等待运行后核对'}</li>)}</ul></details>:null}
    <div className="source-strip"><div><h4>Agent 接入</h4><p>{agentName(task.agent)}</p><small>CLI {agent?.version ?? '不可用'} · {task.agent==='antigravity'?'辅助文本任务':task.agent==='ollama'?'仅本地无工具任务':agent?.runtime?.source === 'app-runtime'||agent?.source==='app-runtime' ? 'App 兼容路径' : '官方 CLI'}</small></div><div><h4>本任务能力共享</h4><p>{task.capabilityRun?`${task.capabilityRun.skills.length} Skills · ${task.capabilityRun.tools.length} MCP`:'未选择共享能力'}</p><small>Codex → 选定快照 → 执行者</small></div></div>
  </section>;
}
