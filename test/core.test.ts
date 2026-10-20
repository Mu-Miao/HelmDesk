import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/store.js';
import { Scheduler } from '../src/scheduler.js';
import { safeJson } from '../src/redact.js';
import { submissionSchema } from '../src/schema.js';
import { collectChanges, inventory, prepareWorkspace, validateScope } from '../src/workspace.js';
import { runCommand } from '../src/qoder.js';
import type { Executor, Execution } from '../src/executor.js';
import type { Task, Submission } from '../src/types.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'helmdesk-test-')), data = join(root, 'data'), project = join(root, 'project');
  mkdirSync(data); mkdirSync(project); writeFileSync(join(project, 'input.txt'), 'original');
  const store = new Store(data);
  const submission: Submission = { title: 'fixture', prompt: 'create result.txt', projectPath: project, allowedFiles: ['result.txt'], acceptanceCriteria: ['result.txt exists'], dependencies: [], model: 'Auto', mode: 'files', timeoutSeconds: 10 };
  return { root, data, project, store, submission, close() { store.close(); rmSync(root, { recursive: true, force: true }); } };
}
class Fake implements Executor {
  starts = 0; cancelled = 0;
  constructor(readonly action: 'success' | 'slow' | 'missing' | 'permission' = 'success') {}
  async verify() { return { verified: true, source: 'test-fixture-only' }; }
  start(task: Task, event: (type: string, data: any) => void): Execution {
    this.starts++;
    let timer: NodeJS.Timeout, resolve: (value: { code: number | null }) => void;
    const finished = new Promise<{ code: number | null }>(r => { resolve = r; timer = setTimeout(() => {
      if (this.action === 'success') { writeFileSync(join(task.workspace!, 'result.txt'), 'verified\n'); event('result', { subtype: 'success', is_error: false, result: 'done', total_credits: 0.25, usage: { input_tokens: 0, output_tokens: 0 }, permission_denials: [] }); }
      if (this.action === 'permission') event('result', { result: 'denied', total_credits: 0.1, permission_denials: [{ tool_name: 'Write' }] });
      resolve({ code: 0 });
    }, this.action === 'slow' ? 10000 : 5); });
    return { finished, cancel: () => { this.cancelled++; clearTimeout(timer); resolve({ code: null }); } };
  }
}
test('redacts credentials and authentication URLs without corrupting real usage fields', () => {
  const value = JSON.parse(safeJson({ access_token: 'secret-value', inputTokens: 12, output_tokens: 0, tokenNote: 'note', url: 'https://site.test/oauth?code=private&state=private', message: 'Authorization: Bearer abcxyz', nested: { apiKey: 'secret' } }));
  assert.equal(value.access_token, '[REDACTED]'); assert.equal(value.inputTokens, 12); assert.equal(value.output_tokens, 0); assert.equal(value.tokenNote, 'note');
  assert.equal(value.url, 'https://site.test/oauth'); assert.ok(!JSON.stringify(value).includes('secret-value')); assert.ok(!JSON.stringify(value).includes('abcxyz')); assert.equal(value.nested.apiKey, '[REDACTED]');
});
test('scope and schema reject traversal and unsupported task flags', () => {
  for (const path of ['../bad', '/absolute', '.codex/config', 'a/../bad', '.env', 'a\\b']) assert.throws(() => validateScope([path]));
  validateScope(['src/', 'result.txt']); assert.throws(() => submissionSchema.parse({ maxTurns: 5 }));
});
test('copy inventory rejects symbolic links rather than following them', () => {
  const f = fixture(); try { symlinkSync('/etc/passwd', join(f.project, 'escape')); assert.throws(() => inventory(f.project), /符号链接/); } finally { f.close(); }
});
test('queue completes in an independent copy and records usage exactly once', async () => {
  const f = fixture(), fake = new Fake(), s = new Scheduler(f.store, fake, [f.project]);
  try {
    const task = s.submit(f.submission); const result = await s.wait(task.id, 0, 3000);
    assert.equal(result.task.state, 'completed'); assert.equal(result.task.acceptance, 'pending'); assert.equal(result.task.usage?.taskCredits, 0.25);
    assert.equal(readFileSync(join(f.project, 'input.txt'), 'utf8'), 'original'); assert.equal(existsSync(join(f.project, 'result.txt')), false);
    assert.equal(result.task.changes?.[0]?.path, 'result.txt');
    const first = f.store.events(0, task.id); const cursor = first.at(-1)!.seq; assert.equal(f.store.events(cursor, task.id).length, 0);
    assert.throws(()=>s.review(task.id,'accepted','missing evidence'),/宿主验证/);
    s.verifyTask(task.id,{status:'passed',command:'host fixture assertions',evidence:'output bytes and original project checked'});
    s.review(task.id, 'accepted', 'Content verified'); assert.equal(f.store.get(task.id).acceptance, 'accepted');
  } finally { s.stop(); f.close(); }
});
test('dependent task waits for acceptance, and concurrency is one', async () => {
  const f = fixture(), fake = new Fake(), s = new Scheduler(f.store, fake, [f.project]);
  try {
    const first = s.submit(f.submission), second = s.submit({ ...f.submission, dependencies: [first.id] });
    await s.wait(first.id, 0, 3000); assert.equal(fake.starts, 1); assert.equal(f.store.get(second.id).state, 'queued');
    s.verifyTask(first.id,{status:'passed',command:'fixture assertions',evidence:'checked'});
    s.review(first.id, 'accepted', 'verified'); const result = await s.wait(second.id, 0, 3000); assert.equal(result.task.state, 'completed'); assert.equal(fake.starts, 2);
  } finally { s.stop(); f.close(); }
});
test('cancel terminates the owned execution and never overwrites cancelled state', async () => {
  const f = fixture(), fake = new Fake('slow'), s = new Scheduler(f.store, fake, [f.project]);
  try {
    const task = s.submit(f.submission); while (f.store.get(task.id).state !== 'running') await new Promise(r => setTimeout(r, 5));
    assert.equal(s.cancel(task.id).state, 'cancelled'); await new Promise(r => setTimeout(r, 20)); assert.equal(fake.cancelled, 1); assert.equal(f.store.get(task.id).state, 'cancelled');
  } finally { s.stop(); f.close(); }
});
test('permission denials retain usage and enter waiting_user', async () => {
  const f = fixture(), s = new Scheduler(f.store, new Fake('permission'), [f.project]);
  try { const task = s.submit(f.submission); const result = await s.wait(task.id, 0, 3000); assert.equal(result.task.state, 'waiting_user'); assert.equal(result.task.usage?.taskCredits, 0.1); }
  finally { s.stop(); f.close(); }
});
test('source provenance mismatch prevents completion and acceptance while preserving real usage',async()=>{
  const f=fixture(),fake=new Fake();
  const executor:Executor={verify:()=>fake.verify(),start:(task,event)=>fake.start(task,event),async finalize(){return {capabilityRun:{skills:[],tools:[],sourceChecks:[{id:'guide',before:'a',after:'b',unchanged:false}]}};}};
  const scheduler=new Scheduler(f.store,executor,[f.project]);
  try {const task=scheduler.submit(f.submission),result=await scheduler.wait(task.id,0,3000);assert.equal(result.task.state,'failed');assert.match(result.task.error!,/来源摘要/);assert.equal(result.task.usage?.taskCredits,.25);assert.throws(()=>scheduler.review(task.id,'accepted','Must not accept'),/仅执行完成/);}
  finally {scheduler.stop();f.close();}
});
test('verification evidence is separate from execution and acceptance; failed checks block acceptance', async () => {
  const f = fixture(), s = new Scheduler(f.store, new Fake(), [f.project]);
  try {
    const task = s.submit(f.submission); await s.wait(task.id, 0, 3000);
    const failed = s.verifyTask(task.id, { status: 'failed', command: 'fixture check', evidence: 'assertion failed' });
    assert.equal(failed.state, 'completed'); assert.equal(failed.acceptance, 'changes_requested'); assert.throws(() => s.review(task.id, 'accepted', 'bad'), /验证失败/);
    s.verifyTask(task.id, { status: 'passed', command: 'fixture check', evidence: 'assertions passed' }); s.review(task.id, 'accepted', 'reviewed');
    assert.equal(f.store.get(task.id).verification?.status, 'passed'); assert.equal(f.store.get(task.id).acceptance, 'accepted');
  } finally { s.stop(); f.close(); }
});
test('zero exit without a structured result is a failure', async () => {
  const f = fixture(), s = new Scheduler(f.store, new Fake('missing'), [f.project]);
  try { const task = s.submit(f.submission); assert.equal((await s.wait(task.id, 0, 3000)).task.state, 'failed'); } finally { s.stop(); f.close(); }
});
test('recovery never automatically replays an uncertain running task', () => {
  const f = fixture(); try { const task = f.store.create(f.submission); f.store.patch(task.id, { state: 'running', pid: 123 }); f.store.recover(); assert.equal(f.store.get(task.id).state, 'waiting_user'); assert.equal(f.store.get(task.id).failureKind, 'interrupted'); } finally { f.close(); }
});
test('task project must be inside a configured root', () => {
  const f = fixture(), s = new Scheduler(f.store, new Fake(), [join(f.root, 'elsewhere')]);
  try { assert.throws(() => s.submit(f.submission), /根目录/); } finally { s.stop(); f.close(); }
});
test('dirty Git project is refused; clean project uses detached worktree', async () => {
  const f = fixture();
  try {
    await runCommand('git', ['-C', f.project, 'init', '-q']); await runCommand('git', ['-C', f.project, 'add', '.']);
    const commit = await runCommand('git', ['-C', f.project, '-c', 'user.name=HelmDesk Test', '-c', 'user.email=test@localhost', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture']); assert.equal(commit.code, 0);
    writeFileSync(join(f.project, 'input.txt'), 'unsaved'); const dirty = f.store.create(f.submission); await assert.rejects(prepareWorkspace(dirty, f.data), /未提交/);
    writeFileSync(join(f.project, 'input.txt'), 'original'); const clean = f.store.create(f.submission); const prepared = await prepareWorkspace(clean, f.data); assert.equal(prepared.workspaceKind, 'worktree');
    writeFileSync(join(prepared.workspace, 'result.txt'), 'new'); assert.equal(collectChanges(prepared.workspace, prepared.before, ['result.txt']).length, 1); assert.equal(existsSync(join(f.project, 'result.txt')), false);
    writeFileSync(join(prepared.workspace, 'input.txt'), 'bad'); assert.throws(() => collectChanges(prepared.workspace, prepared.before, ['result.txt']), /范围之外/);
  } finally { f.close(); }
});
