import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import type { Task, Submission, TaskEvent } from './types.js';
import { safeJson } from './redact.js';
export interface SubmissionReceipt {key:string;hash:string}

export class Store extends EventEmitter {
  readonly db: DatabaseSync;
  constructor(readonly directory: string) {
    super();
    this.db = new DatabaseSync(join(directory, 'helmdesk.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL, type TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_task ON events(task_id,seq);
      CREATE TABLE IF NOT EXISTS snapshots (kind TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS submission_receipts (key TEXT PRIMARY KEY, hash TEXT NOT NULL, task_id TEXT NOT NULL);
      PRAGMA user_version=2;`);
  }
  list(): Task[] { return (this.db.prepare('SELECT data FROM tasks ORDER BY rowid DESC').all() as { data: string }[]).map(r => JSON.parse(r.data)); }
  get(id: string): Task {
    const row = this.db.prepare('SELECT data FROM tasks WHERE id=?').get(id) as { data: string } | undefined;
    if (!row) throw new Error('任务不存在');
    return JSON.parse(row.data);
  }
  requestTask(key:string,hash:string):Task|null {
    const row=this.db.prepare('SELECT hash,task_id FROM submission_receipts WHERE key=?').get(key) as {hash:string;task_id:string}|undefined;
    if(!row)return null;
    if(row.hash!==hash)throw new Error('请求编号已用于不同的派发内容，请使用新的请求编号');
    return this.get(row.task_id);
  }
  create(input: Submission,receipt?:SubmissionReceipt): Task {
    const now = new Date().toISOString();
    const task: Task = { ...input, id: randomUUID(), state: 'queued', acceptance: 'pending', requestedModel: input.model, createdAt: now, updatedAt: now,executionRequested:false };
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous=receipt?this.requestTask(receipt.key,receipt.hash):null;
      if(previous){this.db.exec('COMMIT');return previous;}
      this.db.prepare('INSERT INTO tasks(id,data) VALUES(?,?)').run(task.id, safeJson(task));
      if(receipt)this.db.prepare('INSERT INTO submission_receipts(key,hash,task_id) VALUES(?,?,?)').run(receipt.key,receipt.hash,task.id);
      this.insertEvent(task.id, 'state', { state: 'queued' }); this.db.exec('COMMIT');
    }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.emit('change'); return this.get(task.id);
  }
  patch(id: string, patch: Partial<Task>): Task {
    const task = { ...this.get(id), ...patch, updatedAt: new Date().toISOString() };
    this.db.exec('BEGIN IMMEDIATE');
    try { this.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(safeJson(task), id); this.insertEvent(id, patch.state ? 'state' : 'update', patch); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.emit('change'); return this.get(id);
  }
  private insertEvent(taskId: string, type: string, data: unknown) { this.db.prepare('INSERT INTO events(task_id,type,at,data) VALUES(?,?,?,?)').run(taskId, type, new Date().toISOString(), safeJson(data)); }
  event(taskId: string, type: string, data: unknown) { this.insertEvent(taskId, type, data); this.emit('change'); }
  events(after = 0, taskId?: string, limit = 200): TaskEvent[] {
    const query = taskId ? this.db.prepare('SELECT * FROM events WHERE task_id=? AND seq>? ORDER BY seq LIMIT ?').all(taskId, after, limit) : this.db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT ?').all(after, limit);
    return (query as { seq: number; task_id: string; type: string; at: string; data: string }[]).map(row => ({ seq: row.seq, taskId: row.task_id, type: row.type, at: row.at, data: JSON.parse(row.data) }));
  }
  latestSequence(): number { return Number((this.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM events').get() as { seq: number }).seq); }
  snapshot(kind: string, value?: unknown): unknown {
    if (value !== undefined) { this.db.prepare('INSERT INTO snapshots(kind,data) VALUES(?,?) ON CONFLICT(kind) DO UPDATE SET data=excluded.data').run(kind, safeJson(value)); this.emit('change'); }
    const row = this.db.prepare('SELECT data FROM snapshots WHERE kind=?').get(kind) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : null;
  }
  recover() {
    for (const task of this.list()) if (['running', 'preparing'].includes(task.state)) this.patch(task.id, { state: 'waiting_user', failureKind: 'interrupted', error: '服务上次异常中断；进程与会话存活未确认，任务不会自动重跑。请先核实现场后取消或创建新任务。' });
  }
  close() { this.db.close(); }
}
