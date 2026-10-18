import type {Store} from './store.js';
import type {Task} from './types.js';
import type {ExecutionPolicy,ExecutionPolicyView} from './execution-types.js';
import {budgetDecision} from './budget-policy.js';
import {executionPolicySchema} from './schema.js';
export const executionPolicy=(store:Store):ExecutionPolicy=>executionPolicySchema.parse(store.snapshot('executionPolicy')??{budgets:[]});
function budgetTasks(tasks:Task[]){return tasks.map(task=>task.executionRequested===false?{...task,startedAt:undefined,state:task.state==='waiting_user'?'not_dispatched':task.state}:task);}
export function taskBudget(store:Store,task:Task){
  const rule=executionPolicy(store).budgets.find(r=>r.agent===(task.agent??'qoder-cn')&&r.model===task.model);
  return rule?budgetDecision(budgetTasks(store.list()),rule,task.id):null;
}
export function policyView(store:Store):ExecutionPolicyView{const policy=executionPolicy(store);return{policy,decisions:policy.budgets.map(rule=>({rule,...budgetDecision(budgetTasks(store.list()),rule)})),note:'累计阈值只阻止新的派发；在途请求可能超出阈值。按执行器和模型分别计算任务 Credits，未知用量会暂停派发，不代表账号余额。'};}
