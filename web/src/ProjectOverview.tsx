import React from 'react';
import type { ProjectModelUsage, ProjectSummary, RecordedMetric } from '../../src/project-types.js';

const COUNT_LABELS: [keyof ProjectSummary['counts'], string][] = [
  ['total', '总计'],
  ['active', '进行中'],
  ['queued', '排队'],
  ['pendingReview', '待验收'],
  ['changesRequested', '需要返工'],
  ['failed', '失败'],
  ['waitingUser', '等待用户'],
];

function formatActivity(lastActivityAt: string | null): string {
  if (lastActivityAt === null) return '未记录';
  const date = new Date(lastActivityAt);
  return Number.isNaN(date.getTime()) ? lastActivityAt : date.toLocaleString('zh-CN', {hour12:false});
}

function metricValue(metric: RecordedMetric): string {
  if (metric.overflow) return '超出可表示范围';
  if (metric.total === null) return '不可用';
  const formatted = new Intl.NumberFormat('zh-CN', Number.isInteger(metric.total)
    ? {maximumFractionDigits:0} : {maximumSignificantDigits:12}).format(metric.total);
  return Number(formatted.replaceAll(',', '')) === metric.total ? formatted : `≈ ${formatted}`;
}

function Metric({ label, metric, taskCount }: { label: string; metric: RecordedMetric; taskCount: number }): React.JSX.Element {
  return (
    <p className="recorded-metric">
      <span className="recorded-metric-label">{label}</span>
      <span className="recorded-metric-value" title={metric.total === null ? undefined : `原始记录合计：${metric.total}`}>{metricValue(metric)}</span>
      <span className="recorded-metric-coverage">{`已记录 ${metric.knownTasks} / ${taskCount} · 未记录 ${metric.unknownTasks}`}</span>
    </p>
  );
}

function ProjectModel({ model }: { model: ProjectModelUsage }): React.JSX.Element {
  return (
    <li className="project-model">
      <p className="project-model-head">
        {/* 名称（含 Auto）原样展示，不翻译、不推断厂商 */}
        <span className="project-model-name">{model.id === 'Auto' ? 'Auto' : model.label || model.id}</span>
        <span className="project-model-kind">{model.kind === 'custom' ? '自定义' : '平台'}</span>
        {model.agent ? <span className="project-model-kind">{model.agent==='ollama'?'Ollama 本地':model.agent}</span> : null}
      </p>
      {model.kind === 'custom' ? <code className="project-model-id">{model.id}</code> : null}
      <Metric label="任务 Credits" metric={model.credits} taskCount={model.taskCount} />
      <Metric label="USD" metric={model.usd} taskCount={model.taskCount} />
      <details className="project-model-tokens">
        <summary>Token 记录</summary>
        <Metric label="输入 Token" metric={model.inputTokens} taskCount={model.taskCount} />
        <Metric label="输出 Token" metric={model.outputTokens} taskCount={model.taskCount} />
      </details>
    </li>
  );
}

function ProjectCard({ project, onOpen }: { project: ProjectSummary; onOpen: (path: string) => void }): React.JSX.Element {
  return (
    <li className="project-card">
      <div className="project-heading">
        <h3 className="project-name">{project.name}</h3>
        <p className="project-path">{project.path}</p>
      </div>
      <p className="project-counts">
        {COUNT_LABELS.map(([key, label]) => (
          <span className="project-count" key={key}>{`${label} ${project.counts[key]}`}</span>
        ))}
      </p>
      <p className="project-activity">{`最近活动 ${formatActivity(project.lastActivityAt)}`}</p>
      <button
        type="button"
        className="project-open outline"
        aria-label={`查看 ${project.name} 的任务`}
        onClick={() => { onOpen(project.path); }}
      >
        查看任务
      </button>
      <details className="project-models">
        <summary>用量记录</summary>
        {project.models.length === 0
          ? <p className="project-models-empty">没有模型用量记录</p>
          : <ul className="project-model-list">{project.models.map(model => <ProjectModel model={model} key={`${model.agent??'qoder-cn'}:${model.id}`} />)}</ul>}
      </details>
    </li>
  );
}

export function ProjectOverview({ projects, onOpen }: { projects: ProjectSummary[]; onOpen: (path: string) => void }): React.JSX.Element {
  return (
    <section className="projects-overview" aria-labelledby="projects-overview-title">
      <h2 id="projects-overview-title">项目概览</h2>
      <p className="projects-overview-note">仅统计 HelmDesk 记录的任务，不代表账户余额或实际花费。</p>
      {projects.length === 0
        ? <p className="projects-empty">还没有项目任务</p>
        : <ul className="project-list">{projects.map(project => <ProjectCard project={project} onOpen={onOpen} key={project.path} />)}</ul>}
    </section>
  );
}
