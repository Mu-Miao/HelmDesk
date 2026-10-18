import { test } from 'node:test';
import assert from 'node:assert/strict';

import { budgetDecision } from '../src/budget-policy.js';
import type { BudgetRule, BudgetTask } from '../src/budget-types.js';

const MODEL = 'qwen3-coder-plus';
const rule = (maxCredits = 100): BudgetRule => ({ agent: 'qoder-cn', model: MODEL, maxCredits });
const task = (id: string, over: Partial<BudgetTask> = {}): BudgetTask => ({
  id, model: MODEL, state: 'queued', ...over,
});
const billed = (id: string, taskCredits: number | null, extra: Partial<BudgetTask> = {}): BudgetTask =>
  task(id, { state: 'success', startedAt: '2026-10-10T00:00:00Z', usage: { taskCredits, sessionCredits: 999 }, ...extra });

test('invalid rule config throws', () => {
  assert.throws(() => budgetDecision([], { agent: ' ', model: MODEL, maxCredits: 10 }), /agent/);
  assert.throws(() => budgetDecision([], { agent: 'qoder-cn', model: '', maxCredits: 10 }), /model/);
  for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => budgetDecision([], rule(bad)), /maxCredits/);
  }
  assert.equal(budgetDecision([], rule(Number.MIN_VALUE)).status, 'clear');
});

test('matches exact model + agent, legacy agent means qoder-cn, skips others and currentTaskId', () => {
  const tasks = [
    billed('a', 30),
    task('legacy', { startedAt: '2026-10-10T00:00:00Z', usage: { taskCredits: 20 } }),
    billed('other-model', 40, { model: 'gpt-x' }),
    billed('other-agent', 40, { agent: 'other-agent' }),
    billed('current', 40),
  ];
  const d = budgetDecision(tasks, rule(100), 'current');
  assert.equal(d.recordedCredits, 50);
  assert.equal(d.status, 'clear');
  assert.equal(d.allowed, true);
});

test('no billable records means zero credits and zero unknown', () => {
  const d = budgetDecision([task('q1'), task('q2', { agent: 'qoder-cn' })], rule(10));
  assert.equal(d.recordedCredits, 0);
  assert.equal(d.unknownTasks, 0);
  assert.equal(d.activeTasks, 0);
  assert.equal(d.status, 'clear');
  assert.ok(d.reason.includes('credits'));
});

test('queued unstarted tasks are not billed; started task without usage is unknown', () => {
  const queued = budgetDecision([task('q', { state: 'queued' })], rule(5));
  assert.equal(queued.recordedCredits, 0);
  assert.equal(queued.unknownTasks, 0);
  assert.equal(queued.status, 'clear');

  const noUsage = budgetDecision([task('run', { state: 'running', startedAt: '2026-10-10T00:00:00Z' })], rule(5));
  assert.equal(noUsage.unknownTasks, 1);
  assert.equal(noUsage.activeTasks, 1);
  assert.equal(noUsage.status, 'unknown');
  assert.equal(noUsage.allowed, false);
});

test('invalid taskCredits values stay unknown and never assumed zero, outranking exhausted', () => {
  const tasks = [
    billed('null', null),
    billed('nan', Number.NaN),
    billed('neg', -1),
    billed('inf', Number.POSITIVE_INFINITY),
    billed('zero', 0),
    billed('big', 500),
  ];
  const d = budgetDecision(tasks, rule(100));
  assert.equal(d.unknownTasks, 4);
  assert.equal(d.recordedCredits, 500);
  assert.equal(d.status, 'unknown');
  assert.equal(d.allowed, false);
});

test('overflowing sum yields recordedCredits null with unknown decision', () => {
  const tasks = [
    billed('a', Number.MAX_VALUE),
    billed('b', Number.MAX_VALUE),
    billed('c', 1, { state: 'running' }),
  ];
  const d = budgetDecision(tasks, rule(10));
  assert.equal(d.recordedCredits, null);
  assert.equal(d.status, 'unknown');
  assert.equal(d.allowed, false);
  assert.ok(d.reason.includes('溢出'));
});

test('exhausted outranks inflight and decimals are preserved', () => {
  const r1 = billed('r1', 1.5);
  const r2 = billed('r2', 2.25);
  const r3 = billed('r3', 6.25, { state: 'waiting_user' });
  const full = budgetDecision([r1, r2, r3], rule(10));
  assert.equal(full.recordedCredits, 10);
  assert.equal(full.activeTasks, 1);
  assert.equal(full.status, 'exhausted');
  assert.equal(full.allowed, false);

  const under = budgetDecision([r1, r2], rule(10));
  assert.equal(under.recordedCredits, 3.75);
  assert.equal(under.status, 'clear');
});

test('active tasks block as inflight even with known credits; inputs never mutated', () => {
  const tasks = [
    billed('p', 2, { state: 'preparing' }),
    billed('w', 3, { state: 'waiting_user' }),
    billed('done', 4),
  ];
  const fingerprint = () => tasks.map((t) => `${t.id}|${t.state}|${t.usage?.taskCredits}`).join(',');
  const before = fingerprint();
  const d = budgetDecision(tasks, rule(100));
  assert.equal(fingerprint(), before);
  assert.equal(d.activeTasks, 2);
  assert.equal(d.recordedCredits, 9);
  assert.equal(d.status, 'inflight');
  assert.equal(d.allowed, false);
  assert.notEqual(budgetDecision(tasks, rule(100)), d);
});
