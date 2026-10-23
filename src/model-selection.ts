import type { Store } from './store.js';
import type { ModelOption, ModelPreference } from './model-types.js';
import {resolveReasoningEffort, type ReasoningEffort} from './reasoning.js';
import type {AgentId} from './agent-types.js';
import {antigravityDefaultModel} from './antigravity.js';
export function modelPreference(store: Store, agent?:AgentId): ModelPreference {
  const primary=store.snapshot('modelPreference') as ModelPreference | null;
  const preference=(agent&&agent!==(primary?.agent??'qoder-cn')?store.snapshot(`modelPreference:${agent}`) as ModelPreference|null:primary) ?? (agent==='antigravity'?{agent,model:antigravityDefaultModel,label:'Gemini 3.8 Flash (Medium)',kind:'platform' as const,updatedAt:null}:{agent,model:'Auto',label:'Auto',kind:'platform' as const,updatedAt:null});
  return {...preference,reasoningEffort:preference.agent&&preference.agent!=='qoder-cn'?undefined:resolveReasoningEffort(preference.model,preference.reasoningEffort)};
}
export function selectModel(options: ModelOption[], requested: string,allowFailedProbe=false): ModelOption {
  const option = options.find(item => item.id === requested || (item.kind === 'custom' && `${item.label} (${item.id})` === requested));
  if (!option) throw new Error('所选模型不在 CLI 当前目录中，请刷新模型列表；不会自动改用 Auto');
  if(option.compatibility?.status==='failed'&&!allowFailedProbe)throw Error('所选自定义模型最近一次隔离探测失败；请先检查供应商连接并明确重新探测，不自动回退');
  return option;
}
export function saveModelPreference(store: Store, options: ModelOption[], requested: string, effort?: ReasoningEffort,agent:AgentId='qoder-cn',makePrimary=agent!=='antigravity'): ModelPreference {
  const option = selectModel(options, requested);
  const previous = modelPreference(store,agent);
  if(agent!=='qoder-cn'&&effort)throw Error('此执行器不支持 Qoder 的思考深度参数');
  const reasoningEffort = agent!=='qoder-cn'?undefined:resolveReasoningEffort(option.id, effort ?? (previous.model === option.id ? previous.reasoningEffort : undefined));
  const preference = { agent,model: option.id, label: option.label, kind: option.kind, updatedAt: new Date().toISOString(), reasoningEffort };
  store.snapshot(`modelPreference:${agent}`, preference);
  if(makePrimary)store.snapshot('modelPreference', preference);
  store.event('system', 'model_preference', preference);
  return preference;
}
