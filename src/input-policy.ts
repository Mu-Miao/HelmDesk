import { INPUT_DIRECTORY } from './input-types.js';
import type { InputFile, InputSelection, InputSource } from './input-types.js';
import {protectedProjectEntry} from './protected-paths.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{64}$/;
const MAX_SOURCES = 4;
const MAX_PATHS = 10;
const MAX_FILES = 20;
const MAX_FILE_BYTES = 1000000;
const MAX_TOTAL_BYTES = 4000000;
const RESERVED_SEGMENTS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  '.helmdesk',
  '.helmdesk-inputs',
  '.aws',
  '.codex',
  '.agents',
  '.qoder',
  '.qoder-cn',
  '.qoderworkcn',
  '.ssh',
  'dist',
  '.DS_Store',
]);

function validatePath(path: string, taskId: string): void {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error(`路径无效: ${taskId}`);
  }
  for (let i = 0; i < path.length; i += 1) {
    const code = path.charCodeAt(i);
    if (code <= 31 || code === 127) {
      throw new Error(`路径含控制字符: ${taskId}`);
    }
  }
  if (path.includes('\\')) {
    throw new Error(`路径含反斜杠: ${path}`);
  }
  if (path.startsWith('/')) {
    throw new Error(`路径不能以斜杠开头: ${path}`);
  }
  if (path.endsWith('/')) {
    throw new Error(`路径不能以斜杠结尾: ${path}`);
  }
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new Error(`路径段非法: ${path}`);
    }
    if (RESERVED_SEGMENTS.has(segment) || segment.startsWith('.env') || protectedProjectEntry(segment)) {
      throw new Error(`路径保留段禁止: ${path}`);
    }
  }
}

export function inputPlan(selections: InputSelection[], lookup: (id: string) => InputSource): InputFile[] {
  if (!Array.isArray(selections)) {
    throw new Error('选择列表无效');
  }
  if (selections.length === 0) {
    return [];
  }
  if (selections.length > MAX_SOURCES) {
    throw new Error(`来源数量超过上限${MAX_SOURCES}`);
  }
  const usedSources = new Set<string>();
  const files: InputFile[] = [];
  let totalBytes = 0;
  for (const selection of selections) {
    if (!selection || typeof selection.taskId !== 'string' || !UUID_RE.test(selection.taskId)) {
      throw new Error('任务ID不是UUID');
    }
    const taskId = selection.taskId;
    if (usedSources.has(taskId)) {
      throw new Error(`来源重复: ${taskId}`);
    }
    usedSources.add(taskId);
    if (!Array.isArray(selection.paths) || selection.paths.length < 1 || selection.paths.length > MAX_PATHS) {
      throw new Error(`路径数量须在1..${MAX_PATHS}之间: ${taskId}`);
    }
    let source: InputSource | undefined;
    try {
      source = lookup(taskId);
    } catch {
      source = undefined;
    }
    if (!source) {
      throw new Error(`来源不存在: ${taskId}`);
    }
    if (source.id !== taskId) {
      throw new Error(`来源ID不匹配: ${taskId}`);
    }
    if (source.state !== 'completed') {
      throw new Error(`来源状态未完成: ${taskId}`);
    }
    if (source.acceptance !== 'accepted') {
      throw new Error(`来源未验收: ${taskId}`);
    }
    if (source.verification?.status !== 'passed') {
      throw new Error(`来源校验未通过: ${taskId}`);
    }
    const changes: NonNullable<InputSource['changes']> = Array.isArray(source.changes) ? source.changes : [];
    const usedPaths = new Set<string>();
    for (const path of selection.paths) {
      validatePath(path, taskId);
      if (usedPaths.has(path)) {
        throw new Error(`路径重复: ${path}`);
      }
      usedPaths.add(path);
      if (files.length >= MAX_FILES) {
        throw new Error(`文件总数超过上限${MAX_FILES}`);
      }
      const change = changes.find((item) => item.path === path && (item.kind === 'added' || item.kind === 'modified'));
      if (!change) {
        throw new Error(`路径未记录或已删除: ${path}`);
      }
      if (typeof change.sha256 !== 'string' || !SHA_RE.test(change.sha256)) {
        throw new Error(`缺少或非法哈希: ${path}`);
      }
      const bytes = change.bytes;
      if (typeof bytes !== 'number' || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > MAX_FILE_BYTES) {
        throw new Error(`字节数非法: ${path}`);
      }
      if (totalBytes + bytes > MAX_TOTAL_BYTES) {
        throw new Error(`总字节数超过上限${MAX_TOTAL_BYTES}`);
      }
      totalBytes += bytes;
      files.push({
        taskId,
        title: source.title,
        path,
        sha256: change.sha256,
        bytes,
        mountedPath: `${INPUT_DIRECTORY}/${taskId}/${path}`,
      });
    }
  }
  return files;
}
