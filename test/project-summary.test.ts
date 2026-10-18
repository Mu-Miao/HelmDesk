import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ProjectModelUsage, ProjectSummary, ProjectTask } from '../src/project-types.js';
import { buildProjectSummaries } from '../src/project-summary.js';

const UUID_MODEL = '3f2a9c1e-7b64-4d0a-9c81-5e2f0a1b6d9c';
const HUGE = 1.7976931348623157e308;

type UsageSeed = Partial<NonNullable<ProjectTask['usage']>>;
type TaskSeed = Partial<ProjectTask> & { id: string };

function use(seed: UsageSeed): NonNullable<ProjectTask['usage']> {
  return { taskCredits: null, sessionCredits: null, inputTokens: null, outputTokens: null, usd: null, ...seed };
}

function makeTask(seed: TaskSeed): ProjectTask {
  return {
    projectPath: '/root',
    title: 'Untitled task',
    state: 'completed',
    acceptance: 'none',
    model: 'gpt-4o',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...seed,
  };
}

function summaryAt(result: ProjectSummary[], index: number): ProjectSummary {
  const found = result[index];
  if (!found) throw new Error(`expected a project summary at index ${index}`);
  return found;
}

function modelOf(summary: ProjectSummary, id: string): ProjectModelUsage {
  const found = summary.models.find((model) => model.id === id);
  if (!found) throw new Error(`expected a model bucket for ${id}`);
  return found;
}

test('empty task list produces no projects', () => {
  assert.deepStrictEqual(buildProjectSummaries([]), []);
});

test('projects group by exact path, never by repeated folder name', () => {
  const result = buildProjectSummaries([
    makeTask({ id: 'e1', projectPath: '/work/east/api', updatedAt: '2026-05-01T00:00:00.000Z' }),
    makeTask({ id: 'w1', projectPath: '/work/west/api', updatedAt: '2026-05-02T00:00:00.000Z' }),
  ]);
  assert.deepStrictEqual(result.map((item) => item.path), ['/work/west/api', '/work/east/api']);
  assert.deepStrictEqual(result.map((item) => item.name), ['api', 'api']);
  assert.deepStrictEqual(result.map((item) => item.counts.total), [1, 1]);
});

test('name is the final nonempty segment, and the path itself for /', () => {
  const result = buildProjectSummaries([
    makeTask({ id: 'n1', projectPath: '/nested/dir/' }),
    makeTask({ id: 'n2', projectPath: '/' }),
    makeTask({ id: 'n3', projectPath: '/single' }),
  ]);
  assert.deepStrictEqual(result.map((item) => item.path), ['/', '/nested/dir/', '/single']);
  assert.deepStrictEqual(result.map((item) => item.name), ['/', 'dir', 'single']);
});

test('states map to counts and unknown states land in other', () => {
  const states = ['preparing', 'running', 'queued', 'completed', 'failed', 'cancelled', 'waiting_user', 'paused', ''];
  const result = buildProjectSummaries(
    states.map((state, index) => makeTask({ id: `s${index}`, projectPath: '/states', state })),
  );
  assert.deepStrictEqual(summaryAt(result, 0).counts, {
    total: 9,
    active: 2,
    queued: 1,
    completed: 1,
    failed: 1,
    cancelled: 1,
    waitingUser: 1,
    other: 2,
    pendingReview: 0,
    changesRequested: 0,
  });
});

