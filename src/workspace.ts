import { mkdirSync, readdirSync, lstatSync, readFileSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { runCommand } from './qoder.js';
import type { Task } from './types.js';
import { INPUT_DIRECTORY } from './input-types.js';
import { protectedProjectEntry } from './protected-paths.js';

const excluded = new Set(['.git', 'node_modules', '.helmdesk', '.env', '.aws', '.codex', '.qoder', 'dist', '.ds_store', INPUT_DIRECTORY]);
export const excludedProjectEntry=(name:string)=>excluded.has(name.toLowerCase())||name.toLowerCase().startsWith('.env')||protectedProjectEntry(name);
// Checkout may materialize tracked secrets. Remove excluded entries only inside our new task worktree.
function stripExcludedWorktreeEntries(root:string) {
  function walk(dir:string) {
    for(const item of readdirSync(dir,{withFileTypes:true})) {
      const full=join(dir,item.name);
      if(dir===root&&item.name==='.git')continue; // Keep host-owned worktree metadata; file tools deny it.
      if(excludedProjectEntry(item.name)){rmSync(full,{recursive:true,force:true});continue;}
      if(item.isDirectory())walk(full);
    }
  }
  walk(root);
}
export function inventory(root: string): Map<string, Buffer> {
  const result = new Map<string, Buffer>(); let total = 0;
  function walk(dir: string) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (excludedProjectEntry(item.name)) continue;
      const full = join(dir, item.name);
      if (item.isSymbolicLink()) throw new Error(`项目含符号链接，第一版拒绝复制：${relative(root, full)}`);
      if (item.isDirectory()) walk(full);
      else if (item.isFile()) {
        const size = lstatSync(full).size; total += size;
        if (size > 2_000_000 || total > 20_000_000 || result.size >= 2000) throw new Error('项目副本超过第一版限制（2000 文件、单文件 2MB、总量 20MB）');
        result.set(relative(root, full), readFileSync(full));
      }
    }
  }
  walk(root); return result;
}
export function pathAllowed(path: string, files: string[]) { return files.some(p => p.endsWith('/') ? path.startsWith(p) : path === p); }
export function validateScope(files: string[]) {
  for (const file of files) {
    if (!file || file.startsWith('/') || file.includes('\\') || file.split('/').some(p => p === '..' || p === '.' || excludedProjectEntry(p))) throw new Error('文件范围必须为明确的项目相对路径；目录以 / 结尾，禁止 ..、配置或凭据目录');
  }
}
const projectPreparations=new Map<string,Promise<void>>();
export async function prepareWorkspace(task: Task, dataDir: string) {
  const project=realpathSync(task.projectPath),previous=projectPreparations.get(project)??Promise.resolve();
  let release!:()=>void;
  const current=new Promise<void>(resolve=>{release=resolve;});
  projectPreparations.set(project,current);
  await previous;
  try{return await prepareWorkspaceUnlocked(task,dataDir);}
  finally {release();if(projectPreparations.get(project)===current)projectPreparations.delete(project);}
}
async function prepareWorkspaceUnlocked(task: Task, dataDir: string) {
  const project = realpathSync(task.projectPath);
  try { lstatSync(join(project,INPUT_DIRECTORY)); throw new Error('原项目包含保留的只读输入目录，拒绝覆盖'); }
  catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT') throw error; }
  const directory = join(dataDir, 'tasks', task.id);
  if (project === dataDir || dataDir.startsWith(project + sep) && !dataDir.startsWith(join(project, '.helmdesk') + sep) && dataDir !== join(project, '.helmdesk')) {
    throw new Error('项目与运行数据目录重叠；请使用独立数据目录');
  }
  const workspace = join(directory, 'workspace'); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const git = await runCommand('git', ['-C', project, 'rev-parse', '--show-toplevel']);
  let baseline: string, kind: 'worktree' | 'copy';
  if (git.code === 0) {
    if (realpathSync(git.stdout.trim()) !== project) throw new Error('Git 项目路径必须指向仓库根目录');
    const status = await runCommand('git', ['-C', project, 'status', '--porcelain']);
    if (status.code !== 0 || status.stdout.trim()) throw new Error('项目有未提交改动；已保护用户现场，请先提交或使用独立干净项目');
    const head = await runCommand('git', ['-C', project, 'rev-parse', 'HEAD']);
    if (head.code !== 0) throw new Error('项目尚无 Git 提交');
    baseline = head.stdout.trim();
    const result = await runCommand('git', ['-c', 'core.hooksPath=/dev/null', '-C', project, 'worktree', 'add', '--detach', workspace, baseline]);
    if (result.code !== 0) throw new Error(`无法建立独立 worktree：${result.stderr}`);
    stripExcludedWorktreeEntries(workspace);
    kind = 'worktree';
  } else {
    const before = inventory(project); mkdirSync(workspace, { recursive: true });
    const hash = createHash('sha256');
    for (const [path, bytes] of before) { const target = join(workspace, path); mkdirSync(resolve(target, '..'), { recursive: true }); writeFileSync(target, bytes); hash.update(path); hash.update(bytes); }
    baseline = `copy:sha256:${hash.digest('hex')}`; kind = 'copy';
  }
  const before = inventory(workspace);
  return { workspace, directory, baseline, workspaceKind: kind, before };
}
export function collectChanges(workspace: string, before: Map<string, Buffer>, scope: string[]) {
  const after = inventory(workspace); const changes: NonNullable<Task['changes']> = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(path), b = after.get(path);
    if (a && b && a.equals(b)) continue;
    if (!pathAllowed(path, scope)) throw new Error(`执行者修改了文件范围之外的路径：${path}`);
    let diff: string;
    if (a?.includes(0) || b?.includes(0)) diff = `Binary file ${path} changed`;
    else {
      const lines = (bytes?: Buffer) => { if (!bytes?.length) return []; const result = bytes.toString('utf8').split('\n'); if (result.at(-1) === '') result.pop(); return result; };
      const oldLines = lines(a), newLines = lines(b);
      const block = (items: string[], prefix: string, bytes?: Buffer) => items.map(line => prefix + line).join('\n') + (items.length ? '\n' : '') + (bytes?.length && bytes.at(-1) !== 10 ? '\\ No newline at end of file\n' : '');
      diff = `--- ${a ? `a/${path}` : '/dev/null'}\n+++ ${b ? `b/${path}` : '/dev/null'}\n@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@\n${block(oldLines, '-', a)}${block(newLines, '+', b)}`;
      if (diff.length > 160_000) diff = diff.slice(0, 160_000) + '\n[显示已截断；完整文件保留在独立工作目录]\n';
    }
    changes.push({ path, kind: !a ? 'added' : !b ? 'deleted' : 'modified', diff, ...(a?{beforeSha256:createHash('sha256').update(a).digest('hex'),beforeBytes:a.length}:{}), ...(b?{sha256:createHash('sha256').update(b).digest('hex'),bytes:b.length}:{}) });
  }
  return changes;
}
