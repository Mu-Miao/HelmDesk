import {constants, openSync, closeSync, fstatSync, readFileSync, realpathSync} from 'node:fs';
import {join} from 'node:path';

/** Read only owner-private state; the permanent bearer never reaches the page. */
export async function browserEntryURL(directory: string) {
  const fd = openSync(join(directory,'connection.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let connection: {service:string;protocolVersion:number;instanceId:string;dataDirectory:string;port:number;token:string};
  try {
    const stat=fstatSync(fd);
    if(!stat.isFile() || stat.uid!==process.getuid?.() || stat.mode&0o077 || stat.size>16384) throw Error('网页入口需要当前用户的私有连接记录');
    const bytes=readFileSync(fd);if(bytes.length>16384)throw Error('连接记录过大');
    connection=JSON.parse(bytes.toString('utf8'));
  } finally {closeSync(fd);}
  if(connection.service!=='helmdesk'||connection.protocolVersion!==1||connection.dataDirectory!==realpathSync(directory)||
     !/^[a-f0-9-]{36}$/.test(connection.instanceId)||!Number.isInteger(connection.port)||connection.port<1024||connection.port>65535||
     typeof connection.token!=='string'||connection.token.length!==64||!/^[a-f0-9]{64}$/.test(connection.token))throw Error('服务身份记录无效，请从应用重新连接');
  const origin=`http://127.0.0.1:${connection.port}`;
  const response=await fetch(`${origin}/api/browser-ticket`,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${connection.token}`,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('服务未授权网页入口，请在任务结束后重启新版后台');
  const text=await response.text();if(text.length>4096)throw Error('网页入口响应过大');
  const entry=JSON.parse(text);
  if(entry.instanceId!==connection.instanceId||typeof entry.ticket!=='string'||entry.ticket.length!==64||!/^[a-f0-9]{64}$/.test(entry.ticket))throw Error('网页入口与服务身份不符');
  return `${origin}/#helmdesk-ticket=${entry.ticket}`;
}
