import type { ProjectModelUsage, ProjectSummary, ProjectTask, RecordedMetric } from './project-types.js';

const MAX_TIME_MS = 8640000000000000;
const UUID_MODEL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface MetricAccumulator {
  sum: number;
  known: number;
  unknown: number;
  overflow: boolean;
}

interface ModelBucket {
  agent:string;
  id: string;
  label: string;
  taskCount: number;
  credits: MetricAccumulator;
  usd: MetricAccumulator;
  inputTokens: MetricAccumulator;
  outputTokens: MetricAccumulator;
}

interface AcceptedTask {
  classified:boolean;
  agent:string;
  id: string;
  path: string;
  at: number | null;
  state: string;
  acceptance: string;
  model: string;
  label: string;
  usage: ProjectTask['usage'];
}

interface SummaryRow {
  at: number | null;
  summary: ProjectSummary;
}

function timestampMs(value: string | undefined): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || ms < -MAX_TIME_MS || ms > MAX_TIME_MS) return null;
  return ms;
}

function activityOf(task: ProjectTask): number | null {
  return timestampMs(task.updatedAt) ?? timestampMs(task.createdAt);
}

function projectName(path: string): string {
  const segments = path.split('/');
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment !== undefined && segment !== '') return segment;
  }
  return path;
}

function lexical(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function activityDescending(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function accumulator(): MetricAccumulator {
  return { sum: 0, known: 0, unknown: 0, overflow: false };
}

function recordMetric(acc: MetricAccumulator, value: number | null | undefined, tokens: boolean): void {
  const known =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    (!tokens || Number.isSafeInteger(value));
  if (!known) {
    acc.unknown += 1;
    return;
  }
  acc.known += 1;
  acc.sum += value;
  if (!Number.isFinite(acc.sum)) acc.overflow = true;
}

function metricOf(acc: MetricAccumulator): RecordedMetric {
  return {
    total: acc.known > 0 && !acc.overflow ? acc.sum : null,
    knownTasks: acc.known,
    unknownTasks: acc.unknown,
    overflow: acc.overflow,
  };
}

export function buildProjectSummaries(tasks: ProjectTask[]): ProjectSummary[] {
  const groups = new Map<string, AcceptedTask[]>();
  const seenIds = new Set<string>();

  for (const task of tasks) {
    const id = task.id;
    const path = task.projectPath;
    if (typeof id !== 'string' || id.trim() === '') throw new Error('任务 ID 不能为空');
    if (typeof path !== 'string' || path.trim() === '') throw new Error('项目路径不能为空');
    if (seenIds.has(id)) throw new Error('任务 ID 重复，无法可靠统计');
    seenIds.add(id);

    const item: AcceptedTask = {
      classified:!!task.disposition,
      agent:task.agent??'qoder-cn',
      id,
      path,
      at: activityOf(task),
      state: task.state,
      acceptance: task.acceptance,
      model: task.model,
      label: task.modelLabel ? task.modelLabel : task.model,
      usage: task.usage,
    };
    const existing = groups.get(path);
    if (existing) existing.push(item);
    else groups.set(path, [item]);
  }

  const rows: SummaryRow[] = [];
  for (const [path, items] of groups) {
    const ordered = items.sort(
      (a, b) => activityDescending(a.at, b.at) || lexical(a.id, b.id),
    );

    const counts: ProjectSummary['counts'] = {
      total: ordered.length,
      active: 0,
      queued: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
      waitingUser: 0,
      other: 0,
      pendingReview: 0,
      changesRequested: 0,
    };
    const buckets = new Map<string, ModelBucket>();

    for (const item of ordered) {
      switch (item.state) {
        case 'preparing':
        case 'running':
          counts.active += 1;
          break;
        case 'queued':
          counts.queued += 1;
          break;
        case 'completed':
          counts.completed += 1;
          break;
        case 'failed':
          counts.failed += 1;
          break;
        case 'cancelled':
          counts.cancelled += 1;
          break;
        case 'waiting_user':
          counts.waitingUser += 1;
          break;
        default:
          counts.other += 1;
          break;
      }
      if (!item.classified&&item.state === 'completed' && item.acceptance === 'pending') counts.pendingReview += 1;
      if (!item.classified&&item.acceptance === 'changes_requested') counts.changesRequested += 1;

      const bucketKey=JSON.stringify([item.agent,item.model]);
      let bucket = buckets.get(bucketKey);
      if (!bucket) {
        // `ordered` starts at the most recent task, so the first hit sets the bucket label.
        bucket = {
          agent:item.agent,
          id: item.model,
          label: item.label,
          taskCount: 0,
          credits: accumulator(),
          usd: accumulator(),
          inputTokens: accumulator(),
          outputTokens: accumulator(),
        };
        buckets.set(bucketKey, bucket);
      }
      bucket.taskCount += 1;
      recordMetric(bucket.credits, item.usage?.taskCredits, false);
      recordMetric(bucket.usd, item.usage?.usd, false);
      recordMetric(bucket.inputTokens, item.usage?.inputTokens, true);
      recordMetric(bucket.outputTokens, item.usage?.outputTokens, true);
    }

    const head = ordered[0];
    const at = head ? head.at : null;
    const models: ProjectModelUsage[] = [];
    for (const bucket of [...buckets.values()].sort((a, b) => lexical(a.id, b.id)||lexical(a.agent,b.agent))) {
      models.push({
        ...(bucket.agent==='qoder-cn'?{}:{agent:bucket.agent}),
        id: bucket.id,
        label: bucket.label,
        kind: UUID_MODEL_ID.test(bucket.id) ? 'custom' : 'platform',
        taskCount: bucket.taskCount,
        credits: metricOf(bucket.credits),
        usd: metricOf(bucket.usd),
        inputTokens: metricOf(bucket.inputTokens),
        outputTokens: metricOf(bucket.outputTokens),
      });
    }

    rows.push({
      at,
      summary: {
        path,
        name: projectName(path),
        taskIds: ordered.map((item) => item.id),
        lastActivityAt: at === null ? null : new Date(at).toISOString(),
        counts,
        models,
      },
    });
  }

  return rows
    .sort((a, b) => activityDescending(a.at, b.at) || lexical(a.summary.path, b.summary.path))
    .map((row) => row.summary);
}
