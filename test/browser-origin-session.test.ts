import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BrowserSessions} from '../src/browser-session.js';

test('browser capabilities expire, reject malformed values and bound live sessions without revoking other tabs',()=>{
  let now=0;const sessions=new BrowserSessions(()=>now),first=sessions.issue();
  assert.match(first.browserToken,/^[a-f0-9]{64}$/);
  assert.equal(sessions.get(first.browserToken)?.csrf,first.csrf);
  for(const value of [undefined,['a'.repeat(64)],'a'.repeat(63),'G'.repeat(64),'wrong'])assert.equal(sessions.get(value),undefined);
  for(let i=1;i<128;i++)sessions.issue();
  assert.throws(()=>sessions.issue(),/会话过多/);assert.ok(sessions.get(first.browserToken));
  now=12*60*60*1000;assert.equal(sessions.get(first.browserToken),undefined);assert.ok(sessions.issue());
});

test('fetch event stream authenticates with an explicit header, handles split frames and cancels the reader',async()=>{
  const originalFetch=globalThis.fetch,originalWindow=(globalThis as any).window;
  (globalThis as any).window={sessionStorage:{getItem:()=> 'c'.repeat(64)}};
  const controller=new AbortController();let opened=0,events=0,cancelled=false;
  const bytes=new TextEncoder();const chunks=[': heartbeat\n\n','id: 3\nda','ta: {}\n','\nid: 4\ndata: {}\n\n'];
  globalThis.fetch=(async(url:unknown,init?:RequestInit)=>{
    assert.equal(url,'/api/events?after=2');assert.equal(init?.credentials,'omit');assert.equal(init?.signal,controller.signal);
    assert.equal(new Headers(init?.headers).get('X-HelmDesk-Session'),'c'.repeat(64));
    return new Response(new ReadableStream({pull(c){const next=chunks.shift();if(next)c.enqueue(bytes.encode(next));},cancel(){cancelled=true;}}),{headers:{'Content-Type':'text/event-stream'}});
  }) as typeof fetch;
  try{
    const {eventStream}=await import('../web/src/event-stream.js');
    await eventStream(2,controller.signal,()=>opened++,()=>{if(++events===2)controller.abort();});
    assert.equal(opened,1);assert.equal(events,2);assert.equal(cancelled,true);
  }finally{globalThis.fetch=originalFetch;if(originalWindow===undefined)delete (globalThis as any).window;else (globalThis as any).window=originalWindow;}
});
