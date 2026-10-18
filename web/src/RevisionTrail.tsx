import React from 'react';
import type { RevisionFamily, RevisionItem } from '../../src/revision-types.js';

const STATE_LABELS: Record<string, string> = {
  queued: '排队中',
  preparing: '准备中',
  running: '运行中',
  waiting_user: '等待用户',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const ACCEPTANCE_LABELS: Record<string, string> = {
  accepted: '验收通过',
  pending: '待验收',
  changes_requested: '需要返工',
};

const VERIFICATION_LABELS: Record<string, string> = {
  passed: '通过',
  failed: '失败',
  not_run: '未运行',
};

const EFFORT_LABELS: Record<string,string> = {low:'低',medium:'中',xhigh:'极高'};
function namedValue(labels: Record<string, string>, value: string | null): string {
  if (value === null || value === '') return '未记录';
  return labels[value] ?? value;
}

function RevisionEntry({ item, current, onSelect }: { item: RevisionItem; current: boolean; onSelect: (id: string) => void }): React.JSX.Element {
  return (
    <li className={current ? 'revision-item current' : 'revision-item'}>
      <button type="button" className="revision-select" onClick={() => { onSelect(item.id); }} disabled={current}>
        <span className="revision-title">{item.title}</span>
      </button>
      {current ? <span className="revision-current">当前</span> : null}
      <p className="revision-meta">
        <span className="revision-state">{`状态 ${namedValue(STATE_LABELS, item.state)}`}</span>
        <span className="revision-acceptance">{`验收 ${namedValue(ACCEPTANCE_LABELS, item.acceptance)}`}</span>
        <span className="revision-verification">{`验证 ${namedValue(VERIFICATION_LABELS, item.verification)}`}</span>
      </p>
      {item.model || item.effort ? (
        <p className="revision-config">
          {item.model ? <span className="revision-model">{`模型 ${item.model}`}</span> : null}
          {item.effort ? <span className="revision-effort">{`思考深度 ${EFFORT_LABELS[item.effort] ?? item.effort}（${item.effort}）`}</span> : null}
        </p>
      ) : null}
    </li>
  );
}

export function RevisionTrail({ family, onSelect }: { family: RevisionFamily; onSelect: (id: string) => void }): React.JSX.Element | null {
  if (family.items.length < 2 && !family.problem) return null;
  return (
    <section className="revision-trail" aria-label="任务修订记录">
      <h3 className="revision-trail-title">修订记录</h3>
      <p className="revision-trail-note">每次修订都是新任务，原任务保留。</p>
      {family.problem ? <p className="revision-problem">{`修订状态：${family.problem}`}</p> : null}
      <ul className="revision-items">
        {family.items.map(item => (
          <RevisionEntry item={item} current={item.id === family.currentTaskId} onSelect={onSelect} key={item.id} />
        ))}
      </ul>
    </section>
  );
}
