import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { pathAllowed, excludedProjectEntry } from './workspace.js';
import { INPUT_DIRECTORY } from './input-types.js';

export const fileTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
export function toolDecision(name: string, input: Record<string, unknown>, cwd: string, allowedFiles: string[]): { allowed: boolean; reason: string } {
  if (!fileTools.includes(name)) return { allowed: false, reason: '当前只开放文件工具' };
  const path = input.file_path ?? input.path ?? cwd;
  if (typeof path !== 'string') return { allowed: false, reason: '工具路径无效' };
  const target = resolve(cwd, path), rel = relative(cwd, target).replaceAll('\\', '/');
  if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) return { allowed: false, reason: '只能访问任务工作副本内的文件' };
  if(rel.split('/').some(part=>part!==INPUT_DIRECTORY&&excludedProjectEntry(part)))return{allowed:false,reason:'禁止访问项目中排除的配置、凭据或构建目录'};
  if (['Write','Edit'].includes(name) && rel.split('/').includes(INPUT_DIRECTORY)) return {allowed:false,reason:'交付输入是只读快照，禁止修改'};
  let ancestor = target; while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
  const canonical = relative(realpathSync(cwd), realpathSync(ancestor));
  if (canonical === '..' || canonical.startsWith('../') || isAbsolute(canonical)) return { allowed: false, reason: '符号链接指向工作副本之外' };
  if (name === 'Glob' && typeof input.pattern === 'string' && (isAbsolute(input.pattern) || input.pattern.split('/').includes('..'))) return { allowed: false, reason: 'Glob 模式不能越过工作副本' };
  if (['Write', 'Edit'].includes(name) && !pathAllowed(rel, allowedFiles)) return { allowed: false, reason: '文件不在允许修改范围内' };
  return { allowed: true, reason: '任务文件白名单通过' };
}
