import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildReviewCard} from '../src/review-card.js';
import type {Attention, ReviewCard} from '../src/review-types.js';
import type {State, Task} from '../src/types.js';

const CARD_KEYS = [
  'acceptance', 'agent', 'attention', 'error', 'errorTruncated', 'fileCount', 'files', 'filesTruncated', 'id', 'reasoningEffort',
  'reportedModel', 'requestedModel', 'state', 'summary', 'summaryTruncated', 'title', 'updatedAt', 'usage', 'verification',
];
const FILE_KEYS = ['kind', 'path'];
const USAGE_KEYS = ['inputTokens', 'outputTokens', 'taskCredits', 'usd'];
const FORBIDDEN_KEYS = [
  'allowedFiles', 'acceptanceCriteria', 'baseline', 'beforeBytes', 'beforeSha256', 'bytes', 'capabilityPins', 'capabilityRun',
  'command', 'createdAt', 'dependencies', 'diff', 'evidence', 'executionRequested', 'failureKind', 'finishedAt', 'maxTurns',
  'model', 'mode', 'pid', 'projectPath', 'prompt', 'recordedAt', 'reviewNote', 'revision', 'session', 'sessionCredits',
  'sessionId', 'sha256', 'source', 'startedAt', 'timeoutSeconds', 'tokenNote', 'workspace', 'workspaceKind',
];
const SENTINELS = [
  'PROMPT-SECRET', 'PROJECT-PATH', 'CRITERIA-SECRET', 'ALLOWED-FILE-SECRET', 'DEPENDENCY-SECRET', 'MODEL-FIELD-SECRET',
  'WORKSPACE-SECRET', 'BASELINE-SECRET', 'SESSION-SECRET', 'REVIEW-NOTE-SECRET', 'DIFF-SECRET', 'COMMAND-SECRET',
  'EVIDENCE-SECRET', 'RECORDED-SECRET', 'TOKEN-NOTE-SECRET', 'SOURCE-SECRET', 'FAILURE-KIND-SECRET', 'CAPABILITY-SECRET',
  'REASONING-RUN-SECRET', 'INPUT-RUN-SECRET', 'REVISION-SECRET', 'PIN-SECRET', 'SHA-SECRET', 'BYTES-SECRET', 'NOT-AN-ARRAY',
];

const SECRET_FIELDS = {
  reviewNote: 'REVIEW-NOTE-SECRET',
  sessionId: 'SESSION-SECRET',
  capabilities: {'CAPABILITY-SECRET': true},
  capabilityPins: {'PIN-SECRET': '1.0.0'},
  capabilityRun: {note: 'CAPABILITY-SECRET'},
  reasoningRun: {note: 'REASONING-RUN-SECRET'},
  inputRun: {note: 'INPUT-RUN-SECRET'},
  revision: {note: 'REVISION-SECRET'},
  reportedModel: 'helm-large-reported',
  reasoningEffort: 'high',
  summary: 'Lands the whitelisted projection.',
  error: '',
  changes: [{path: 'src/review-card.ts', kind: 'modified', diff: 'DIFF-SECRET', sha256: 'SHA-SECRET', bytes: 12, beforeSha256: 'BYTES-SECRET', beforeBytes: 9}],
  verification: {status: 'passed', command: 'COMMAND-SECRET', evidence: 'EVIDENCE-SECRET', recordedAt: 'RECORDED-SECRET'},
  usage: {taskCredits: 2.5, sessionCredits: 11, inputTokens: 100, outputTokens: 200, usd: 0.125, tokenNote: 'TOKEN-NOTE-SECRET', source: 'SOURCE-SECRET'},
};

function makeTask(overrides: Partial<Task> = {}): Task {
  const base = {
    id: 'task-42',
    title: 'Render a review card',
    prompt: 'PROMPT-SECRET do the thing',
    projectPath: '/srv/PROJECT-PATH/repo',
    allowedFiles: ['src/ALLOWED-FILE-SECRET.ts'],
    acceptanceCriteria: ['CRITERIA-SECRET'],
    dependencies: ['DEPENDENCY-SECRET'],
    model: 'MODEL-FIELD-SECRET',
    mode: 'files',
    timeoutSeconds: 900,
    maxTurns: 7,
    state: 'running',
    acceptance: 'pending',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T03:04:05.000Z',
    requestedModel: 'helm-large',
    startedAt: '2026-10-01T00:01:00.000Z',
    finishedAt: '2026-10-01T00:09:00.000Z',
    workspace: '/tmp/WORKSPACE-SECRET',
    workspaceKind: 'worktree',
    baseline: 'BASELINE-SECRET',
    pid: 4242,
    failureKind: 'FAILURE-KIND-SECRET',
    agent: 'qoder',
  } as unknown as Task;
  return {...base, ...overrides};
}

