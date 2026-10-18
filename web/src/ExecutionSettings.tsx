import {useEffect,useState} from 'react';
import {tool} from './api';
import type {ModelPreference} from '../../src/model-types.js';
import type {ExecutionPolicyView as View} from '../../src/execution-types.js';
export function ExecutionSettings({view,preference,csrf,onSaved,onError}:{view:View;preference:ModelPreference;csrf:string;onSaved:()=>Promise<unknown>;onError:(s:string)=>void}){
  const agent=preference.agent??'qoder-cn',rule=view.policy.budgets.find(r=>r.agent===agent&&r.model===preference.model);
  const [turns,setTurns]=useState(''),[enabled,setEnabled]=useState(false),[credits,setCredits]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{setTurns(view.policy.maxTurns?.toString()??'');setEnabled(!!rule);setCredits(rule?.maxCredits.toString()??'');},[view.policy.maxTurns,rule?.maxCredits,preference.model,agent]);
  async function save(){
    const maxTurns=turns.trim()?Number(turns):undefined,maxCredits=Number(credits);
    if(maxTurns!==undefined&&(!Number.isInteger(maxTurns)||maxTurns<1||maxTurns>100)){onError('最大轮数须为 1–100 的整数，留空表示未设置');return;}
    if(enabled&&(!Number.isFinite(maxCredits)||maxCredits<=0)){onError('累计 Credits 阈值须为正数');return;}
    setBusy(true);setMessage('');try{
      const budgets=view.policy.budgets.filter(r=>r.agent!==agent||r.model!==preference.model);
      if(enabled&&agent==='qoder-cn')budgets.push({agent,model:preference.model,maxCredits});
      await tool('execution_policy_set',{maxTurns,budgets},csrf);await onSaved();setMessage('运行限制已保存。已有任务的轮数保持原设置，预算控制未发起的请求。');
    }catch(error:any){onError(error.message);}finally{setBusy(false);}
  }
  return <section className="execution-settings" aria-label="运行限制"><h2>运行限制</h2>
    <div className="execution-fields"><label>新 Qoder 任务最大轮数<input aria-label="新任务最大轮数" type="number" min="1" max="100" placeholder="未设置" value={turns} onChange={e=>setTurns(e.target.value)}/></label>
    <label className="budget-toggle"><input type="checkbox" checked={enabled} disabled={agent!=='qoder-cn'} onChange={e=>setEnabled(e.target.checked)}/>为当前模型启用累计 Credits 阈值</label>
    <label>{preference.label} · 累计 Credits<input aria-label="累计 Credits 阈值" type="number" min="0" step="any" disabled={!enabled||agent!=='qoder-cn'} value={credits} onChange={e=>setCredits(e.target.value)}/></label>
    <button className="outline" disabled={busy||!csrf} onClick={()=>void save()}>{busy?'保存中…':'保存运行限制'}</button></div>
    <p className="caption">按已记录的累计任务用量控制后续派发；未知用量会暂停，在途请求可能超出阈值。Ollama 固定单轮，不使用 Qoder Credits。</p>
    {view.decisions.length?<details className="policy-decisions"><summary>已设置的预算 · {view.decisions.length}</summary><ul>{view.decisions.map(d=><li key={`${d.rule.agent}:${d.rule.model}`}><strong>{d.rule.model} · {d.rule.maxCredits} Credits</strong><p>{d.reason}</p></li>)}</ul></details>:null}
    {message?<p role="status" className="model-message">{message}</p>:null}
  </section>;
}
