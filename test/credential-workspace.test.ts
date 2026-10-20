import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {prepareWorkspace,validateScope,inventory} from '../src/workspace.js';
import {toolDecision} from '../src/tool-policy.js';
import type {Task} from '../src/types.js';

for(const git of [false,true])test(`nested account directories and recognizable private-key files never reach a ${git?'Git':'copy'} task`,async()=>{
  const root=mkdtempSync(join(tmpdir(),'helm-credential-workspace-')),project=join(root,'project'),data=join(root,'data');mkdirSync(project);mkdirSync(data);
  const paths=['nested/.ssh/id_ed25519','nested/.agents/private.md','nested/.qoder-cn/.auth/user','nested/.qoderworkcn/settings.json','nested/.gnupg/private','nested/private.pem','nested/client.key','nested/.npmrc','nested/credentials.json','upper/.SSH/id_ed25519','upper/.QODER-CN/.auth/user','upper/.ENV.local'];
  const marker='synthetic-private-file-never-send';
  for(const path of paths){mkdirSync(dirname(join(project,path)),{recursive:true});writeFileSync(join(project,path),marker);}
  writeFileSync(join(project,'source.txt'),'ordinary source');writeFileSync(join(project,'public.pub'),'public fixture');
  const run=(args:string[])=>execFileSync('/usr/bin/git',['-C',project,...args],{encoding:'utf8'});
  if(git){run(['init','-q']);run(['add','.']);run(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null','commit','-qm','fixture']);}
  const task:Task={id:randomUUID(),title:'fixture',prompt:'fixture',projectPath:project,allowedFiles:['source.txt'],acceptanceCriteria:['fixture'],dependencies:[],model:'Fixture',requestedModel:'Fixture',mode:'files',timeoutSeconds:10,state:'queued',acceptance:'pending',createdAt:'fixture',updatedAt:'fixture'};
  try{
    const prepared=await prepareWorkspace(task,data);
    assert.deepEqual([...inventory(prepared.workspace).keys()].sort(),['public.pub','source.txt']);
    for(const path of paths){
      assert.equal(existsSync(join(prepared.workspace,path)),false,path);assert.equal(readFileSync(join(project,path),'utf8'),marker);
      assert.throws(()=>validateScope([path]));
      for(const tool of ['Read','Write','Edit','Grep','Glob'])assert.equal(toolDecision(tool,{path},prepared.workspace,['nested/']).allowed,false,`${tool}:${path}`);
    }
    assert.equal(toolDecision('Read',{path:'source.txt'},prepared.workspace,[]).allowed,true);
    if(git)assert.equal(run(['status','--porcelain']),'');
  }finally{rmSync(root,{recursive:true,force:true});}
});
