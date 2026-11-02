import {test,type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CLIInstaller,installationEnvironment,runInstallCommand,type CLIInstallTarget,type InstallRunner,type InstallCommandOptions} from '../src/cli-installation.js';
import {inspectOwnedGroup} from '../src/process.js';

async function finished(installer:CLIInstaller) {
  for(let i=0;i<200;i++){const state=installer.snapshot();if(state.job?.state!=='running')return state;await new Promise(r=>setTimeout(r,5));}
  throw Error('Fixture installer did not finish');
}
function fixture(t:TestContext,options:{brew?:boolean;platform?:NodeJS.Platform;existing?:CLIInstallTarget[];install?:(command:string,args:string[],opts:InstallCommandOptions,installed:Set<CLIInstallTarget>)=>ReturnType<InstallRunner>}={}) {
  const root=mkdtempSync(join(tmpdir(),'helm-cli-install-')),home=join(root,'home');mkdirSync(home);
  const installed=new Set(options.existing??[]),calls:{command:string;args:string[];options:InstallCommandOptions}[]=[];
  const run:InstallRunner=async(command,args,opts)=>{
    calls.push({command,args,options:opts});
    if(args[0]==='--version')return{code:0,stdout:'Homebrew 5.0.fixture\n',stderr:''};
    if(options.install)return options.install(command,args,opts,installed);
    const target=command==='/bin/bash'?'qoder-cn':args.includes('antigravity-cli')?'antigravity':args.includes('ollama')?'ollama':args.includes('zcode')?'zcode':null;
    if(target)installed.add(target);
    opts.onOutput('download/install fixture\n');return{code:0,stdout:'',stderr:''};
  };
  const installer=new CLIInstaller(join(root,'data'),{platform:options.platform??'darwin',home,environment:{PATH:'/fixture/bin',USER:'fixture',API_KEY:'private fixture',BASH_ENV:'/fixture/unsafe',NODE_OPTIONS:'--inspect'},
    executable:path=>options.brew!==false&&path==='/fixture/bin/brew',installed:()=>new Set(installed),agents:async()=>[],run});
  t.after(async()=>{await installer.cancel();rmSync(root,{recursive:true,force:true});});
  return{installer,calls,root,home,installed};
}

test('missing Homebrew is detected without running installers and only offers manual setup',async t=>{
  const{installer,calls}=fixture(t,{brew:false});const state=await installer.refresh();
  assert.equal(state.homebrew.available,false);assert.equal(state.checking,false);assert.match(state.homebrew.reason,/brew.sh/);
  await assert.rejects(installer.start(['ollama']),/Homebrew/);assert.equal(calls.length,0);assert.equal(installer.snapshot().job,null);
});

test('unsupported platforms cannot install even with an executable brew fixture',async t=>{
  const{installer,calls}=fixture(t,{platform:'linux'});assert.equal((await installer.refresh()).homebrew.supported,false);
  await assert.rejects(installer.start(['ollama']),/macOS/);assert.equal(calls.length,0);
});

test('arbitrary targets, commands, option injection and malformed selections never execute',async t=>{
  const{installer,calls}=fixture(t);
  for(const value of [[],null,{},'ollama',['ollama;touch bad'],['--force'],['https://foreign.test'],['qoder-cn','zcode','ollama','antigravity','ollama']])await assert.rejects(installer.start(value));
  assert.equal(calls.length,0);
});

test('fixed Homebrew argv installs sequentially and re-probes installed CLI presence',async t=>{
  const{installer,calls,home}=fixture(t);await installer.start(['antigravity','ollama','zcode']);const state=await finished(installer);
  assert.equal(state.job?.state,'succeeded');assert.deepEqual(state.job.completedTargets,['antigravity','ollama','zcode']);
  assert.deepEqual(calls.filter(c=>c.args[0]!=='--version').map(c=>[c.command,c.args]),[
    ['/fixture/bin/brew',['install','--cask','antigravity-cli']],['/fixture/bin/brew',['install','--formula','ollama']],
    ['/fixture/bin/brew',['install','--cask',`--appdir=${join(home,'Applications')}`,'zcode']]
  ]);
  assert.equal(state.tools.filter(tool=>tool.installed).length,3);
  for(const call of calls){assert.equal(call.options.env.API_KEY,undefined);assert.equal(call.options.env.BASH_ENV,undefined);assert.equal(call.options.env.NODE_OPTIONS,undefined);assert.equal(call.options.env.NONINTERACTIVE,'1');}
});

