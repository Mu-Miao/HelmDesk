import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workerContract,FileTaskProgress} from '../src/worker-contract.js';

const spec={mode:'files' as const,cwd:'/fixture/task/workspace',allowedFiles:['src/example.ts'],maxTurns:18,gatewayTools:[]};
test('file contract describes actual tools and write scope, assigns command validation to host',()=>{
  const text=workerContract(spec);
  assert.ok(text.includes('Registered tools: ["Read","Write","Edit","Glob","Grep"]'));
  assert.ok(text.includes('Allowed write paths (workspace-relative): ["src/example.ts"]'));
  assert.match(text,/maximum of 18 model turns/);
  assert.match(text,/Bash, Shell, terminal.*unavailable/);
  assert.match(text,/Codex runs npm, tests, builds and Git operations independently/);
  assert.match(text,/not claim they passed/);
  assert.match(text,/without look-around/);
});
test('probe and shared contracts do not advertise native file tools or unselected gateway tools',()=>{
  const selected=['mcp__helm__call'];
  const shared=workerContract({...spec,mode:'shared',gatewayTools:selected});
  assert.ok(shared.includes('Registered tools: ["mcp__helm__call"]'));
  assert.match(shared,/Do not read or modify local project files/);
  const probe=workerContract({...spec,mode:'probe',gatewayTools:selected,maxTurns:undefined});
  assert.ok(probe.includes('Registered tools: []'));
  assert.match(probe,/without tools/);assert.ok(!probe.includes('mcp__helm__call'));
  assert.match(probe,/did not request a turn limit/);
});
test('files mode without allowed write paths remains explicitly read-only',()=>{
  const text=workerContract({...spec,allowedFiles:[]});
  assert.match(text,/No write paths were granted/);
  assert.match(text,/Do not modify files/);
  assert.ok(!text.includes('implement the requested change early'));
});
test('scope strings stay quoted data and the progress checkpoint does not widen permissions or retry',()=>{
  const text=workerContract({...spec,cwd:'/fixture/"\nworkspace',allowedFiles:['src/a\n.ts']});
  assert.ok(text.includes(JSON.stringify('/fixture/"\nworkspace')));
  assert.ok(text.includes(JSON.stringify(['src/a\n.ts'])));
  const progress=new FileTaskProgress(true);
  for(let i=0;i<7;i++)assert.equal(progress.record(i%2?'Read':'Grep'),undefined);
  assert.equal(progress.record('mcp__helm__call'),undefined);
  assert.equal(progress.record('Bash'),undefined);
  assert.match(progress.record('Glob')!,/8 completed read\/search calls and no completed Write\/Edit/);
  for(let i=0;i<7;i++)assert.equal(progress.record('Read'),undefined);
  assert.match(progress.record('Read')!,/16 completed/);
  progress.record('Edit');for(let i=0;i<16;i++)assert.equal(progress.record('Read'),undefined);
  const disabled=new FileTaskProgress(false);for(let i=0;i<16;i++)assert.equal(disabled.record('Read'),undefined);
});
