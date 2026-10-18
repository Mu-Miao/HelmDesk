import { useCallback, useEffect, useState,useRef } from 'react';
import { tool } from './api';
import { Icon } from './Icon';
import type { ModelOption, ModelPreference } from '../../src/model-types';
import { reasoningChoices, reasoningDefault, reasoningLabels, type ReasoningEffort } from '../../src/reasoning';
import type {AgentId} from '../../src/agent-types.js';

interface Catalog { agent:AgentId;options: ModelOption[]; sampledAt: string; }
export function ModelSettings({ csrf, preference, onSaved, onError }: { csrf: string; preference: ModelPreference; onSaved: () => Promise<unknown>; onError: (message: string) => void }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null), [draft, setDraft] = useState(preference.model);
  const [agent,setAgent]=useState<AgentId>(preference.agent??'qoder-cn');const generation=useRef(0);
  const [effort, setEffort] = useState<ReasoningEffort | undefined>(preference.reasoningEffort);
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { setAgent(preference.agent??'qoder-cn');setDraft(preference.model); setEffort(preference.reasoningEffort); }, [preference.agent,preference.model, preference.reasoningEffort]);
  const load = useCallback(async () => {
    setLoading(true);
    const ticket=++generation.current;
    try { const result=await tool<Catalog>('models_list', {agent}, csrf);if(ticket===generation.current){setCatalog(result);setDraft(previous=>result.options.some(o=>o.id===previous)?previous:result.options[0]?.id??'');} }
    catch (error: any) { if(ticket===generation.current){setCatalog(null);onError(error.message);} }
    finally { if(ticket===generation.current)setLoading(false); }
  }, [agent,csrf, onError]);
  useEffect(() => { if (csrf) void load(); }, [csrf, load]);
  const selected = catalog?.agent===agent?catalog.options.find(option => option.id === draft):undefined;
  const efforts = agent==='qoder-cn'?reasoningChoices(draft):[];
  async function save() {
    setSaving(true); setMessage('');
    try { const result = await tool<ModelPreference>('model_preference_set', { agent,model: draft, reasoningEffort: agent==='qoder-cn'?effort:undefined }, csrf); await onSaved(); setMessage(`已保存：后续新任务使用 ${result.agent==='ollama'?'Ollama 本地':'Qoder CN'} · ${result.label}${result.reasoningEffort ? ` · 思考深度${reasoningLabels[result.reasoningEffort]}` : ''}。`); }
    catch (error: any) { onError(error.message); }
    finally { setSaving(false); }
  }
  return <section className="model-settings" aria-label="模型选择">
    <div className="model-setting-row"><div><h2>默认执行模型</h2><p>后续新任务使用，单次派活可单独指定。</p></div>
      <div className="model-controls"><label className="model-field"><span>执行器</span><select aria-label="选择默认执行器" value={agent} disabled={saving} onChange={event=>{setAgent(event.target.value as AgentId);setDraft('');setCatalog(null);setEffort(undefined);setMessage('');}}><option value="qoder-cn">Qoder CN</option><option value="ollama">Ollama 本地 · 无工具任务</option></select></label><label className="model-field"><span>执行模型</span><select aria-label="选择默认模型" value={draft} disabled={loading || saving || !catalog} onChange={event => { const model=event.target.value; setDraft(model); setEffort(agent==='qoder-cn'?(model===preference.model ? preference.reasoningEffort : reasoningDefault(model)):undefined); setMessage(''); }}>
        {!catalog || !catalog.options.some(option => option.id === draft) ? <option value={draft}>{draft?preference.label:'请选择模型'}{loading ? ' · 读取中…' : ''}</option> : null}
        <optgroup label={agent==='ollama'?'已安装的本地模型':'Qoder 平台模型'}>{catalog?.options.filter(option => option.kind === 'platform').map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</optgroup>
        {catalog?.options.some(option => option.kind === 'custom') ? <optgroup label="已有自定义模型 · 沿用原配置">{catalog.options.filter(option => option.kind === 'custom').map(option => <option key={option.id} value={option.id}>{option.label} · 自定义{option.compatibility?.status==='failed'?' · 探测失败':option.compatibility?.status==='passed'?' · 短探测通过':''}</option>)}</optgroup> : null}
      </select></label><label className="model-field effort-field"><span>思考深度</span><select aria-label="选择思考深度" value={effort ?? ''} disabled={!efforts.length || !selected || loading || saving} onChange={event => { const value=efforts.find(item=>item===event.target.value); setEffort(value); setMessage(''); }}>
        {efforts.length ? efforts.map(value=><option key={value} value={value}>{reasoningLabels[value]} · {value}</option>) : <option value="">模型默认</option>}
      </select></label><button className="outline" onClick={save} disabled={!selected ||selected.compatibility?.status==='failed'|| (agent===(preference.agent??'qoder-cn')&&draft === preference.model && effort === preference.reasoningEffort) || loading || saving}>{saving ? '保存中…' : '保存选择'}</button><button className="theme-toggle" aria-label="刷新模型目录" disabled={loading || saving} onClick={() => { void load(); }}><Icon name="refresh" size={18}/></button></div>
    </div>
    <p className="caption">{efforts.length ? '可选择此模型已验证支持的深度，每次请求按官方目录再次校验。' : '此模型暂未验证可选思考深度，沿用模型默认。'} 保存后用于新任务，已有任务保持原设置。</p>
    {selected?.kind === 'custom' ? <p className="caption">自定义模型沿用已有供应商配置，可能使用独立 API 额度；与 Qoder 账号 Credits 分开。</p> : null}
    {selected?.compatibility?<p className="caption">{selected.compatibility.reason} · 记录 {selected.compatibility.taskId}</p>:null}
    {agent==='ollama'?<p className="caption">仅无工具任务；不修改项目文件、不下载模型，不会自动回退到 Qoder。文件开发仍请选择 Qoder CN。</p>:null}
    {message ? <p className="model-message" role="status">{message}</p> : null}
  </section>;
}