function withSecrets(overrides: Record<string, unknown> = {}): Task {
  return makeTask({...SECRET_FIELDS, ...overrides} as unknown as Partial<Task>);
}

function usageOf(value: Record<string, unknown>): Task['usage'] {
  return value as unknown as Task['usage'];
}

function verificationOf(status: unknown): Task['verification'] {
  return {status, command: 'COMMAND-SECRET', evidence: 'EVIDENCE-SECRET', recordedAt: 'RECORDED-SECRET'} as unknown as Task['verification'];
}

function keyNames(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keyNames(item, found);
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      found.push(key);
      keyNames(nested, found);
    }
  }
  return found;
}

function assertCardShape(card: ReviewCard): void {
  const json = JSON.stringify(card);
  for (const sentinel of SENTINELS) assert.ok(!json.includes(sentinel), `leaked value ${sentinel}`);
  const expected = [...CARD_KEYS, ...USAGE_KEYS, ...(card.files.length > 0 ? FILE_KEYS : [])];
  assert.deepEqual([...new Set(keyNames(card))].sort(), expected.sort());
}

test('attention follows the state matrix', () => {
  const cases: [State, Task['acceptance'], ReviewCard['verification'], Attention | null][] = [
    ['queued', 'pending', 'not_run', null],
    ['queued', 'accepted', 'passed', null],
    ['preparing', 'pending', 'not_run', null],
    ['preparing', 'changes_requested', 'failed', null],
    ['running', 'pending', 'not_run', null],
    ['running', 'changes_requested', 'failed', null],
    ['cancelled', 'pending', 'not_run', null],
    ['cancelled', 'changes_requested', 'failed', null],
    ['waiting_user', 'pending', 'not_run', 'intervention'],
    ['waiting_user', 'accepted', 'passed', 'intervention'],
    ['waiting_user', 'changes_requested', 'failed', 'intervention'],
    ['failed', 'pending', 'not_run', 'rework'],
    ['failed', 'accepted', 'passed', 'rework'],
    ['failed', 'changes_requested', 'failed', 'rework'],
    ['completed', 'pending', 'not_run', 'review'],
    ['completed', 'pending', 'passed', 'review'],
    ['completed', 'accepted', 'passed', null],
    ['completed', 'accepted', 'not_run', null],
    ['completed', 'accepted', 'failed', 'rework'],
    ['completed', 'changes_requested', 'not_run', 'rework'],
    ['completed', 'changes_requested', 'passed', 'rework'],
    ['completed', 'changes_requested', 'failed', 'rework'],
  ];
  for (const [state, acceptance, status, expected] of cases) {
    const card = buildReviewCard(makeTask({state, acceptance, verification: status === 'not_run' ? undefined : verificationOf(status)}));
    assert.equal(card.attention, expected, `${state}/${acceptance}/${status}`);
    assert.equal(card.verification, status);
  }
});

test('attention precedence between competing signals', () => {
  const failed = verificationOf('failed');
  const passed = verificationOf('passed');
  assert.equal(buildReviewCard(makeTask({state: 'waiting_user', acceptance: 'changes_requested', verification: failed})).attention, 'intervention');
  assert.equal(buildReviewCard(makeTask({state: 'failed', acceptance: 'pending', verification: passed})).attention, 'rework');
  assert.equal(buildReviewCard(makeTask({state: 'failed', acceptance: 'changes_requested', verification: failed})).attention, 'rework');
  assert.equal(buildReviewCard(makeTask({state: 'completed', acceptance: 'pending', verification: failed})).attention, 'rework');
  assert.equal(buildReviewCard(makeTask({state: 'completed', acceptance: 'accepted', verification: failed})).attention, 'rework');
  assert.equal(buildReviewCard(makeTask({state: 'completed', acceptance: 'changes_requested', verification: passed})).attention, 'rework');
  assert.equal(buildReviewCard(makeTask({state: 'completed', acceptance: 'pending', verification: passed})).attention, 'review');
  assert.equal(buildReviewCard(makeTask({state: 'completed', acceptance: 'accepted', verification: passed})).attention, null);
  assert.equal(buildReviewCard(makeTask({state: 'cancelled', acceptance: 'changes_requested', verification: failed})).attention, null);
  assert.equal(buildReviewCard(makeTask({state: 'running', acceptance: 'pending', verification: undefined})).attention, null);
});

