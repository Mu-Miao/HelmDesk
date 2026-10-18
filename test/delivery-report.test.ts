import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deliveryReport } from '../src/delivery-report.js';
import type { Task } from '../src/types.js';

function makeTask(overrides: Partial<Task> = {}): Task {
  const task: Task = {
    id: 'task-1',
    title: '示例任务标题',
    prompt: 'SECRET-PROMPT 不要出现在报告里',
    projectPath: '/SECRET/project/path',
    allowedFiles: ['src/a.ts'],
    acceptanceCriteria: ['测试全部通过', '不修改公共接口'],
    dependencies: [],
    model: 'model-id-1',
    requestedModel: 'model-id-1',
    mode: 'files',
    timeoutSeconds: 600,
    state: 'completed',
    acceptance: 'pending',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    ...overrides,
  };
  return task;
}

const SECRET_MARKERS = [
  'SECRET-PROMPT',
  '/SECRET/project/path',
  '/SECRET/workspace/dir',
  'SECRET-BASELINE',
  'SECRET-SESSION-ID',
  'SECRET-SKILL',
  'SECRET-TOOL',
  'SECRET-CAP-DIR',
  '424242',
];

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      out.push(key);
      collectStrings(item, out);
    }
  }
  return out;
}

/** Tracks which lines sit outside a fenced code block (closing fence must be at least as long as the opener). */
function unescapedLines(markdown: string): string[] {
  const plain: string[] = [];
  let openLength = 0;
  for (const line of markdown.split('\n')) {
    const fence = /^\s*(`{3,})(.*)$/.exec(line);
    if (fence) {
      const length = fence[1]!.length;
      if (openLength === 0) {
        if (!fence[2]!.includes('`')) {
          openLength = length;
          continue;
        }
      } else if (length >= openLength && fence[2]!.trim() === '') {
        openLength = 0;
        continue;
      }
    }
    if (openLength === 0) plain.push(line);
  }
  assert.equal(openLength, 0, 'markdown has an unterminated code fence');
  return plain;
}

test('rejects non-terminal task states', () => {
  for (const state of ['queued', 'preparing', 'running', 'waiting_user'] as const) {
    assert.throws(() => deliveryReport(makeTask({ state })), /已结束|允许的状态/);
  }
  for (const state of ['completed', 'failed', 'cancelled'] as const) {
    const report = deliveryReport(makeTask({ state }));
    assert.equal(report.record.state, state);
    assert.equal(report.schemaVersion, 1);
  }
});

test('returns exactly the contract fields', () => {
  const report = deliveryReport(makeTask());
  assert.deepEqual(Object.keys(report).sort(), ['filename', 'limitations', 'markdown', 'record', 'schemaVersion']);
  assert.deepEqual(Object.keys(report.record).sort(), [
    'acceptance',
    'acceptanceCriteria',
    'agent',
    'changes',
    'createdAt',
    'dependencies',
    'error',
    'id',
    'inputs',
    'maxTurns',
    'reasoningEffort',
    'reasoningRun',
    'reportedModel',
    'requestedModel',
    'reviewNote',
    'revision',
    'state',
    'summary',
    'title',
    'updatedAt',
    'usage',
    'verification',
  ]);
  assert.ok(Array.isArray(report.limitations));
  assert.ok(report.limitations.length > 0);
});

test('verification is recorded evidence, never acceptance', () => {
  const task = makeTask({
    verification: {
      status: 'passed',
      command: 'npm test',
      evidence: '33 tests passed',
      recordedAt: '2026-10-02T01:00:00.000Z',
    },
    acceptance: 'pending',
  });
  const report = deliveryReport(task);
  assert.equal(report.record.verification?.status, 'passed');
  assert.equal(report.record.acceptance, 'pending');
  assert.match(report.markdown, /验证[\s\S]*独立/);
  const limitationsText = report.limitations.join('\n');
  assert.match(limitationsText, /执行、验证与验收[\s\S]*独立/);
  assert.match(limitationsText, /不等于验收通过|不构成验收/);
  assert.match(report.markdown, /不构成验收通过/);
});

