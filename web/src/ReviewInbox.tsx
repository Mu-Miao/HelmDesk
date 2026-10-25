import React from 'react';
import type {Attention, ReviewCard} from '../../src/review-types.js';
import type {State} from '../../src/types.js';
import {agentName} from '../../src/agent-types.js';

type Acceptance = ReviewCard['acceptance'];
type Verification = ReviewCard['verification'];

const STATE_LABEL: Record<State, string> = {
	queued: '排队中',
	preparing: '准备中',
	running: '运行中',
	waiting_user: '等待用户',
	completed: '执行完成',
	failed: '执行失败',
	cancelled: '已取消',
};

const ATTENTION_LABEL: Record<Attention, string> = {
	review: '待审核',
	rework: '需要返工',
	intervention: '等待处理',
};

const VERIFICATION_LABEL: Record<Verification, string> = {
	passed: '验证通过',
	failed: '验证失败',
	not_run: '未验证',
};

const ACCEPTANCE_LABEL: Record<Acceptance, string> = {
	pending: '待验收',
	accepted: '已验收',
	changes_requested: '要求修改',
};

const SUMMARY_LIMIT = 240;
const ERROR_LIMIT = 180;

function bounded(value: string, limit: number, hostTruncated: boolean) {
	const text = value.trim();
	if (!text) return null;
	const points = Array.from(text);
	const clipped = points.length > limit;
	return {
		text: clipped ? `${points.slice(0, limit).join('')}…` : text,
		truncated: clipped || hostTruncated,
	};
}

function BoundedText({label, value, limit, hostTruncated, tone}: {label: string; value: string; limit: number; hostTruncated: boolean; tone: string}) {
	const shown = bounded(value, limit, hostTruncated);
	if (!shown) return null;
	return (
		<div className={`review-text ${tone}`}>
			<span className="review-text-label">{label}</span>
			<span className="review-text-body">{shown.text}</span>
			{shown.truncated ? <span className="review-text-cut">内容已截断</span> : null}
		</div>
	);
}

function FileDetails({card}: {card: ReviewCard}) {
	return (
		<details className="review-files">
			<summary className="review-files-summary">
				共 {card.fileCount} 个文件
				{card.filesTruncated || card.files.length < card.fileCount ? `（已列出 ${card.files.length} 个，其余被截断）` : ''}
			</summary>
			{card.files.length === 0 ? (
				<p className="review-files-empty">没有可列出的文件</p>
			) : (
				<ul className="review-file-list">
					{card.files.map((file) => (
						<li key={file.path} className="review-file-item">
							<span className="review-file-kind">{file.kind}</span>
							<span className="review-file-path">{file.path}</span>
						</li>
					))}
				</ul>
			)}
		</details>
	);
}

function ReviewItem({card, onOpen}: {card: ReviewCard; onOpen: (id: string) => void}) {
	return (
		<li className="review-card">
			<div className="review-card-head">
				<h3 className="review-card-title">{card.title}</h3>
				<p className="review-badges">
					<span className="review-badge review-state">{STATE_LABEL[card.state]}</span>
					<span className={`review-badge review-attention${card.attention ? ` review-attention-${card.attention}` : ''}`}>
						{card.attention ? ATTENTION_LABEL[card.attention] : '未标记'}
					</span>
				</p>
			</div>

			<div className="review-status-row">
				<p className="review-status-cell">
					<span className="review-status-key">验证</span>
					<span className={`review-status-value review-verify-${card.verification}`}>{VERIFICATION_LABEL[card.verification]}</span>
				</p>
				<p className="review-status-cell">
					<span className="review-status-key">验收</span>
					<span className={`review-status-value review-accept-${card.acceptance}`}>{ACCEPTANCE_LABEL[card.acceptance]}</span>
				</p>
			</div>

			<dl className="review-meta">
				<div className="review-meta-item">
					<dt className="review-meta-key">智能体</dt>
					<dd className="review-meta-value">{agentName(card.agent)}</dd>
				</div>
				<div className="review-meta-item">
					<dt className="review-meta-key">模型</dt>
					<dd className="review-meta-value">
						请求 {card.requestedModel} / 上报 {card.reportedModel ?? '未上报'}
					</dd>
				</div>
				<div className="review-meta-item">
					<dt className="review-meta-key">推理深度</dt>
					<dd className="review-meta-value">{card.reasoningEffort==='xhigh'?'极高 · xhigh':card.reasoningEffort==='medium'?'中 · medium':card.reasoningEffort==='low'?'低 · low':card.reasoningEffort ?? '未指定'}</dd>
				</div>
			</dl>

			<BoundedText label="摘要" value={card.summary} limit={SUMMARY_LIMIT} hostTruncated={card.summaryTruncated} tone="review-summary" />
			<BoundedText label="错误" value={card.error} limit={ERROR_LIMIT} hostTruncated={card.errorTruncated} tone="review-error" />

			<FileDetails card={card} />

			<button type="button" className="review-open" onClick={() => onOpen(card.id)}>
				打开任务
			</button>
		</li>
	);
}

export default function ReviewInbox({cards, onOpen}: {cards: ReviewCard[]; onOpen: (id: string) => void}) {
	return (
		<section className="review-inbox" aria-label="待处理交付">

			<header className="review-header">
				<div className="review-heading">
					<h2 className="review-title">集中验收</h2>
					<p className="review-hint">执行完成不等于验收通过，请分别核对验证与验收状态</p>
				</div>
				<p className="review-count">{cards.length} 项待处理交付</p>
			</header>

			{cards.length === 0 ? (
				<p className="review-empty">当前没有待处理交付</p>
			) : (
				<ul className="review-list">
					{cards.map((card) => (
						<ReviewItem key={card.id} card={card} onOpen={onOpen} />
					))}
				</ul>
			)}
		</section>
	);
}
