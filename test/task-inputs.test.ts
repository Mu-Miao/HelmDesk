import {deliveryVersion} from '../src/verified-delivery.js';
import{test}from'node:test';
import assert from'node:assert/strict';
import{mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,unlinkSync,renameSync,chmodSync,existsSync}from'node:fs';
import{join}from'node:path';
import{tmpdir}from'node:os';
import{createHash,randomUUID}from'node:crypto';
import{Store}from'../src/store.js';
import{Scheduler}from'../src/scheduler.js';
import type{Task,Submission}from'../src/types.js';
import type{Executor}from'../src/executor.js';
import{stageInputs,pinInputs,materializeInputs,auditInputs,inputRoots}from'../src/task-inputs.js';
import{verifyInputIsolation,protectedSourceRoots}from'../src/isolation.js';
import{toolDecision}from'../src/tool-policy.js';
import{inventory,prepareWorkspace,validateScope}from'../src/workspace.js';
import{deliveryReport}from'../src/delivery-report.js';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'helmdesk-inputs-')),data=join(root,'data'),project=join(root,'project');mkdirSync(data);mkdirSync(project);writeFileSync(join(project,'base.txt'),'base');
 const store=new Store(data);const submission:Submission={title:'source',prompt:'fixture',projectPath:project,allowedFiles:['result.txt'],acceptanceCriteria:['fixture'],dependencies:[],model:'fixture',mode:'files',timeoutSeconds:10};
 const parent=store.create(submission),workspace=join(data,'tasks',parent.id,'workspace');mkdirSync(workspace,{recursive:true});const content=Buffer.from('DELIVERY\n'),sha256=createHash('sha256').update(content).digest('hex');writeFileSync(join(workspace,'result.txt'),content);
 store.patch(parent.id,{workspace,state:'completed',acceptance:'accepted',verification:{status:'passed',command:'fixture',evidence:'ok',recordedAt:new Date().toISOString()},changes:[{path:'result.txt',kind:'added',diff:'+DELIVERY',sha256,bytes:content.length}]});
 store.patch(parent.id,{verification:{...store.get(parent.id).verification!,deliveryVersion:deliveryVersion(store.get(parent.id))}});
 return{root,data,project,store,submission,parent:store.get(parent.id),content,selection:[{taskId:parent.id,paths:['result.txt']}],close(){store.close();rmSync(root,{recursive:true,force:true});}};
}
function child(f:ReturnType<typeof fixture>):Task{const task=f.store.create({...f.submission,title:'consumer'});const workspace=join(f.data,'tasks',task.id,'workspace');mkdirSync(workspace,{recursive:true});return f.store.patch(task.id,{workspace});}

test('pinning freezes accepted bytes, excludes unselected files, and the mount is not an output',()=>{
 const f=fixture();try{
  writeFileSync(join(f.parent.workspace!,'unselected.txt'),'secret fixture');const t=child(f),inputRun=pinInputs(t.id,stageInputs(f.selection,id=>f.store.get(id),f.data),f.data)!;const task={...t,inputRun};
  writeFileSync(join(f.parent.workspace!,'result.txt'),'SOURCE LATER CHANGED');materializeInputs(task,f.data);
  assert.equal(readFileSync(join(t.workspace!,inputRun.files[0]!.mountedPath),'utf8'),'DELIVERY\n');assert.equal(inventory(t.workspace!).size,0);assert.equal(existsSync(join(t.workspace!,'.helmdesk-inputs',f.parent.id,'unselected.txt')),false);assert.equal(auditInputs(task,f.data)?.integrity,'verified');assert.equal(existsSync(join(f.project,'result.txt')),false);
  for(const name of ['Write','Edit'])assert.equal(toolDecision(name,{file_path:inputRun.files[0]!.mountedPath},t.workspace!,['.helmdesk-inputs/']).allowed,false);
  assert.equal(toolDecision('Read',{file_path:inputRun.files[0]!.mountedPath},t.workspace!,[]).allowed,true);
  assert.equal(deliveryReport({...task,state:'completed'}).record.inputs?.files[0]?.sha256,inputRun.files[0]?.sha256);
 }finally{f.close();}
});