test('clips to Unicode code points instead of UTF-16 units', () => {
  const card = buildReviewCard(makeTask({
    title: '😀'.repeat(200),
    requestedModel: '🧠'.repeat(201),
    reportedModel: '🧠'.repeat(250),
    summary: '🚨'.repeat(601),
    error: '❌'.repeat(241),
    changes: [{path: '📁'.repeat(241), kind: '🔧'.repeat(41), diff: 'DIFF-SECRET'}],
  }));
  assert.equal(card.title, '😀'.repeat(160));
  assert.equal(Array.from(card.title).length, 160);
  assert.equal(card.requestedModel, '🧠'.repeat(200));
  assert.equal(card.reportedModel, '🧠'.repeat(200));
  assert.equal(card.summary, '🚨'.repeat(600));
  assert.equal(Array.from(card.summary).length, 600);
  assert.equal(card.summaryTruncated, true);
  assert.equal(card.error, '❌'.repeat(240));
  assert.equal(card.errorTruncated, true);
  assert.equal(card.files[0]!.path, '📁'.repeat(240));
  assert.equal(card.files[0]!.kind, '🔧'.repeat(40));
});

test('truncation flags compare full code-point length', () => {
  const underLimit = buildReviewCard(makeTask({title: '😀'.repeat(160), summary: '🚨'.repeat(301), error: '❌'.repeat(121)}));
  assert.equal(underLimit.title, '😀'.repeat(160));
  assert.equal(underLimit.summary, '🚨'.repeat(301));
  assert.equal(underLimit.summaryTruncated, false);
  assert.equal(underLimit.error, '❌'.repeat(121));
  assert.equal(underLimit.errorTruncated, false);

  const exact = buildReviewCard(makeTask({summary: 'a'.repeat(600), error: 'b'.repeat(240)}));
  assert.equal(exact.summary, 'a'.repeat(600));
  assert.equal(exact.summaryTruncated, false);
  assert.equal(exact.error, 'b'.repeat(240));
  assert.equal(exact.errorTruncated, false);

  const over = buildReviewCard(makeTask({summary: 'a'.repeat(601), error: 'b'.repeat(241)}));
  assert.equal(over.summary.length, 600);
  assert.equal(over.summaryTruncated, true);
  assert.equal(over.error.length, 240);
  assert.equal(over.errorTruncated, true);

  const missing = buildReviewCard(makeTask({summary: undefined, error: undefined}));
  assert.equal(missing.summary, '');
  assert.equal(missing.summaryTruncated, false);
  assert.equal(missing.error, '');
  assert.equal(missing.errorTruncated, false);
});

