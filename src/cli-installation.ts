import {spawn} from 'node:child_process';
import {accessSync,constants,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {delimiter,dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {stripVTControlCharacters} from 'node:util';
import {agentCatalog} from './agents.js';
import {findRuntime} from './qoder.js';
import {findAntigravity} from './antigravity.js';
import {findOllama} from './ollama.js';
import {findZcode} from './zcode.js';
import {watchOwnedProcess} from './process.js';
import {errorText,redact} from './redact.js';
import type {AgentInfo} from './agent-types.js';

export const CLI_INSTALL_TARGETS=['qoder-cn','antigravity','ollama','zcode'] as const;
export type CLIInstallTarget=typeof CLI_INSTALL_TARGETS[number];
export interface CLIInstallerSnapshot {
  checking:boolean;
  homebrew:{supported:boolean;available:boolean;path:string|null;version:string|null;reason:string};
  tools:{id:CLIInstallTarget;label:string;installed:boolean;version:string|null;method:string;sourceURL:string;detail:string}[];
  job:null|{id:string;state:'running'|'succeeded'|'failed'|'cancelled';targets:CLIInstallTarget[];activeTarget:CLIInstallTarget|null;completedTargets:CLIInstallTarget[];message:string;log:string;startedAt:string;finishedAt:string|null};
}
export interface InstallCommandOptions {
  env:NodeJS.ProcessEnv;signal:AbortSignal;timeoutMs:number;onOutput:(text:string)=>void;
}
export type InstallRunner=(command:string,args:string[],options:InstallCommandOptions)=>Promise<{code:number|null;stdout:string;stderr:string}>;
export interface CLIInstallerDependencies {
  platform:NodeJS.Platform;home:string;environment:NodeJS.ProcessEnv;
  executable:(path:string)=>boolean;
  installed:()=>Set<CLIInstallTarget>;
  agents:()=>Promise<AgentInfo[]>;
  run:InstallRunner;
  timeoutMs:number;
}
const metadata=[
  {id:'qoder-cn',label:'Qoder CN',method:'Qoder CN 官方安装器',sourceURL:'https://docs.qoder.cn/cli/installation',detail:'安装独立 CLI；首次使用需在官方 CLI 中登录。'},
  {id:'antigravity',label:'Antigravity · agy',method:'Homebrew · antigravity-cli',sourceURL:'https://formulae.brew.sh/cask/antigravity-cli',detail:'安装终端 CLI；Google 登录和模型权限单独确认。'},
  {id:'ollama',label:'Ollama',method:'Homebrew · ollama',sourceURL:'https://formulae.brew.sh/formula/ollama',detail:'仅安装 CLI，不启动后台服务，也不下载模型。'},
  {id:'zcode',label:'ZCode',method:'Homebrew · ZCode App 内置 CLI',sourceURL:'https://formulae.brew.sh/cask/zcode',detail:'安装到当前用户 Applications，使用 App 内置 CLI；BigModel 登录需另行完成。'}
] satisfies Array<Pick<CLIInstallerSnapshot['tools'][number],'id'|'label'|'method'|'sourceURL'|'detail'>>;

export function installationEnvironment(home:string,brewPath:string,source:NodeJS.ProcessEnv):NodeJS.ProcessEnv {
  const env:NodeJS.ProcessEnv={HOME:home,PATH:[dirname(brewPath),join(home,'.local/bin'),'/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin','/usr/sbin','/sbin'].join(delimiter),
    NONINTERACTIVE:'1',CI:'1',HOMEBREW_NO_AUTO_UPDATE:'1',HOMEBREW_NO_ANALYTICS:'1',HOMEBREW_NO_INSTALL_CLEANUP:'1',HOMEBREW_NO_INSTALL_UPGRADE:'1',HOMEBREW_NO_ENV_HINTS:'1',TERM:'dumb',NO_COLOR:'1'};
  for(const key of ['USER','LOGNAME','LANG','LC_ALL','TMPDIR','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy'])if(source[key])env[key]=source[key];
  return env;
}
function tail(text:string,limit=65536) {
  const bytes=Buffer.from(text);if(bytes.length<=limit)return text;
  let start=bytes.length-limit;while(start<bytes.length&&(bytes[start]!&0xc0)===0x80)start++;
  return bytes.subarray(start).toString('utf8');
}
export async function runInstallCommand(command:string,args:string[],options:InstallCommandOptions) {
  if(options.signal.aborted)throw Error('安装已取消');
  const child=spawn(command,args,{cwd:options.env.HOME,env:options.env,detached:true,shell:false,stdio:['ignore','pipe','pipe']});
  const watched=watchOwnedProcess(child,()=>{});let stdout='',stderr='',expired=false;
  const decoders=[new StringDecoder('utf8'),new StringDecoder('utf8')];
  const receive=(text:string,index:number)=>{if(index===0)stdout=tail(stdout+text,16384);else stderr=tail(stderr+text,16384);options.onOutput(text);};
  child.stdout.on('data',chunk=>receive(decoders[0]!.write(chunk),0));
  child.stderr.on('data',chunk=>receive(decoders[1]!.write(chunk),1));
  let escalation:ReturnType<typeof setTimeout>|undefined;
  const terminate=()=>{
    if(escalation)return;
    try{if(child.pid)process.kill(-child.pid,'SIGTERM');}
    catch(error:any){if(error.code!=='ESRCH')watched.cancel();}
    escalation=setTimeout(()=>watched.cancel(),2000);
  };
  const abort=()=>terminate();options.signal.addEventListener('abort',abort,{once:true});
  if(options.signal.aborted)abort();
  const timer=setTimeout(()=>{expired=true;terminate();},options.timeoutMs);
  try {
    const result=await watched.finished;decoders.forEach((decoder,index)=>receive(decoder.end(),index));
    if(expired)throw Error('安装命令超时，已停止本次安装');
    if(options.signal.aborted)throw Error('安装已取消');
    return {...result,stdout,stderr};
  } finally {clearTimeout(timer);if(escalation)clearTimeout(escalation);options.signal.removeEventListener('abort',abort);}
}
function installedTools() {
  const result=new Set<CLIInstallTarget>();
  for(const[id,find]of [['qoder-cn',findRuntime],['antigravity',findAntigravity],['ollama',findOllama],['zcode',findZcode]] as const){
    try{if(find())result.add(id);}catch{/* Invalid configured paths are reported by the executor catalog. */}
  }
  return result;
}

export class CLIInstaller {
  private readonly deps:CLIInstallerDependencies;
  private state:CLIInstallerSnapshot;
  private probing:Promise<CLIInstallerSnapshot>|null=null;
  private preparing=false;
  private preparation:Promise<void>|null=null;
  private preparationCancelled=false;
  private controller:AbortController|null=null;
  private completion:Promise<void>|null=null;
  private rawLog='';

  constructor(private dataDirectory:string,dependencies:Partial<CLIInstallerDependencies>={}) {
    this.deps={platform:process.platform,home:homedir(),environment:{...process.env},
      executable:path=>{try{accessSync(path,constants.X_OK);return true;}catch{return false;}},
      installed:installedTools,agents:agentCatalog,run:runInstallCommand,timeoutMs:20*60*1000,...dependencies};
    this.state={checking:false,homebrew:{supported:this.deps.platform==='darwin',available:false,path:null,version:null,reason:'尚未检测 Homebrew'},
      tools:metadata.map(tool=>({...tool,installed:false,version:null})),job:null};
  }
  snapshot():CLIInstallerSnapshot {return structuredClone(this.state);}

  refresh():Promise<CLIInstallerSnapshot> {
    return this.state.job?.state==='running'?Promise.resolve(this.snapshot()):this.probe();
  }
  private probe():Promise<CLIInstallerSnapshot> {
    if(this.probing)return this.probing;
    this.state.checking=true;
    this.probing=(async()=>{try{await this.discover();}finally{this.state.checking=false;this.probing=null;}return this.snapshot();})();
    return this.probing;
  }
  private async discover() {
    if(this.deps.platform!=='darwin') {
      this.state.homebrew={supported:false,available:false,path:null,version:null,reason:'CLI 安装目前仅支持 macOS。请使用各执行器的官方安装说明。'};
      return this.snapshot();
    }
    const candidates=[...new Set(['/opt/homebrew/bin/brew','/usr/local/bin/brew',...(this.deps.environment.PATH??'').split(delimiter).filter(path=>path.startsWith('/')).map(path=>join(path,'brew'))])];
    const path=candidates.find(this.deps.executable);
    this.state.homebrew={supported:true,available:false,path:path??null,version:null,reason:'未检测到 Homebrew，请先前往 https://brew.sh/ 按官网说明自行安装，然后重新检测。'};
    if(path) {
      try {
        const version=await this.deps.run(path,['--version'],{env:installationEnvironment(this.deps.home,path,this.deps.environment),signal:new AbortController().signal,timeoutMs:5000,onOutput:()=>{}});
        if(version.code!==0||!/^Homebrew\s+\S+/m.test(version.stdout))throw Error('版本探测失败');
        this.state.homebrew={supported:true,available:true,path,version:version.stdout.trim().split('\n')[0]!,reason:'Homebrew 已就绪，可以选择需要安装的 CLI。'};
      } catch {this.state.homebrew.reason='检测到 Homebrew 路径，但版本检查未通过。请先在终端修复 Homebrew，再重新检测。';}
    }
    const installed=this.deps.installed();let agents:AgentInfo[]=[];
    try {agents=await this.deps.agents();}catch{/* Presence and runtime readiness remain separate. */}
    this.state.tools=metadata.map(tool=>{
      const agent=agents.find(agent=>agent.id===tool.id);
      return {...tool,installed:installed.has(tool.id),version:agent?.version??null,
        detail:installed.has(tool.id)?`已检测到安装。${agent?.reason??'登录及运行状态需另行确认。'}`:tool.detail};
    });
    return this.snapshot();
  }

  async start(value:unknown):Promise<CLIInstallerSnapshot> {
    if(!Array.isArray(value)||value.length===0||value.length>4||value.some(id=>typeof id!=='string'||!CLI_INSTALL_TARGETS.includes(id as CLIInstallTarget)))throw Error('只能选择支持的 CLI：Qoder CN、Antigravity、Ollama、ZCode');
    if(this.preparing||this.state.job?.state==='running')throw Error('已有 CLI 安装正在进行');
    this.preparing=true;this.preparationCancelled=false;
    let release!:()=>void;this.preparation=new Promise<void>(resolve=>{release=resolve;});
    try {
      await this.probe();
      if(this.preparationCancelled)throw Error('安装已取消');
      if(!this.state.homebrew.supported||!this.state.homebrew.available||!this.state.homebrew.path)throw Error(this.state.homebrew.reason);
      const targets=[...new Set(value)] as CLIInstallTarget[];
      this.rawLog='';this.controller=new AbortController();
      this.state.job={id:randomUUID(),state:'running',targets,activeTarget:null,completedTargets:[],message:'准备安装所选 CLI',log:'',startedAt:new Date().toISOString(),finishedAt:null};
      this.completion=this.perform(targets,this.state.homebrew.path,this.controller.signal);
      return this.snapshot();
    } finally {this.preparing=false;release();this.preparation=null;}
  }
  async cancel():Promise<CLIInstallerSnapshot> {
    if(this.preparing){this.preparationCancelled=true;await this.preparation;}
    if(this.state.job?.state==='running'){this.state.job.message='正在取消安装，等待安装程序退出…';this.controller?.abort();await this.completion;}
    else if(this.probing){try{await this.probing;}catch{/* A failed read-only probe has no installation to resume. */}}
    return this.snapshot();
  }
  private log(text:string) {
    if(!this.state.job)return;
    this.rawLog=tail(this.rawLog+text);
    this.state.job.log=tail(String(redact(stripVTControlCharacters(this.rawLog).replace(/\r/g,'\n').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,''))));
  }
  private async perform(targets:CLIInstallTarget[],brew:string,signal:AbortSignal) {
    const job=this.state.job!;
    let outcome:'succeeded'|'failed'|'cancelled'='succeeded',message='所选 CLI 已就绪，请按各工具说明完成登录或服务设置';
    const run=async(command:string,args:string[],timeoutMs=this.deps.timeoutMs)=>{
      if(signal.aborted)throw Error('安装已取消');
      const result=await this.deps.run(command,args,{env:installationEnvironment(this.deps.home,brew,this.deps.environment),signal,timeoutMs,onOutput:text=>this.log(text)});
      if(signal.aborted)throw Error('安装已取消');
      if(result.code!==0)throw Error(`安装命令未成功（退出码 ${result.code??'未知'}）。请查看日志；如需管理员授权，请在终端使用官方安装方式。`);
    };
    try {
      for(const target of targets) {
        if(signal.aborted)throw Error('安装已取消');
        const tool=this.state.tools.find(tool=>tool.id===target)!;
        if(tool.installed){this.log(`\n${tool.label} 已安装，保留现有版本。\n`);job.completedTargets.push(target);continue;}
        job.activeTarget=target;job.message=`正在安装 ${tool.label}`;
        this.log(`\n开始安装 ${tool.label} · ${tool.method}\n`);
        if(target==='qoder-cn') {
          const root=join(this.dataDirectory,'cli-installation');mkdirSync(root,{recursive:true,mode:0o700});
          const temporary=mkdtempSync(join(root,'qoder-')),script=join(temporary,'install.sh');
          try {
            await run('/usr/bin/curl',['--fail','--location','--proto','=https','--proto-redir','=https','--connect-timeout','30','--max-time','120','--output',script,'https://static.qoder.com.cn/qoder-cli-cn/install.sh'],125000);
            await run('/bin/bash',[script]);
          } finally {rmSync(temporary,{recursive:true,force:true});}
        } else if(target==='antigravity')await run(brew,['install','--cask','antigravity-cli']);
        else if(target==='ollama')await run(brew,['install','--formula','ollama']);
        else await run(brew,['install','--cask',`--appdir=${join(this.deps.home,'Applications')}`,'zcode']);
        await this.probe();
        if(signal.aborted)throw Error('安装已取消');
        if(!this.state.tools.find(tool=>tool.id===target)?.installed)throw Error(`${tool.label} 安装命令结束，但尚未检测到 CLI，请查看日志和官方说明。`);
        job.completedTargets.push(target);this.log(`${tool.label} 安装已检测到；账号与模型权限仍需单独确认。\n`);
      }
    } catch(error) {
      outcome=signal.aborted?'cancelled':'failed';
      message=signal.aborted?'本次安装已取消；已经完成的组件会保留':errorText(error);
      this.log(`\n${message}\n`);
    } finally {
      job.message='正在重新检测安装状态…';job.activeTarget=null;
      try{await this.probe();}catch{/* Keep the terminal outcome when a final detection fails. */}
      job.state=signal.aborted?'cancelled':outcome;
      job.message=signal.aborted?'本次安装已取消；已经完成的组件会保留':message;
      job.finishedAt=new Date().toISOString();this.controller=null;
    }
  }
}