test('changed source bytes, symlink files/ancestors and foreign workspaces cannot be pinned',()=>{
 const f=fixture();try{
  const source=join(f.parent.workspace!,'result.txt');writeFileSync(source,'MUTATION');assert.throws(()=>stageInputs(f.selection,id=>f.store.get(id),f.data),/大小|摘要/);writeFileSync(source,f.content);
  const other=join(f.root,'outside.txt');writeFileSync(other,f.content);unlinkSync(source);symlinkSync(other,source);assert.throws(()=>stageInputs(f.selection,id=>f.store.get(id),f.data),/符号链接/);
  assert.throws(()=>stageInputs(f.selection,()=>({...f.parent,workspace:f.project}),f.data),/来源工作目录/);
  unlinkSync(source);mkdirSync(join(f.parent.workspace!,'folder'));writeFileSync(join(f.parent.workspace!,'folder','nested.txt'),f.content);const nested={...f.parent,changes:[{...f.parent.changes![0]!,path:'folder/nested.txt'}]};nested.verification={...nested.verification!,deliveryVersion:deliveryVersion(nested)};renameSync(join(f.parent.workspace!,'folder'),join(f.root,'folder'));symlinkSync(join(f.root,'folder'),join(f.parent.workspace!,'folder'));assert.throws(()=>stageInputs([{taskId:f.parent.id,paths:['folder/nested.txt']}],()=>nested,f.data),/符号链接/);
 }finally{f.close();}
});

test('staging drift prevents launch; mounted drift or replaced root fails final audit',()=>{
 const f=fixture();try{
  const t=child(f),inputRun=pinInputs(t.id,stageInputs(f.selection,id=>f.store.get(id),f.data),f.data)!,task={...t,inputRun};const staged=join(f.data,'tasks',t.id,'input-snapshot',f.parent.id,'result.txt');chmodSync(staged,0o600);writeFileSync(staged,'CHANGED!\n');assert.throws(()=>materializeInputs(task,f.data),/摘要|大小/);rmSync(join(t.workspace!,'.helmdesk-inputs'),{recursive:true});writeFileSync(staged,f.content);materializeInputs(task,f.data);
  const mountFile=join(t.workspace!,inputRun.files[0]!.mountedPath);chmodSync(mountFile,0o600);writeFileSync(mountFile,'CHANGED!\n');assert.equal(auditInputs(task,f.data)?.integrity,'failed');writeFileSync(mountFile,f.content);
  const mount=join(t.workspace!,'.helmdesk-inputs');renameSync(mount,join(f.root,'moved'));symlinkSync(join(f.root,'moved'),mount);assert.equal(auditInputs(task,f.data)?.integrity,'failed');
 }finally{f.close();}
});

test('real OS sandbox reads snapshots but rejects file writes, new files and chmod',async()=>{
 const f=fixture();try{
  const t=child(f),inputRun=pinInputs(t.id,stageInputs(f.selection,id=>f.store.get(id),f.data),f.data)!,task={...t,inputRun};materializeInputs(task,f.data);const roots=inputRoots(task,f.data),files=roots.map(root=>join(root,f.parent.id,'result.txt'));
  assert.equal(await verifyInputIsolation(join(f.data,'tasks',t.id),roots,files,protectedSourceRoots()),true);assert.equal(auditInputs(task,f.data)?.integrity,'verified');
 }finally{f.close();}
});

test('scheduler adds source dependency, mounts before execution, and preserves independent output',async()=>{
 const f=fixture();let starts=0;const executor:Executor={async verify(){return{};},start(task,event){starts++;assert.equal(readFileSync(join(task.workspace!,'.helmdesk-inputs',f.parent.id,'result.txt'),'utf8'),'DELIVERY\n');writeFileSync(join(task.workspace!,'result.txt'),'CONSUMED\n');event('result',{subtype:'success',is_error:false,result:'done',total_credits:.1});return{finished:Promise.resolve({code:0}),cancel(){}};}};const s=new Scheduler(f.store,executor,[f.project]);
 try{
  const t=s.submit({...f.submission,inputs:f.selection});assert.deepEqual(t.dependencies,[f.parent.id]);const result=(await s.wait(t.id,0,3000)).task;assert.equal(result.state,'completed');assert.equal(starts,1);assert.equal(result.inputRun?.integrity,'verified');assert.equal(result.changes?.length,1);assert.equal(result.changes?.[0]?.path,'result.txt');assert.match(result.changes?.[0]?.sha256??'',/^[a-f0-9]{64}$/);assert.equal(readFileSync(join(f.parent.workspace!,'result.txt'),'utf8'),'DELIVERY\n');
 }finally{s.stop();f.close();}
});

