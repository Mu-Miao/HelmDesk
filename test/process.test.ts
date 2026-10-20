import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { killOwnedGroup } from '../src/process.js';
import {parseProcessGroups,inspectOwnedGroup,watchOwnedProcess} from '../src/process.js';
import {sandboxProfile} from '../src/isolation.js';

test('sandboxed detached execution confirms timeout cleanup of its own real process tree',{skip:process.platform!=='darwin',timeout:5000},async()=>{
  const root=mkdtempSync(join(tmpdir(),'helm-sandbox-timeout-'));
  const program='require("child_process").spawn(process.execPath,["-e","setTimeout(()=>{},10000)"],{stdio:"ignore"});console.log("ready");setTimeout(()=>{},10000)';
  const child=spawn('/usr/bin/sandbox-exec',['-p',sandboxProfile(root),process.execPath,'-e',program],{detached:true,stdio:['ignore','pipe','pipe']});
  const errors:Error[]=[],execution=watchOwnedProcess(child,error=>errors.push(error));
  try{
    await new Promise<void>((resolve,reject)=>{child.stdout.once('data',()=>resolve());child.once('error',reject);});
    assert.equal(execution.cancel().confirmed,true);await execution.finished;
    assert.equal(errors.length,0);assert.ok(inspectOwnedGroup(child.pid!).every(member=>member.state.startsWith('Z')));
  }finally{killOwnedGroup(child.pid);rmSync(root,{recursive:true,force:true});}
});

test('fresh OS inspection selects only an owned detached group and handles an absent group',async()=>{
  const child=spawn(process.execPath,['-e','console.log("ready");setTimeout(()=>{},10000)'],{detached:true,stdio:['ignore','pipe','pipe']});
  try{
    await new Promise<void>((resolve,reject)=>{child.stdout.once('data',()=>resolve());child.once('error',reject);});
    const members=inspectOwnedGroup(child.pid!);assert.ok(members.some(member=>member.pid===child.pid));assert.ok(members.every(member=>member.pgid===child.pid));
    const closed=new Promise(resolve=>child.once('close',resolve));killOwnedGroup(child.pid);await closed;
    assert.deepEqual(inspectOwnedGroup(child.pid!),[]);
    for(const value of [0,1,-1,NaN])assert.throws(()=>inspectOwnedGroup(value));
  }finally{killOwnedGroup(child.pid);}
});

test('OS process snapshots require complete parseable pid/group/state rows',()=>{
  assert.deepEqual(parseProcessGroups(' 12 12 Z+\n 13 12 S\n'),[{pid:12,pgid:12,state:'Z+'},{pid:13,pgid:12,state:'S'}]);
  for(const text of ['permission denied','12 12','12 nan Z','999999999999999999999 12 Z'])assert.throws(()=>parseProcessGroups(text));
});

test('EPERM only confirms cleanup when fresh OS evidence proves no executable group member',t=>{
  t.mock.method(process,'kill',()=>{throw Object.assign(new Error('kill EPERM'),{code:'EPERM'});});
  assert.deepEqual(killOwnedGroup(12345,()=>[]),{status:'absent',members:[]});
  assert.deepEqual(killOwnedGroup(12345,()=>[{pid:12346,pgid:12345,state:'Z+'},{pid:9,pgid:9,state:'S'}]),{status:'zombies_only',members:[12346]});
  for(const state of ['S','R','T','D'])assert.throws(()=>killOwnedGroup(12345,()=>[{pid:12346,pgid:12345,state}]),/EPERM/);
  assert.throws(()=>killOwnedGroup(12345,()=>[{pid:12346,pgid:12345,state:'Z'},{pid:12347,pgid:12345,state:'S'}]),/EPERM/);
  assert.throws(()=>killOwnedGroup(12345,()=>{throw Error('snapshot unavailable');}),/snapshot unavailable/);
});

test('non-EPERM permission errors never become successful cleanup',t=>{
  t.mock.method(process,'kill',()=>{throw Object.assign(new Error('kill EACCES'),{code:'EACCES'});});
  assert.throws(()=>killOwnedGroup(12345,()=>[]),/EACCES/);
});

test('cancellation kills a real parent and its child before either can write', async () => {
  const root = mkdtempSync(join(tmpdir(), 'helmdesk-process-')), target = join(root, 'escaped');
  const childProgram = `setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(target)},'bad'),500);setTimeout(()=>{},5000)`;
  const parentProgram = `require('child_process').spawn(process.execPath,['-e',${JSON.stringify(childProgram)}],{stdio:'ignore'});console.log('ready');setTimeout(()=>{},5000)`;
  const child = spawn(process.execPath, ['-e', parentProgram], { detached: true, stdio: ['ignore','pipe','pipe'] });
  try {
    await new Promise<void>((resolve,reject) => { child.stdout.once('data', () => resolve()); child.once('error',reject); });
    const closed = new Promise(resolve => child.once('close',resolve)); killOwnedGroup(child.pid); await closed;
    await new Promise(resolve => setTimeout(resolve,650)); assert.equal(existsSync(target), false);
  } finally { killOwnedGroup(child.pid); rmSync(root, { recursive: true, force: true }); }
});

test('cleanup EPERM in a close callback rejects execution without crashing the service loop', async () => {
  const { EventEmitter } = await import('node:events');
  const { watchOwnedProcess } = await import('../src/process.js');
  const child = Object.assign(new EventEmitter(), {pid:12345}) as unknown as import('node:child_process').ChildProcess;
  const errors: Error[] = [];
  const execution=watchOwnedProcess(child,error=>errors.push(error),()=>{throw Object.assign(new Error('kill EPERM'),{code:'EPERM'});});
  const rejected=assert.rejects(execution.finished,/清理未确认.*EPERM/);
  assert.doesNotThrow(()=>execution.cancel());
  assert.doesNotThrow(()=>child.emit('close',0));
  await rejected;assert.equal(errors.length,2);
});

test('spawn errors and normal close both settle owned execution', async () => {
  const { EventEmitter } = await import('node:events');
  const { watchOwnedProcess } = await import('../src/process.js');
  for(const event of ['error','close']){
    const child = Object.assign(new EventEmitter(), {pid:12345}) as unknown as import('node:child_process').ChildProcess;
    let kills=0;const execution=watchOwnedProcess(child,()=>assert.fail('unexpected cleanup error'),()=>{kills++;});
    if(event==='error'){const rejected=assert.rejects(execution.finished,/spawn failed/);child.emit('error',new Error('spawn failed'));await rejected;}
    else{child.emit('close',0);assert.deepEqual(await execution.finished,{code:0});}
    assert.equal(kills,1);
  }
});

test('model discovery timeout cleanup EPERM rejects the command instead of escaping its timer', async t => {
  const { runCommand } = await import('../src/qoder.js');
  const originalKill=process.kill;let ownedPid:number|undefined;
  const mocked=t.mock.method(process,'kill',(pid:number,signal?:NodeJS.Signals|number)=>{
    if(pid<0){ownedPid=-pid;throw Object.assign(new Error('kill EPERM'),{code:'EPERM'});}
    return originalKill.call(process,pid,signal);
  });
  try {await assert.rejects(runCommand(process.execPath,['-e','setTimeout(()=>{},5000)'],{timeoutMs:30}),/清理未确认.*EPERM/);}
  finally {mocked.mock.restore();killOwnedGroup(ownedPid);}
});