test('pendingReview needs completed plus pending, changesRequested is independent, verification passed is never accepted', () => {
  const result = buildProjectSummaries([
    makeTask({ id: 'a1', projectPath: '/acc', state: 'completed', acceptance: 'pending' }),
    makeTask({ id: 'a2', projectPath: '/acc', state: 'completed', acceptance: 'accepted' }),
    makeTask({ id: 'a3', projectPath: '/acc', state: 'running', acceptance: 'changes_requested' }),
    makeTask({ id: 'a4', projectPath: '/acc', state: 'completed', acceptance: 'changes_requested' }),
    makeTask({ id: 'a5', projectPath: '/acc', state: 'completed', acceptance: 'pending', verification: { status: 'passed' } }),
    makeTask({ id: 'a6', projectPath: '/acc', state: 'queued', acceptance: 'pending' }),
  ]);
  assert.deepStrictEqual(summaryAt(result, 0).counts, {
    total: 6,
    active: 1,
    queued: 1,
    completed: 4,
    failed: 0,
    cancelled: 0,
    waitingUser: 0,
    other: 0,
    pendingReview: 2,
    changesRequested: 2,
  });
});

test('duplicate task ids reject contradictory records rather than choosing one', () => {
  assert.throws(() => buildProjectSummaries([
    makeTask({ id: 'dup', projectPath: '/p/a', state: 'running', updatedAt: '2026-03-01T00:00:00.000Z' }),
    makeTask({ id: 'dup', projectPath: '/p/b', state: 'failed' }),
    makeTask({ id: 'dup', projectPath: '/p/a', state: 'failed' }),
    makeTask({ id: 'keep', projectPath: '/p/a' }),
  ]), /重复/);
});

test('blank ids and blank project paths are rejected', () => {
  const tasks = [
    makeTask({ id: '', projectPath: '/blank' }),
    makeTask({ id: '   ', projectPath: '/blank' }),
    makeTask({ id: 'x', projectPath: '' }),
    makeTask({ id: 'y', projectPath: '   ' }),
    makeTask({ id: 'ok', projectPath: '/blank' }),
  ];
  for(const task of tasks.slice(0,4)) assert.throws(() => buildProjectSummaries([task]), /不能为空/);
  assert.equal(tasks.length, 5);
});

test('models bucket by exact id, Auto stays platform, uuid is custom, sorted by id', () => {
  const result = buildProjectSummaries([
    makeTask({ id: 'b1', projectPath: '/models', model: UUID_MODEL, modelLabel: 'gpt-4o' }),
    makeTask({ id: 'b2', projectPath: '/models', model: 'gpt-4o', modelLabel: 'GPT-4o' }),
    makeTask({ id: 'b3', projectPath: '/models', model: 'Auto' }),
    makeTask({ id: 'b4', projectPath: '/models', model: 'auto' }),
    makeTask({ id: 'b5', projectPath: '/models', model: 'GPT-4O' }),
  ]);
  const summary = summaryAt(result, 0);
  assert.equal(summary.counts.total, 5);
  assert.deepStrictEqual(summary.models.map((model) => model.id), [UUID_MODEL, 'Auto', 'GPT-4O', 'auto', 'gpt-4o']);
  assert.deepStrictEqual(summary.models.map((model) => model.label), ['gpt-4o', 'Auto', 'GPT-4O', 'auto', 'GPT-4o']);
  assert.deepStrictEqual(summary.models.map((model) => model.kind), ['custom', 'platform', 'platform', 'platform', 'platform']);
  assert.deepStrictEqual(summary.models.map((model) => model.taskCount), [1, 1, 1, 1, 1]);
});

test('model label comes from the most recent task and falls back to the id', () => {
  const result = buildProjectSummaries([
    makeTask({ id: 'l1', projectPath: '/labels', model: 'glm', modelLabel: 'old-glm', updatedAt: '2026-01-05T00:00:00.000Z' }),
    makeTask({ id: 'l2', projectPath: '/labels', model: 'glm', updatedAt: '2026-09-01T00:00:00.000Z' }),
    makeTask({ id: 'q1', projectPath: '/labels2', model: 'qwen', modelLabel: 'first-qwen', updatedAt: '2026-02-01T00:00:00.000Z' }),
    makeTask({ id: 'q2', projectPath: '/labels2', model: 'qwen', modelLabel: 'last-qwen', updatedAt: '2026-03-01T00:00:00.000Z' }),
    makeTask({ id: 'z', projectPath: '/tie', model: 'tie', modelLabel: 'zeta-label', updatedAt: '2026-04-01T00:00:00.000Z' }),
    makeTask({ id: 'a', projectPath: '/tie', model: 'tie', modelLabel: 'alpha-label', updatedAt: '2026-04-01T00:00:00.000Z' }),
  ]);
  assert.deepStrictEqual(result.map((item) => item.models[0]?.label), ['glm', 'alpha-label', 'last-qwen']);
});

