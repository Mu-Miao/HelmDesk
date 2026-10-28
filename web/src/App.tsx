import { useLayoutEffect, useState } from 'react';
import { useDesk } from './useDesk';
import { Icon } from './Icon';
import { TaskTable } from './TaskTable';
import { TaskDetail } from './TaskDetail';
import { clock, number, tool } from './api';
import GlassSurface from './blog/GlassSurface';
import { BlogBackdrop } from './BlogBackdrop';
import { ModelSettings } from './ModelSettings';
import { Capabilities } from './Capabilities';
import { QueueOverview } from './QueueOverview';
import {ProjectOverview} from './ProjectOverview';
import {AgentCatalog} from './AgentCatalog';
import ReviewInbox from './ReviewInbox';
import {buildReviewCard} from '../../src/review-card';
import type {Attention} from '../../src/review-types';
import {ExecutionSettings} from './ExecutionSettings';
const navigation = [{ name: '总览', icon: 'grid' }, { name: '项目概览', icon: 'grid' }, { name: '任务列表', icon: 'list' }, { name: '集中验收', icon: 'list' }, { name: '工具来源', icon: 'tool' }];
export default function App() {
  const { data, csrf, connected, error, setError, refresh } = useDesk();
  const [page, setPage] = useState('总览'), [selected, setSelected] = useState(''), [refreshing, setRefreshing] = useState(false);
  const [reviewFilter,setReviewFilter]=useState<Attention|'all'>('all'),[reviewLimit,setReviewLimit]=useState(10),[reviewProject,setReviewProject]=useState('');
  const [project,setProject]=useState(''),[projectSearch,setProjectSearch]=useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => { try { return localStorage.getItem('helmdesk.theme.v1') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } });
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle('dark', theme === 'dark'); try { localStorage.setItem('helmdesk.theme.v1', theme); } catch { /* optional preference */ } }, [theme]);
  const task = data?.tasks.find(item => item.id === selected) ?? data?.tasks[0];
  const running = data?.tasks.filter(task => ['running','preparing'].includes(task.state)).length ?? 0;
  const pending = data?.tasks.filter(task => task.state === 'completed' && task.acceptance === 'pending'&&!task.disposition).length ?? 0;
  const quota = data?.quota, addOn = quota?.available ? quota.value?.addOnQuota : null;
  const projects=data?.projects??[],filteredProjects=projects.filter(p=>`${p.name} ${p.path}`.toLowerCase().includes(projectSearch.toLowerCase()));
  const reviewCards=(data?.tasks??[]).filter(t=>!reviewProject||t.projectPath===reviewProject).map(buildReviewCard).filter(c=>c.attention!==null);
  const filteredReviews=reviewCards.filter(c=>reviewFilter==='all'||c.attention===reviewFilter);
  async function refreshStatus() { setRefreshing(true); try { await tool('agents_list', {}, csrf); await refresh(); } catch (e: any) { setError(e.message); } finally { setRefreshing(false); } }
  return <div className="app-shell"><BlogBackdrop theme={theme}/><header className="floating-header"><GlassSurface width="100%" height="auto" borderRadius={32} backgroundOpacity={.45} saturation={1.4} className="nav-glass"><a className="brand" href="#" onClick={() => setPage('总览')}><img className="brand-icon" src="/assets/helmdesk.svg" width="40" height="40" alt=""/><span>领航台<small>HELMDESK</small></span></a><nav aria-label="主导航">{navigation.map(item => <button className={page === item.name ? 'active' : ''} aria-current={page === item.name ? 'page' : undefined} onClick={() => setPage(item.name)} key={item.name}>{item.name}</button>)}</nav><div className="header-tools"><span className="connection"><i className={connected ? 'online' : ''}/>{connected ? '本地连接' : '连接中'}</span><button className="theme-toggle" aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'} onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18}/></button></div></GlassSurface></header>
    <div className="main-shell"><main>
      <div className="page-heading"><div><h1>{page}</h1><p>在 Codex 里指挥，在领航台里看见。</p></div><button className="outline refresh" onClick={refreshStatus} disabled={refreshing || !csrf}><Icon name="refresh"/>{refreshing ? '刷新中…' : '刷新状态'}</button></div>
      {error ? <div className="notice" role="alert">{error}</div> : null}
      {!data ? <div className="empty"><h2>正在连接本地工作台</h2><p>读取真实任务与运行记录…</p></div> : page === '工具来源' ? <><AgentCatalog agents={data.agents??[]}/><Capabilities catalog={data.capabilities} csrf={csrf} onRefresh={refresh} onError={setError}/></> : page==='集中验收'?<><div className="review-filters"><label>处理类型<select aria-label="筛选处理类型" value={reviewFilter} onChange={e=>{setReviewFilter(e.target.value as Attention|'all');setReviewLimit(10);}}><option value="all">全部待处理</option><option value="review">待审核</option><option value="rework">需要返工</option><option value="intervention">等待处理</option></select></label><label>项目<select aria-label="筛选验收项目" value={reviewProject} onChange={e=>{setReviewProject(e.target.value);setReviewLimit(10);}}><option value="">所有项目</option>{projects.map(p=><option key={p.path} value={p.path}>{p.name} · {p.path}</option>)}</select></label></div><p className="caption">共 {filteredReviews.length} 项，显示 {Math.min(reviewLimit,filteredReviews.length)} 项。摘要仅用于定位，进入任务后独立核对差异与测试。</p><ReviewInbox cards={filteredReviews.slice(0,reviewLimit)} onOpen={id=>{setSelected(id);setProject('');setPage('任务列表');}}/>{filteredReviews.length>reviewLimit?<button className="outline review-more" onClick={()=>setReviewLimit(n=>n+10)}>再显示 10 项</button>:null}</>: page==='项目概览'?<><label className="project-search">搜索项目<input aria-label="搜索项目" value={projectSearch} onChange={event=>setProjectSearch(event.target.value)} placeholder="项目名或路径"/></label>{projects.length&&!filteredProjects.length?<div className="empty"><h2>没有匹配的项目</h2><p>调整项目名或路径搜索。</p></div>:<ProjectOverview projects={filteredProjects} onOpen={path=>{setProject(path);setSelected(data.tasks.find(t=>t.projectPath===path)?.id??'');setPage('任务列表');}}/>}</>:<>
        {page === '总览' ? <section className="metrics" aria-label="工作台状态"><div><span>执行中</span><strong>{running}</strong></div><div><span>待验收</span><strong>{pending}</strong></div><div><span>Qoder CN</span><strong>{data.agent?.available ? '可用' : '未就绪'}</strong></div><div><span>加购额度</span><strong className="quota">{addOn?.remaining != null ? `${number(addOn.remaining)} Credits` : '不可用'}</strong><small>{quota?.sampledAt ? `快照 · ${clock(quota.sampledAt)}` : '尚未取得官方快照'}</small>{quota?.available === false && quota.reason ? <small className="quota-reason">{quota.reason}</small> : null}</div></section> : null}
        {page === '总览' ? <ModelSettings csrf={csrf} preference={data.modelPreference} onSaved={refresh} onError={setError}/> : null}
        {page === '总览'&&data.executionPolicy ? <ExecutionSettings view={data.executionPolicy} preference={data.modelPreference} csrf={csrf} onSaved={refresh} onError={setError}/> : null}
        {data.queue ? <QueueOverview queue={data.queue} tasks={data.tasks} onSelect={setSelected}/> : null}
        <TaskTable tasks={data.tasks} selected={task?.id} onSelect={setSelected} all={page === '任务列表'} project={project} onProject={setProject}/>
        {task ? <TaskDetail key={task.id} task={task} tasks={data.tasks} onSelect={setSelected} csrf={csrf} agent={data.agents?.find(a=>a.id===(task.agent??'qoder-cn'))??data.agent} onRefresh={refresh} onError={setError}/> : null}
      </>}
    </main></div></div>;
}
