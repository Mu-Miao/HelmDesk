import {test} from 'node:test';import assert from 'node:assert/strict';import{createElement}from'react';import{renderToStaticMarkup}from'react-dom/server';
import{TaskDisposition}from'../web/src/TaskDisposition.js';import{TaskTable}from'../web/src/TaskTable.js';import type{Task}from'../src/types.js';
const base:Task={id:'fixture',title:'Historical task',prompt:'PRIVATE_PROMPT',projectPath:'/fixture',allowedFiles:[],acceptanceCriteria:[],dependencies:[],model:'Fixture',requestedModel:'Fixture',mode:'probe',timeoutSeconds:30,state:'failed',acceptance:'pending',createdAt:'2026-01-01',updatedAt:'2026-01-02',error:'Original <script>failure</script>',failureKind:'process'};
test('history displays a distinct handling label, reason and original failure without implying acceptance',()=>{
 const task:Task={...base,disposition:{status:'resolved',reason:'Host fixed <script>markup</script>',recordedAt:'2026-01-03'}};
 const html=renderToStaticMarkup(createElement(TaskDisposition,{task,tasks:[task],onSelect:()=>{},csrf:'fixture',onRefresh:async()=>{},onError:()=>{}}));
 for(const text of ['已解决','原始执行记录（保留）','执行：失败','Host fixed &lt;script&gt;','Original &lt;script&gt;','修改处理结论','重新待处理'])assert.ok(html.includes(text),text);
 for(const text of ['PRIVATE_PROMPT','<script>','验收通过'])assert.ok(!html.includes(text),text);
});
test('task rows preserve execution failure but replace generic execution-exception text with handling categories',()=>{
 const tasks:Task[]=(['resolved','expected_failure','deferred']as const).map((status,index)=>({...base,id:'fixture-'+index,disposition:{status,reason:'Historical reason',recordedAt:'2026-01-03'}}));
 const html=renderToStaticMarkup(createElement(TaskTable,{tasks,all:true,project:'',onProject:()=>{},onSelect:()=>{}}));
 for(const text of ['已解决','预期失败','暂缓处理','按处理结论筛选','原始执行状态保留','Historical reason'])assert.ok(html.includes(text),text);
 assert.ok(!html.includes('执行异常'));assert.ok(html.includes('status-failed'));
});