test('metrics stay inside their own model bucket with no cross-model sum', () => {
  const result = buildProjectSummaries([
    makeTask({ id: 'p1', projectPath: '/split', model: 'model-a', usage: use({ taskCredits: 1.5 }) }),
    makeTask({ id: 'p2', projectPath: '/split', model: 'model-a', usage: use({ taskCredits: 2.25 }) }),
    makeTask({ id: 'p3', projectPath: '/split', model: 'model-b', usage: use({ taskCredits: 10 }) }),
  ]);
  const summary = summaryAt(result, 0);
  assert.equal(summary.models.length, 2);
  assert.equal(modelOf(summary, 'model-a').credits.total, 3.75);
  assert.equal(modelOf(summary, 'model-a').taskCount, 2);
  assert.equal(modelOf(summary, 'model-b').credits.total, 10);
  assert.equal(modelOf(summary, 'model-b').taskCount, 1);
});

test('credits read taskCredits only and sessionCredits is never summed', () => {
  const result = buildProjectSummaries([
    makeTask({ id: 'c1', projectPath: '/session', usage: use({ taskCredits: 2.5, sessionCredits: 1000, inputTokens: 100, outputTokens: 50, usd: 0.125 }) }),
    makeTask({ id: 'c2', projectPath: '/session', usage: use({ sessionCredits: 4000 }) }),
    makeTask({ id: 'c3', projectPath: '/session', usage: use({ taskCredits: 0, sessionCredits: 0, inputTokens: 0, outputTokens: 0, usd: 0 }) }),
  ]);
  const summary = summaryAt(result, 0);
  assert.deepStrictEqual(summary.models[0], {
    id: 'gpt-4o',
    label: 'gpt-4o',
    kind: 'platform',
    taskCount: 3,
    credits: { total: 2.5, knownTasks: 2, unknownTasks: 1, overflow: false },
    usd: { total: 0.125, knownTasks: 2, unknownTasks: 1, overflow: false },
    inputTokens: { total: 100, knownTasks: 2, unknownTasks: 1, overflow: false },
    outputTokens: { total: 50, knownTasks: 2, unknownTasks: 1, overflow: false },
  });
  assert.equal(JSON.stringify(summary).includes('sessionCredits'), false);
});

test('zero is known while null, missing, NaN, Infinity and negatives are unknown', () => {
  const result = buildProjectSummaries([
    makeTask({ id: 'z1', projectPath: '/zeros', usage: use({ taskCredits: 0, usd: 0, inputTokens: 0, outputTokens: 0 }) }),
    makeTask({ id: 'z2', projectPath: '/zeros', usage: use({ taskCredits: Number.NaN, usd: -0.5, inputTokens: Number.POSITIVE_INFINITY, outputTokens: -3 }) }),
    makeTask({ id: 'z3', projectPath: '/zeros' }),
    makeTask({ id: 'z4', projectPath: '/zeros', usage: use({}) }),
  ]);
  const model = summaryAt(result, 0).models[0];
  if (!model) throw new Error('expected a model bucket');
  const unknown = { total: 0, knownTasks: 1, unknownTasks: 3, overflow: false };
  assert.deepStrictEqual([model.credits, model.usd, model.inputTokens, model.outputTokens], [unknown, unknown, unknown, unknown]);
  for (const metric of [model.credits, model.usd, model.inputTokens, model.outputTokens]) {
    assert.equal(metric.knownTasks + metric.unknownTasks, model.taskCount);
  }
});

