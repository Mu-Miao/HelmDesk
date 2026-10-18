import type {BudgetRule,BudgetDecision} from './budget-types.js';
export interface ExecutionPolicy {maxTurns?:number;budgets:BudgetRule[]}
export interface ExecutionPolicyView {policy:ExecutionPolicy;decisions:(BudgetDecision&{rule:BudgetRule})[];note:string}
