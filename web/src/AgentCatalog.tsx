import type { AgentInfo } from '../../src/agent-types.js';

const MODE_LABELS: Record<AgentInfo['modes'][number], string> = {
  probe: '无工具任务',
  shared: '共享只读任务',
  files: '文件任务',
};

export function AgentCatalog({ agents }: { agents: AgentInfo[] }) {
  const nativeApp = typeof window !== 'undefined' && (window as Window & {__HELMDESK_NATIVE__?: boolean}).__HELMDESK_NATIVE__ === true;
  return (
    <section className="agent-catalog" aria-label="执行器目录">
      <h2>执行器目录</h2>
      <div className="cli-install-entry">
        <div>
          <h3>安装需要的 CLI</h3>
          <p>先检测 Homebrew，再选择执行器安装。已有安装与模型默认值会保留。</p>
          {!nativeApp ? <p>请在领航台 Mac 应用中打开“执行端 → CLI 安装…”；浏览器不执行安装。</p> : null}
        </div>
        {nativeApp ? <a className="outline" href="helmdesk://cli-installation">选择并安装 CLI</a> : <a className="outline" href="https://brew.sh/">Homebrew 官网</a>}
      </div>

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
