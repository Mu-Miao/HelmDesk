import { mkdirSync, mkdtempSync, realpathSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { runCommand } from './qoder.js';

const literal = (path: string) => JSON.stringify(path);
export function protectedSourceRoots(additional: string[] = []) {
  return [...new Set([join(homedir(),'.codex'),join(homedir(),'.agents'),...additional].flatMap(path=>existsSync(path)?[resolve(path),realpathSync(path)]:[resolve(path)]))];
}
export function sandboxProfile(writeRoot: string, protectedRoots: string[] = protectedSourceRoots(), readOnlyRoots: string[] = []): string {
  const root = realpathSync(writeRoot);
  if (root === '/' || root === homedir()) throw new Error('拒绝宽泛沙箱写入目录');
  return `(version 1)
(allow default)
(deny file-write*)
(allow file-write* (subpath ${literal(root)}) (literal "/dev/null") (literal "/dev/tty") (literal "/dev/stdout") (literal "/dev/stderr"))
${protectedRoots.map(p => `(deny file-read* file-write* (subpath ${literal(existsSync(p) ? realpathSync(p) : resolve(p))}))`).join('\n')}
${readOnlyRoots.map(p => `(deny file-write* (subpath ${literal(realpathSync(p))}))`).join('\n')}
`;
}

export async function verifyTaskIsolation(directory:string, protectedRoots:string[], snapshotRoot:string) {
  const checks:string[]=[];
  const probe=join(directory,'isolation'); mkdirSync(probe,{recursive:true,mode:0o700});
  const marker=join(snapshotRoot,'readonly-sentinel'); writeFileSync(marker,'unchanged',{mode:0o600});
  function existingFile(root:string,depth=0):string|undefined {
    if(!existsSync(root)) return;
    if(lstatSync(root).isFile()) return root;
    if(depth>2) return;
    for(const entry of readdirSync(root,{withFileTypes:true}).slice(0,50)) if(entry.isFile()) return join(root,entry.name);
    for(const entry of readdirSync(root,{withFileTypes:true}).slice(0,50)) if(entry.isDirectory()) {const file=existingFile(join(root,entry.name),depth+1);if(file)return file;}
  }
  const targets=protectedRoots.map(root=>existingFile(root)).filter((path):path is string=>!!path);
  // O_WRONLY without O_TRUNC never changes content, even if the protection unexpectedly fails.
  const program=`const fs=require('fs');const blocked=[];fs.writeFileSync(${JSON.stringify(join(probe,'allowed'))},'ok');for(const p of ${JSON.stringify([...targets,marker])}){try{const fd=fs.openSync(p,fs.constants.O_WRONLY);fs.closeSync(fd);process.exit(9)}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e;blocked.push(p)}}try{fs.chmodSync(${JSON.stringify(marker)},0o600);process.exit(10)}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e}if(fs.readFileSync(${JSON.stringify(marker)},'utf8')!=='unchanged')process.exit(11);console.log(JSON.stringify({blocked:blocked.length}));`;
  const result=await runCommand('/usr/bin/sandbox-exec',['-p',sandboxProfile(directory,protectedRoots,[snapshotRoot]),process.execPath,'-e',program]);
  const verified=result.code===0&&result.stdout.includes(`"blocked":${targets.length+1}`)&&readFileSync(marker,'utf8')==='unchanged';
  if(verified) checks.push('任务目录写入成功','只读快照可读、写入及 chmod 被拒绝',`实际来源文件无截断写入打开被拒绝（${targets.length} 项）`);
  return {verified,checks,protectedRoots};
}

export function mcpSandboxProfile(writeRoot:string, workspace:string, codeRoots:string[], protectedRoots:string[],loopbackPort?:number) {
  if(loopbackPort!==undefined&&(!Number.isInteger(loopbackPort)||loopbackPort<1||loopbackPort>65535))throw Error('回环端口无效');
  const readRoots=['/System','/usr','/Library/Apple','/private/var/db/dyld','/dev',writeRoot,workspace,...codeRoots].map(path=>existsSync(path)?realpathSync(path):resolve(path));
  return sandboxProfile(writeRoot,protectedRoots)+`\n(deny network*)\n${loopbackPort?`(allow network-outbound (remote ip "localhost:${loopbackPort}"))`:''}\n(deny file-read-data)\n(allow file-read-data (literal "/") ${readRoots.map(path=>`(subpath ${literal(path)})`).join(' ')})\n${protectedRoots.map(path=>`(deny file-read* file-write* (subpath ${literal(existsSync(path)?realpathSync(path):resolve(path))}))`).join('\n')}\n`;
}

export async function verifyAuthenticationReference(directory:string,source:string,alias:string,protectedRoots:string[]) {
  if(!existsSync(join(source,'user'))||!existsSync(join(alias,'user'))) return false;
  const program=`const fs=require('fs');const fd=fs.openSync(${JSON.stringify(join(alias,'user'))},fs.constants.O_RDONLY);fs.closeSync(fd);let denied=0;for(const path of ${JSON.stringify([join(source,'user'),join(alias,'user')])}){try{const fd=fs.openSync(path,fs.constants.O_WRONLY);fs.closeSync(fd);process.exit(9)}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e;denied++}}console.log(denied);`;
  const result=await runCommand('/usr/bin/sandbox-exec',['-p',sandboxProfile(directory,protectedRoots,[source]),process.execPath,'-e',program]);
  return result.code===0&&result.stdout.trim()==='2';
}

export async function verifyInputIsolation(directory:string,roots:string[],files:string[],protectedRoots:string[]) {
  const program=`const fs=require('fs');let denied=0;for(const path of ${JSON.stringify(files)}){fs.closeSync(fs.openSync(path,fs.constants.O_RDONLY));try{fs.closeSync(fs.openSync(path,fs.constants.O_WRONLY));process.exit(9)}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e;denied++}}for(const path of ${JSON.stringify(roots)}){try{fs.chmodSync(path,0o700);process.exit(10)}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e;denied++}try{fs.writeFileSync(path+'/.write-probe','blocked',{flag:'wx'});process.exit(11)}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e;denied++}}console.log(JSON.stringify({denied}));`;
  const result=await runCommand('/usr/bin/sandbox-exec',['-p',sandboxProfile(directory,protectedRoots,roots),process.execPath,'-e',program]);
  return result.code===0&&result.stdout.includes(`"denied":${files.length+roots.length*2}`);
}

export async function checkIsolation(dataDir: string) {
  if (process.platform !== 'darwin' || !existsSync('/usr/bin/sandbox-exec')) return { verified: false, reason: '当前仅实现 macOS sandbox-exec；拒绝启动未隔离执行者' };
  const root = mkdtempSync(join(dataDir, 'isolation-check-'));
  const allowed = join(root, 'allowed');
  const protectedRoot = join(root, 'protected');
  mkdirSync(allowed, { recursive: true }); mkdirSync(protectedRoot, { recursive: true });
  const sentinel = join(protectedRoot, 'sentinel'); writeFileSync(sentinel, 'unchanged');
  const profile = sandboxProfile(allowed, [protectedRoot, join(homedir(), '.codex')]);
  const program = `const fs=require('fs'); fs.writeFileSync(${JSON.stringify(join(allowed, 'ok'))},'ok'); for(const p of [${JSON.stringify(sentinel)},${JSON.stringify(join(protectedRoot, 'new-file'))}]){try{fs.writeFileSync(p,'changed');process.exit(9)}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e}} console.log('write-denied');`;
  const result = await runCommand('/usr/bin/sandbox-exec', ['-p', profile, process.execPath, '-e', program]);
  const verified = result.code === 0 && result.stdout.includes('write-denied') && readFileSync(sentinel, 'utf8') === 'unchanged';
  rmSync(root, { recursive: true, force: true });
  return { verified, boundary: '整个执行进程树只能写入当前任务目录；Codex 目录禁止读取和写入', scope: '基础写入门禁；共享来源、快照与只读认证引用在任务准备时另做实测', reason: verified ? null : result.stderr.trim() || '沙箱验证失败' };
}
