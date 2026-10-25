import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {ZcodeProtocol} from '../src/zcode-protocol.js';

function fixture() {
  const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stdin:new PassThrough()});
  child.stdin.resume();let stops=0;
  const protocol=new ZcodeProtocol(child as unknown as ChildProcessWithoutNullStreams,()=>{stops++;});
  return {child,protocol,stops:()=>stops,frame:(value:unknown)=>child.stdout.write(JSON.stringify(value)+'\n')};
}
test('malformed matching frames always settle outstanding requests before stopping the child',{timeout:1000},async()=>{
  for(const response of [{id:1},{id:1,result:null,error:{message:'ambiguous'}},{id:1,error:null},{id:1,error:{}},null,[]]){
    const f=fixture(),pending=f.protocol.request('workspace/generateText',{},500);
    f.frame(response);
    await assert.rejects(pending,/无效/);assert.equal(f.stops(),1);
    await assert.rejects(f.protocol.request('next',{}),/无效/);
  }
});
test('reverse requests reject object/oversized/nonfinite ids without an unhandled async rejection',{timeout:1000},async()=>{
  for(const id of [{deep:{nested:true}},['nested'],'x'.repeat(201),null]){
    const f=fixture(),pending=f.protocol.request('pending',{},500);
    f.frame({id,method:'interaction/requestProviderRuntimeHeaders',params:{}});
    await assert.rejects(pending,/无效/);assert.equal(f.stops(),1);
  }
});
test('LF framing preserves Unicode separators across UTF-8 byte splits and process exit settles remaining work',async()=>{
  const f=fixture(),pending=f.protocol.request('fixture',{}),bytes=Buffer.from(JSON.stringify({id:1,result:'你好\u2028尾'})+'\n');
  for(const byte of bytes)f.child.stdout.write(Buffer.from([byte]));
  assert.equal(await pending,'你好\u2028尾');
  const second=f.protocol.request('second',{});f.child.emit('close');await assert.rejects(second,/退出/);
});
