import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../src/store.js';
import {Scheduler} from '../src/scheduler.js';
import type {Executor,Execution} from '../src/executor.js';
import type {Task,Submission} from '../src/types.js';
import {runCommand} from '../src/qoder.js';

async function until(check:()=>boolean){const end=Date.now()+4000;while(!check()){if(Date.now()>end)throw new Error('Fixture deadline exceeded');await new Promise(resolve=>setTimeout(resolve,5));}}
class ControlledExecutor implements Executor {
  readonly pending=new Map<string,{task:Task;event:(type:string,data:any)=>void;resolve:(exit:{code:number|null})=>void;ended:boolean}>();
  started=0;live=0;maxLive=0;preflights=0;
  async verify(){this.preflights++;await new Promise(resolve=>setTimeout(resolve,10));return {verified:true,source:'fixture'};}
  start(task:Task,event:(type:string,data:any)=>void):Execution {
    this.started++;this.live++;this.maxLive=Math.max(this.maxLive,this.live);
    let resolve!:(exit:{code:number|null})=>void;const finished=new Promise<{code:number|null}>(r=>{resolve=r;});
    const pending={task,event,resolve,ended:false};this.pending.set(task.id,pending);
    return {finished,cancel:()=>{if(!pending.ended){pending.ended=true;this.live--;resolve({code:null});}}};
  }
  finish(id:string,failure=false){const pending=this.pending.get(id)!;if(pending.ended)return;pending.ended=true;this.live--;
    if(!failure)writeFileSync(join(pending.task.workspace!,'result.txt'),id+'\n');
    pending.event('result',{subtype:failure?'error':'success',is_error:failure,result:failure?'':'done',errors:failure?['quota exhausted']:[],total_credits:failure ? 0.2 : 0.1,permission_denials:[]});pending.resolve({code:failure?1:0});
  }
}
function fixture(){const root=mkdtempSync(join(tmpdir(),'helmdesk-concurrency-')),data=join(root,'data'),project=join(root,'project');mkdirSync(data);mkdirSync(project);writeFileSync(join(project,'input.txt'),'ORIGINAL');const store=new Store(data),executor=new ControlledExecutor(),scheduler=new Scheduler(store,executor,[project],2);
  const submission:Submission={title:'Concurrent fixture',prompt:'Create result',projectPath:project,allowedFiles:['result.txt'],dependencies:[],acceptanceCriteria:['Fixture'],model:'Qwen3.8-Flash',mode:'files',timeoutSeconds:10};
  return {root,data,project,store,executor,scheduler,submission,async close(){scheduler.stop();await until(()=>scheduler.queue().active===0);store.close();rmSync(root,{recursive:true,force:true});}};
}

test('two slots include preparations, repeated kicks never oversubscribe, and cancel affects one task only',async()=>{
  const f=fixture();try{
    const a=f.scheduler.submit(f.submission),b=f.scheduler.submit(f.submission),c=f.scheduler.submit(f.submission);
    for(let i=0;i<20;i++)f.scheduler.kick();await until(()=>f.executor.preflights===2);assert.equal(f.scheduler.queue().active,2);assert.equal(f.store.get(c.id).state,'queued');
    await until(()=>f.executor.started===2);assert.notEqual(f.store.get(a.id).workspace,f.store.get(b.id).workspace);
    f.scheduler.cancel(a.id);await until(()=>f.executor.started===3);assert.equal(f.store.get(b.id).state,'running');assert.equal(f.store.get(a.id).state,'cancelled');
    f.executor.finish(b.id);f.executor.finish(c.id);await f.scheduler.wait(c.id,0,3000);assert.equal(f.store.get(b.id).state,'completed');assert.equal(f.executor.maxLive,2);
    assert.equal(readFileSync(join(f.project,'input.txt'),'utf8'),'ORIGINAL');assert.equal(existsSync(join(f.project,'result.txt')),false);
    for(const id of [b.id,c.id]){const task=f.store.get(id);assert.equal(task.requestedModel,'Qwen3.8-Flash');assert.equal(readFileSync(join(task.workspace!,'result.txt'),'utf8'),id+'\n');}
    assert.ok(f.store.events(0,'system',100).some(event=>event.type==='queue_changed'));
  }finally{await f.close();}
});

