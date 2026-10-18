import{test}from'node:test';import assert from'node:assert/strict';
import{mkdtempSync,mkdirSync,rmSync}from'node:fs';import{join}from'node:path';import{tmpdir}from'node:os';
import{flashReasoningPolicy,reasoningDefault,flashEfforts}from'../src/reasoning.js';import{Store}from'../src/store.js';import{Scheduler}from'../src/scheduler.js';import{modelPreference,saveModelPreference}from'../src/model-selection.js';import type{ModelPolicyContext}from'@qodercn-ai/qodercn-agent-sdk';
import{modelPreferenceSchema,submissionSchema}from'../src/schema.js';
const context:ModelPolicyContext={purpose:'main',sessionId:'fixture',turnIndex:0,resolvedModel:'qfmodel',availableModels:[{value:'qfmodel',modelId:'qfmodel',displayName:'Qwen3.8-Flash',description:'fixture',efforts:['xhigh','low','medium'],defaultEffort:'medium'}]};
test('Flash defaults to xhigh, explicit Auto/custom/other models are left alone',()=>{assert.equal(reasoningDefault('Qwen3.8-Flash'),'xhigh');for(const model of ['Auto','Qwen3.8-Max','custom-model-id'])assert.equal(reasoningDefault(model),undefined);});
test('official pull policy passes xhigh without replacing the resolved model or mutating the catalog',()=>{const before=structuredClone(context),p=flashReasoningPolicy(context);assert.deepEqual(p.parameters,{reasoningEffort:'xhigh'});assert.equal(p.evidence.model,'qfmodel');assert.equal(p.evidence.effort,'xhigh');assert.equal('model' in p,false);assert.deepEqual(context,before);});
test('missing capability, unresolved or switched model fails rather than silently lowering effort',()=>{
 for(const candidate of [{...context,resolvedModel:undefined},{...context,availableModels:[]},{...context,availableModels:[{...context.availableModels[0]!,efforts:['medium']}]},{...context,availableModels:[{...context.availableModels[0]!,displayName:'Other'}]}])assert.throws(()=>flashReasoningPolicy(candidate),/拒绝/);
});
test('each selectable effort reaches the SDK policy unchanged, and removed capabilities fail closed',()=>{
 for(const effort of flashEfforts){const policy=flashReasoningPolicy(context,effort);assert.equal(policy.parameters.reasoningEffort,effort);assert.equal(policy.evidence.effort,effort);assert.throws(()=>flashReasoningPolicy({...context,availableModels:[{...context.availableModels[0]!,efforts:[]}]},effort),/拒绝降低/);}
 for(const effort of ['high','max','',null,5])assert.equal(modelPreferenceSchema.safeParse({model:'Qwen3.8-Flash',reasoningEffort:effort}).success,false);
 assert.equal(submissionSchema.shape.reasoningEffort.safeParse('medium').success,true);
});
test('saved depth survives reopening and cannot leak into Auto or an existing same-name custom model',()=>{
 const root=mkdtempSync(join(tmpdir(),'helmdesk-effort-pref-'));let store=new Store(root);
 const options=[{id:'Qwen3.8-Flash',label:'Qwen3.8-Flash',kind:'platform' as const},{id:'Auto',label:'Auto',kind:'platform' as const},{id:'custom-id',label:'Qwen3.8-Flash',kind:'custom' as const}];
 try{saveModelPreference(store,options,'Qwen3.8-Flash','low');store.close();store=new Store(root);assert.equal(modelPreference(store).reasoningEffort,'low');saveModelPreference(store,options,'Qwen3.8-Flash');assert.equal(modelPreference(store).reasoningEffort,'low');assert.throws(()=>saveModelPreference(store,options,'Auto','low'));assert.equal(modelPreference(store).reasoningEffort,'low');saveModelPreference(store,options,'custom-id');assert.equal(modelPreference(store).reasoningEffort,undefined);saveModelPreference(store,options,'Qwen3.8-Flash');assert.equal(modelPreference(store).reasoningEffort,'xhigh');}finally{store.close();rmSync(root,{recursive:true,force:true});}
});
test('submission freezes Flash effort; old tasks and model selection changes remain distinct',()=>{
 const root=mkdtempSync(join(tmpdir(),'helmdesk-reasoning-')),project=join(root,'project');mkdirSync(project);const store=new Store(root),s=new Scheduler(store,{async verify(){throw Error('not used');},start(){throw Error('not used');}},[project]);s.stop();
 try{const spec={title:'fixture',prompt:'fixture',projectPath:project,allowedFiles:[],dependencies:[],acceptanceCriteria:['fixture'],model:'Qwen3.8-Flash',mode:'probe' as const,timeoutSeconds:10};const task=s.submit(spec);assert.equal(task.reasoningEffort,'xhigh');const auto=s.submit({...spec,model:'Auto'});assert.equal(auto.reasoningEffort,undefined);assert.throws(()=>s.submit({...spec,model:'Auto',reasoningEffort:'xhigh'}));saveModelPreference(store,[{id:spec.model,label:spec.model,kind:'platform'}],spec.model);assert.equal(modelPreference(store).reasoningEffort,'xhigh');assert.equal(store.get(auto.id).reasoningEffort,undefined);
 }finally{s.stop();store.close();rmSync(root,{recursive:true,force:true});}
});