test('Qoder CN uses only its fixed official script in private staging and cleans staging',async t=>{
  const{installer,calls,root}=fixture(t);await installer.start(['qoder-cn']);assert.equal((await finished(installer)).job?.state,'succeeded');
  const commands=calls.filter(c=>c.args[0]!=='--version');assert.equal(commands[0]?.command,'/usr/bin/curl');assert.equal(commands[1]?.command,'/bin/bash');
  assert.equal(commands[0]?.args.at(-1),'https://static.qoder.com.cn/qoder-cli-cn/install.sh');
  assert.deepEqual(commands[1]?.args,[commands[0]!.args[commands[0]!.args.indexOf('--output')+1]!]);
  assert.deepEqual(readdirSync(join(root,'data','cli-installation')),[]);
});

test('already installed CLIs are skipped and duplicate selections do not cause duplicate commands',async t=>{
  const{installer,calls}=fixture(t,{existing:['qoder-cn','antigravity']});await installer.start(['qoder-cn','antigravity','ollama','ollama']);const state=await finished(installer);
  assert.deepEqual(state.job?.targets,['qoder-cn','antigravity','ollama']);assert.equal(calls.filter(c=>c.args[0]==='install').length,1);
  assert.deepEqual(state.job?.completedTargets,['qoder-cn','antigravity','ollama']);
});

test('failure preserves completed targets and does not retry or run later targets',async t=>{
  const{installer,calls}=fixture(t,{install:async(_command,args,_opts,installed)=>{
    if(args.includes('antigravity-cli')){installed.add('antigravity');return{code:0,stdout:'',stderr:''};}
    return{code:9,stdout:'',stderr:'fixture failure'};
  }});
  await installer.start(['antigravity','ollama','zcode']);const state=await finished(installer);
  assert.equal(state.job?.state,'failed');assert.deepEqual(state.job.completedTargets,['antigravity']);assert.equal(calls.filter(c=>c.args[0]==='install').length,2);
});

test('exit zero without a discovered CLI is a failed installation',async t=>{
  const{installer}=fixture(t,{install:async()=>({code:0,stdout:'',stderr:''})});await installer.start(['ollama']);const state=await finished(installer);
  assert.equal(state.job?.state,'failed');assert.match(state.job.message,/尚未检测到/);assert.deepEqual(state.job.completedTargets,[]);
});

test('concurrent start is rejected, cancellation settles the active command and never starts the next target',async t=>{
  let began!:()=>void;const started=new Promise<void>(r=>{began=r;});
  const{installer,calls}=fixture(t,{install:async(_command,_args,opts)=>{began();await new Promise<void>(r=>opts.signal.addEventListener('abort',()=>r(),{once:true}));throw Error('cancel fixture');}});
  const pending=installer.start(['ollama','zcode']);await assert.rejects(installer.start(['antigravity']),/正在进行/);await pending;await started;
  const state=await installer.cancel();assert.equal(state.job?.state,'cancelled');assert.equal(calls.filter(c=>c.args[0]==='install').length,1);
  assert.equal((await installer.cancel()).job?.id,state.job.id);
});