test('quota failure preserves usage and blocks only dependants while other tasks finish',async()=>{
  const f=fixture();try{
    const a=f.scheduler.submit(f.submission),b=f.scheduler.submit(f.submission),child=f.scheduler.submit({...f.submission,dependencies:[a.id]}),other=f.scheduler.submit(f.submission);
    await until(()=>f.executor.started===2);f.executor.finish(a.id,true);await until(()=>f.executor.started===3);assert.equal(f.store.get(b.id).state,'running');
    assert.equal(f.store.get(a.id).failureKind,'quota');assert.equal(f.store.get(a.id).usage?.taskCredits,.2);assert.equal(f.store.get(child.id).state,'queued');assert.equal(f.scheduler.queue().entries.find(entry=>entry.taskId===child.id)?.blockers[0]?.code,'dependency_failed');
    f.executor.finish(b.id);f.executor.finish(other.id);await f.scheduler.wait(other.id,0,3000);assert.equal(f.store.get(other.id).state,'completed');assert.equal(f.store.get(child.id).state,'queued');
  }finally{await f.close();}
});

test('completed parents still require acceptance and failed verification cannot release dependencies',async()=>{
  const f=fixture();try{
    const parent=f.scheduler.submit(f.submission),child=f.scheduler.submit({...f.submission,dependencies:[parent.id]});await until(()=>f.executor.started===1);f.executor.finish(parent.id);await f.scheduler.wait(parent.id,0,3000);
    assert.equal(f.scheduler.queue().entries[0]?.blockers[0]?.code,'awaiting_acceptance');assert.equal(f.executor.started,1);
    f.scheduler.verifyTask(parent.id,{status:'failed',command:'fixture',evidence:'Mismatch'});assert.throws(()=>f.scheduler.review(parent.id,'accepted','Cannot pass'),/验证失败/);assert.equal(f.executor.started,1);
    f.scheduler.verifyTask(parent.id,{status:'passed',command:'fixture',evidence:'Fixed'});f.scheduler.review(parent.id,'accepted','Reviewed');await until(()=>f.executor.started===2);f.executor.finish(child.id);assert.equal((await f.scheduler.wait(child.id,0,3000)).task.state,'completed');
  }finally{await f.close();}
});

test('stop cancels all owned active tasks without starting queued work',async()=>{
  const f=fixture();try{
    const a=f.scheduler.submit(f.submission),b=f.scheduler.submit(f.submission),c=f.scheduler.submit(f.submission);await until(()=>f.executor.started===2);f.scheduler.stop();await until(()=>f.scheduler.queue().active===0);
    assert.equal(f.store.get(a.id).state,'cancelled');assert.equal(f.store.get(b.id).state,'cancelled');assert.equal(f.store.get(c.id).state,'queued');assert.equal(f.executor.started,2);
  }finally{await f.close();}
});

test('a result received before cancellation retains usage and does not cancel its neighbour',async()=>{
  const f=fixture();try{
    const a=f.scheduler.submit(f.submission),b=f.scheduler.submit(f.submission);await until(()=>f.executor.started===2);
    f.executor.pending.get(a.id)!.event('result',{subtype:'success',is_error:false,result:'awaiting process close',total_credits:.15,permission_denials:[]});
    f.scheduler.cancel(a.id);await until(()=>f.scheduler.queue().active===1);assert.equal(f.store.get(a.id).state,'cancelled');assert.equal(f.store.get(a.id).usage?.taskCredits,.15);assert.equal(f.store.get(b.id).state,'running');
    f.executor.finish(b.id);assert.equal((await f.scheduler.wait(b.id,0,3000)).task.state,'completed');
  }finally{await f.close();}
});

test('parallel tasks in one clean Git project use separate detached worktrees',async()=>{
  const f=fixture();try{
    await runCommand('git',['-C',f.project,'init','-q']);await runCommand('git',['-C',f.project,'add','.']);const commit=await runCommand('git',['-C',f.project,'-c','user.name=HelmDesk Test','-c','user.email=test@localhost','-c','commit.gpgsign=false','commit','-qm','fixture']);assert.equal(commit.code,0);
    const a=f.scheduler.submit(f.submission),b=f.scheduler.submit(f.submission);await until(()=>f.executor.started===2);
    for(const id of [a.id,b.id])assert.equal(f.store.get(id).workspaceKind,'worktree');assert.notEqual(f.store.get(a.id).workspace,f.store.get(b.id).workspace);
    f.executor.finish(a.id);f.executor.finish(b.id);await f.scheduler.wait(b.id,0,3000);assert.equal((await runCommand('git',['-C',f.project,'status','--porcelain'])).stdout,'');assert.equal(existsSync(join(f.project,'result.txt')),false);
  }finally{await f.close();}
});
