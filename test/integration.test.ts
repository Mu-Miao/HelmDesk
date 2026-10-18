import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,cpSync,unlinkSync,symlinkSync,linkSync,chmodSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {collectChanges,inventory} from '../src/workspace.js';
import {integrationPreview,integrationPatch} from '../src/integration.js';
import {safeJson} from '../src/redact.js';
import {runCommand} from '../src/qoder.js';
import type {Task} from '../src/types.js';

function fixture(base:Record<string,string|Buffer>={'edit.txt':'old\n','delete.txt':'remove\n'},outputs:Record<string,string|Buffer|null>={'edit.txt':'new\n','delete.txt':null,'added.txt':'hello\n'}){
  const root=mkdtempSync(join(tmpdir(),'helmdesk-integration-')),project=join(root,'project'),data=join(root,'data'),id=randomUUID(),workspace=join(data,'tasks',id,'workspace');
  mkdirSync(project,{recursive:true});mkdirSync(workspace,{recursive:true});
  const put=(dir:string,path:string,bytes:string|Buffer)=>{mkdirSync(dirname(join(dir,path)),{recursive:true});writeFileSync(join(dir,path),bytes);};
  for(const [path,bytes]of Object.entries(base))put(project,path,bytes);
  const before=inventory(project);cpSync(project,workspace,{recursive:true});
  for(const [path,bytes]of Object.entries(outputs)){if(bytes===null)unlinkSync(join(workspace,path));else put(workspace,path,bytes);}
  const task:Task={id,title:'integration fixture',prompt:'fixture',model:'Auto',requestedModel:'Auto',projectPath:project,workspace,baseline:'copy:fixture',workspaceKind:'copy',state:'completed',acceptance:'accepted',createdAt:'2026-10-17T00:00:00Z',updatedAt:'2026-10-17T00:00:01Z',mode:'files',allowedFiles:[...new Set([...Object.keys(base),...Object.keys(outputs)])],dependencies:[],acceptanceCriteria:['fixture'],timeoutSeconds:10,verification:{status:'passed',command:'fixture',evidence:'checked',recordedAt:'2026-10-17T00:00:01Z'},changes:collectChanges(workspace,before,[...new Set([...Object.keys(base),...Object.keys(outputs)])])};
  return {root,project,data,workspace,task,before,put,close(){rmSync(root,{recursive:true,force:true});}};
}
test('only completed, verified and accepted files qualify; reads do not alter task or original bytes',()=>{
  const f=fixture();try{const original=structuredClone(f.task);for(const task of [{...f.task,state:'running' as const},{...f.task,acceptance:'pending' as const},{...f.task,verification:undefined},{...f.task,verification:{...f.task.verification!,status:'failed' as const}}])assert.throws(()=>integrationPreview(task,f.data),/验证通过且验收通过/);
    const p=integrationPreview(f.task,f.data);assert.equal(p.canExport,true);assert.deepEqual(p.counts,{ready:3,conflict:0,alreadyApplied:0,blocked:0});assert.deepEqual(f.task,original);assert.deepEqual(inventory(f.project),f.before);const text=JSON.stringify(p);for(const secret of [f.project,f.workspace,f.task.prompt+'secret'])assert.ok(!text.includes(secret));
  }finally{f.close();}
});
test('complete patch round-trips via real git apply, including empty files, CRLF, no final LF, UTF-8 and quoted names',async()=>{
  const f=fixture({'edit.txt':'old\n','delete.txt':'remove\n','empty-delete.txt':'','crlf.txt':'before\r\n','no-lf.txt':'before'},{'edit.txt':'new\n','delete.txt':null,'empty-delete.txt':null,'empty-add.txt':'','crlf.txt':'after\r\n','no-lf.txt':'after','文件 空格".txt':'你好\n','first-newline.txt':'\n'});
  try{const preview=integrationPreview(f.task,f.data),result=integrationPatch(f.task,f.data,undefined,preview.fingerprint);assert.equal(preview.canExport,true);assert.equal(result.sha256,createHash('sha256').update(result.patch).digest('hex'));assert.equal(JSON.parse(safeJson(result)).patch,result.patch);
    const target=join(f.root,'apply');cpSync(f.project,target,{recursive:true});const patch=join(f.root,'delivery.patch');writeFileSync(patch,result.patch);
    const check=await runCommand('git',['-C',target,'apply','--check',patch]);assert.equal(check.code,0,check.stderr);
    const applied=await runCommand('git',['-C',target,'apply',patch]);assert.equal(applied.code,0,applied.stderr);assert.deepEqual(inventory(target),inventory(f.workspace));assert.deepEqual(inventory(f.project),f.before);
  }finally{f.close();}
});
test('changed original blocks whole selection and stale export; selecting an unaffected file stays explicit',()=>{
  const f=fixture();try{const preview=integrationPreview(f.task,f.data);writeFileSync(join(f.project,'edit.txt'),'user edit\n');assert.throws(()=>integrationPatch(f.task,f.data,undefined,preview.fingerprint),/预检已过期/);
    const conflict=integrationPreview(f.task,f.data);assert.equal(conflict.canExport,false);assert.equal(conflict.files.find(i=>i.path==='edit.txt')?.status,'conflict');assert.throws(()=>integrationPatch(f.task,f.data,undefined,conflict.fingerprint),/有阻塞/);
    const selected=integrationPreview(f.task,f.data,['added.txt']);const result=integrationPatch(f.task,f.data,['added.txt'],selected.fingerprint);assert.ok(!result.patch.includes('edit.txt'));assert.ok(result.patch.includes('added.txt'));assert.throws(()=>integrationPatch(f.task,f.data,undefined,selected.fingerprint),/预检已过期/);
  }finally{f.close();}
});
test('already integrated bytes and already absent deletions are distinct from conflicts',()=>{
  const f=fixture();try{for(const c of f.task.changes!){if(c.kind==='deleted')unlinkSync(join(f.project,c.path));else cpSync(join(f.workspace,c.path),join(f.project,c.path));}
    const preview=integrationPreview(f.task,f.data);assert.equal(preview.status,'nothing_to_apply');assert.equal(preview.counts.alreadyApplied,3);assert.equal(preview.canExport,false);assert.throws(()=>integrationPatch(f.task,f.data,undefined,preview.fingerprint),/没有可整合/);
    const empty=integrationPreview(f.task,f.data,[]);assert.deepEqual(empty.counts,{ready:0,conflict:0,alreadyApplied:0,blocked:0});assert.equal(empty.status,'nothing_to_apply');
  }finally{f.close();}
});
test('changed delivered bytes, missing outputs and reappearing deleted outputs fail integrity check',()=>{
  for(const [path,bytes]of [['added.txt','tampered'],['delete.txt','resurrected']]as const){const f=fixture();try{writeFileSync(join(f.workspace,path),bytes);const p=integrationPreview(f.task,f.data,[path]);assert.equal(p.files[0]?.status,'blocked');assert.match(p.files[0]?.reason??'',/验收记录不一致/);assert.equal(p.canExport,false);}finally{f.close();}}
  const f=fixture();try{unlinkSync(join(f.workspace,'edit.txt'));assert.equal(integrationPreview(f.task,f.data,['edit.txt']).files[0]?.status,'blocked');}finally{f.close();}
});
test('legacy modifications need original baselines; stored truncated display is never used to build a patch',()=>{
  const f=fixture();try{const edit=f.task.changes!.find(c=>c.path==='edit.txt')!;assert.equal(edit.beforeBytes,4);assert.match(edit.beforeSha256!,/^[a-f0-9]{64}$/);delete edit.beforeSha256;assert.match(integrationPreview(f.task,f.data,['edit.txt']).files[0]?.reason??'',/缺少完整原始基线/);
    const added=f.task.changes!.find(c=>c.path==='added.txt')!;added.diff='[显示已截断] unrelated text';const p=integrationPreview(f.task,f.data,['added.txt']),patch=integrationPatch(f.task,f.data,['added.txt'],p.fingerprint).patch;assert.ok(patch.includes('+hello'));assert.ok(!patch.includes('unrelated'));delete added.sha256;assert.equal(integrationPreview(f.task,f.data,['added.txt']).canExport,false);
  }finally{f.close();}
});
test('traversal, reserved/control paths, unrecorded selections and excessive/duplicate selection are rejected before IO',()=>{
  const f=fixture();try{for(const path of ['../outside','/absolute','a\\b','a//b','a/./b','.codex/x','.env.test','.helmdesk-inputs/a','x\ny','x\ty'])assert.throws(()=>integrationPreview(f.task,f.data,[path]));
    assert.throws(()=>integrationPreview(f.task,f.data,['unknown.txt']));assert.throws(()=>integrationPreview(f.task,f.data,['added.txt','added.txt']));assert.throws(()=>integrationPreview(f.task,f.data,Array.from({length:21},(_,i)=>`f${i}`)));
    f.task.allowedFiles=[];assert.throws(()=>integrationPreview(f.task,f.data,['added.txt']),/允许范围/);
  }finally{f.close();}
});
test('symlink roots/leaves/parents, foreign workspaces and hard-linked outputs cannot be read as accepted content',()=>{
  const f=fixture();try{const outside=join(f.root,'outside');writeFileSync(outside,'OUTSIDE-SENTINEL');unlinkSync(join(f.workspace,'added.txt'));symlinkSync(outside,join(f.workspace,'added.txt'));const p=integrationPreview(f.task,f.data,['added.txt']);assert.equal(p.files[0]?.status,'blocked');assert.ok(!JSON.stringify(p).includes('OUTSIDE-SENTINEL'));
    f.task.workspace=f.project;assert.equal(integrationPreview(f.task,f.data,['edit.txt']).files[0]?.status,'blocked');
  }finally{f.close();}
  const parent=fixture({}, {'sub/file.txt':'ok'});try{symlinkSync(parent.workspace,join(parent.project,'sub'));assert.match(integrationPreview(parent.task,parent.data).files[0]?.reason??'',/符号链接/);}finally{parent.close();}
  const hard=fixture();try{linkSync(join(hard.workspace,'added.txt'),join(hard.root,'hard'));assert.match(integrationPreview(hard.task,hard.data,['added.txt']).files[0]?.reason??'',/单链接/);}finally{hard.close();}
  const root=fixture();try{const alias=join(root.root,'alias');symlinkSync(root.project,alias);root.task.projectPath=alias;assert.equal(integrationPreview(root.task,root.data).canExport,false);}finally{root.close();}
});
test('binary, invalid UTF-8, executable, oversize and redaction-changing text refuse patch export',()=>{
  for(const bytes of [Buffer.from([0,1,2]),Buffer.from([255,254,250]),Buffer.from('Authorization: Bearer abc123'),Buffer.alloc(1_000_001,97)]){
    const f=fixture({}, {'added.txt':bytes});try{const p=integrationPreview(f.task,f.data);assert.equal(p.canExport,false);assert.equal(p.files[0]?.status,'blocked');}finally{f.close();}
  }
  const f=fixture();try{chmodSync(join(f.workspace,'added.txt'),0o755);assert.match(integrationPreview(f.task,f.data,['added.txt']).files[0]?.reason??'',/可执行/);}finally{f.close();}
});
test('total read budget is bounded and changed task evidence invalidates the preview',()=>{
  const base=Object.fromEntries(Array.from({length:4},(_,i)=>[`f${i}`,Buffer.alloc(600_000,97)])),outputs=Object.fromEntries(Array.from({length:4},(_,i)=>[`f${i}`,Buffer.alloc(600_000,98)]));
  const big=fixture(base,outputs);try{const p=integrationPreview(big.task,big.data);assert.equal(p.canExport,false);assert.ok(p.files.some(f=>f.reason.includes('4MB')));}finally{big.close();}
  const f=fixture();try{const preview=integrationPreview(f.task,f.data);f.task.updatedAt='2026-10-17T00:01:00Z';assert.throws(()=>integrationPatch(f.task,f.data,undefined,preview.fingerprint),/预检已过期/);assert.equal(existsSync(join(f.project,'added.txt')),false);}finally{f.close();}
});