test('logs are bounded UTF8 text, strip terminal controls, and redact secrets and credential URLs',async t=>{
  const key='sk-'+'a'.repeat(32);
  const credentialURL=new URL('https://install.test/x');credentialURL.username='fixture';credentialURL.password='secret';
  const{installer}=fixture(t,{install:async(_command,_args,opts,installed)=>{
    opts.onOutput('领航'.repeat(40000));opts.onOutput(`\u001b[31m${key}\u001b[0m ${credentialURL}\n`);installed.add('ollama');return{code:0,stdout:'',stderr:''};
  }});
  await installer.start(['ollama']);const log=(await finished(installer)).job!.log;
  assert.ok(Buffer.byteLength(log)<=65536);assert.ok(!log.includes('\u001b'));assert.ok(!log.includes(key));assert.ok(!log.includes('fixture:secret'));assert.ok(!log.includes('\ufffd'));
});

test('installation environment excludes model credentials, registry hooks and shell startup injection',()=>{
  const source={USER:'fixture',HTTPS_PROXY:'http://127.0.0.1:7890',NPM_TOKEN:'private',GITHUB_TOKEN:'private',BASH_ENV:'bad',ENV:'bad',NODE_OPTIONS:'bad',DYLD_INSERT_LIBRARIES:'bad'};
  const env=installationEnvironment('/fixture/home','/fixture/brew/bin/brew',source);
  assert.equal(env.HTTPS_PROXY,source.HTTPS_PROXY);assert.equal(env.USER,'fixture');
  for(const name of ['NPM_TOKEN','GITHUB_TOKEN','BASH_ENV','ENV','NODE_OPTIONS','DYLD_INSERT_LIBRARIES'])assert.equal(env[name],undefined);
});

test('owned real process runner preserves split Unicode and enforces timeout and cancellation',async()=>{
  const env=installationEnvironment(tmpdir(),'/usr/bin/brew',{});let output='';
  const result=await runInstallCommand(process.execPath,['-e',`const b=Buffer.from('领航');process.stdout.write(b.subarray(0,2));setTimeout(()=>{process.stdout.write(b.subarray(2));},15);`],{env,signal:new AbortController().signal,timeoutMs:3000,onOutput:text=>output+=text});
  assert.equal(result.code,0);assert.equal(output,'领航');
  await assert.rejects(runInstallCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{env,signal:new AbortController().signal,timeoutMs:80,onOutput:()=>{}}),/超时/);
  const controller=new AbortController();
  const pending=runInstallCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{env,signal:controller.signal,timeoutMs:3000,onOutput:()=>{}});
  controller.abort();await assert.rejects(pending,/取消/);
});

test('cancelling an installation terminates its forked child group as well as the launcher',async()=>{
  const controller=new AbortController(),env=installationEnvironment(tmpdir(),'/usr/bin/brew',{});
  let ready!:(value:{pid:number;child:number})=>void,output='';
  const started=new Promise<{pid:number;child:number}>(resolve=>{ready=resolve;});
  const code=`const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});console.log(JSON.stringify({pid:process.pid,child:c.pid}));setInterval(()=>{},1000);`;
  const running=runInstallCommand(process.execPath,['-e',code],{env,signal:controller.signal,timeoutMs:5000,onOutput:text=>{output+=text;if(output.includes('\n'))ready(JSON.parse(output.trim()));}});
  const group=await started;assert.ok(group.child>1);controller.abort();await assert.rejects(running,/取消/);
  assert.deepEqual(inspectOwnedGroup(group.pid).filter(member=>!member.state.startsWith('Z')),[]);
});

test('cancellation allows installer cleanup before escalating a process that ignores TERM',async()=>{
  const controller=new AbortController(),env=installationEnvironment(tmpdir(),'/usr/bin/brew',{});
  let ready!:()=>void;const started=new Promise<void>(resolve=>{ready=resolve;});
  const code="process.on('SIGTERM',()=>{});console.log('READY');setInterval(()=>{},1000);";
  const running=runInstallCommand(process.execPath,['-e',code],{env,signal:controller.signal,timeoutMs:5000,onOutput:text=>{if(text.includes('READY'))ready();}});
  await started;const now=Date.now();controller.abort();await assert.rejects(running,/取消/);
  assert.ok(Date.now()-now>=1800);assert.ok(Date.now()-now<4500);
});
