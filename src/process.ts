import type { ChildProcess } from 'node:child_process';
import {execFileSync} from 'node:child_process';
export interface GroupMember {pid:number;pgid:number;state:string}
export interface GroupCleanup {status:'signalled'|'absent'|'zombies_only';members:number[]}
export function parseProcessGroups(output:string):GroupMember[]{
  return output.split(/\r?\n/).filter(line=>line.trim()).map(line=>{
    const match=/^\s*(\d+)\s+(\d+)\s+([A-Za-z+<>=\-]+)\s*$/.exec(line);
    if(!match)throw Error('进程快照格式无法确认');
    const pid=Number(match[1]),pgid=Number(match[2]);
    if(!Number.isSafeInteger(pid)||pid<0||!Number.isSafeInteger(pgid)||pgid<0)throw Error('进程快照编号无效');
    return{pid,pgid,state:match[3]!};
  });
}
function inspectGroups(){
  return parseProcessGroups(execFileSync('/bin/ps',['-axo','pid=,pgid=,stat='],{encoding:'utf8',timeout:2000,maxBuffer:4_000_000}));
}
// Only call for detached process groups created and owned by HelmDesk.
export function killOwnedGroup(pid: number | undefined,inspect=inspectGroups):GroupCleanup {
  if (!pid || !Number.isSafeInteger(pid) || pid <= 1) return{status:'absent',members:[]};
  try { process.kill(-pid, 'SIGKILL');return{status:'signalled',members:[]}; }
  catch (error: any) {
    if(error.code==='ESRCH')return{status:'absent',members:[]};
    if(error.code==='EPERM'){
      // macOS can reject killpg for an exited group whose remaining members are zombies.
      // An explicit fresh OS snapshot is required: EPERM alone never proves termination.
      const members=inspect().filter(member=>member.pgid===pid);
      if(!members.length)return{status:'absent',members:[]};
      if(members.every(member=>member.state.startsWith('Z')))return{status:'zombies_only',members:members.map(m=>m.pid)};
    }
    throw error;
  }
}

// Event callbacks and timeout handlers must not throw out of the service loop.
// Preserve cleanup failures as a rejected execution, never as successful termination.
export function watchOwnedProcess(child: ChildProcess, onCleanupError: (error: Error) => void, terminate:(pid:number|undefined)=>unknown = killOwnedGroup,onCleanup?:(result:GroupCleanup)=>void) {
  let cleanupError: Error | undefined;
  function cancel() {
    try { const result=terminate(child.pid);cleanupError=undefined;if(result)onCleanup?.(result as GroupCleanup);return{confirmed:true}; }
    catch (error) {
      cleanupError = new Error(`进程组清理未确认：${error instanceof Error ? error.message : String(error)}`);
      onCleanupError(cleanupError);
      return{confirmed:false,error:cleanupError.message};
    }
  }
  const finished = new Promise<{code:number|null}>((resolve, reject) => {
    child.once('error', error => { cancel(); reject(cleanupError ?? error); });
    child.once('close', code => { cancel(); cleanupError ? reject(cleanupError) : resolve({code}); });
  });
  return {finished, pid:child.pid, cancel};
}