test('token metrics require safe integers and other totals keep decimals unrounded', () => {
  const result = buildProjectSummaries([
    makeTask({ id: 't1', projectPath: '/tokens', usage: use({ taskCredits: 0.1, usd: 0.2, inputTokens: 1.5, outputTokens: 4 }) }),
    makeTask({ id: 't2', projectPath: '/tokens', usage: use({ taskCredits: 0.2, usd: 0.2, inputTokens: 2 ** 53, outputTokens: 7 }) }),
    makeTask({ id: 't3', projectPath: '/tokens', usage: use({ taskCredits: 4, usd: 1e-9, inputTokens: 2 ** 53 - 1, outputTokens: 0 }) }),
  ]);
  const model = summaryAt(result, 0).models[0];
  if (!model) throw new Error('expected a model bucket');
  assert.deepStrictEqual(model.inputTokens, { total: 2 ** 53 - 1, knownTasks: 1, unknownTasks: 2, overflow: false });
  assert.deepStrictEqual(model.outputTokens, { total: 11, knownTasks: 3, unknownTasks: 0, overflow: false });
  assert.equal(model.credits.total, 0.1 + 0.2 + 4);
  assert.equal(model.usd.total, 0.2 + 0.2 + 1e-9);
  const decimals=summaryAt(buildProjectSummaries([
    makeTask({id:'d1',usage:use({taskCredits:0.1})}),makeTask({id:'d2',usage:use({taskCredits:0.2})}),
  ]),0).models[0]!;
  assert.equal(decimals.credits.total,0.1+0.2);
  assert.notEqual(decimals.credits.total,0.3);
});

test('a wholly unknown metric remains null independently of known zero in another metric',()=>{
  const model=summaryAt(buildProjectSummaries([
    makeTask({id:'unknown',usage:use({sessionCredits:20,usd:0})}),
  ]),0).models[0]!;
  assert.deepEqual(model.credits,{total:null,knownTasks:0,unknownTasks:1,overflow:false});
  assert.deepEqual(model.usd,{total:0,knownTasks:1,unknownTasks:0,overflow:false});
});

test('overflow nulls only the overflowing metric total and keeps task counts', () => {
  const result = buildProjectSummaries([
    makeTask({ id: 'o1', projectPath: '/ov', usage: use({ taskCredits: 1, usd: HUGE, inputTokens: 10, outputTokens: 20 }) }),
    makeTask({ id: 'o2', projectPath: '/ov', usage: use({ taskCredits: 2, usd: HUGE, inputTokens: 30, outputTokens: 40 }) }),
    makeTask({ id: 'o3', projectPath: '/ov', usage: use({ usd: -1 }) }),
  ]);
  const model = summaryAt(result, 0).models[0];
  if (!model) throw new Error('expected a model bucket');
  assert.equal(model.taskCount, 3);
  assert.deepStrictEqual(model.usd, { total: null, knownTasks: 2, unknownTasks: 1, overflow: true });
  assert.deepStrictEqual(model.credits, { total: 3, knownTasks: 2, unknownTasks: 1, overflow: false });
  assert.deepStrictEqual(model.inputTokens, { total: 40, knownTasks: 2, unknownTasks: 1, overflow: false });
  assert.deepStrictEqual(model.outputTokens, { total: 60, knownTasks: 2, unknownTasks: 1, overflow: false });
});

test('activity prefers a valid updatedAt, falls back to createdAt, else null, and canonicalizes', () => {
  const result = buildProjectSummaries([
    makeTask({ id: 'f1', projectPath: '/fallback', updatedAt: 'not-a-timestamp', createdAt: '2026-02-03T04:05:06.007Z' }),
    makeTask({ id: 'f2', projectPath: '/both-bad', updatedAt: '', createdAt: 'nope' }),
    makeTask({ id: 'f3', projectPath: '/offset', updatedAt: '2026-05-06T08:09:10+02:00' }),
  ]);
  assert.deepStrictEqual(result.map((item) => item.path), ['/offset', '/fallback', '/both-bad']);
  assert.deepStrictEqual(result.map((item) => item.lastActivityAt), [
    '2026-05-06T06:09:10.000Z',
    '2026-02-03T04:05:06.007Z',
    null,
  ]);
});

