import {createServer} from 'node:http';
import {ollamaOrigin} from './ollama.js';
export interface OllamaReceipt {model:string;inputTokens:number|null;outputTokens:number|null}
export async function ollamaGateway(model:string,upstream=ollamaOrigin){
  let requests=0,receipt:OllamaReceipt|null=null;
  const routes:{method:string;path:string;model?:string;keys?:string[]}[]=[];
  const controllers=new Set<AbortController>();
  const server=createServer(async(req,res)=>{
    const fail=(code:number,message:string)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify({error:message}));};
    if(req.headers.origin||req.headers['sec-fetch-site']==='cross-site'){fail(403,'只允许当前 CLI');return;}
    const path=req.url;
    if(routes.length<100)routes.push({method:req.method??'',path:path??''});
    if(req.headers.host!==`127.0.0.1:${(server.address() as {port:number}|null)?.port}`){fail(403,'本机 Host 不匹配');return;}
    if((req.method==='GET'||req.method==='HEAD')&&path==='/'){res.end(req.method==='HEAD'?undefined:'Ollama is running');return;}
    if(req.method==='GET'&&path==='/api/version'){try{const r=await fetch(`${upstream}/api/version`,{signal:AbortSignal.timeout(3000)}),text=await r.text();if(!r.ok||text.length>10000||typeof JSON.parse(text).version!=='string')throw Error('版本不可用');res.setHeader('Content-Type','application/json');res.end(text);}catch{fail(502,'未取得本地服务版本');}return;}
    if(req.method!=='POST'||!['/api/show','/api/generate'].includes(path??'')||!req.headers['content-type']?.startsWith('application/json')){fail(403,'只开放当前本地模型的一次生成；禁止下载、删除和配置');return;}
    const controller=new AbortController();controllers.add(controller);res.once('close',()=>controller.abort());
    try{
      let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>100000)throw Error('请求过大');}
      const value=JSON.parse(body);
      const requested=value.model||value.name;
      const route=routes.at(-1);if(route){route.model=String(requested??'');route.keys=Object.keys(value);}
      if(requested!==model||(value.model&&value.name&&value.model!==value.name)||value.images?.length)throw Error('模型或输入范围不匹配');
      if(path==='/api/generate'&&++requests>1)throw Error('本任务只允许一次生成请求');
      const response=await fetch(`${upstream}${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(600000)])});
      res.writeHead(response.status,{'Content-Type':response.headers.get('content-type')??'application/json'});
      if(!response.body){res.end();return;}
      let buffered='',bytes=0;const decoder=new TextDecoder();
      for await(const chunk of response.body){
        bytes+=chunk.length;if(bytes>2_000_000)throw Error('响应过大');res.write(chunk);
        if(path==='/api/generate'){
          buffered+=decoder.decode(chunk,{stream:true});const lines=buffered.split('\n');buffered=lines.pop()??'';
          for(const line of lines){if(!line.trim())continue;const event=JSON.parse(line);if(event.done===true){if(event.model!==model)throw Error('本地服务报告的模型与请求不一致');const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;receipt={model:event.model,inputTokens:count(event.prompt_eval_count),outputTokens:count(event.eval_count)};}}
        }
      }
      if(path==='/api/generate'&&buffered.trim()){
        const event=JSON.parse(buffered);if(event.done===true&&event.model===model){const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;receipt={model:event.model,inputTokens:count(event.prompt_eval_count),outputTokens:count(event.eval_count)};}
      }
      res.end();
    }catch(error){if(!res.headersSent)fail(400,error instanceof Error?error.message:'任务网关拒绝');else res.destroy();}
    finally{controllers.delete(controller);}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=(server.address() as {port:number}).port;
  return{port,url:`http://127.0.0.1:${port}`,receipt:()=>receipt,requests:()=>requests,routes:()=>routes.map(r=>({...r})),async close(){for(const c of controllers)c.abort();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
