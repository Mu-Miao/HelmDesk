import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inputPlan } from '../src/input-policy.js';
import type { InputFile, InputSelection, InputSource } from '../src/input-types.js';

const SHA = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ID1 = '11111111-2222-3333-4444-555555555555';
const ID2 = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ID3 = '99999999-8888-7777-6666-555555555555';
const ID4 = '12345678-1234-1234-1234-123456789abc';
const ID5 = '00000000-0000-4000-8000-000000000000';

function src(id: string, overrides: Partial<InputSource> = {}): InputSource {
  return {
    id,
    title: `标题-${id.slice(0, 4)}`,
    state: 'completed',
    acceptance: 'accepted',
    verification: { status: 'passed' },
    changes: [
      { path: 'src/a.ts', kind: 'added', sha256: SHA, bytes: 100 },
      { path: 'docs/b.md', kind: 'modified', sha256: SHA, bytes: 200 },
      { path: 'old/c.ts', kind: 'deleted', sha256: SHA, bytes: 1 },
      { path: 'legacy.ts', kind: 'added', bytes: 1 },
    ],
    ...overrides,
  };
}

function broad(id: string, count: number, bytes: number): InputSource {
  const changes = Array.from(
    { length: count },
    (_unused, i): { path: string; kind: string; sha256?: string; bytes?: number } => ({
      path: `f/${String(i)}.ts`,
      kind: 'added',
      sha256: SHA,
      bytes,
    }),
  );
  return src(id, { changes });
}

function lookup(...sources: InputSource[]): (id: string) => InputSource {
  return (id: string): InputSource => {
    const found = sources.find((item): boolean => item.id === id);
    if (!found) {
      throw new Error('missing');
    }
    return found;
  };
}

function pathList(count: number): string[] {
  return Array.from({ length: count }, (_unused, i): string => `f/${String(i)}.ts`);
}

function planOne(path: string, source: InputSource = src(ID1)): InputFile[] {
  return inputPlan([{ taskId: ID1, paths: [path] }], lookup(source));
}

test('成功规划并按选择顺序输出', () => {
  const s1 = src(ID1);
  const s2 = src(ID2);
  const result = inputPlan(
    [
      { taskId: ID2, paths: ['docs/b.md'] },
      { taskId: ID1, paths: ['src/a.ts'] },
    ],
    lookup(s1, s2),
  );
  assert.deepEqual(result, [
    { taskId: ID2, title: s2.title, path: 'docs/b.md', sha256: SHA, bytes: 200, mountedPath: `.helmdesk-inputs/${ID2}/docs/b.md` },
    { taskId: ID1, title: s1.title, path: 'src/a.ts', sha256: SHA, bytes: 100, mountedPath: `.helmdesk-inputs/${ID1}/src/a.ts` },
  ]);
});

test('空选择返回空数组', () => {
  assert.deepEqual(inputPlan([], lookup(src(ID1))), []);
});

test('状态/验收/校验闸门', () => {
  const run = (overrides: Partial<InputSource>): InputFile[] =>
    inputPlan([{ taskId: ID1, paths: ['src/a.ts'] }], lookup(src(ID1, overrides)));
  assert.equal(run({}).length, 1);
  assert.throws(() => run({ state: 'running' }), Error);
  assert.throws(() => run({ acceptance: 'pending' }), Error);
  assert.throws(() => run({ verification: undefined }), Error);
  assert.throws(() => run({ verification: { status: 'failed' } }), Error);
});

test('非法UUID与缺失来源', () => {
  assert.throws(() => inputPlan([{ taskId: 'not-a-uuid', paths: ['src/a.ts'] }], lookup(src(ID1))), Error);
  assert.throws(() => inputPlan([{ taskId: ID1, paths: ['src/a.ts'] }], lookup()), Error);
  assert.throws(() => inputPlan([{ taskId: ID1, paths: ['src/a.ts'] }], () => src(ID2)), Error);
});

