import type { ModelPolicyContext } from '@qodercn-ai/qodercn-agent-sdk';

// Confirmed by the official Flash catalog. Revalidated at every model request.
export const flashEfforts = ['low', 'medium', 'xhigh'] as const;
export type ReasoningEffort = typeof flashEfforts[number];
export const reasoningLabels: Record<ReasoningEffort, string> = { low: '低', medium: '中', xhigh: '极高' };
export interface ReasoningRun { effort: ReasoningEffort; model: string; label: string; supportedEfforts: string[]; source: 'official-sdk.resolveModel' }
export function reasoningChoices(model: string): readonly ReasoningEffort[] { return model === 'Qwen3.8-Flash' ? flashEfforts : []; }
export function reasoningDefault(model: string): ReasoningEffort | undefined { return model === 'Qwen3.8-Flash' ? 'xhigh' : undefined; }
export function resolveReasoningEffort(model: string, effort?: ReasoningEffort): ReasoningEffort | undefined {
  if (effort !== undefined && !reasoningChoices(model).includes(effort)) throw new Error('所选模型不支持这个思考深度；当前已验证 Qwen3.8-Flash 支持 low、medium、xhigh');
  return effort ?? reasoningDefault(model);
}
export function flashReasoningPolicy(context: ModelPolicyContext, effort: ReasoningEffort = 'xhigh') {
  const model = context.availableModels.find(m => m.value === context.resolvedModel || m.modelId === context.resolvedModel || m.displayName === context.resolvedModel);
  if (!context.resolvedModel || !model || model.displayName !== 'Qwen3.8-Flash') throw new Error('思考深度请求未解析为 Qwen3.8-Flash，拒绝换模型');
  resolveReasoningEffort(model.displayName, effort);
  if (!model.efforts?.includes(effort)) throw new Error(`官方目录未确认 Flash 支持 ${effort}，拒绝降低推理档位`);
  return { parameters: { reasoningEffort: effort }, evidence: { effort, model: model.value, label: model.displayName, supportedEfforts: [...model.efforts], source: 'official-sdk.resolveModel' } satisfies ReasoningRun };
}
