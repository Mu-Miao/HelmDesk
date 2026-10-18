import type { BudgetDecision, BudgetRule, BudgetTask } from './budget-types.js';

const ACTIVE_STATES = new Set(['preparing', 'running', 'waiting_user']);
const LEGACY_AGENT = 'qoder-cn';

function assertValidRule(rule: BudgetRule): void {
  if (!rule || typeof rule.agent !== 'string' || rule.agent.trim() === '') {
    throw new Error('预算配置无效：agent 必须是非空字符串');
  }
  if (typeof rule.model !== 'string' || rule.model.trim() === '') {
    throw new Error('预算配置无效：model 必须是非空字符串');
  }
  if (typeof rule.maxCredits !== 'number' || !Number.isFinite(rule.maxCredits) || rule.maxCredits <= 0) {
    throw new Error('预算配置无效：maxCredits 必须是有限的正数');
  }
}

function knownCredits(usage: BudgetTask['usage']): number | null {
  const credits = usage?.taskCredits;
  return typeof credits === 'number' && Number.isFinite(credits) && credits >= 0 ? credits : null;
}

function isMatched(task: BudgetTask, rule: BudgetRule): boolean {
  return task.model === rule.model && (task.agent ?? LEGACY_AGENT) === rule.agent;
}

function isBillable(task: BudgetTask): boolean {
  return task.startedAt !== undefined || task.usage !== undefined;
}

function buildReason(
  status: BudgetDecision['status'],
  rule: BudgetRule,
  recordedCredits: number | null,
  activeTasks: number,
  unknownTasks: number,
  overflow: boolean,
): string {
  const scope = `model=${rule.model} / agent=${rule.agent}`;
  const spent = recordedCredits === null ? '无法计算' : `${recordedCredits} credits`;
  if (status === 'unknown') {
    return `同 ${scope} 有 ${unknownTasks} 条计费记录缺失或非法（taskCredits 为 null/NaN/负数/无穷）`
      + `${overflow ? '，且累计 credits 数值溢出' : ''}，账目不确定时按未知处理不放行新任务，请先修复用量数据`;
  }
  if (status === 'exhausted') {
    return `同 ${scope} 已记账 ${spent}，达到上限 ${rule.maxCredits} credits，预算耗尽，禁止启动新任务`;
  }
  if (status === 'inflight') {
    return `同 ${scope} 已记账 ${spent}/${rule.maxCredits} credits，仍有 ${activeTasks} 个任务处于 preparing/running/waiting_user，等待在途任务结算后再启动`;
  }
  return `同 ${scope} 已记账 ${spent}/${rule.maxCredits} credits，无未知计费记录且无在途任务，允许启动新任务`;
}

export function budgetDecision(
  tasks: BudgetTask[],
  rule: BudgetRule,
  currentTaskId?: string,
): BudgetDecision {
  assertValidRule(rule);

  let activeTasks = 0;
  let unknownTasks = 0;
  let sum = 0;
  let overflow = false;

  for (const task of tasks) {
    if (task.id === currentTaskId || !isMatched(task, rule)) continue;
    if (ACTIVE_STATES.has(task.state)) activeTasks += 1;
    if (!isBillable(task)) continue;
    const credits = knownCredits(task.usage);
    if (credits === null) {
      unknownTasks += 1;
      continue;
    }
    sum += credits;
    if (!Number.isFinite(sum)) overflow = true;
  }

  const recordedCredits: number | null = overflow ? null : sum;
  const status: BudgetDecision['status'] =
    overflow || unknownTasks > 0
      ? 'unknown'
      : sum >= rule.maxCredits
        ? 'exhausted'
        : activeTasks > 0
          ? 'inflight'
          : 'clear';

  return {
    allowed: status === 'clear',
    status,
    recordedCredits,
    unknownTasks,
    activeTasks,
    reason: buildReason(status, rule, recordedCredits, activeTasks, unknownTasks, overflow),
  };
}