test('usage keeps zero and finite nonnegatives and nulls everything else', () => {
  const zeros = buildReviewCard(makeTask({usage: usageOf({taskCredits: 0, sessionCredits: 0, inputTokens: 0, outputTokens: 0, usd: 0, tokenNote: 'x', source: 'y'})}));
  assert.deepEqual(zeros.usage, {taskCredits: 0, inputTokens: 0, outputTokens: 0, usd: 0});

  const valid = buildReviewCard(makeTask({usage: usageOf({taskCredits: 2.5, sessionCredits: 99, inputTokens: 10, outputTokens: 0, usd: 0.001, tokenNote: 'x', source: 'y'})}));
  assert.deepEqual(valid.usage, {taskCredits: 2.5, inputTokens: 10, outputTokens: 0, usd: 0.001});

  const absent = buildReviewCard(makeTask({usage: undefined}));
  assert.deepEqual(absent.usage, {taskCredits: null, inputTokens: null, outputTokens: null, usd: null});

  const nullish = buildReviewCard(makeTask({usage: usageOf({taskCredits: null, sessionCredits: 42, inputTokens: null, outputTokens: null, usd: null, tokenNote: 'TOKEN-NOTE-SECRET', source: 'SOURCE-SECRET'})}));
  assert.deepEqual(nullish.usage, {taskCredits: null, inputTokens: null, outputTokens: null, usd: null});

  const notFinite = buildReviewCard(makeTask({usage: usageOf({taskCredits: -1, sessionCredits: 42, inputTokens: Number.NaN, outputTokens: Number.POSITIVE_INFINITY, usd: Number.NEGATIVE_INFINITY, tokenNote: 'x', source: 'y'})}));
  assert.deepEqual(notFinite.usage, {taskCredits: null, inputTokens: null, outputTokens: null, usd: null});

  const wrongType = buildReviewCard(makeTask({usage: usageOf({taskCredits: '12', sessionCredits: 42, inputTokens: true, outputTokens: {}, usd: undefined, tokenNote: 'x', source: 'y'})}));
  assert.deepEqual(wrongType.usage, {taskCredits: null, inputTokens: null, outputTokens: null, usd: null});

  const partial = buildReviewCard(makeTask({usage: usageOf({taskCredits: 4, sessionCredits: 77, tokenNote: 'x', source: 'y'})}));
  assert.deepEqual(partial.usage, {taskCredits: 4, inputTokens: null, outputTokens: null, usd: null});
  assert.equal('sessionCredits' in partial.usage, false);
});

test('verification projects only a status and defaults to not_run', () => {
  assert.equal(buildReviewCard(makeTask({})).verification, 'not_run');
  assert.equal(buildReviewCard(makeTask({verification: undefined})).verification, 'not_run');
  assert.equal(buildReviewCard(makeTask({verification: verificationOf('not_run')})).verification, 'not_run');
  assert.equal(buildReviewCard(makeTask({verification: verificationOf('passed')})).verification, 'passed');
  assert.equal(buildReviewCard(makeTask({verification: verificationOf('failed')})).verification, 'failed');
  assert.equal(buildReviewCard(makeTask({verification: verificationOf('done')})).verification, 'not_run');
  assert.equal(buildReviewCard(makeTask({verification: verificationOf(undefined)})).verification, 'not_run');
});

test('projects whitelisted scalars and nulls absent optional text', () => {
  const card = buildReviewCard(withSecrets());
  assert.equal(card.id, 'task-42');
  assert.equal(card.title, 'Render a review card');
  assert.equal(card.state, 'running');
  assert.equal(card.acceptance, 'pending');
  assert.equal(card.agent, 'qoder');
  assert.equal(card.requestedModel, 'helm-large');
  assert.equal(card.reportedModel, 'helm-large-reported');
  assert.equal(card.reasoningEffort, 'high');
  assert.equal(card.updatedAt, '2026-10-02T03:04:05.000Z');
  assert.equal(card.summary, 'Lands the whitelisted projection.');
  assert.equal(card.error, '');
  assert.deepEqual(card.files, [{path: 'src/review-card.ts', kind: 'modified'}]);
  assert.equal(card.fileCount, 1);
  assert.equal(card.filesTruncated, false);
  assertCardShape(card);

  const bare = buildReviewCard(makeTask({agent: undefined, reportedModel: undefined, reasoningEffort: undefined}));
  assert.equal(bare.agent, 'qoder-cn');
  assert.equal(bare.reportedModel, null);
  assert.equal(bare.reasoningEffort, null);
  assert.deepEqual(bare.files, []);
  assert.equal(bare.fileCount, 0);
  assert.equal(bare.filesTruncated, false);
});

