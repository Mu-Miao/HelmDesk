import { createHash } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inventory } from './workspace.js';
import type { Task } from './types.js';

/** Review/classification timestamps do not change the delivery that was verified. */
export function deliveryVersion(task: Task) {
  return createHash('sha256').update(JSON.stringify({
    id: task.id, projectPath: task.projectPath, title: task.title, prompt: task.prompt,
    model: task.model, requestedModel: task.requestedModel, reportedModel: task.reportedModel,
    reasoningEffort: task.reasoningEffort, mode: task.mode, allowedFiles: task.allowedFiles,
    acceptanceCriteria: task.acceptanceCriteria, inputs: task.inputRun?.files,
    summary: task.summary, changes: task.changes ?? [],
  })).digest('hex');
}

export function assertDeliveryVersion(task:Task) {
  if (task.state !== 'completed' || task.verification?.status !== 'passed' || !task.verification.deliveryVersion) {
    throw new Error('交付缺少当前版本的宿主验证，请在 Mac 重新验证');
  }
  if(task.verification.deliveryVersion!==deliveryVersion(task))throw Error('交付已变化，预检已过期，请重新进行宿主验证');
}
export function assertVerifiedDelivery(task: Task, dataDirectory: string) {
  assertDeliveryVersion(task);
  if (task.mode === 'probe' && !task.changes?.length) return;
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(task.id))throw Error('交付编号无效');
  const expected = join(dataDirectory, 'tasks', task.id, 'workspace');
  if (!task.workspace || resolve(task.workspace) !== resolve(expected) ||
      !lstatSync(expected).isDirectory() || lstatSync(expected).isSymbolicLink() ||
      realpathSync(task.workspace) !== join(realpathSync(dataDirectory),'tasks',task.id,'workspace')) throw new Error('交付工作区身份无效');
  const files = inventory(expected);
  for (const change of task.changes ?? []) {
    const bytes = files.get(change.path);
    if (change.kind === 'deleted') {
      if (bytes) throw new Error('已删除交付文件重新出现，请在 Mac 重新验证');
    } else if (!bytes || !/^[a-f0-9]{64}$/.test(change.sha256 ?? '') ||
        change.bytes !== bytes.length || createHash('sha256').update(bytes).digest('hex') !== change.sha256) {
      throw new Error('交付文件已变化或缺少完整摘要，请在 Mac 重新验证');
    }
  }
  return files;
}
