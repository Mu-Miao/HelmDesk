import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DATA_SCHEMA_VERSION, createDataBackup, inspectData, openDataDatabase, verifyDataBackup } from '../src/data-maintenance.js';

function directory(label: string, t: { after(hook: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), `helmdesk-data-${label}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const version = (db: DatabaseSync) => Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
const count = (db: DatabaseSync, sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
const taskData = (db: DatabaseSync, id: string) => JSON.parse(String((db.prepare('SELECT data FROM tasks WHERE id=?').get(id) as { data: string }).data));
const digest = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
function insertTask(db: DatabaseSync, id: string, extra: Record<string, unknown> = {}) {
  db.prepare('INSERT INTO tasks(id,data) VALUES(?,?)').run(id, JSON.stringify({ id, state: 'queued', ...extra }));
}
function insertEvent(db: DatabaseSync, id: string, type: string) {
  db.prepare('INSERT INTO events(task_id,type,at,data) VALUES(?,?,?,?)').run(id, type, new Date().toISOString(), JSON.stringify({ type }));
}
function legacyDatabase(dir: string, userVersion: number) {
  const db = new DatabaseSync(join(dir, 'helmdesk.sqlite'));
  db.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, type TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL);
    PRAGMA user_version=${userVersion};`);
  return db;
}
async function rejected(label: string, run: () => unknown) {
  const outcome = await Promise.resolve().then(run).then(() => null, (error: unknown) => error);
  assert.ok(outcome instanceof Error, `${label} 应当被拒绝`);
}

test('opens an empty database on the current schema and backs it up', async t => {
  const dir = directory('fresh', t), db = openDataDatabase(dir);
  t.after(() => db.close());
  assert.equal(DATA_SCHEMA_VERSION, 3);
  assert.equal(version(db), 3);
  const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map(row => row.name);
  for (const table of ['tasks', 'events', 'snapshots', 'submission_receipts', 'task_dispositions']) assert.ok(tables.includes(table), `缺少数据表 ${table}`);
  assert.equal((db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode, 'wal');
  const info = inspectData(dir, db);
  assert.equal(info.schemaVersion, 3);
  assert.equal(info.tasks, 0); assert.equal(info.events, 0); assert.equal(info.missingWorkspaces, 0);
  assert.equal(typeof info.recordDigest, 'string'); assert.ok(info.recordDigest.length > 0);
  const backup = await createDataBackup(dir, db);
  const root = join(dir, 'backups', backup.name), files = readdirSync(root);
  assert.ok(files.includes('helmdesk.sqlite') && files.includes('manifest.json'), '备份目录须包含数据库与清单');
  assert.equal(JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')).schemaVersion, 3);
  assert.equal(backup.sha256, digest(join(root, 'helmdesk.sqlite')));
  const verified = await verifyDataBackup(dir, backup.name);
  assert.equal(verified.valid, true);
  assert.equal(verified.tasks, 0); assert.equal(verified.events, 0); assert.equal(verified.sha256, backup.sha256);
});

test('backup keeps records and events written to an uncheckpointed WAL', async t => {
  const dir = directory('wal', t), db = openDataDatabase(dir);
  t.after(() => db.close());
  insertTask(db, 'task-1', { state: 'running', workspace: dir });
  insertTask(db, 'task-2', { state: 'queued', workspace: join(dir, 'missing-workspace') });
  insertEvent(db, 'task-1', 'state'); insertEvent(db, 'task-1', 'output');
  assert.ok(existsSync(join(dir, 'helmdesk.sqlite-wal')), '应当存在尚未合并的写入日志');
  const info = inspectData(dir, db);
  assert.equal(info.tasks, 2); assert.equal(info.events, 2); assert.equal(info.missingWorkspaces, 1);
  const backup = await createDataBackup(dir, db);
  assert.equal(backup.tasks, 2); assert.equal(backup.events, 2); assert.equal(backup.missingWorkspaces, 1);
  const verified = await verifyDataBackup(dir, backup.name);
  assert.equal(verified.valid, true); assert.equal(verified.tasks, 2); assert.equal(verified.events, 2);
  assert.equal(verified.sha256, backup.sha256);
  const copy = new DatabaseSync(join(dir, 'backups', backup.name, 'helmdesk.sqlite'));
  t.after(() => copy.close());
  assert.equal(version(copy), 3);
  assert.equal(count(copy, 'SELECT COUNT(*) AS n FROM tasks'), 2);
  assert.equal(count(copy, `SELECT COUNT(*) AS n FROM events WHERE type='output'`), 1);
  assert.equal(taskData(copy, 'task-1').state, 'running');
  assert.equal(taskData(copy, 'task-2').workspace, join(dir, 'missing-workspace'));
});

test('refuses a database written by a newer version and leaves it untouched', async t => {
  const dir = directory('future', t);
  const future = legacyDatabase(dir, 7);
  insertTask(future, 'task-9', { state: 'running' });
  future.close();
  const before = readFileSync(join(dir, 'helmdesk.sqlite'));
  assert.throws(() => openDataDatabase(dir));
  assert.ok(readFileSync(join(dir, 'helmdesk.sqlite')).equals(before), '拒绝新版本时不得改写原数据库');
  const db = new DatabaseSync(join(dir, 'helmdesk.sqlite'));
  t.after(() => db.close());
  assert.equal(version(db), 7);
  assert.equal(taskData(db, 'task-9').state, 'running');
});

test('upgrades a legacy version 1 database behind a private backup', async t => {
  const dir = directory('legacy', t);
  const legacy = legacyDatabase(dir, 1);
  insertTask(legacy, 'task-1', { state: 'waiting_user', workspace: dir });
  insertEvent(legacy, 'task-1', 'state');
  legacy.close();
  const db = openDataDatabase(dir);
  t.after(() => db.close());
  assert.equal(version(db), 3);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM tasks'), 1);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM events'), 1);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM snapshots'), 0);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM submission_receipts'), 0);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM task_dispositions'), 0);
  assert.equal(taskData(db, 'task-1').state, 'waiting_user');
  assert.ok(existsSync(join(dir, 'schema-backups')), '升级前须先留下私有备份');
  assert.ok(readdirSync(join(dir, 'schema-backups')).length >= 1, '升级备份不得为空');
  const info = inspectData(dir, db);
  assert.equal(info.schemaVersion, 3); assert.equal(info.tasks, 1); assert.equal(info.events, 1);
  const backup = await createDataBackup(dir, db);
  const verified = await verifyDataBackup(dir, backup.name);
  assert.equal(verified.valid, true); assert.equal(verified.tasks, 1); assert.equal(verified.events, 1);
});