test('caps projected files at twelve entries with per-field bounds', () => {
  const many = Array.from({length: 15}, (_, index) => ({path: `src/file-${index}.ts`, kind: 'modified', diff: 'DIFF-SECRET'}));
  const card = buildReviewCard(makeTask({changes: many}));
  assert.equal(card.files.length, 12);
  assert.equal(card.fileCount, 15);
  assert.equal(card.filesTruncated, true);
  assert.deepEqual(card.files[0], {path: 'src/file-0.ts', kind: 'modified'});
  assert.deepEqual(card.files[11], {path: 'src/file-11.ts', kind: 'modified'});
  for (const file of card.files) assert.deepEqual(Object.keys(file).sort(), FILE_KEYS);
  assertCardShape(card);

  const exactly = buildReviewCard(makeTask({changes: many.slice(0, 12)}));
  assert.equal(exactly.files.length, 12);
  assert.equal(exactly.fileCount, 12);
  assert.equal(exactly.filesTruncated, false);

  const oneMore = buildReviewCard(makeTask({changes: many.slice(0, 13)}));
  assert.equal(oneMore.files.length, 12);
  assert.equal(oneMore.fileCount, 13);
  assert.equal(oneMore.filesTruncated, true);

  const absent = buildReviewCard(makeTask({changes: undefined}));
  assert.deepEqual(absent.files, []);
  assert.equal(absent.fileCount, 0);
  assert.equal(absent.filesTruncated, false);

  const broken = buildReviewCard(makeTask({changes: 'NOT-AN-ARRAY' as unknown as Task['changes']}));
  assert.deepEqual(broken.files, []);
  assert.equal(broken.fileCount, 0);
  assert.equal(broken.filesTruncated, false);
});

test('output holds no prompt, diff, evidence, session or other forbidden fields', () => {
  const card = buildReviewCard(withSecrets({summary: 'x'.repeat(700), error: 'y'.repeat(300), changes: [{path: 'a.ts', kind: 'modified', diff: 'DIFF-SECRET'}]}));
  assert.deepEqual(Object.keys(card).sort(), CARD_KEYS);
  for (const forbidden of ['prompt', 'diff', 'command', 'evidence', 'reviewNote', 'workspace', 'session', 'sessionId', 'projectPath', 'capabilities', 'sessionCredits']) {
    assert.equal(forbidden in card, false, forbidden);
  }
  assert.deepEqual(Object.keys(card.usage).sort(), USAGE_KEYS);
  for (const file of card.files) assert.deepEqual(Object.keys(file).sort(), FILE_KEYS);
  const found = keyNames(card);
  for (const forbidden of FORBIDDEN_KEYS) assert.ok(!found.includes(forbidden), `leaked key ${forbidden}`);
  assertCardShape(card);

  const noFiles = buildReviewCard(withSecrets({changes: undefined}));
  assertCardShape(noFiles);
  assert.equal(noFiles.summaryTruncated, false);
  assert.equal(noFiles.errorTruncated, false);
});

test('does not mutate the task and returns fresh deep projections', () => {
  const task = withSecrets({changes: [{path: 'src/a.ts', kind: 'modified', diff: 'DIFF-SECRET'}, {path: 'src/b.ts', kind: 'added', diff: 'DIFF-SECRET'}]});
  const snapshot = JSON.stringify(task);
  const first = buildReviewCard(task);
  const second = buildReviewCard(task);
  assert.equal(JSON.stringify(task), snapshot, 'input task must stay untouched');
  assert.notEqual(first, second);
  assert.notEqual(first.files, second.files);
  assert.notEqual(first.files[0], second.files[0]);
  assert.notEqual(first.files[0], task.changes![0]);
  assert.notEqual(first.usage, task.usage);
  assert.notEqual(first.usage, second.usage);

  first.files[0]!.path = 'MUTATED';
  first.files.push({path: 'extra.ts', kind: 'extra'});
  first.usage.taskCredits = 999;
  first.usage.usd = 999;
  first.summary = 'shrunk';
  assert.equal(second.files[0]!.path, 'src/a.ts');
  assert.equal(second.files.length, 2);
  assert.equal(second.usage.taskCredits, 2.5);
  assert.equal(second.usage.usd, 0.125);
  assert.equal(second.summary, 'Lands the whitelisted projection.');

  const pinned = buildReviewCard(task);
  task.title = 'LATER-TITLE';
  task.state = 'cancelled';
  task.changes![0]!.path = 'LATER-PATH';
  task.usage!.inputTokens = 12345;
  task.summary = 'LATER-SUMMARY';
  assert.equal(pinned.title, 'Render a review card');
  assert.equal(pinned.state, 'running');
  assert.equal(pinned.files[0]!.path, 'src/a.ts');
  assert.equal(pinned.usage.inputTokens, 100);
  assert.equal(pinned.summary, 'Lands the whitelisted projection.');
});
