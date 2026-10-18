import { useState } from 'react';
import type { CapabilityCatalog } from '../../src/capability-types';
import { tool } from './api';
import { Icon } from './Icon';
const statuses={compatible:'可共享',needs_adaptation:'需适配',blocked:'已排除'};
export function Capabilities({catalog,csrf,onRefresh,onError}:{catalog:CapabilityCatalog;csrf:string;onRefresh:()=>Promise<unknown>;onError:(message:string)=>void}) {
  const [busy,setBusy]=useState(false);
  async function refresh(){setBusy(true);try{await tool('capabilities_refresh',{},csrf);await onRefresh();}catch(error:any){onError(error.message);}finally{setBusy(false);}}
  return <section className="capability-view" aria-label="单向能力共享">
    <div className="capability-heading"><div><h2>按任务共享能力</h2><p>{catalog.direction}</p></div><button className="outline" disabled={busy||!csrf} onClick={refresh}><Icon name="refresh"/>{busy?'检查中…':'检查共享来源'}</button></div>
    <p className="caption">{catalog.reason}</p>
    <h3>Skills 只读快照 <span className="caption">{catalog.skills.length} 项来源</span></h3>
    {catalog.skills.length?<div className="capability-cards">{catalog.skills.map(skill=><article className="capability-card" key={skill.id}><div className="capability-title"><h4>{skill.id}</h4><span className={`capability-status ${skill.status}`}>{statuses[skill.status]}</span></div><p className="caption">版本 {skill.version} · {skill.fileCount} 文件 · {(skill.bytes/1024).toFixed(1)} KB</p><p className="source-path">{skill.source}</p>{skill.sha256?<details><summary>来源摘要 SHA-256</summary><code>{skill.sha256}</code></details>:null}{skill.reasons.length?<ul>{skill.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>:<p className="caption">提交任务时用 capabilities.skills 选择此 ID；默认不共享。</p>}</article>)}</div>:<div className="result">尚未列出技能来源。宿主在 sharing.json 中明确选择来源，再检查目录。</div>}
    <h3>本地只读 MCP</h3>
    {catalog.servers.length?<div className="capability-cards">{catalog.servers.map(server=><article className="capability-card" key={server.id}><div className="capability-title"><h4>{server.id}</h4><span className={`capability-status ${server.status==='ready'?'compatible':'blocked'}`}>{server.status==='ready'?'网关可用':'不可用'}</span></div><p className="caption">{server.source}</p>{server.reason?<p>{server.reason}</p>:null}{server.tools.map(item=><div className="shared-tool" key={item.id}><code>{item.id}</code><p>{item.description}</p></div>)}</article>)}</div>:<div className="result">未选择本地 MCP。网关不自动复制服务器配置或授权。</div>}
    <h3>执行边界</h3><dl className="boundaries"><dt>默认权限</dt><dd>Read、Write、Edit、Glob、Grep；文件工具仅访问任务副本</dd><dt>Skills</dt><dd>复制文件及相对资源，固定摘要；OS 沙箱拒绝快照写入</dd><dt>MCP</dt><dd>每项任务的工具、schema、凭证与调用次数独立；仅只读 stdio；网络关闭</dd><dt>来源保护</dt><dd>实际来源目录禁止读取和写入；运行前后核对摘要</dd><dt>执行者状态</dt><dd>独立配置、缓存和日志目录；不复制 Codex 登录凭据</dd></dl>
    <ul className="caption">{catalog.exclusions.map(item=><li key={item}>{item}</li>)}</ul>
  </section>;
}
