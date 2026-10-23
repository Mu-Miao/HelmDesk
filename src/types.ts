export type State = 'queued' | 'preparing' | 'running' | 'waiting_user' | 'completed' | 'failed' | 'cancelled';
export interface Submission {
  agent?:import('./agent-types.js').AgentId;
  maxTurns?:number;
  probePurpose?:'model-compatibility';
  title: string;
  prompt: string;
  projectPath: string;
  allowedFiles: string[];
  acceptanceCriteria: string[];
  dependencies: string[];
  inputs?: import('./input-types.js').InputSelection[];
  model: string;
  reasoningEffort?: import('./reasoning.js').ReasoningEffort;
  modelLabel?: string;
  capabilities?: import('./capability-types.js').CapabilitySelection;
  capabilityPins?: Record<string,string>;
  revision?: import('./revision-types.js').RevisionLink;
  mode: 'probe' | 'shared' | 'files';
  timeoutSeconds: number;
}
export interface Task extends Submission {
  disposition?:import('./disposition-types.js').TaskDisposition;
  executionRequested?:boolean;
  reasoningRun?: import('./reasoning.js').ReasoningRun;
  inputRun?: import('./input-types.js').InputRun;
  capabilityRun?: import('./capability-types.js').CapabilityRun;
  id: string; state: State; acceptance: 'pending' | 'accepted' | 'changes_requested';
  createdAt: string; updatedAt: string; startedAt?: string; finishedAt?: string;
  workspace?: string; baseline?: string; workspaceKind?: 'worktree' | 'copy';
  pid?: number; summary?: string; error?: string; failureKind?: string;
  requestedModel: string; reportedModel?: string; sessionId?: string;
  usage?: { taskCredits: number | null; sessionCredits: number | null; inputTokens: number | null; outputTokens: number | null; thinkingTokens?:number|null;cacheReadTokens?:number|null;totalTokens?:number|null; usd: number | null; tokenNote: string; source: string };
  changes?: { path: string; kind: string; diff: string; sha256?:string; bytes?:number; beforeSha256?:string; beforeBytes?:number }[];
  reviewNote?: string;
  verification?: { status: 'passed' | 'failed' | 'not_run'; command: string; evidence: string; recordedAt: string; deliveryVersion?: string };
}
export interface TaskEvent { seq: number; taskId: string; type: string; at: string; data: unknown }
