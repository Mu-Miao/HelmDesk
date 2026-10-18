import type { Task } from './types.js';
export interface DeliveryReport {
 schemaVersion: 1;
 filename: string;
 markdown: string;
 record: {
  agent:string;maxTurns:number|null;
  id: string; title: string; state: Task['state']; acceptance: Task['acceptance'];
  createdAt: string; updatedAt: string; requestedModel: string; reportedModel: string | null;
  reasoningEffort:import('./reasoning.js').ReasoningEffort|null; reasoningRun:import('./reasoning.js').ReasoningRun|null;
  revision:{sourceTaskId:string;rootTaskId:string}|null;
  summary: string | null; error: string | null; reviewNote: string | null;
  verification: Task['verification'] | null; usage: Task['usage'] | null;
  dependencies: string[]; acceptanceCriteria: string[];
  inputs: import('./input-types.js').InputRun | null;
  changes: {path:string;kind:string;diff:string;incomplete:boolean}[];
 };
 limitations: string[];
}