test('post-run input mutation blocks completion and acceptance but retains known usage',async()=>{
 const f=fixture();const executor:Executor={async verify(){return{};},start(task,event){const file=join(task.workspace!,'.helmdesk-inputs',f.parent.id,'result.txt');chmodSync(file,0o600);writeFileSync(file,'CORRUPT');event('result',{subtype:'success',is_error:false,result:'bad',total_credits:.2});return{finished:Promise.resolve({code:0}),cancel(){}};}};const s=new Scheduler(f.store,executor,[f.project]);try{const t=s.submit({...f.submission,inputs:f.selection});const result=(await s.wait(t.id,0,3000)).task;assert.equal(result.state,'failed');assert.equal(result.inputRun?.integrity,'failed');assert.equal(result.usage?.taskCredits,.2);assert.throws(()=>s.review(t.id,'accepted','bad'),/仅执行完成/);}finally{s.stop();f.close();}
});

test('source review revoked while queued blocks launch, cancellation retains frozen evidence',async()=>{
 const f=fixture();const s=new Scheduler(f.store,{async verify(){throw Error('should not start');},start(){throw Error('should not start');}},[f.project]);try{
  const t=s.submit({...f.submission,inputs:f.selection});f.store.patch(f.parent.id,{acceptance:'changes_requested'});await new Promise(r=>setTimeout(r,10));assert.equal(f.store.get(t.id).state,'queued');assert.equal(s.queue().blocked,1);assert.equal(s.cancel(t.id).state,'cancelled');assert.equal(existsSync(join(f.data,'tasks',t.id,'input-snapshot',f.parent.id,'result.txt')),true);
 }finally{s.stop();f.close();}
});

test('reserved input directory is rejected in original projects and allowed output scope',async()=>{
 const f=fixture();try{mkdirSync(join(f.project,'.helmdesk-inputs'));await assert.rejects(prepareWorkspace({...f.parent,id:randomUUID(),projectPath:f.project},f.data),/保留/);assert.throws(()=>validateScope(['.helmdesk-inputs/']),/文件范围/);}finally{f.close();}
});

test('unsafe paths are rejected even when otherwise valid source metadata records them',async()=>{
 const {inputPlan}=await import('../src/input-policy.js');const id=randomUUID();
 for(const path of ['../escape','a/../escape','/etc/file','a\\b','a//b','a/','x/.codex/config','x/.env.local','.helmdesk-inputs/file','bad\nname']){
  const source={id,title:'source',state:'completed',acceptance:'accepted',verification:{status:'passed'},changes:[{path,kind:'added',sha256:'a'.repeat(64),bytes:0}]};
  assert.throws(()=>inputPlan([{taskId:id,paths:[path]}],()=>source),Error,path);
 }
});

test('empty and binary files preserve exact bytes through pinning and mount',()=>{
 const f=fixture();try{for(const content of [Buffer.alloc(0),Buffer.from([0,255,13,10,128])]){
  writeFileSync(join(f.parent.workspace!,'result.txt'),content);f.store.patch(f.parent.id,{changes:[{path:'result.txt',kind:'modified',diff:'binary fixture',sha256:createHash('sha256').update(content).digest('hex'),bytes:content.length}]});
  f.store.patch(f.parent.id,{verification:{...f.store.get(f.parent.id).verification!,deliveryVersion:deliveryVersion(f.store.get(f.parent.id))}});
  const t=child(f),inputRun=pinInputs(t.id,stageInputs(f.selection,id=>f.store.get(id),f.data),f.data)!,task={...t,inputRun};materializeInputs(task,f.data);assert.deepEqual(readFileSync(join(t.workspace!,inputRun.files[0]!.mountedPath)),content);assert.equal(auditInputs(task,f.data)?.integrity,'verified');
 }}finally{f.close();}
});

