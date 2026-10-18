import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { Task, State } from '../src/types.js';
import { queueReport, nextRunnableTaskIds } from '../src/queue-policy.js';

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `task ${id}`,
    prompt: `prompt ${id}`,
    projectPath: '/project',
    allowedFiles: [],
    acceptanceCriteria: [],
    dependencies: [],
    model: 'test-model',
    mode: 'files',
    timeoutSeconds: 60,
    state: 'queued',
    acceptance: 'pending',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    requestedModel: 'test-model',
    ...overrides,
  };
}

function completedDep(id: string): Task {
  return makeTask(id, {
    state: 'completed',
    acceptance: 'accepted',
    verification: { status: 'passed', command: 'npm test', evidence: 'ok', recordedAt: '2026-01-01T00:00:00.000Z' },
  });
}

test('normal readiness: ready task with no dependencies', () => {
  const tasks = [makeTask('a'), makeTask('b')];
  const report = queueReport(tasks, new Set(), 2);
  assert.equal(report.concurrency, 2);
  assert.equal(report.active, 0);
  assert.equal(report.availableSlots, 2);
  assert.equal(report.ready, 2);
  assert.equal(report.blocked, 0);
  assert.deepEqual(report.entries.map((e) => e.taskId), ['a', 'b']);
  assert.deepEqual(nextRunnableTaskIds(tasks, new Set(), 2), ['a', 'b']);
});

test('zero capacity: active fills slots, nothing returned for launch', () => {
  const tasks = [makeTask('r', { state: 'running' }), makeTask('a'), makeTask('b')];
  const activeIds = new Set(['r']);
  const report = queueReport(tasks, activeIds, 1);
  assert.equal(report.active, 1);
  assert.equal(report.availableSlots, 0);
  assert.equal(report.ready, 2);
  assert.deepEqual(nextRunnableTaskIds(tasks, activeIds, 1), []);
});

test('two slots limit launch batch', () => {
  const tasks = [makeTask('a'), makeTask('b'), makeTask('c')];
  assert.deepEqual(nextRunnableTaskIds(tasks, new Set(), 2), ['a', 'b']);
});

test('queued task already reserved in activeIds is excluded', () => {
  const tasks = [makeTask('a'), makeTask('b')];
  const activeIds = new Set(['a']);
  const report = queueReport(tasks, activeIds, 2);
  assert.equal(report.active, 1);
  assert.equal(report.availableSlots, 1);
  assert.deepEqual(report.entries.map((e) => e.taskId), ['b']);
  assert.deepEqual(nextRunnableTaskIds(tasks, activeIds, 2), ['b']);
});

test('accepted completed dependency unblocks', () => {
  const tasks = [completedDep('d'), makeTask('a', { dependencies: ['d'] })];
  const report = queueReport(tasks, new Set(), 2);
  assert.equal(report.entries.length, 1);
  assert.equal(report.entries[0]?.ready, true);
  assert.deepEqual(report.entries[0]?.blockers, []);
  assert.deepEqual(nextRunnableTaskIds(tasks, new Set(), 2), ['a']);
});

test('completed dependency with pending acceptance blocks with awaiting_acceptance', () => {
  const tasks = [
    makeTask('d', { state: 'completed', acceptance: 'pending' }),
    makeTask('a', { dependencies: ['d'] }),
  ];
  const report = queueReport(tasks, new Set(), 2);
  const entry = report.entries.find((e) => e.taskId === 'a');
  assert.ok(entry && !entry.ready);
  assert.equal(entry?.blockers.length, 1);
  assert.equal(entry?.blockers[0]?.code, 'awaiting_acceptance');
  assert.equal(entry?.blockers[0]?.taskId, 'd');
  assert.equal(entry?.blockers[0]?.reason, '等待依赖任务验收');
  assert.deepEqual(nextRunnableTaskIds(tasks, new Set(), 2), []);
});

test('completed dependency with failed verification blocks with awaiting_acceptance', () => {
  const tasks = [
    makeTask('d', {
      state: 'completed',
      acceptance: 'accepted',
      verification: { status: 'failed', command: 'npm test', evidence: 'fail', recordedAt: '2026-01-01T00:00:00.000Z' },
    }),
    makeTask('a', { dependencies: ['d'] }),
  ];
  const entry = queueReport(tasks, new Set(), 2).entries.find((e) => e.taskId === 'a');
  assert.equal(entry?.blockers[0]?.code, 'awaiting_acceptance');
  assert.equal(entry?.blockers[0]?.taskId, 'd');
  assert.equal(entry?.blockers[0]?.reason, '依赖任务验证失败');
});

for (const state of ['failed', 'cancelled'] as const) {
  test(`dependency ${state} blocks with dependency_failed`, () => {
    const tasks = [makeTask('d', { state }), makeTask('a', { dependencies: ['d'] })];
    const entry = queueReport(tasks, new Set(), 2).entries.find((e) => e.taskId === 'a');
    assert.equal(entry?.blockers[0]?.code, 'dependency_failed');
    assert.equal(entry?.blockers[0]?.taskId, 'd');
    assert.equal(
      entry?.blockers[0]?.reason,
      state === 'failed' ? '依赖任务执行失败' : '依赖任务已取消',
    );
  });
}

test('waiting_user dependency blocks with dependency_attention', () => {
  const tasks = [makeTask('d', { state: 'waiting_user' }), makeTask('a', { dependencies: ['d'] })];
  const entry = queueReport(tasks, new Set(), 2).entries.find((e) => e.taskId === 'a');
  assert.equal(entry?.blockers[0]?.code, 'dependency_attention');
  assert.equal(entry?.blockers[0]?.taskId, 'd');
  assert.equal(entry?.blockers[0]?.reason, '依赖任务等待用户处理');
});

