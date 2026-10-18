import type { Task } from './types.js';
import type { DeliveryReport } from './report-types.js';

const TERMINAL_STATES: Task['state'][] = ['completed', 'failed', 'cancelled'];

const STATE_LABELS: Record<Task['state'], string> = {
  queued: '排队中',
  preparing: '准备中',
  running: '运行中',
  waiting_user: '等待用户',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const ACCEPTANCE_LABELS: Record<Task['acceptance'], string> = {
  pending: '待验收',
  accepted: '已验收',
  changes_requested: '要求修改',
};

const VERIFICATION_LABELS: Record<'passed' | 'failed' | 'not_run', string> = {
  passed: '通过',
  failed: '失败',
  not_run: '未运行',
};

const BINARY_PREFIX = 'Binary file ';

function isIncompleteDiff(diff: string): boolean {
  return diff.startsWith(BINARY_PREFIX) || diff.includes('显示已截断');
}

function sanitizeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '_');
}

function longestBacktickRun(text: string): number {
  let max = 0;
  for (const match of text.matchAll(/`+/g)) {
    if (match[0].length > max) max = match[0].length;
  }
  return max;
}

function fence(untrusted: string): string {
  const marker = '`'.repeat(Math.max(3, longestBacktickRun(untrusted) + 1));
  const body = untrusted.replace(/[ \t\r\n]+$/, '');
  return `${marker}text\n${body}\n${marker}`;
}

function valueOrUnknown(value: string | null | undefined): string {
  return value === undefined || value === null || value === '' ? '未记录' : value;
}

function numberOrUnknown(value: number | null | undefined): string {
  if (value === undefined || value === null) return '未知（null）';
  return String(value);
}

export function deliveryReport(task: Task): DeliveryReport {
  if (!TERMINAL_STATES.includes(task.state)) {
    throw new Error(
      `deliveryReport 只能为已结束的任务生成报告，当前状态：${task.state}；允许的状态：${TERMINAL_STATES.join('、')}`,
    );
  }

  const filename = `helm-${sanitizeId(task.id)}.md`;

  const changes = (task.changes ?? []).map((change) => ({
    path: change.path,
    kind: change.kind,
    diff: change.diff,
    incomplete: isIncompleteDiff(change.diff),
  }));

  const record = {
    agent:task.agent??'qoder-cn',maxTurns:task.maxTurns??null,
    id: task.id,
    title: task.title,
    state: task.state,
    acceptance: task.acceptance,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    requestedModel: task.requestedModel,
    reasoningEffort:task.reasoningEffort??null,
    reasoningRun:task.reasoningRun?{effort:task.reasoningRun.effort,model:task.reasoningRun.model,label:task.reasoningRun.label,supportedEfforts:[...task.reasoningRun.supportedEfforts],source:task.reasoningRun.source}:null,
    reportedModel: task.reportedModel ?? null,
    revision:task.revision?{sourceTaskId:task.revision.sourceTaskId,rootTaskId:task.revision.rootTaskId}:null,
    summary: task.summary ?? null,
    error: task.error ?? null,
    reviewNote: task.reviewNote ?? null,
    ...(task.disposition?{disposition:{...task.disposition}}:{}),
    verification: task.verification
      ? {
          status: task.verification.status,
          command: task.verification.command,
          evidence: task.verification.evidence,
          recordedAt: task.verification.recordedAt,
        }
      : null,
    usage: task.usage
      ? {
          taskCredits: task.usage.taskCredits ?? null,
          sessionCredits: task.usage.sessionCredits ?? null,
          inputTokens: task.usage.inputTokens ?? null,
          outputTokens: task.usage.outputTokens ?? null,
          usd: task.usage.usd ?? null,
          tokenNote: task.usage.tokenNote ?? '',
          source: task.usage.source ?? '',
        }
      : null,
    dependencies: [...task.dependencies],
    inputs: task.inputRun ? {
      files:task.inputRun.files.map(f=>({taskId:f.taskId,title:f.title,path:f.path,sha256:f.sha256,bytes:f.bytes,mountedPath:f.mountedPath})),
      isolationVerified:task.inputRun.isolationVerified,integrity:task.inputRun.integrity,
      ...(task.inputRun.error?{error:task.inputRun.error}:{})
    } : null,
    acceptanceCriteria: [...task.acceptanceCriteria],
    changes,
  };

  const hasIncomplete = changes.some((change) => change.incomplete);

  const limitations = [
    '本报告只是已保存记录（历史证据）的存档，不代表任何实时状态；原始完整文件仍保留在隔离工作区中，本报告不包含、不复制这些原始文件。',
    '本报告不提供可应用补丁（patch），不会尝试生成可合并的改动，也不会读取隔离工作区或原项目中的文件。',
    '执行、验证与验收是相互独立的三个环节：任务状态为已完成、或验证记录显示通过，都不等于验收通过；验收仍需人工单独判定。',
    '不会发生任何合并操作，也不会对原项目、原分支或原工作目录做任何写入。',
    '记录中的差异可能不完整：被截断的差异、以及二进制文件的差异，只是记录下来的片段，无法证明完整的变更范围。',
    '模型与用量信息按记录原样呈现，0 与 null（未知）都予以保留；未对任务级用量与会话级用量做任何求和、换算或推断。',
    '所有来自任务记录的文本（标题、路径、摘要、证据等）均视为不可信内容，已放入代码块中，避免被渲染为 HTML 或 Markdown。',
  ];

  if (hasIncomplete) {
    limitations.push('警告：本次记录中存在不完整差异（被截断的差异或二进制文件差异），无法据此证明完整的变更范围。');
  }

  const sections: string[] = [];
  const push = (text: string) => sections.push(text, '');

  push('# 交付报告');
  push(fence([
    `任务编号：${record.id}`,
    `报告文件名：${filename}`,
    `任务状态：${record.state}（${STATE_LABELS[record.state]}）`,
  ].join('\n')));

  push('## 状态');
  push(fence([
    `执行状态：${record.state}（${STATE_LABELS[record.state]}）`,
    `验收状态：${record.acceptance}（${ACCEPTANCE_LABELS[record.acceptance]}）`,
    `创建时间：${record.createdAt}`,
    `更新时间：${record.updatedAt}`,
    `报告文件名：${filename}`,
  ].join('\n')));

  push('## 标题');
  push(fence(record.title));

  push('## 模型');
  push(fence([
    `执行器：${record.agent}`,
    `最大轮数：${record.maxTurns??'未设置'}`,
    `请求模型：${record.requestedModel}`,
    `上报模型：${record.reportedModel ?? '未记录（null）'}`,
  ].join('\n')));

  push('## 验证');
  push(
    record.verification
      ? fence([
          `验证结果：${record.verification.status}（${VERIFICATION_LABELS[record.verification.status]}）`,
          `验证命令：${record.verification.command}`,
          `验证证据：${record.verification.evidence}`,
          `记录时间：${record.verification.recordedAt}`,
        ].join('\n'))
      : fence('未记录验证。'),
  );
  push('验证结果由记录得出，与验收结论相互独立，不构成验收通过。');

  push('## 评审');
  push(fence(valueOrUnknown(record.reviewNote)));
  push(`验收状态仍为：${record.acceptance}（${ACCEPTANCE_LABELS[record.acceptance]}），未做任何变更。`);

  if(record.disposition){
    push('## 历史处理结论');
    push('处理结论独立于执行、验证与验收；原始状态和错误保留。');
    push(fence([`历史处理：${({resolved:'已解决',expected_failure:'预期失败',deferred:'暂缓处理'})[record.disposition.status]}`,`原因：${record.disposition.reason}`,`记录时间：${record.disposition.recordedAt}`,...(record.disposition.replacementTaskId?[`后续替代任务：${record.disposition.replacementTaskId}`]:[])].join('\n')));
  }
  push('## 摘要');
  push(fence(valueOrUnknown(record.summary)));

  if (record.error !== null) {
    push('## 错误信息');
    push(fence(record.error));
  }

  push('## 验收标准与依赖');
  push(fence([
    '验收标准：',
    ...record.acceptanceCriteria.map((item, index) => `${index + 1}. ${item}`),
    '依赖项：',
    ...(record.dependencies.length ? record.dependencies.map((item, index) => `${index + 1}. ${item}`) : ['（无）']),
  ].join('\n')));

  if(record.inputs){push('## 只读交付输入');push(fence(JSON.stringify(record.inputs,null,2)));}
  if(record.revision){push('## 修订来源');push(fence(JSON.stringify(record.revision,null,2)));}
  if(record.reasoningEffort){push('## 推理强度');push(fence(JSON.stringify({requested:record.reasoningEffort,cliPolicy:record.reasoningRun},null,2)));}
  push('## 用量');
  push(
    record.usage
      ? fence([
          `任务级 credits：${numberOrUnknown(record.usage.taskCredits)}`,
          `会话级 credits：${numberOrUnknown(record.usage.sessionCredits)}（与任务级分别记录，未求和）`,
          `输入 tokens：${numberOrUnknown(record.usage.inputTokens)}`,
          `输出 tokens：${numberOrUnknown(record.usage.outputTokens)}`,
          `USD：${numberOrUnknown(record.usage.usd)}`,
          `说明：${record.usage.tokenNote}`,
          `来源：${record.usage.source}`,
        ].join('\n'))
      : fence('未记录用量。'),
  );

  push('## 变更差异');
  if (!changes.length) {
    push(fence('记录中没有任何变更差异。'));
  } else {
    push(`共记录 ${changes.length} 处变更。以下差异仅为已保存的证据片段，不构成可应用补丁。`);
    changes.forEach((change, index) => {
      push(`### 变更 ${index + 1}`);
      push(fence(`路径：${change.path}`));
      push(fence(`类型：${change.kind}`));
      if (change.incomplete) {
        push(fence('不完整：是（该差异被截断，或为二进制文件差异，无法证明完整变更范围）'));
      }
      push(fence(change.diff));
    });
  }

  if (hasIncomplete) {
    push('## 不完整差异警告');
    push('警告：上述变更中存在不完整差异（被截断或为二进制文件差异），本报告无法证明完整的变更范围，请勿据此判定变更已完整交付。');
  }

  push('## 局限与边界');
  push(limitations.map((item, index) => `${index + 1}. ${item}`).join('\n'));

  return {
    schemaVersion: 1,
    filename,
    markdown: sections.join('\n').replace(/[ \t\r\n]+$/, '') + '\n',
    record,
    limitations,
  };
}