test('snapshot tampering before scheduler preparation never starts the executor',async()=>{
 const f=fixture();let starts=0;const executor:Executor={async verify(){return{};},start(){starts++;throw Error('must not launch');}};const s=new Scheduler(f.store,executor,[f.project]);try{
  const task=s.submit({...f.submission,inputs:f.selection}),file=join(f.data,'tasks',task.id,'input-snapshot',f.parent.id,'result.txt');chmodSync(file,0o600);writeFileSync(file,'CORRUPT');const done=(await s.wait(task.id,0,3000)).task;
  assert.equal(done.state,'failed');assert.equal(done.inputRun?.integrity,'failed');assert.equal(starts,0);assert.equal(s.queue().active,0);
 }finally{s.stop();f.close();}
});

test('read-only handoff is also mounted in a clean detached Git worktree',async()=>{
 const f=fixture();const {runCommand}=await import('../src/qoder.js');const git=async(args:string[])=>{const r=await runCommand('git',['-C',f.project,...args]);assert.equal(r.code,0,r.stderr);return r.stdout.trim();};let s:Scheduler|undefined;
 try{
  await git(['init','-q']);await git(['add','base.txt']);await git(['-c','user.name=HelmDesk Test','-c','user.email=test@local.invalid','commit','-qm','fixture']);const baseline=await git(['rev-parse','HEAD']);
  const executor:Executor={async verify(){return{};},start(task,event){assert.equal(readFileSync(join(task.workspace!,'.helmdesk-inputs',f.parent.id,'result.txt'),'utf8'),'DELIVERY\n');writeFileSync(join(task.workspace!,'result.txt'),'GIT CHILD\n');event('result',{subtype:'success',is_error:false,result:'ok'});return{finished:Promise.resolve({code:0}),cancel(){}};}};s=new Scheduler(f.store,executor,[f.project]);const task=s.submit({...f.submission,inputs:f.selection}),done=(await s.wait(task.id,0,3000)).task;
  assert.equal(done.state,'completed');assert.equal(done.workspaceKind,'worktree');assert.equal(done.baseline,baseline);assert.equal(done.inputRun?.integrity,'verified');assert.equal(await git(['status','--porcelain']),'');assert.equal(existsSync(join(f.project,'.helmdesk-inputs')),false);assert.equal(existsSync(join(f.project,'result.txt')),false);
 }finally{s?.stop();f.close();}
});

test('reset verification blocks an input consumer until verification passes again',async()=>{
 const f=fixture();let starts=0;const executor:Executor={async verify(){return{};},start(task,event){starts++;writeFileSync(join(task.workspace!,'result.txt'),'ok');event('result',{subtype:'success',is_error:false,result:'ok'});return{finished:Promise.resolve({code:0}),cancel(){}};}};const s=new Scheduler(f.store,executor,[f.project]);try{
  const task=s.submit({...f.submission,inputs:f.selection});s.verifyTask(f.parent.id,{status:'not_run',command:'',evidence:'reset for recheck'});await new Promise(r=>setTimeout(r,10));assert.equal(starts,0);assert.equal(f.store.get(task.id).state,'queued');assert.equal(s.queue().entries[0]?.blockers[0]?.reason,'交付来源需要验证通过');
  s.verifyTask(f.parent.id,{status:'passed',command:'fixture recheck',evidence:'verified again'});assert.equal((await s.wait(task.id,0,3000)).task.state,'completed');assert.equal(starts,1);
 }finally{s.stop();f.close();}
});

test('source approval lost during async preparation prevents the CLI from starting',async()=>{
 const f=fixture();let starts=0;const executor:Executor={async verify(){return{};},async prepare(){f.store.patch(f.parent.id,{verification:{status:'not_run',command:'',evidence:'revoked during prepare',recordedAt:new Date().toISOString()}});return{};},start(){starts++;throw Error('must not start');}};const s=new Scheduler(f.store,executor,[f.project]);try{
  const task=s.submit({...f.submission,inputs:f.selection}),done=(await s.wait(task.id,0,3000)).task;assert.equal(done.state,'failed');assert.equal(starts,0);assert.match(done.error??'',/来源校验未通过/);assert.equal(s.queue().active,0);
 }finally{s.stop();f.close();}
});
