import{spawn}from'node:child_process';import{existsSync,readFileSync,writeFileSync,unlinkSync,openSync,closeSync}from'node:fs';import{join}from'node:path';import{fileURLToPath}from'node:url';
const alive=(pid:number)=>{if(!Number.isSafeInteger(pid)||pid<=1)throw Error('服务进程记录无效');try{process.kill(pid,0);return true;}catch(e:any){if(e.code==='ESRCH')return false;throw e;}};
export async function ensureLocalService(directory:string,concurrency=1){
  if(![1,2].includes(concurrency))throw Error('并发数必须为 1 或 2');let port=4317;
  const connection=join(directory,'connection.json'),serviceLock=join(directory,'service.lock'),startLock=join(directory,'autostart.lock');
  async function ready(){
    if(!existsSync(connection))return false;
    const c=JSON.parse(readFileSync(connection,'utf8'));if(!Number.isInteger(c.port)||c.port<1||c.port>65535||typeof c.token!=='string')throw Error('连接记录无效');port=c.port;
    try{const r=await fetch(`http://127.0.0.1:${c.port}/api/tool/queue_get`,{method:'POST',headers:{Authorization:`Bearer ${c.token}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(500)});if(!r.ok)throw Error('现有服务身份校验未通过');await r.json();return true;}catch(e:any){if(e.cause?.code==='ECONNREFUSED'||e.name==='TimeoutError')return false;throw e;}
  }
  if(await ready())return;
  if(existsSync(serviceLock)&&alive(Number(readFileSync(serviceLock,'utf8')))){
    for(let i=0;i<60;i++){if(await ready())return;await new Promise(r=>setTimeout(r,100));}
    throw Error('已有服务进程但连接未确认，不自动启动第二个实例');
  }
  let owned=false;
  try{
    if(existsSync(startLock)){const pid=Number(readFileSync(startLock,'utf8'));if(!alive(pid))unlinkSync(startLock);}
    try{writeFileSync(startLock,String(process.pid),{flag:'wx',mode:0o600});owned=true;}catch(e:any){if(e.code!=='EEXIST')throw e;}
    if(owned){
      if(await ready())return;
      const stdout=openSync(join(directory,'service.stdout.log'),'a',0o600),stderr=openSync(join(directory,'service.stderr.log'),'a',0o600);
      try{const cli=fileURLToPath(new URL('./cli.js',import.meta.url)),root=fileURLToPath(new URL('../',import.meta.url));const child=spawn(process.execPath,[cli,'serve','--data-dir',directory,'--port',String(port),'--concurrency',String(concurrency)],{cwd:root,detached:true,stdio:['ignore',stdout,stderr]});child.on('error',()=>{});child.unref();}finally{closeSync(stdout);closeSync(stderr);}
    }
    for(let i=0;i<60;i++){if(await ready())return;await new Promise(r=>setTimeout(r,100));}
    throw Error('本地服务尚未就绪；请检查数据目录中的服务日志，不自动重复创建执行请求');
  }finally{if(owned&&existsSync(startLock)&&readFileSync(startLock,'utf8')===String(process.pid))unlinkSync(startLock);}
}
