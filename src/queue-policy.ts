import type { Task } from './types.js';
import type { QueueBlock, QueueBlockCode, QueueEntry, QueueReport } from './queue-types.js';

function validateConcurrency(concurrency: number): void {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) {
    throw new RangeError(`concurrency must be an integer from 1 through 2, got ${String(concurrency)}`);
  }
}

function blockersFor(task: Task, byId: Map<string, Task>): QueueBlock[] {
  const blockers: QueueBlock[] = [];
  for (const depId of task.dependencies) {
    const dep = byId.get(depId);
    let code: QueueBlockCode;
    let reason: string;
    if (!dep) {
      code = 'missing_dependency';
      reason = '依赖任务不存在';
    } else if (dep.state === 'failed' || dep.state === 'cancelled') {
      code = 'dependency_failed';
      reason = dep.state === 'failed' ? '依赖任务执行失败' : '依赖任务已取消';
    } else if (dep.state === 'waiting_user') {
      code = 'dependency_attention';
      reason = '依赖任务等待用户处理';
    } else if (dep.state === 'completed') {
      if (dep.verification?.status === 'failed') {
        code = 'awaiting_acceptance';
        reason = '依赖任务验证失败';
      } else if (task.inputs?.some(input=>input.taskId===depId) && dep.verification?.status !== 'passed') {
        code = 'awaiting_acceptance';
        reason = '交付来源需要验证通过';
      } else if (dep.acceptance !== 'accepted') {
        code = 'awaiting_acceptance';
        reason = '等待依赖任务验收';
      } else {
        continue;
      }
    } else {
      code = 'dependency_pending';
      reason = '依赖任务尚未完成';
    }
    blockers.push({ taskId: depId, code, reason });
  }
  return blockers;
}

interface QueueModel {
  entries: QueueEntry[];
  active: number;
  availableSlots: number;
}

function buildModel(tasks: readonly Task[], activeIds: ReadonlySet<string>, concurrency: number): QueueModel {
  validateConcurrency(concurrency);
  const byId = new Map<string, Task>();
  for (const task of tasks) {
    if (!byId.has(task.id)) byId.set(task.id, task);
  }
  const entries: QueueEntry[] = [];
  for (const task of tasks) {
    if (task.state !== 'queued' || activeIds.has(task.id)) continue;
    const blockers = blockersFor(task, byId);
    entries.push({ taskId: task.id, ready: blockers.length === 0, blockers });
  }
  const active = activeIds.size;
  return { entries, active, availableSlots: Math.max(0, concurrency - active) };
}

export function queueReport(
  tasks: readonly Task[],
  activeIds: ReadonlySet<string>,
  concurrency: number,
): QueueReport {
  const { entries, active, availableSlots } = buildModel(tasks, activeIds, concurrency);
  let ready = 0;
  let blocked = 0;
  for (const entry of entries) {
    if (entry.ready) ready += 1;
    else blocked += 1;
  }
  return { concurrency, active, availableSlots, ready, blocked, entries };
}

export function nextRunnableTaskIds(
  tasks: readonly Task[],
  activeIds: ReadonlySet<string>,
  concurrency: number,
): string[] {
  const { entries, availableSlots } = buildModel(tasks, activeIds, concurrency);
  return entries.filter((entry) => entry.ready).slice(0, availableSlots).map((entry) => entry.taskId);
}
