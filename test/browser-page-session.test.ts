import {test} from 'node:test';
import assert from 'node:assert/strict';

test('page clears bootstrap capability, shares concurrent exchanges and accepts a later same-page entry',async()=>{
  const originalFetch=globalThis.fetch,originalWindow=(globalThis as any).window;
  const location={hash:'#helmdesk-ticket='+ 'a'.repeat(64),pathname:'/',search:''};
  const calls:{path:string;body?:string}[]=[];
  const storage=new Map<string,string>();
  let authorized=false,expected='a'.repeat(64),sequence=0;
  (globalThis as any).window={location,sessionStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)},history:{replaceState(){location.hash='';}}};
  globalThis.fetch=(async(input:unknown,init?:RequestInit)=>{
    calls.push({path:String(input),body:init?.body as string|undefined});
    assert.equal(init?.credentials,'omit');
    if(init?.method!=='POST'&&authorized)assert.equal(new Headers(init?.headers).get('X-HelmDesk-Session'),'c'.repeat(64));
    if(init?.method==='POST'){
      assert.equal(location.hash,'','capability must leave the address before exchange');
      assert.equal(JSON.parse(init.body as string).ticket,expected);authorized=true;sequence++;
    }
    return new Response(JSON.stringify(authorized?{csrf:`fixture-${sequence}`,browserToken:'c'.repeat(64)}:{error:'unauthorized'}),{status:authorized?200:401});
  }) as typeof fetch;
  try{
    const moduleURL=new URL('../web/src/session.ts',import.meta.url);moduleURL.searchParams.set('fixture','fresh');
    const {browserSession}=await import(moduleURL.href);
    const [a,b]=await Promise.all([browserSession(),browserSession()]);
    assert.deepEqual(a,b);assert.equal(a.csrf,'fixture-1');assert.equal(calls.filter(c=>c.body).length,1);
    await browserSession();assert.equal(calls.filter(c=>c.body).length,1);
    moduleURL.searchParams.set('fixture','reload');
    const reloaded=await import(moduleURL.href);
    assert.equal((await reloaded.browserSession()).csrf,'fixture-1');
    assert.equal(reloaded.sessionHeaders()['X-HelmDesk-Session'],'c'.repeat(64));
    authorized=false;expected='b'.repeat(64);location.hash='#helmdesk-ticket='+expected;
    assert.equal((await browserSession()).csrf,'fixture-2');assert.equal(location.hash,'');assert.equal(calls.filter(c=>c.body).length,2);
  }finally{globalThis.fetch=originalFetch;if(originalWindow===undefined)delete (globalThis as any).window;else (globalThis as any).window=originalWindow;}
});
