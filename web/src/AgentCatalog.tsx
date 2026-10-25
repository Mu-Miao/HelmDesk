import type { AgentInfo } from '../../src/agent-types.js';

const MODE_LABELS: Record<AgentInfo['modes'][number], string> = {
  probe: '无工具任务',
  shared: '共享只读任务',
  files: '文件任务',
};

export function AgentCatalog({ agents }: { agents: AgentInfo[] }) {
  return (
    <section className="agent-catalog" aria-label="执行器目录">
      <h2>执行器目录</h2>

      {agents.length === 0 ? (
        <p>尚未检查执行器</p>
      ) : (
        <ul className="agent-cards">
          {agents.map((agent) => (
            <li className="agent-card" key={agent.id}>
              <h3>{agent.label}</h3>
              <p>{agent.id}</p>
              <p className="agent-status">{agent.available ? '可用' : '不可用'}</p>
              <p>{agent.version ?? '未取得版本'}</p>
              <p>{agent.modes.map((mode) => MODE_LABELS[mode]).join('、')}</p>
              <p>{agent.reason}</p>
              <p className="agent-source">{agent.source}</p>
            </li>
          ))}
        </ul>
      )}

      <p>模型目录和权限按执行器分别验证，不自动切换或合计不同单位用量。</p>
    </section>
  );
}
