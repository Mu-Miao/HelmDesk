import {DatabaseSync, backup} from 'node:sqlite';
import {createHash, randomUUID} from 'node:crypto';
import {chmodSync,closeSync,constants,existsSync,fstatSync,lstatSync,mkdirSync,openSync,readFileSync,readdirSync,readSync,realpathSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

export const DATA_SCHEMA_VERSION=3;
const schema=`CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL,type TEXT NOT NULL,at TEXT NOT NULL,data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_task ON events(task_id,seq);
CREATE TABLE IF NOT EXISTS snapshots(kind TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS submission_receipts(key TEXT PRIMARY KEY,hash TEXT NOT NULL,task_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS task_dispositions(task_id TEXT PRIMARY KEY,data TEXT NOT NULL);`;
const version=(db:DatabaseSync)=>Number((db.prepare('PRAGMA user_version').get() as {user_version:number}).user_version);
const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
function databaseDigest(file:string) {
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=fstatSync(fd);if(!before.isFile()||before.nlink!==1)throw Error('备份数据库必须为普通单链接文件');
    const hash=createHash('sha256'),chunk=Buffer.alloc(1024*1024);let position=0;
    for(;;){const n=readSync(fd,chunk,0,chunk.length,position);if(!n)break;hash.update(chunk.subarray(0,n));position+=n;}
    const after=fstatSync(fd),current=lstatSync(file);
    if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||current.isSymbolicLink()||current.dev!==before.dev||current.ino!==before.ino||position!==before.size)throw Error('备份校验期间文件变化，请重试');
    return hash.digest('hex');
  } finally{closeSync(fd);}
}
function privateDirectory(path:string) {
  if(existsSync(path)&&(!lstatSync(path).isDirectory()||lstatSync(path).isSymbolicLink()))throw Error('备份目录必须为真实目录');
  mkdirSync(path,{recursive:true,mode:0o700});chmodSync(path,0o700);return path;
}
function healthy(db:DatabaseSync) {
  const rows=db.prepare('PRAGMA quick_check').all();
  if(rows.length!==1||Object.values(rows[0]??{})[0]!=='ok')throw Error('数据库完整性检查失败，已停止操作并保留原文件');
}
function validateTables(db:DatabaseSync,current:number) {
  const expected:Record<string,string[]>={tasks:['id','data'],events:['seq','task_id','type','at','data'],snapshots:['kind','data'],submission_receipts:['key','hash','task_id'],task_dispositions:['task_id','data']};
  for(const [table,columns]of Object.entries(expected)) {
    const actual=db.prepare(`PRAGMA table_info(${table})`).all();
    if((current===DATA_SCHEMA_VERSION||actual.length)&&columns.some(name=>!actual.some(column=>column.name===name)))throw Error('数据库结构不兼容或关键表缺失，已保留原文件');
  }
}
export function openDataDatabase(directory:string):DatabaseSync {
  const file=join(directory,'helmdesk.sqlite');
  if(existsSync(file)&&(!lstatSync(file).isFile()||lstatSync(file).isSymbolicLink()||lstatSync(file).nlink!==1||lstatSync(file).uid!==process.getuid?.()))throw Error('数据库必须是当前用户的普通单链接文件，不能是符号链接');
  const db=new DatabaseSync(file);
  try {
    const current=version(db);
    if(current>DATA_SCHEMA_VERSION)throw Error('数据库版本较新，当前应用不兼容；请使用对应的新版本，未降低数据版本');
    healthy(db);
    validateTables(db,current);
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    if(tables.length&&!tables.some(t=>t.name==='tasks'))throw Error('数据目录中的数据库格式不受支持');
    db.exec('PRAGMA busy_timeout=5000');
    if(current<DATA_SCHEMA_VERSION&&tables.length) {
      const folder=privateDirectory(join(directory,'schema-backups'));
      const target=join(folder,`before-v${current}-${randomUUID()}.sqlite`);
      // VACUUM INTO reads a consistent SQLite snapshot, including committed WAL rows.
      db.exec(`VACUUM INTO '${target.replaceAll("'","''")}'`);chmodSync(target,0o600);
    }
    db.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE');
    try {db.exec(schema+`PRAGMA user_version=${DATA_SCHEMA_VERSION}; COMMIT;`);}
    catch(error){db.exec('ROLLBACK');throw error;}
    chmodSync(file,0o600);
    return db;
  } catch(error) {db.close();throw error;}
}
export function inspectData(directory:string,db:DatabaseSync) {
  healthy(db);
  const records=db.prepare('SELECT id,data FROM tasks ORDER BY id').all() as {id:string;data:string}[];
  let missingWorkspaces=0;
  for(const row of records) {
    const task=JSON.parse(row.data);
    if(task.workspace&&(!existsSync(task.workspace)||!lstatSync(task.workspace).isDirectory()))missingWorkspaces++;
  }
  const events=Number((db.prepare('SELECT COUNT(*) AS n FROM events').get() as {n:number}).n);
  // Include every authoritative table, including independent history and receipts.
  const content=['tasks','events','snapshots','submission_receipts','task_dispositions'].map(table=>({table,rows:db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()}));
  return {schemaVersion:version(db),tasks:records.length,events,missingWorkspaces,recordDigest:digest(JSON.stringify(content)),dataDirectory:realpathSync(directory)};
}
export async function createDataBackup(directory:string,db:DatabaseSync) {
  const parent=privateDirectory(join(directory,'backups'));
  const name=`backup-${new Date().toISOString().replaceAll(/[:.]/g,'-')}-${randomUUID()}`;
  const target=privateDirectory(join(parent,name)),file=join(target,'helmdesk.sqlite');
  await backup(db,file);chmodSync(file,0o600);
  const copy=new DatabaseSync(file,{readOnly:true});
  try {
    const summary=inspectData(directory,copy),sha256=databaseDigest(file);
    const manifest={format:1,name,createdAt:new Date().toISOString(),sha256,...summary,scope:'SQLite records only; task workspaces remain in their original paths'};
    writeFileSync(join(target,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx'});
    return {name,sha256,tasks:summary.tasks,events:summary.events,missingWorkspaces:summary.missingWorkspaces};
  } finally {copy.close();}
}
export function verifyDataBackup(directory:string,name:string) {
  if(!/^backup-[A-Za-z0-9-]{20,100}$/.test(name))throw Error('备份名称无效');
  const parent=join(directory,'backups'),folder=join(parent,name),file=join(folder,'helmdesk.sqlite'),manifestFile=join(folder,'manifest.json');
  for(const path of [parent,folder,file,manifestFile])if(lstatSync(path).isSymbolicLink())throw Error('备份不能包含符号链接');
  if(!lstatSync(parent).isDirectory()||!lstatSync(folder).isDirectory()||!lstatSync(manifestFile).isFile()||lstatSync(manifestFile).nlink!==1||lstatSync(manifestFile).size>64000)throw Error('备份清单必须是有界普通文件');
  const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
  const sha256=databaseDigest(file);
  if(manifest.format!==1||manifest.name!==name||manifest.sha256!==sha256||manifest.schemaVersion!==DATA_SCHEMA_VERSION)throw Error('备份校验不匹配，不能用于恢复');
  const copy=new DatabaseSync(file,{readOnly:true});
  try {
    const summary=inspectData(directory,copy);
    if(summary.recordDigest!==manifest.recordDigest||summary.tasks!==manifest.tasks||summary.events!==manifest.events)throw Error('备份记录摘要不匹配');
    return {valid:true as const,tasks:summary.tasks,events:summary.events,sha256};
  } finally {copy.close();}
}

export function listDataBackups(directory:string) {
  const parent=join(directory,'backups');if(!existsSync(parent))return [];
  if(lstatSync(parent).isSymbolicLink()||!lstatSync(parent).isDirectory())throw Error('备份目录身份无效');
  return readdirSync(parent).filter(name=>/^backup-[A-Za-z0-9-]{20,100}$/.test(name)).sort().reverse().slice(0,20).flatMap(name=>{
    try {
      const folder=join(parent,name),file=join(folder,'manifest.json');
      if(lstatSync(folder).isSymbolicLink()||!lstatSync(folder).isDirectory()||lstatSync(file).isSymbolicLink()||!lstatSync(file).isFile()||lstatSync(file).nlink!==1||lstatSync(file).size>64000)return [];
      const value=JSON.parse(readFileSync(file,'utf8'));
      if(value.format!==1||value.name!==name||!/^[a-f0-9]{64}$/.test(value.sha256)||![value.tasks,value.events,value.missingWorkspaces].every(n=>Number.isSafeInteger(n)&&n>=0))return [];
      return [{name,sha256:value.sha256 as string,tasks:value.tasks as number,events:value.events as number,missingWorkspaces:value.missingWorkspaces as number}];
    }catch{return [];}
  });
}
