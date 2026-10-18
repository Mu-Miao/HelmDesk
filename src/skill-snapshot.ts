import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import type { SkillSnapshot } from './capability-types.js';

export function safeResourcePath(path: string) {
  return !!path && !isAbsolute(path) && !path.includes('\\') && !path.includes('\0') && !path.split('/').some(part => !part || part === '.' || part === '..');
}
export function readSkillTree(source: string) {
  const root = realpathSync(source), files = new Map<string, Buffer>(); let bytes = 0;
  function walk(directory: string, prefix = '') {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name))) {
      const path = prefix + entry.name;
      if (!safeResourcePath(path) || /(^|\/)(\.env(?:\..*)?|.*\.(pem|key|p12)|id_rsa|credentials(?:\..*)?)$/i.test(path)) throw new Error('技能目录包含不安全路径或凭据文件');
      const full = join(directory, entry.name), stat = lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error('技能快照拒绝符号链接');
      if (stat.isDirectory()) { if (path.split('/').length > 12) throw new Error('技能目录层级过深'); walk(full, path + '/'); }
      else if (stat.isFile()) {
        if(stat.nlink>1) throw new Error('技能快照拒绝硬链接文件');
        if (stat.size > 512_000 || bytes + stat.size > 3_000_000 || files.size >= 300) throw new Error('技能快照超过大小限制');
        const content = readFileSync(full); bytes += content.length; files.set(path, content);
      } else throw new Error('技能目录包含非常规文件');
    }
  }
  walk(root);
  if (!files.has('SKILL.md')) throw new Error('缺少 SKILL.md');
  const hash = createHash('sha256');
  for (const [path, content] of files) { hash.update(JSON.stringify([path, content.length])); hash.update(content); }
  return { root, files, sha256: hash.digest('hex'), bytes };
}
export function snapshotSkill(id: string, source: string, version: string, destination: string, expected: string): SkillSnapshot {
  const tree = readSkillTree(source);
  if (tree.sha256 !== expected) throw new Error('技能来源已变化，请刷新目录后重新派活');
  mkdirSync(destination, {recursive:true,mode:0o700});
  for (const [path, content] of tree.files) { const target = join(destination,path); mkdirSync(dirname(target),{recursive:true,mode:0o700}); writeFileSync(target,content,{flag:'wx',mode:0o400}); }
  // chmod is supplemental; the executor sandbox separately denies all snapshot writes.
  function seal(directory: string) { for (const entry of readdirSync(directory,{withFileTypes:true})) if(entry.isDirectory()) seal(join(directory,entry.name)); chmodSync(directory,0o500); }
  seal(destination);
  return {id,source:tree.root,version,sha256:tree.sha256,fileCount:tree.files.size,bytes:tree.bytes,files:[...tree.files.keys()]};
}
