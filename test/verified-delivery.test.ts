import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,symlinkSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Store} from '../src/store.js';
import {Scheduler} from '../src/scheduler.js';
import {deliveryVersion,assertVerifiedDelivery} from '../src/verified-delivery.js';
import type {Submission} from '../src/types.js';
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'helm-verification-pin-')),data=join(root,'data'),project=join(root,'project');mkdirSync(data);mkdirSync(project);
  const store=new Store(data),scheduler=new Scheduler(store,{async verify(){throw Error('No model');},start(){throw Error('No model');}},[project]);scheduler.stop();
  const input:Submission={title:'proof',prompt:'fixture',projectPath:project,model:'Auto',mode:'probe',allowedFiles:[],acceptanceCriteria:['fixture'],dependencies:[],timeoutSeconds:10};
  const task=store.create(input);store.patch(task.id,{state:'completed',summary:'original summary'});
  return {root,data,project,store,scheduler,input,id:task.id,close(){store.close();rmSync(root,{recursive:true,force:true});}};
}
test('host verification pins delivery content and stale accepted history cannot release new work',()=>{
  const f=fixture();try {
    f.store.patch(f.id,{acceptance:'accepted',verification:{status:'passed',command:'legacy',evidence:'retained',recordedAt:'2026-01-01'}});
    assert.throws(()=>f.scheduler.review(f.id,'accepted','must reverify'),/当前版本/);
    assert.equal(f.store.get(f.id).acceptance,'accepted');assert.equal(f.store.get(f.id).verification?.evidence,'retained');
    const verified=f.scheduler.verifyTask(f.id,{status:'passed',command:'host assertions',evidence:'exact fixture content'});
    assert.equal(verified.verification?.deliveryVersion,deliveryVersion(verified));
    const before=deliveryVersion(verified);f.scheduler.review(f.id,'accepted','review changed');
    assert.equal(deliveryVersion(f.store.get(f.id)),before);
    f.store.patch(f.id,{summary:'changed summary'});
    assert.throws(()=>f.scheduler.review(f.id,'accepted','stale'),/交付已变化/);
    const child=f.scheduler.submit({...f.input,dependencies:[f.id]});
    const entry=f.scheduler.queue().entries.find(t=>t.taskId===child.id)!;assert.equal(entry.ready,false);assert.match(entry.blockers[0]!.reason,/当前版本/);
    f.scheduler.verifyTask(f.id,{status:'not_run',command:'reset',evidence:'proof reset'});
    assert.equal(f.store.get(f.id).verification?.deliveryVersion,undefined);
  }finally{f.close();}
});
test('file-byte drift and a symlinked task ancestor cannot be accepted with unchanged metadata',()=>{
  const f=fixture();try {
    const workspace=join(f.data,'tasks',f.id,'workspace');mkdirSync(workspace,{recursive:true});writeFileSync(join(workspace,'result.txt'),'verified');
    f.store.patch(f.id,{mode:'files',allowedFiles:['result.txt'],workspace,changes:[{path:'result.txt',kind:'added',diff:'+verified',sha256:createHash('sha256').update('verified').digest('hex'),bytes:8}]});
    f.scheduler.verifyTask(f.id,{status:'passed',command:'host assertions',evidence:'bytes verified'});
    assert.equal(assertVerifiedDelivery(f.store.get(f.id),f.data)?.get('result.txt')?.toString(),'verified');
    writeFileSync(join(workspace,'result.txt'),'tampered');assert.throws(()=>f.scheduler.review(f.id,'accepted','must not accept'),/交付文件/);
    writeFileSync(join(workspace,'result.txt'),'verified');
    const taskRoot=join(f.data,'tasks',f.id),outside=join(f.root,'outside');renameSync(taskRoot,outside);symlinkSync(outside,taskRoot);
    assert.throws(()=>assertVerifiedDelivery(f.store.get(f.id),f.data),/工作区身份/);
  }finally{f.close();}
});
