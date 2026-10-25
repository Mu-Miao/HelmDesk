import {createDecipheriv,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {homedir,userInfo} from 'node:os';

/** Official ZCode local AES-GCM format. Values stay in host memory, never in task files/logs. */
export function decodeZcodeCredential(value:string) {
  if(!value.startsWith('enc:v1:'))throw Error('ZCode 认证格式未验证；请使用官方应用登录');
  const parts=value.slice(7).split('.');if(parts.length!==3)throw Error('ZCode 认证格式无效');
  const [iv,tag,data]=parts.map(p=>Buffer.from(p,'base64url'));
  if(iv!.length!==12||tag!.length!==16)throw Error('ZCode 认证格式无效');
  try {
    const key=createHash('sha256').update(`zcode-credential-fallback:${process.platform}:${homedir()}:${userInfo().username}`).digest();
    const cipher=createDecipheriv('aes-256-gcm',key,iv!);cipher.setAuthTag(tag!);
    return Buffer.concat([cipher.update(data!),cipher.final()]).toString('utf8');
  }catch{throw Error('ZCode 本机认证无法解密；不会导入其他凭据');}
}
/** ZCode's official Start Plan authenticates with the existing product JWT. No API key issuance. */
export async function zcodeRequestAuth(credentials:string,providerId:string,signal:AbortSignal) {
  signal.throwIfAborted();
  if(providerId!=='account:bigmodel-start-plan')throw Error('ZCode 仅支持已固定的 BigModel Start Plan，不自动切换付费套餐');
  try {
    const raw=JSON.parse(readFileSync(credentials,'utf8'));
    const token=decodeZcodeCredential(raw.zcodejwttoken);
    if(!token.trim()||/[\r\n]/.test(token))throw Error();
    return {headersApplied:true,requestAuth:{apiKey:token}};
  }catch{throw Error('ZCode 认证不可用；请先在官方应用登录，不自动重试或换 Key');}
}
