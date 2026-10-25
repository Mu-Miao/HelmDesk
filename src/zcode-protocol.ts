import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';

/** Bounded LF-framed official app-server protocol. Never executes a server request. */
export class ZcodeProtocol {
  private sequence=0;
  private buffer='';
  private bytes=0;
  private readonly decoder=new StringDecoder('utf8');
  private readonly pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private failure:Error|undefined;
  constructor(private readonly child:ChildProcessWithoutNullStreams,private readonly stop:()=>void,private readonly authorize?:(method:string,params:any)=>Promise<unknown>) {
    child.stdout.on('data',chunk=>{
      this.bytes+=chunk.length;
      if(this.bytes>4_000_000)return this.fail('ZCode 协议输出超出限制');
      this.buffer+=this.decoder.write(chunk);
      if(this.buffer.length>1_000_000)return this.fail('ZCode 单帧超出限制');
      let split:number;
      while((split=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,split);this.buffer=this.buffer.slice(split+1);if(line.trim())this.receive(line);}
    });
    child.on('error',()=>this.fail('ZCode 进程启动失败'));
    child.on('close',()=>this.fail('ZCode 在协议完成前退出'));
    child.stdin.on('error',()=>this.fail('ZCode 协议输入中断'));
  }
  private receive(line:string) {
    if(this.failure)return;
    try {
      const value=JSON.parse(line);
      if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid frame');
      if(Object.hasOwn(value,'method')){
        if(typeof value.method!=='string'||!value.method.length||value.method.length>200)throw Error('Invalid method');
        if(value.id!==undefined){
          if(!validId(value.id))throw Error('Invalid request id');
          void this.answer(value.id,value.method,value.params).catch(()=>this.fail('ZCode 反向请求响应失败'));
        }
        return;
      }
      if(!validId(value.id))throw Error('Invalid response id');
      const pending=typeof value.id==='number'?this.pending.get(value.id):undefined;
      if(!pending)throw Error('Unexpected response');
      const hasError=Object.hasOwn(value,'error'),hasResult=Object.hasOwn(value,'result');
      // Validate while the promise is still registered, so fail() always settles it.
      if(hasError===hasResult||hasError&&(!value.error||typeof value.error.message!=='string'))throw Error('Missing or ambiguous result');
      clearTimeout(pending.timer);this.pending.delete(value.id);
      if(hasError)pending.reject(Error(zcodeFailure(value.error.message)));
      else pending.resolve(value.result);
    } catch {this.fail('ZCode 返回无效或重复协议帧');}
  }
  private async answer(id:number|string,method:string,params:any) {
    let response:unknown;
    try {
      if(!this.authorize)throw Error();
      response={id,result:await this.authorize(method,params)};
    }catch{response={id,error:{code:-32601,message:'Host interaction is disabled or authentication failed'}};}
    if(!this.failure)this.child.stdin.write(JSON.stringify(response)+'\n');
  }
  private fail(message:string) {
    if(this.failure)return;
    this.failure=Error(message);
    for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(this.failure);}
    this.pending.clear();this.stop();
  }
  request(method:string,params:unknown,timeoutMs=30000):Promise<any> {
    if(this.failure)return Promise.reject(this.failure);
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.fail('ZCode 协议请求超时'),timeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      this.child.stdin.write(JSON.stringify({id,method,params})+'\n');
    });
  }
  close(){this.child.stdin.end();}
}

function validId(value:unknown):value is string|number {
  return typeof value==='string'&&value.length>0&&value.length<=200||typeof value==='number'&&Number.isSafeInteger(value);
}

export function zcodeFailure(message:unknown) {
  const text=typeof message==='string'?message:'';
  if(/unusual activity|risk.control|风控|安全验证/i.test(text))return 'ZCode 上游风控拦截；请在官方应用检查账号状态，本任务不自动重试';
  if(/1113|余额不足|quota|insufficient|资源包/i.test(text))return 'ZCode 套餐额度不可用；请在官方应用检查额度，本任务不自动重试或换套餐';
  if(/unauthori[sz]ed|login|expired|认证|登录|401/i.test(text))return 'ZCode 登录不可用；请在官方应用检查登录，本任务不自动重试';
  return 'ZCode 拒绝请求；请检查账号套餐、额度或运行时协议（不自动重试）';
}
