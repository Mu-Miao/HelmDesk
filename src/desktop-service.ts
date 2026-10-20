import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {z} from 'zod';
import type {Store} from './store.js';
import type {Scheduler} from './scheduler.js';
import {desktopConfiguration,saveDesktopConfiguration,desktopConfigSchema} from './desktop-config.js';
import {createDataBackup,inspectData,listDataBackups,verifyDataBackup} from './data-maintenance.js';
import {checkIsolation} from './isolation.js';
import {detectAgent,listModels,runCommand} from './qoder.js';

export class DesktopService {
  private applied;
  constructor(private store:Store,private scheduler:Scheduler,private stop?:()=>void,port?:number) {this.applied=desktopConfiguration(store.directory);if(port)this.applied.configuration.preferredPort=port;}
  async execute(action:string,args:unknown) {
    if(action==='status') {
      z.object({}).strict().parse(args);
      const saved=desktopConfiguration(this.store.directory);
      if(!existsSync(join(this.store.directory,'desktop-config.json')))saved.configuration.preferredPort=this.applied.configuration.preferredPort;
      return {...saved,applied:this.applied.configuration,restartRequired:saved.configuration.preferredPort!==this.applied.configuration.preferredPort,data:inspectData(this.store.directory,this.store.db),backups:listDataBackups(this.store.directory)};
    }
    if(action==='configure') {
      const input=z.object({configuration:desktopConfigSchema,expectedRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(args);
      this.assertIdle();
      const saved=saveDesktopConfiguration(this.store.directory,input.configuration,input.expectedRevision);
      if(saved.configuration.qoderCLI)process.env.HELMDESK_QODER_CLI=saved.configuration.qoderCLI;else delete process.env.HELMDESK_QODER_CLI;
      this.scheduler.setAllowedRoots(saved.configuration.projectRoots);
      this.applied={...saved,configuration:{...saved.configuration,preferredPort:this.applied.configuration.preferredPort}};
      return {saved:true,revision:saved.revision,restartRequired:saved.configuration.preferredPort!==this.applied.configuration.preferredPort};
    }
    if(action==='backup') {z.object({}).strict().parse(args);return createDataBackup(this.store.directory,this.store.db);}
    if(action==='verify-backup') {const input=z.object({name:z.string()}).strict().parse(args);return verifyDataBackup(this.store.directory,input.name);}
    if(action==='stop') {
      z.object({}).strict().parse(args);this.assertIdle();
      if(!this.stop)throw Error('此服务未开放受控停止入口');
      this.scheduler.beginShutdown();setTimeout(this.stop,150).unref();return {stopping:true};
    }
    if(action==='diagnostics') {
      z.object({}).strict().parse(args);
      const checks:{id:string;title:string;status:string;detail:string}[]=[];
      const add=(id:string,title:string,ok:boolean,detail:string)=>checks.push({id,title,status:ok?'passed':'failed',detail});
      add('node','内置 Node',Number(process.versions.node.split('.')[0])>=24,process.version);
      try {const git=await runCommand('/usr/bin/git',['--version'],{timeoutMs:5000});add('git','Git',git.code===0,git.code===0?git.stdout.trim():'Git 不可用，请安装 Command Line Tools');}catch{add('git','Git',false,'Git 探测失败');}
      try {const agent=await detectAgent();add('qoder','Qoder CLI',agent.available,agent.available?`CLI ${agent.version} · ${agent.runtime?.source}`:'未找到兼容的官方 CLI，请选择正确路径');}catch{add('qoder','Qoder CLI',false,'路径或 CLI 不可用，请检查设置');}
      checks.push({id:'login',title:'Qoder 登录',status:'unknown',detail:existsSync(join(process.env.HELMDESK_QODER_LOGIN_DIR??join(homedir(),'.qoder-cn'),'.auth','user'))?'检测到官方登录文件；有效性须以真实任务请求确认':'未发现默认位置的登录记录，请在 Qoder 官方应用或 CLI 中登录'});
      try {const models=await listModels();add('models','模型目录',models.options.length>0,`${models.options.length} 个模型；目录可用不代表额度充足`);}catch{add('models','模型目录',false,'模型发现失败或超时；不自动切换模型');}
      try {const isolation=await checkIsolation(this.store.directory);add('sandbox','执行隔离',isolation.verified,isolation.verified?'沙箱写入门禁通过':'沙箱门禁未通过，拒绝无隔离执行');}catch{add('sandbox','执行隔离',false,'沙箱检查失败');}
      return {sampledAt:new Date().toISOString(),checks,inferenceRequested:false};
    }
    throw Error('未知的原生应用操作');
  }
  private assertIdle() {
    if(this.scheduler.queue().active||this.store.list().some(task=>['queued','preparing','running'].includes(task.state)))throw Error('请先处理排队和运行中的任务，再修改执行设置或重启服务');
  }
}