test('missing dependency blocks with missing_dependency', () => {
  const tasks = [makeTask('a', { dependencies: ['ghost'] })];
  const entry = queueReport(tasks, new Set(), 2).entries.find((e) => e.taskId === 'a');
  assert.equal(entry?.blockers[0]?.code, 'missing_dependency');
  assert.equal(entry?.blockers[0]?.taskId, 'ghost');
  assert.equal(entry?.blockers[0]?.reason, '依赖任务不存在');
});

test('incomplete dependency blocks with dependency_pending', () => {
  const states: State[] = ['queued', 'preparing', 'running'];
  for (const state of states) {
    const tasks = [makeTask('d', { state }), makeTask('a', { dependencies: ['d'] })];
    const entry = queueReport(tasks, new Set(), 2).entries.find((e) => e.taskId === 'a');
    assert.equal(entry?.blockers[0]?.code, 'dependency_pending', `state ${state}`);
    assert.equal(entry?.blockers[0]?.taskId, 'd', `state ${state}`);
    assert.equal(entry?.blockers[0]?.reason, '依赖任务尚未完成', `state ${state}`);
  }
});

test('multiple blockers are all returned, one per dependency', () => {
  const tasks = [
    makeTask('d1', { state: 'failed' }),
    makeTask('d2', { state: 'waiting_user' }),
    completedDep('d3'),
    makeTask('d4'),
    makeTask('a', { dependencies: ['d1', 'd3', 'd2', 'ghost', 'd4'] }),
  ];
  const entry = queueReport(tasks, new Set(), 2).entries.find((e) => e.taskId === 'a');
  assert.equal(entry?.ready, false);
  assert.deepEqual(entry?.blockers.map((b) => b.taskId), ['d1', 'd2', 'ghost', 'd4']);
  assert.deepEqual(entry?.blockers.map((b) => b.code), [
    'dependency_failed',
    'dependency_attention',
    'missing_dependency',
    'dependency_pending',
  ]);
});

test('multiple blockers with mixed states report parent IDs and codes', () => {
  const tasks = [
    makeTask('p1', { state: 'completed', acceptance: 'pending' }),
    makeTask('p2', {
      state: 'completed',
      acceptance: 'accepted',
      verification: { status: 'failed', command: 'npm test', evidence: 'fail', recordedAt: '2026-01-01T00:00:00.000Z' },
    }),
    makeTask('p3', { state: 'cancelled' }),
    makeTask('child', { dependencies: ['p1', 'p2', 'p3'] }),
  ];
  const entry = queueReport(tasks, new Set(), 2).entries.find((e) => e.taskId === 'child');
  assert.equal(entry?.ready, false);
  assert.deepEqual(entry?.blockers.map((b) => b.taskId), ['p1', 'p2', 'p3']);
  assert.deepEqual(entry?.blockers.map((b) => b.code), [
    'awaiting_acceptance',
    'awaiting_acceptance',
    'dependency_failed',
  ]);
  assert.deepEqual(entry?.blockers.map((b) => b.reason), [
    '等待依赖任务验收',
    '依赖任务验证失败',
    '依赖任务已取消',
  ]);
});

test('invalid concurrency limits reject with RangeError', () => {
  const tasks = [makeTask('a')];
  for (const bad of [0, 3, -1, 1.5, NaN, Infinity, -Infinity, 2.0001]) {
    assert.throws(() => queueReport(tasks, new Set(), bad), RangeError, `queueReport(${bad})`);
    assert.throws(() => nextRunnableTaskIds(tasks, new Set(), bad), RangeError, `nextRunnable(${bad})`);
  }
  assert.doesNotThrow(() => queueReport(tasks, new Set(), 1));
  assert.doesNotThrow(() => queueReport(tasks, new Set(), 2));
});

test('deterministic oldest-first ordering preserved', () => {
  const tasks = [
    makeTask('old'),
    makeTask('blocked1', { dependencies: ['missing'] }),
    makeTask('mid'),
    makeTask('blocked2', { dependencies: ['missing'] }),
    makeTask('new'),
  ];
  const report = queueReport(tasks, new Set(), 2);
  assert.deepEqual(report.entries.map((e) => e.taskId), ['old', 'blocked1', 'mid', 'blocked2', 'new']);
  assert.equal(report.ready, 3);
  assert.equal(report.blocked, 2);
  assert.deepEqual(nextRunnableTaskIds(tasks, new Set(), 2), ['old', 'mid']);
  assert.deepEqual(nextRunnableTaskIds(tasks, new Set(), 2), ['old', 'mid']);
});

test('inputs are not mutated', () => {
  const tasks = [
    completedDep('d'),
    makeTask('a', { dependencies: ['d'] }),
    makeTask('b', { dependencies: ['ghost'] }),
    makeTask('c'),
  ];
  const activeIds = new Set<string>(['c']);
  const tasksSnapshot = JSON.parse(JSON.stringify(tasks));
  const activeSnapshot = [...activeIds];
  queueReport(tasks, activeIds, 2);
  nextRunnableTaskIds(tasks, activeIds, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(tasks)), tasksSnapshot);
  assert.deepEqual([...activeIds], activeSnapshot);
  assert.deepEqual(nextRunnableTaskIds(tasks, activeIds, 2), ['a']);
});