test('limitations state stored evidence, isolated workspace, no merge or original write', () => {
  const text = deliveryReport(makeTask()).limitations.join('\n');
  assert.match(text, /已保存/);
  assert.match(text, /证据/);
  assert.match(text, /隔离工作区/);
  assert.match(text, /合并/);
  assert.match(text, /不会[\s\S]*原项目[\s\S]*写入|不做任何写入/);
  assert.match(text, /可应用补丁/);
  const markdown = deliveryReport(makeTask()).markdown;
  assert.match(markdown, /原始完整文件仍保留在隔离工作区/);
});

test('omits private and capability fields from record and markdown', () => {
  const task = makeTask({
    state: 'failed',
    error: 'boom',
    workspace: '/SECRET/workspace/dir',
    baseline: 'SECRET-BASELINE',
    sessionId: 'SECRET-SESSION-ID',
    pid: 424242,
    capabilityRun: {
      skills: [{ id: 'SECRET-SKILL', source: 'x', version: '1', sha256: 'y', fileCount: 1, bytes: 1, files: ['a'] }],
      tools: [{ id: 'SECRET-TOOL', serverId: 's', name: 'n', description: 'd', inputSchema: {}, sourceSha256: 'z' }],
      sourceChecks: [],
      configDirectory: 'SECRET-CAP-DIR',
    },
    capabilityPins: { 'SECRET-SKILL': '1' },
    capabilities: { skills: ['SECRET-SKILL'], tools: ['SECRET-TOOL'] },
  });
  const report = deliveryReport(task);
  const haystack = collectStrings(report).join('\n');
  for (const marker of SECRET_MARKERS) assert.ok(!haystack.includes(marker), `unexpected leak: ${marker}`);
  for (const marker of SECRET_MARKERS) assert.ok(!report.markdown.includes(marker), `markdown leak: ${marker}`);
  assert.ok(!('prompt' in report.record));
  assert.ok(!('projectPath' in report.record));
  assert.ok(!('workspace' in report.record));
  assert.ok(!('baseline' in report.record));
  assert.ok(!('sessionId' in report.record));
  assert.ok(!('pid' in report.record));
  assert.ok(!('capabilities' in report.record));
  assert.ok(!('capabilityPins' in report.record));
  assert.ok(!('capabilityRun' in report.record));
  assert.equal(report.record.error, 'boom');
});

test('preserves zero credits, null unknowns, and does not sum usage', () => {
  const noUsage = deliveryReport(makeTask());
  assert.equal(noUsage.record.usage, null);
  assert.match(noUsage.markdown, /未记录用量/);

  const task = makeTask({
    usage: {
      taskCredits: 0,
      sessionCredits: null,
      inputTokens: 100,
      outputTokens: null,
      usd: null,
      tokenNote: 'token 数据不完整',
      source: 'cli-log',
    },
  });
  const report = deliveryReport(task);
  assert.equal(report.record.usage?.taskCredits, 0);
  assert.equal(report.record.usage?.sessionCredits, null);
  assert.equal(report.record.usage?.outputTokens, null);
  assert.equal(report.record.usage?.usd, null);
  assert.match(report.markdown, /任务级 credits：0/);
  assert.match(report.markdown, /会话级 credits：未知（null）/);
  assert.ok(!/credits：0\s*\+\s*|总计|合计/.test(report.markdown));
});

test('flags truncated and binary diffs as incomplete and warns in Chinese', () => {
  const task = makeTask({
    changes: [
      { path: 'src/a.ts', kind: 'modified', diff: '--- a/src/a.ts\n+++ b/src/a.ts\n（显示已截断，仅保留前 200 行）' },
      { path: 'assets/logo.png', kind: 'added', diff: 'Binary file assets/logo.png differs' },
      { path: 'src/b.ts', kind: 'modified', diff: '@@ -1 +1 @@\n-a\n+b' },
    ],
  });
  const report = deliveryReport(task);
  assert.equal(report.record.changes.length, 3);
  assert.equal(report.record.changes[0]!.incomplete, true);
  assert.equal(report.record.changes[1]!.incomplete, true);
  assert.equal(report.record.changes[2]!.incomplete, false);
  assert.equal(report.record.changes[2]!.diff, '@@ -1 +1 @@\n-a\n+b');
  assert.equal(report.record.changes[0]!.diff.includes('显示已截断'), true);
  assert.match(report.markdown, /不完整差异警告/);
  assert.match(report.markdown, /警告：[\s\S]*不完整差异/);
  assert.ok(report.limitations.join('\n').includes('被截断'));

  const clean = deliveryReport(makeTask({ changes: [{ path: 'src/b.ts', kind: 'modified', diff: '@@ -1 +1 @@' }] }));
  assert.ok(!clean.markdown.includes('不完整差异警告'));
});

