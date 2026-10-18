import{test}from'node:test';import assert from'node:assert/strict';
import{modelCompatibility}from'../src/model-compatibility.js';import{selectModel}from'../src/model-selection.js';import{submissionSchema}from'../src/schema.js';import type{Task}from'../src/types.js';
const id='11111111-2222-4333-8444-555555555555'; // Synthetic custom-model ID.
const option={id,label:'Same Label',kind:'custom' as const};
const task={id:'probe',agent:'qoder-cn',model:id,requestedModel:id,mode:'probe',probePurpose:'model-compatibility',state:'failed',title:'explicit probe',updatedAt:'2026-10-17',acceptance:'pending'}as Task;
test('failed explicit custom probes block ordinary use but allow an explicit no-tool recheck',()=>{
 const options=modelCompatibility([option],[task]);assert.equal(options[0]?.compatibility?.status,'failed');assert.throws(()=>selectModel(options,id),/探测失败/);assert.equal(selectModel(options,id,true).id,id);assert.equal(option.kind,'custom');assert.equal('compatibility'in option,false);
});
test('unreviewed completion never clears a prior failure; reviewed fresh success does',()=>{
 const pending={...task,id:'pending',state:'completed' as const};assert.equal(modelCompatibility([option],[pending,task])[0]?.compatibility?.status,'failed');
 const accepted={...pending,acceptance:'accepted' as const,verification:{status:'passed' as const,command:'probe',evidence:'ok',recordedAt:'2026-10-17'}};assert.equal(modelCompatibility([option],[accepted,task])[0]?.compatibility?.status,'passed');
 assert.equal(modelCompatibility([{id:'native',label:option.label,kind:'platform'}],[task])[0]?.compatibility,undefined);
 assert.equal(modelCompatibility([option],[{...task,agent:'ollama'}])[0]?.compatibility,undefined);
});
test('compatibility labels grant no file permissions and cannot mark a file task as a probe',()=>{
 const request={title:'probe',prompt:'hi',projectPath:'/p',acceptanceCriteria:['ok'],mode:'probe',probePurpose:'model-compatibility'};
 assert.equal(submissionSchema.parse(request).probePurpose,'model-compatibility');assert.throws(()=>submissionSchema.parse({...request,mode:'files',allowedFiles:['a']}));
});
