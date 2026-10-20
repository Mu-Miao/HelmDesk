interface BrowserSession { csrf: string; browserToken?:string }
let pending: Promise<BrowserSession> | undefined;
let ticket: string | undefined;
let token:string|undefined;
const storageKey='helmdesk-browser-session';

export function sessionHeaders():Record<string,string> {
  if(!token){try{token=window.sessionStorage.getItem(storageKey)??undefined;}catch{/* Memory-only session if storage is unavailable. */}}
  return token&&/^[a-f0-9]{64}$/.test(token)?{'X-HelmDesk-Session':token}:{};
}

/** Accept fresh same-page entries too; remove the capability before network work. */
function entryTicket() {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  if (fragment.has('helmdesk-ticket')) {
    ticket = fragment.get('helmdesk-ticket') ?? undefined;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}

export function browserSession(): Promise<BrowserSession> {
  entryTicket();
  if (pending) return pending;
  pending = (async () => {
    let response:Response;
    if (ticket !== undefined) {
      const value = ticket; ticket = undefined;
      response = await fetch('/api/session', {method:'POST',credentials:'omit',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticket:value})});
    } else response = await fetch('/api/session',{credentials:'omit',redirect:'error',headers:sessionHeaders()});
    if (!response.ok) throw Error(response.status === 401 ? '请从领航台应用的“浏览器”按钮或本机 CLI 网页入口重新打开。' : '网页会话未建立，请重新连接。');
    const result=await response.json() as BrowserSession;
    if(result.browserToken){
      if(!/^[a-f0-9]{64}$/.test(result.browserToken))throw Error('网页会话格式无效');
      token=result.browserToken;
      try{window.sessionStorage.setItem(storageKey,token);}catch{/* Keep the capability in memory only. */}
    }
    return result;
  })().finally(() => { pending = undefined; });
  return pending;
}