test('不安全路径与保留段拒绝', () => {
  const nul = String.fromCharCode(0);
  const bell = String.fromCharCode(7);
  const del = String.fromCharCode(127);
  const badPaths = [
    '',
    '/abs.ts',
    'a\\b.ts',
    'dir/',
    `a${nul}.ts`,
    `a${bell}.ts`,
    `a${del}.ts`,
    'a//b.ts',
    './a.ts',
    '../a.ts',
    'a/./b.ts',
    'a/../b.ts',
    '.git/config',
    'x/node_modules/y.js',
    '.helmdesk/in',
    '.helmdesk-inputs/x',
    '.aws/creds',
    '.codex/x',
    '.agents/x',
    '.qoder/x',
    '.qoder-cn/x',
    '.qoderworkcn/x',
    '.ssh/key',
    'dist/app.js',
    '.DS_Store',
    'x/.DS_Store',
    '.env',
    '.env.local',
    'x/.env.local',
  ];
  for (const bad of badPaths) {
    assert.throws(() => planOne(bad), Error, `应拒绝: ${bad}`);
  }
  assert.equal(planOne('src/a.ts').length, 1);
});

test('未记录/已删除/缺哈希拒绝', () => {
  assert.equal(planOne('src/a.ts').length, 1);
  assert.throws(() => planOne('unrecorded.ts'), Error);
  assert.throws(() => planOne('old/c.ts'), Error);
  assert.throws(() => planOne('legacy.ts'), Error);
  const upper = src(ID1, { changes: [{ path: 'src/a.ts', kind: 'added', sha256: SHA.toUpperCase(), bytes: 1 }] });
  assert.throws(() => planOne('src/a.ts', upper), Error);
});

test('来源与路径重复拒绝', () => {
  const s = src(ID1);
  assert.throws(
    () => inputPlan([{ taskId: ID1, paths: ['src/a.ts'] }, { taskId: ID1, paths: ['docs/b.md'] }], lookup(s)),
    Error,
  );
  assert.throws(() => inputPlan([{ taskId: ID1, paths: ['src/a.ts', 'src/a.ts'] }], lookup(s)), Error);
});

test('数量上限', () => {
  const ids = [ID1, ID2, ID3, ID4, ID5];
  const lk5 = lookup(...ids.map((id): InputSource => broad(id, 1, 10)));
  const five = ids.map((id): InputSelection => ({ taskId: id, paths: ['f/0.ts'] }));
  assert.equal(inputPlan(five.slice(0, 4), lk5).length, 4);
  assert.throws(() => inputPlan(five, lk5), Error);
  const b11 = broad(ID1, 11, 10);
  assert.throws(() => inputPlan([{ taskId: ID1, paths: [] }], lookup(b11)), Error);
  assert.throws(() => inputPlan([{ taskId: ID1, paths: pathList(11) }], lookup(b11)), Error);
  const ten = pathList(10);
  const lk3 = lookup(broad(ID1, 10, 100), broad(ID2, 10, 100), broad(ID3, 10, 100));
  assert.equal(inputPlan([{ taskId: ID1, paths: ten }, { taskId: ID2, paths: ten }], lk3).length, 20);
  assert.throws(
    () => inputPlan([{ taskId: ID1, paths: ten }, { taskId: ID2, paths: ten }, { taskId: ID3, paths: ten }], lk3),
    Error,
  );
});

test('字节上限', () => {
  const bytesRun = (bytes: number): InputFile[] =>
    planOne('src/a.ts', src(ID1, { changes: [{ path: 'src/a.ts', kind: 'added', sha256: SHA, bytes }] }));
  assert.equal(bytesRun(0).length, 1);
  assert.equal(bytesRun(1000000).length, 1);
  assert.throws(() => bytesRun(1000001), Error);
  assert.throws(() => bytesRun(-1), Error);
  assert.throws(() => bytesRun(1.5), Error);
  assert.throws(() => bytesRun(Number.NaN), Error);
  const five = pathList(5);
  assert.equal(inputPlan([{ taskId: ID1, paths: five }], lookup(broad(ID1, 5, 800000))).length, 5);
  assert.throws(
    () =>
      inputPlan(
        [{ taskId: ID1, paths: five }, { taskId: ID2, paths: five }],
        lookup(broad(ID1, 5, 450000), broad(ID2, 5, 450000)),
      ),
    Error,
  );
});

test('确定性与不变更输入', () => {
  const selections: InputSelection[] = [{ taskId: ID1, paths: ['src/a.ts', 'docs/b.md'] }];
  const source = src(ID1);
  const selectionsClone = structuredClone(selections);
  const sourceClone = structuredClone(source);
  const first = inputPlan(selections, () => source);
  const second = inputPlan(selections, () => source);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.equal(first[0]?.mountedPath, `.helmdesk-inputs/${ID1}/src/a.ts`);
  assert.deepEqual(selections, selectionsClone);
  assert.deepEqual(source, sourceClone);
});
