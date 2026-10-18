import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync,chmodSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/store.js';
import {Sharing} from '../src/sharing.js';
import {readSkillTree,snapshotSkill} from '../src/skill-snapshot.js';
import {mcpSandboxProfile,verifyAuthenticationReference} from '../src/isolation.js';
import {runCommand} from '../src/qoder.js';
function cleanup(root:string){function unseal(path:string){chmodSync(path,0o700);for(const entry of readdirSync(path,{withFileTypes:true}))if(entry.isDirectory())unseal(join(path,entry.name));}unseal(root);rmSync(root,{recursive:true,force:true});}

test('host integration checks and patch exports are never delegated through the worker gateway',()=>{
  const root=mkdtempSync(join(tmpdir(),'helmdesk-integration-gateway-')),store=new Store(root);
  try{for(const tool of ['task_brief_get','task_briefs_list','tasks_watch','task_integration_check','task_patch_export','task_revision_prepare','task_revision_submit']){
    writeFileSync(join(root,'sharing.json'),JSON.stringify({version:1,servers:[{id:'host',source:'test-only',approved:true,command:process.execPath,args:[resolve('scripts/fixtures/readonly-mcp.mjs')],readRoots:[resolve('scripts/fixtures')],tools:[tool]}]}));
    assert.throws(()=>new Sharing(store,'http://127.0.0.1:4317'),/不允许/);
  }}finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('skill snapshots pin all resources, reject symlinks/secrets and detect source changes',()=>{
  const root=mkdtempSync(join(tmpdir(),'helmdesk-snapshot-')),source=join(root,'source');mkdirSync(source);mkdirSync(join(source,'references'));
  writeFileSync(join(source,'SKILL.md'),'Read [rules](references/rules.md).');writeFileSync(join(source,'references/rules.md'),'RULE');
  try {
    const tree=readSkillTree(source);const snapshot=snapshotSkill('guide',source,'1',join(root,'snapshot'),tree.sha256);
    assert.equal(snapshot.fileCount,2);assert.equal(readFileSync(join(root,'snapshot/references/rules.md'),'utf8'),'RULE');
    writeFileSync(join(source,'SKILL.md'),'Changed');assert.throws(()=>snapshotSkill('guide',source,'1',join(root,'other'),tree.sha256),/来源已变化/);
    symlinkSync(join(root,'snapshot'),join(source,'escape'));assert.throws(()=>readSkillTree(source),/符号链接/);
    rmSync(join(source,'escape'));writeFileSync(join(source,'.env'),'not-a-real-key');assert.throws(()=>readSkillTree(source),/凭据/);
  } finally {cleanup(root);}
});

test('real sandboxed MCP gateway validates per-task selections, schema, snapshots, revocation and provenance',{skip:process.platform!=='darwin'},async()=>{
  const root=mkdtempSync(join(tmpdir(),'helmdesk-sharing-')),data=join(root,'data'),source=join(root,'source');mkdirSync(data);mkdirSync(source);mkdirSync(join(source,'references'));
  writeFileSync(join(source,'SKILL.md'),'A plain guide. Read references/rule.md.');writeFileSync(join(source,'references/rule.md'),'IMMUTABLE_RULE');
  const previousSecret=process.env.P3_UPSTREAM_TEST_SECRET;process.env.P3_UPSTREAM_TEST_SECRET='p3-fake-"secret\\only';
  const config={version:1,skills:[{id:'guide',path:source,version:'1.0',approved:true}],servers:[{id:'fixture',source:'Local validation fixture',approved:true,command:process.execPath,args:[resolve('scripts/fixtures/readonly-mcp.mjs')],readRoots:[resolve('scripts/fixtures'),resolve('node_modules')],tools:['add_numbers','echo_fixture_secret'],envFrom:['P3_UPSTREAM_TEST_SECRET']}]};
  writeFileSync(join(data,'sharing.json'),JSON.stringify(config));
  const store=new Store(data),sharing=new Sharing(store,'http://127.0.0.1:4317');
  try {
    const catalog=await sharing.refresh();assert.equal(catalog.skills[0]?.status,'compatible');assert.equal(catalog.servers[0]?.status,'ready',JSON.stringify(catalog.servers));
    const selection={skills:['guide'],tools:['fixture/add_numbers','fixture/echo_fixture_secret']},pins=await sharing.select(selection);
    await assert.rejects(sharing.select({skills:[],tools:['fixture/hidden_read']}),/不在已批准/);
    const task=store.create({title:'P3 fixture',prompt:'Test',projectPath:root,allowedFiles:['result.txt'],acceptanceCriteria:['Test'],dependencies:[],mode:'files',model:'Auto',timeoutSeconds:60,capabilities:selection,capabilityPins:pins});
    const workspace=join(data,'tasks',task.id,'workspace');mkdirSync(workspace,{recursive:true});store.patch(task.id,{state:'preparing',workspace});
    const opened=await sharing.open(store.get(task.id));assert.equal(opened.run.isolation?.verified,true);assert.equal(sharing.authorized(task.id,opened.gateway!.token),true);assert.equal(sharing.authorized(task.id,'x'.repeat(64)),false);assert.equal(sharing.authorized(task.id,'中'.repeat(64)),false);
    const content=await sharing.dispatch(task.id,'read-skill',{skillId:'guide',path:'references/rule.md'});assert.equal(content.content[0].text,'IMMUTABLE_RULE');
    await assert.rejects(sharing.dispatch(task.id,'read-skill',{skillId:'guide',path:'../SKILL.md'}),/白名单/);
    await assert.rejects(sharing.dispatch(task.id,'call',{tool:'fixture/hidden_read',arguments:{}}),/白名单/);
    await assert.rejects(sharing.dispatch(task.id,'call',{tool:'fixture/add_numbers',arguments:{a:'bad',b:2}}),/schema/);
    const answer=await sharing.dispatch(task.id,'call',{tool:'fixture/add_numbers',arguments:{a:19,b:23}});assert.equal(JSON.parse(answer.content[0].text).sum,42);
    const redacted=await sharing.dispatch(task.id,'call',{tool:'fixture/echo_fixture_secret',arguments:{}});assert.equal(redacted.content[0].text,'[REDACTED]');
    const audit=await sharing.close(task.id);assert.ok(audit?.sourceChecks.every(check=>check.unchanged));assert.equal(sharing.authorized(task.id,opened.gateway!.token),false);
    await assert.rejects(sharing.dispatch(task.id,'call',{tool:'fixture/add_numbers',arguments:{a:1,b:2}}),/撤销/);
    const events=store.events(0,task.id,100);assert.ok(events.some(event=>event.type==='gateway'&&(event.data as any).allowed===false));
    writeFileSync(join(data,'sharing.json'),'{}');await assert.rejects(sharing.select(selection),/配置已变化/);
  } finally {await sharing.shutdown();store.close();cleanup(root);if(previousSecret===undefined)delete process.env.P3_UPSTREAM_TEST_SECRET;else process.env.P3_UPSTREAM_TEST_SECRET=previousSecret;}
});

test('isolated authentication reference can be read but neither alias nor original can be written',{skip:process.platform!=='darwin'},async()=>{
  const root=mkdtempSync(join(tmpdir(),'helmdesk-auth-reference-')),task=join(root,'task'),source=join(root,'login'),alias=join(task,'config','.auth');mkdirSync(join(task,'config'),{recursive:true});mkdirSync(source);writeFileSync(join(source,'user'),'FAKE_LOGIN_FIXTURE');symlinkSync(source,alias,'dir');
  try {assert.equal(await verifyAuthenticationReference(task,source,alias,[]),true);assert.equal(readFileSync(join(source,'user'),'utf8'),'FAKE_LOGIN_FIXTURE');}
  finally {cleanup(root);}
});

test('MCP process cannot read arbitrary files or write the workspace even when its tool claims read-only',{skip:process.platform!=='darwin'},async()=>{
  const root=mkdtempSync(join(tmpdir(),'helmdesk-mcp-isolation-')),cache=join(root,'cache'),workspace=join(root,'work'),outside=join(root,'outside');mkdirSync(cache);mkdirSync(workspace);writeFileSync(outside,'PRIVATE_FIXTURE');
  try {
    const program=`const fs=require('fs');let denied=0;for(const p of [${JSON.stringify(outside)}]){try{fs.readFileSync(p);process.exit(10)}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e;denied++}}try{fs.writeFileSync(${JSON.stringify(join(workspace,'bad'))},'bad');process.exit(11)}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e;denied++}fs.writeFileSync(${JSON.stringify(join(cache,'ok'))},'ok');console.log(denied);`;
    const result=await runCommand('/usr/bin/sandbox-exec',['-p',mcpSandboxProfile(cache,workspace,[],[]),process.execPath,'-e',program]);assert.equal(result.code,0,result.stderr);assert.equal(result.stdout.trim(),'2');
  } finally {rmSync(root,{recursive:true,force:true});}
});
