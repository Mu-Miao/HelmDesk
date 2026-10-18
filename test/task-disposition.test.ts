import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {taskBrief,briefPage,watchBriefs} from '../src/review.js';
import {deliveryReport} from '../src/delivery-report.js';
import {matchesDisposition} from '../src/disposition-types.js';
import {buildProjectSummaries} from '../src/project-summary.js';

function fixture(){
  const root=mkdtempSync(join(tmpdir(),'helmdesk-classification-'));const store=new Store(root);
  const make=()=>store.create({title:'Historical fixture',prompt:'Fixture only',projectPath:root,allowedFiles:[],acceptanceCriteria:['fixture'],dependencies:[],model:'Fixture',mode:'probe',timeoutSeconds:30});
  const failed=make();store.patch(failed.id,{state:'failed',error:'Original process error',failureKind:'process',summary:'Original output',usage:{taskCredits:0,sessionCredits:0,inputTokens:0,outputTokens:0,usd:0,tokenNote:'fixture',source:'fixture'}});
  const raw=(id:string)=>String((store.db.prepare('SELECT data FROM tasks WHERE id=?').get(id) as {data:string}).data);
  return{root,store,make,failed:store.get(failed.id),raw,close(){store.close();rmSync(root,{recursive:true,force:true});}};
}

test('classification survives restart without changing original task bytes, execution timestamps, usage or old events',()=>{
  const f=fixture();let reopened:Store|undefined;
  try{
    const original=f.raw(f.failed.id),events=f.store.events(0,f.failed.id),before=f.store.get(f.failed.id);
    const classified=f.store.classifyTask({taskId:before.id,status:'deferred',reason:'Awaiting user configuration'});
    assert.equal(f.raw(before.id),original);assert.equal(classified.updatedAt,before.updatedAt);assert.equal(classified.error,before.error);assert.deepEqual(classified.usage,before.usage);
    assert.deepEqual(f.store.events(0,before.id).slice(0,events.length),events);
    assert.equal(f.store.events(0,before.id).at(-1)?.type,'disposition');
    reopened=new Store(f.root);assert.equal(reopened.get(before.id).disposition?.status,'deferred');
    assert.deepEqual(reopened.list().find(t=>t.id===before.id),classified);
  }finally{reopened?.close();f.close();}
});

test('invalid classifications and unverified replacement tasks never write metadata or events',()=>{
  const f=fixture();try{
    const unfinished=f.make(),replacement=f.make(),original=f.raw(f.failed.id),cursor=f.store.latestSequence();
    for(const args of [
      {taskId:f.failed.id,status:'resolved',reason:' '},
      {taskId:f.failed.id,status:'accepted',reason:'bad'},
      {taskId:unfinished.id,status:'resolved',reason:'still queued'},
      {taskId:f.failed.id,status:'resolved',reason:'self',replacementTaskId:f.failed.id},
      {taskId:f.failed.id,status:'resolved',reason:'unverified',replacementTaskId:replacement.id},
      {taskId:f.failed.id,status:'deferred',reason:'not a replacement',replacementTaskId:replacement.id},
      {taskId:f.failed.id,status:'resolved',reason:'extra',state:'completed'},
    ])assert.throws(()=>f.store.classifyTask(args));
    assert.equal(f.raw(f.failed.id),original);assert.equal(f.store.latestSequence(),cursor);assert.equal(f.store.get(f.failed.id).disposition,undefined);
  }finally{f.close();}
});

test('replacement links require completed verified accepted delivery and never accept the original failed task',()=>{
  const f=fixture();try{
    const next=f.make();f.store.patch(next.id,{state:'completed',verification:{status:'passed',command:'fixture',evidence:'ok',recordedAt:'now'},acceptance:'accepted'});
    const r=f.store.classifyTask({taskId:f.failed.id,status:'resolved',reason:'Later task corrected the issue',replacementTaskId:next.id});
    assert.equal(r.state,'failed');assert.equal(r.acceptance,'pending');assert.equal(r.disposition?.replacementTaskId,next.id);assert.equal(f.store.get(next.id).acceptance,'accepted');
    const report=deliveryReport(r);assert.equal(report.record.state,'failed');assert.equal(report.record.error,'Original process error');assert.equal(report.record.disposition?.status,'resolved');assert.ok(report.markdown.includes('历史处理结论'));assert.ok(report.markdown.includes('Original process error'));
  }finally{f.close();}
});

