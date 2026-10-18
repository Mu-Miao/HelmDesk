import type {Attention, ReviewCard} from './review-types.js';
import type {State, Task} from './types.js';

const TITLE = 160;
const MODEL = 200;
const SUMMARY = 600;
const ERROR = 240;
const MAX_FILES = 12;
const FILE_PATH = 240;
const FILE_KIND = 40;

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function clip(value: unknown, max: number): string {
  const raw = asText(value);
  const points = Array.from(raw);
  return points.length > max ? points.slice(0, max).join('') : raw;
}

function project(value: unknown, max: number): {text: string; truncated: boolean} {
  const points = Array.from(asText(value));
  const truncated = points.length > max;
  return {text: truncated ? points.slice(0, max).join('') : points.join(''), truncated};
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function verificationOf(task: Task): ReviewCard['verification'] {
  const status = task.verification?.status;
  return status === 'passed' || status === 'failed' ? status : 'not_run';
}

function attentionOf(state: State, acceptance: Task['acceptance'], verification: ReviewCard['verification']): Attention | null {
  if (state === 'waiting_user') return 'intervention';
  if (state === 'failed') return 'rework';
  if (state !== 'completed') return null;
  if (verification === 'failed' || acceptance === 'changes_requested') return 'rework';
  return acceptance === 'pending' ? 'review' : null;
}

export function buildReviewCard(task: Task): ReviewCard {
  const summary = project(task.summary, SUMMARY);
  const error = project(task.error, ERROR);
  const verification = verificationOf(task);
  const changes = Array.isArray(task.changes) ? task.changes : [];
  const usage = task.usage;
  const reportedModel = typeof task.reportedModel === 'string' && task.reportedModel !== '' ? clip(task.reportedModel, MODEL) : null;
  const reasoningEffort = typeof task.reasoningEffort === 'string' ? task.reasoningEffort : null;
  return {
    id: asText(task.id),
    title: clip(task.title, TITLE),
    state: task.state,
    acceptance: task.acceptance,
    verification,
    agent: asText(task.agent ?? 'qoder-cn'),
    requestedModel: clip(task.requestedModel, MODEL),
    reportedModel,
    reasoningEffort,
    updatedAt: asText(task.updatedAt),
    attention: attentionOf(task.state, task.acceptance, verification),
    summary: summary.text,
    summaryTruncated: summary.truncated,
    error: error.text,
    errorTruncated: error.truncated,
    fileCount: changes.length,
    files: changes.slice(0, MAX_FILES).map((entry) => ({path: clip(entry?.path, FILE_PATH), kind: clip(entry?.kind, FILE_KIND)})),
    filesTruncated: changes.length > MAX_FILES,
    usage: {
      taskCredits: count(usage?.taskCredits),
      inputTokens: count(usage?.inputTokens),
      outputTokens: count(usage?.outputTokens),
      usd: count(usage?.usd),
    },
  };
}
