import {sessionHeaders} from './session.js';

/** Fetch permits an origin-scoped capability header; EventSource cannot. */
export async function eventStream(after:number,signal:AbortSignal,onOpen:()=>void,onEvent:()=>void) {
  const response=await fetch(`/api/events?after=${after}`,{credentials:'omit',redirect:'error',headers:sessionHeaders(),signal});
  if(!response.ok||!response.headers.get('content-type')?.startsWith('text/event-stream')||!response.body)throw Error('实时事件连接失败');
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let pending='';
  try{
    onOpen();
    while(!signal.aborted){
      const result=await reader.read();if(result.done)throw Error('实时事件连接已关闭');
      pending+=decoder.decode(result.value,{stream:true});
      let end:number;
      while((end=pending.indexOf('\n\n'))!==-1){
        const frame=pending.slice(0,end);pending=pending.slice(end+2);
        if(frame.split('\n').some(line=>line.startsWith('data:')))onEvent();
      }
      if(pending.length>2_000_000)throw Error('实时事件过大');
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
