import { useMemo } from 'react';
import type { Task } from '../../src/types';
import type { QueueReport } from '../../src/queue-types';

export function QueueOverview({ queue, tasks, onSelect }: {
  queue: QueueReport;
  tasks: Task[];
  onSelect: (id: string) => void;
}) {
  const taskById = useMemo(() => {
    const map = new Map<string, Task>();
    for (const task of tasks) map.set(task.id, task);
    return map;
  }, [tasks]);

  return (
    <section className="queue-overview" aria-label="协作队列">
      <h3>协作队列</h3>
      <p>当前隔离执行槽位，任务完成后仍需独立验收</p>
      <div className="queue-stats">
        <span>正在占用 {queue.active} / {queue.concurrency}</span>
        <span>可执行 {queue.ready}</span>
        <span>受阻任务 {queue.blocked}</span>
      </div>
      <p>槽位占满时，已就绪的排队任务会等待空闲槽位后再开始执行。</p>
      {queue.entries.length === 0 ? (
        <p className="queue-empty">没有排队任务</p>
      ) : (
        <ul>
          {queue.entries.map(entry => {
            const task = taskById.get(entry.taskId);
            return (
              <li key={entry.taskId} className="queue-entry">
                <button type="button" onClick={() => onSelect(entry.taskId)}>
                  <span className="queue-entry-title">{task?.title || entry.taskId}</span>
                  <span>{entry.ready ? '等待空闲槽位' : '等待条件满足'}</span>
                </button>
                {entry.blockers.length > 0 && (
                  <ul className="queue-reasons">
                    {entry.blockers.map(blocker => {
                      const parent = taskById.get(blocker.taskId);
                      return (
                        <li key={`${blocker.taskId}-${blocker.code}`}>
                          {parent?.title || blocker.taskId}：{blocker.reason}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
