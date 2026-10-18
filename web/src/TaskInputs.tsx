import type { InputRun } from '../../src/input-types';

export function TaskInputs({ run }: { run?: InputRun }) {
  if (!run || run.files.length === 0) return null;

  const integrityText =
    run.integrity === 'verified' ? '摘要核对通过' : run.integrity === 'failed' ? '摘要核对失败' : '等待执行核对';
  const osText = run.isolationVerified ? '已验证' : '待验证';

  return (
    <section className="task-inputs" aria-label="只读交付输入">
      <h4>只读交付输入</h4>
      <p>
        以下文件是从已完成任务中被明确选中的已验收输出，以只读方式挂载到本任务工作区，不会合并到原项目。
      </p>
      <ul>
        <li>完整性核对：{integrityText}</li>
        <li>操作系统隔离验证：{osText}</li>
      </ul>
      {run.error ? <p className="task-inputs-error">{run.error}</p> : null}
      {run.files.map((file) => (
        <details key={`${file.taskId}:${file.path}`}>
          <summary>
            {file.title} · {file.path}
          </summary>
          <ul>
            <li>挂载路径：{file.mountedPath}</li>
            <li>SHA-256：{file.sha256}</li>
            <li>字节数：{file.bytes}</li>
            <li>来源任务 ID：{file.taskId}</li>
          </ul>
        </details>
      ))}
    </section>
  );
}