test('ordering is deterministic on ties with undated projects last', () => {
  const result = buildProjectSummaries([
    makeTask({ id: 'b1', projectPath: '/zeta', updatedAt: '2026-04-01T00:00:00.000Z' }),
    makeTask({ id: 'a1', projectPath: '/alpha', updatedAt: '2026-04-01T00:00:00.000Z' }),
    makeTask({ id: 'a2', projectPath: '/alpha', updatedAt: '2026-04-01T00:00:00.000Z' }),
    makeTask({ id: 'n2', projectPath: '/nulls' }),
    makeTask({ id: 'n1', projectPath: '/nulls' }),
    makeTask({ id: 'undated', projectPath: '/undated', createdAt: 'nope', updatedAt: 'still-nope' }),
  ]);
  assert.deepStrictEqual(result.map((item) => item.path), ['/alpha', '/zeta', '/nulls', '/undated']);
  assert.deepStrictEqual(result.map((item) => item.taskIds), [['a1', 'a2'], ['b1'], ['n1', 'n2'], ['undated']]);
  assert.equal(summaryAt(result, 3).lastActivityAt, null);
  assert.equal(summaryAt(result, 2).lastActivityAt, '2026-01-01T00:00:00.000Z');
});

test('output exposes only the whitelisted fields', () => {
  const result = buildProjectSummaries([
    makeTask({ id: 'k1', usage: use({ taskCredits: 1, sessionCredits: 2, inputTokens: 3, outputTokens: 4, usd: 5 }), verification: { status: 'passed' } }),
  ]);
  const summary = summaryAt(result, 0);
  const model = summary.models[0];
  if (!model) throw new Error('expected a model bucket');
  assert.deepStrictEqual(Object.keys(summary).sort(), ['counts', 'lastActivityAt', 'models', 'name', 'path', 'taskIds']);
  assert.deepStrictEqual(Object.keys(summary.counts).sort(), [
    'active',
    'cancelled',
    'changesRequested',
    'completed',
    'failed',
    'other',
    'pendingReview',
    'queued',
    'total',
    'waitingUser',
  ]);
  assert.deepStrictEqual(Object.keys(model).sort(), ['credits', 'id', 'inputTokens', 'kind', 'label', 'outputTokens', 'taskCount', 'usd']);
  assert.deepStrictEqual(Object.keys(model.credits).sort(), ['knownTasks', 'overflow', 'total', 'unknownTasks']);
  for (const raw of ['title', 'state', 'acceptance', 'verification', 'sessionCredits', 'createdAt', 'updatedAt', 'modelLabel']) {
    assert.equal(JSON.stringify(summary).includes(raw), false, raw);
  }
});

test('inputs are untouched and every run returns fresh independent containers', () => {
  const makeInput = (): ProjectTask[] => [
    makeTask({ id: 'x1', projectPath: '/in/a', usage: use({ taskCredits: 1, inputTokens: 2 }) }),
    makeTask({ id: 'x2', projectPath: '/in/b', model: 'Auto' }),
  ];
  const input = makeInput();
  const first = buildProjectSummaries(input);
  const second = buildProjectSummaries(makeInput());
  assert.deepStrictEqual(input, makeInput());
  assert.deepStrictEqual(first, second);
  assert.notStrictEqual(first, second);
  const a = summaryAt(first, 0);
  const b = summaryAt(second, 0);
  assert.notStrictEqual(a.taskIds, b.taskIds);
  assert.notStrictEqual(a.counts, b.counts);
  assert.notStrictEqual(a.models, b.models);
  a.taskIds.push('x9');
  a.counts.total = 42;
  a.models.length = 0;
  assert.deepStrictEqual(buildProjectSummaries(input), second);
});