test('ordinary source words like truncated/省略/截断 do not mark a diff incomplete', () => {
  const ordinary = deliveryReport(makeTask({
    changes: [{ path: 'src/a.ts', kind: 'modified', diff: '+const truncated = "省略和截断只是业务文字";' }],
  }));
  assert.equal(ordinary.record.changes[0]!.incomplete, false);
  assert.ok(!ordinary.markdown.includes('不完整差异警告'));
  assert.ok(!ordinary.limitations.some((item) => item.startsWith('警告：')));

  const incomplete = deliveryReport(makeTask({
    changes: [{ path: 'src/a.ts', kind: 'modified', diff: '@@ -1 +1 @@\n[显示已截断；完整文件保留在独立工作目录]' }],
  }));
  assert.equal(incomplete.record.changes[0]!.incomplete, true);
  assert.ok(incomplete.limitations.some((item) => item.startsWith('警告：')));
});

test('copies arrays and neutralizes malicious backticks and HTML', () => {
  const task = makeTask({
    title: '恶意 ``` 标题\n<script>alert(1)</script>\n```text\n注入结束',
    summary: '# 假标题\n<a href="javascript:alert(1)">链接</a> ```',
    reviewNote: '``` 评审 <img src=x onerror=alert(1)>',
    changes: [{ path: '```\n/evil/`'.repeat(2), kind: 'modified', diff: '``````\n<script>diff</script>' }],
    acceptanceCriteria: ['<script>criteria</script>'],
    dependencies: ['```dep'],
  });
  const report = deliveryReport(task);
  const plainLines = unescapedLines(report.markdown);
  const outside = plainLines.join('\n');
  assert.ok(!outside.includes('<script>'), 'raw <script> escaped its fence');
  assert.ok(!outside.includes('<img'), 'raw <img> escaped its fence');
  assert.ok(!outside.includes('alert(1)'));
  assert.ok(!plainLines.some((line) => /^# 假标题$/.test(line)));
  assert.ok(!plainLines.some((line) => /^# 恶意/.test(line)));
  assert.ok(!plainLines.some((line) => line.includes('```dep')));
  assert.ok(report.markdown.includes('````text'), 'fence must be longer than content backtick runs');
  assert.equal(report.record.changes[0]!.path, '```\n/evil/`'.repeat(2));
});

test('sanitizes the filename against path traversal', () => {
  const cases: [string, string][] = [
    ['../../evil/id', 'helm-______evil_id.md'],
    ['a b/c\\d', 'helm-a_b_c_d.md'],
    ['中文/任务', 'helm-_____.md'],
    ['ok-1_2', 'helm-ok-1_2.md'],
  ];
  for (const [id, expected] of cases) {
    const report = deliveryReport(makeTask({ id }));
    assert.equal(report.filename, expected, `id ${JSON.stringify(id)}`);
    assert.ok(!report.filename.includes('/'));
    assert.ok(!report.filename.includes('\\'));
    assert.ok(!report.filename.includes('..'));
    assert.equal(report.record.id, id);
  }
});

test('is deterministic and does not mutate the input task', () => {
  const task = makeTask({
    summary: 's',
    changes: [{ path: 'p', kind: 'k', diff: 'd' }],
    verification: { status: 'not_run', command: 'c', evidence: 'e', recordedAt: 'r' },
    usage: { taskCredits: null, sessionCredits: 0, inputTokens: 1, outputTokens: 2, usd: 0, tokenNote: 'n', source: 's' },
  });
  const before = JSON.stringify(task);
  const first = deliveryReport(task);
  const second = deliveryReport(task);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(task), before);
  assert.notEqual(first.record.changes, task.changes);
  assert.notEqual(first.record.dependencies, task.dependencies);
  first.record.acceptanceCriteria.push('不应回写');
  first.record.changes.push({ path: 'x', kind: 'y', diff: 'z', incomplete: false });
  assert.equal(task.acceptanceCriteria.length, 2);
  assert.equal(task.changes?.length, 1);
});