test('verification rejects malformed names, traversal and symlinks', async t => {
  const dir = directory('names', t), db = openDataDatabase(dir);
  t.after(() => db.close());
  insertTask(db, 'task-1');
  const backup = await createDataBackup(dir, db);
  const names = ['', '.', '..', '../escape', `../${backup.name}`, `${backup.name}/manifest.json`, 'missing-backup', backup.name + '.'];
  for (const name of names) await rejected(`备份名称 ${JSON.stringify(name)}`, () => verifyDataBackup(dir, name));
  symlinkSync(join(dir, 'backups', backup.name), join(dir, 'backups', 'linked'));
  await rejected('符号链接备份目录', () => verifyDataBackup(dir, 'linked'));
  mkdirSync(join(dir, 'backups', 'partial'));
  symlinkSync(join(dir, 'backups', backup.name, 'helmdesk.sqlite'), join(dir, 'backups', 'partial', 'helmdesk.sqlite'));
  writeFileSync(join(dir, 'backups', 'partial', 'manifest.json'), readFileSync(join(dir, 'backups', backup.name, 'manifest.json')));
  await rejected('符号链接数据库文件', () => verifyDataBackup(dir, 'partial'));
});

test('verification rejects tampered database bytes and manifest digest', async t => {
  const dir = directory('tamper', t), db = openDataDatabase(dir);
  t.after(() => db.close());
  insertTask(db, 'task-1', { state: 'done' });
  insertEvent(db, 'task-1', 'state');
  const first = await createDataBackup(dir, db);
  const file = join(dir, 'backups', first.name, 'helmdesk.sqlite');
  writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from('tampered')]));
  await rejected('被改动的数据库字节', () => verifyDataBackup(dir, first.name));
  const second = await createDataBackup(dir, db);
  const manifestPath = join(dir, 'backups', second.name, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.sha256, second.sha256, '清单摘要须与备份返回值一致');
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, sha256: 'f'.repeat(64) }));
  await rejected('被改动的清单摘要', () => verifyDataBackup(dir, second.name));
});

test('missing current-schema tables and hard-linked database files are rejected without rewriting them',t=>{
  const dir=directory('shape',t),partial=legacyDatabase(dir,3);partial.close();
  const original=readFileSync(join(dir,'helmdesk.sqlite'));
  assert.throws(()=>openDataDatabase(dir),/关键表缺失/);
  assert.deepEqual(readFileSync(join(dir,'helmdesk.sqlite')),original);
  linkSync(join(dir,'helmdesk.sqlite'),join(dir,'alias.sqlite'));
  assert.throws(()=>openDataDatabase(dir),/单链接/);
});

test('a correctly named backup with a symlinked manifest is rejected before following it',async t=>{
  const dir=directory('manifest-link',t),db=openDataDatabase(dir);t.after(()=>db.close());
  const backup=await createDataBackup(dir,db),manifest=join(dir,'backups',backup.name,'manifest.json'),external=join(dir,'external.json');
  writeFileSync(external,readFileSync(manifest));unlinkSync(manifest);symlinkSync(external,manifest);
  assert.throws(()=>verifyDataBackup(dir,backup.name),/符号链接/);
});
