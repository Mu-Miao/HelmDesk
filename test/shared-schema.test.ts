import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileSharedSchema} from '../src/shared-schema.js';

test('read-only MCP accepts both older schemas and Context7 draft 2020-12 without dropping validation',()=>{
  const schema={type:'object',properties:{query:{type:'string',minLength:1}},required:['query'],additionalProperties:false};
  for(const inputSchema of [schema,{$schema:'https://json-schema.org/draft/2020-12/schema',...schema}]){
    const validate=compileSharedSchema(inputSchema);
    assert.equal(validate({query:'React hooks'}),true);
    for(const input of [{},{query:7},{query:''},{query:'valid',extra:true}])assert.equal(validate(input),false);
  }
  assert.throws(()=>compileSharedSchema({$schema:'https://invalid.example/schema',type:'object'}));
});
