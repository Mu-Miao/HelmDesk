export interface BudgetRule { agent:string; model:string; maxCredits:number }
export interface BudgetTask { id:string; agent?:string; model:string; state:string; startedAt?:string; usage?:{taskCredits:number|null;sessionCredits?:number|null} }
export interface BudgetDecision {
  allowed:boolean; status:'clear'|'exhausted'|'unknown'|'inflight';
  recordedCredits:number|null; unknownTasks:number; activeTasks:number; reason:string;
}
