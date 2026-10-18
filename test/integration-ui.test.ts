import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {IntegrationPreviewView} from '../web/src/IntegrationPreview.js';
import type {IntegrationPreview} from '../src/integration-types.js';
const preview:IntegrationPreview={schemaVersion:1,taskId:'fixture',checkedAt:'2026-10-17T06:00:00Z',fingerprint:'a'.repeat(64),status:'ready',canExport:true,counts:{ready:1,conflict:0,blocked:0,alreadyApplied:0},files:[{path:'<script>literal</script>.txt',kind:'added',baseline:null,current:null,delivered:{sha256:'b'.repeat(64),bytes:3},status:'ready',reason:'尚未写入原项目'}],limitations:['只读检查']};
function render(value:IntegrationPreview|null,busy=false){return renderToStaticMarkup(createElement(IntegrationPreviewView,{preview:value,busy,onCheck(){throw Error('SSR must not execute actions');},onExport(){throw Error('SSR must not execute actions');}}));}
test('integration preview escapes paths, separates status/stamps and keeps credentials folded',()=>{
  const html=render(preview);assert.ok(html.includes('可导出补丁'));assert.ok(html.includes('可整合：1'));assert.ok(html.includes('&lt;script&gt;literal&lt;/script&gt;.txt'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('摘要凭据'));assert.ok(!html.includes('<details class="integration-details" open'));assert.ok(!html.includes('fingerprint'));assert.ok(!html.includes(preview.fingerprint));
});
test('empty, blocked and busy views cannot offer an active export action',()=>{
  for(const [value,busy]of [[null,false],[{...preview,status:'blocked',canExport:false},false],[preview,true]]as const){const html=render(value,busy);assert.match(html,/<button[^>]*disabled=""[^>]*>导出补丁<\/button>/);}
  assert.ok(render(preview,true).includes('正在检查…'));assert.ok(render(null).includes('检查整合条件'));assert.ok(render({...preview,files:[]}).includes('没有需要整合的文件'));
});