test('classification versions wake watchers and expire cursors while compact cards omit the reason',async()=>{
  const f=fixture();try{
    const other=f.make();f.store.patch(other.id,{state:'failed'});
    const initial=taskBrief(f.failed),pending=watchBriefs(f.store,{targets:[{taskId:f.failed.id,version:initial.version}],timeoutMs:500});
    const page=briefPage(f.store.list(),{attention:'rework',limit:1});assert.equal(page.total,2);assert.ok(page.nextCursor);
    f.store.classifyTask({taskId:f.failed.id,status:'expected_failure',reason:'PRIVATE_CLASSIFICATION_REASON'});
    const changed=await pending;assert.equal(changed.items.length,1);assert.notEqual(changed.items[0]?.version,initial.version);assert.equal(changed.items[0]?.attention,null);assert.equal(changed.items[0]?.dispositionStatus,'expected_failure');assert.ok(!JSON.stringify(changed).includes('PRIVATE_CLASSIFICATION_REASON'));
    assert.equal(briefPage(f.store.list(),{attention:'rework'}).total,1);assert.equal(f.store.get(f.failed.id).error,'Original process error');
    assert.throws(()=>briefPage(f.store.list(),{attention:'rework',limit:1,cursor:page.nextCursor}),/过期/);
    assert.equal(f.store.listenerCount('change'),0);
  }finally{f.close();}
});

test('reopening a classification restores pending handling and preserves all classification audit events',()=>{
  const f=fixture();try{
    const original=f.raw(f.failed.id);
    f.store.classifyTask({taskId:f.failed.id,status:'resolved',reason:'Host corrected module'});
    f.store.classifyTask({taskId:f.failed.id,status:'unclassified',reason:'Evidence needs another review'});
    const reopened=f.store.get(f.failed.id);assert.equal(reopened.disposition,undefined);assert.equal(taskBrief(reopened).attention,'rework');assert.equal(f.raw(reopened.id),original);
    assert.equal(f.store.events(0,reopened.id).filter(e=>e.type==='disposition').length,2);
  }finally{f.close();}
});

test('saving an identical classification is idempotent and does not add duplicate history',()=>{
  const f=fixture();try{
    const input={taskId:f.failed.id,status:'deferred',reason:'Await user configuration'};
    const first=f.store.classifyTask(input),cursor=f.store.latestSequence();
    assert.deepEqual(f.store.classifyTask(input),first);assert.equal(f.store.latestSequence(),cursor);
  }finally{f.close();}
});

test('new execution, verification or acceptance changes reopen handling; ordinary notes never embed the projection in raw tasks',()=>{
  const f=fixture();try{
    f.store.classifyTask({taskId:f.failed.id,status:'resolved',reason:'Host correction'});
    f.store.patch(f.failed.id,{reviewNote:'Additional historical explanation'});
    assert.equal(f.store.get(f.failed.id).disposition?.status,'resolved');assert.ok(!f.raw(f.failed.id).includes('disposition'));
    assert.throws(()=>f.store.patch(f.failed.id,{disposition:{status:'resolved',reason:'bypass',recordedAt:'now'}}));
    f.store.patch(f.failed.id,{verification:{status:'failed',command:'new check',evidence:'new evidence',recordedAt:'now'}});
    assert.equal(f.store.get(f.failed.id).disposition,undefined);assert.equal(taskBrief(f.store.get(f.failed.id)).attention,'rework');
  }finally{f.close();}
});

test('processing filters and project pending counts separate settled history without changing execution totals',()=>{
  const f=fixture();try{
    f.store.patch(f.failed.id,{state:'completed',acceptance:'changes_requested',verification:{status:'failed',command:'fixture',evidence:'failed',recordedAt:'now'}});
    assert.equal(matchesDisposition(f.store.get(f.failed.id),'unclassified'),true);
    assert.equal(buildProjectSummaries(f.store.list())[0]?.counts.changesRequested,1);
    f.store.classifyTask({taskId:f.failed.id,status:'resolved',reason:'Host repaired and verified integration'});
    const task=f.store.get(f.failed.id);assert.equal(matchesDisposition(task,'resolved'),true);assert.equal(matchesDisposition(task,'unclassified'),false);assert.equal(matchesDisposition(task,'deferred'),false);
    const project=buildProjectSummaries(f.store.list())[0]!;assert.equal(project.counts.completed,1);assert.equal(project.counts.changesRequested,0);assert.equal(task.verification?.status,'failed');assert.equal(task.acceptance,'changes_requested');
  }finally{f.close();}
});
