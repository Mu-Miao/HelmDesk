import{test}from'node:test';import assert from'node:assert/strict';
import{createElement}from'react';import{renderToStaticMarkup}from'react-dom/server';
import MarkdownResult from'../web/src/MarkdownResult.js';
import{EventTimeline}from'../web/src/EventTimeline.js';
const render=(text:string)=>renderToStaticMarkup(createElement(MarkdownResult,{text}));
test('summary renders structured headings, lists, inline code, code blocks and GFM tables',()=>{
 const html=render('# 交付\n\n完成 **核心模块**，路径 `src/a.ts`。\n\n- 第一项\n- 第二项\n\n```ts\nconst value = 1;\n```\n\n| 文件 | 结果 |\n| --- | --- |\n| a.ts | 通过 |');
 for(const fragment of ['<h4>交付</h4>','<strong>核心模块</strong>','<code>src/a.ts</code>','<ul>','<li>第一项</li>','<pre>','language-ts','<table>','<th>文件</th>','<td>通过</td>'])assert.ok(html.includes(fragment),fragment);
});
test('raw HTML, executable URLs and remote images never become executable or fetched elements',()=>{
 const html=render('<script>alert(1)</script>\n\n<iframe src="https://outside.test"></iframe>\n\n[bad](javascript:alert%281%29) [data](data:text/html,test) ![封面](https://outside.test/image.png)\n\n[good](https://example.com/docs)');
 assert.ok(!/<script|<iframe|<img|href="(?:javascript|data):/i.test(html));assert.ok(html.includes('[图片：封面]'));assert.ok(html.includes('href="https://example.com/docs"'));assert.ok(html.includes('rel="noopener noreferrer"'));assert.ok(html.includes('target="_blank"'));
});
test('HTML-looking code and nested Markdown stay readable text with escaped markup',()=>{
 const html=render('```html\n<script>literal()</script>\n```\n\n> 引用\n\n1. 父项目\n   - 子项目\n\n- [x] 已完成');
 assert.ok(html.includes('&lt;script&gt;literal()&lt;/script&gt;'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('<blockquote>'));assert.ok(html.includes('<ol>'));assert.ok(html.includes('type="checkbox"'));assert.ok(html.includes('disabled'));
});
test('timeline describes events, filters empty transport messages, and leaves JSON folded',()=>{
 const html=renderToStaticMarkup(createElement(EventTimeline,{events:[
 {seq:1,taskId:'fixture',type:'state',at:'2026-10-17T00:00:00Z',data:{state:'completed'}},
 {seq:2,taskId:'fixture',type:'assistant',at:'2026-10-17T00:00:01Z',data:{content:[]}},
 {seq:3,taskId:'fixture',type:'policy',at:'2026-10-17T00:00:02Z',data:{tool:'Write',allowed:true,reason:'范围通过'}},
 {seq:4,taskId:'fixture',type:'stderr',at:'2026-10-17T00:00:03Z',data:'<script>not executable</script>'},
 ]}));
 assert.ok(html.includes('3 条事件'));assert.ok(html.includes('任务状态'));assert.ok(html.includes('已完成'));assert.ok(html.includes('权限检查'));assert.ok(html.includes('Write · 允许'));assert.ok(html.includes('原始记录 · #3'));assert.ok(!html.includes('原始记录 · #2'));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<details class="event-raw" open'));
});
