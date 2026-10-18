export interface ModelOption { id: string; label: string; kind: 'platform' | 'custom'; compatibility?:{status:'passed'|'failed';taskId:string;at:string;reason:string}; }
export interface ModelPreference { agent?:import('./agent-types.js').AgentId; model: string; label: string; kind: 'platform' | 'custom'; updatedAt: string | null; reasoningEffort?:import('./reasoning.js').ReasoningEffort; }
