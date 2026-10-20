import {z} from 'zod';
import {createHash,randomUUID} from 'node:crypto';
import {accessSync,closeSync,constants,existsSync,fstatSync,openSync,readFileSync,realpathSync,renameSync,statSync,writeFileSync} from 'node:fs';
import {delimiter,isAbsolute,join,sep} from 'node:path';
import {homedir} from 'node:os';
import {protectedDirectoryNames} from './protected-paths.js';

export const desktopConfigSchema=z.object({qoderCLI:z.string().max(2000).nullable(),projectRoots:z.array(z.string().min(1).max(2000)).min(1).max(20),preferredPort:z.number().int().min(1024).max(65535)}).strict();
export type DesktopConfiguration=z.infer<typeof desktopConfigSchema>;
const revision=(value:DesktopConfiguration)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function desktopConfiguration(directory:string) {
  const path=join(directory,'desktop-config.json');
  let configuration:DesktopConfiguration;
  if(existsSync(path)) {
    const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try {
      const s=fstatSync(fd);
      if(!s.isFile()||s.size>64000||s.uid!==process.getuid?.()||(s.mode&0o077)!==0)throw Error('应用配置必须是当前用户的私有普通文件');
      configuration=desktopConfigSchema.parse(JSON.parse(readFileSync(fd,'utf8')));
    } finally{closeSync(fd);}
  } else configuration={qoderCLI:process.env.HELMDESK_QODER_CLI??null,projectRoots:process.env.HELMDESK_PROJECT_ROOTS?.split(delimiter).filter(Boolean)??[realpathSync(process.execPath.includes('.app/Contents/Resources/runtime/')?directory:process.cwd())],preferredPort:4317};
  return {configuration,revision:revision(configuration)};
}
export function saveDesktopConfiguration(directory:string,input:unknown,expectedRevision:string) {
  const previous=desktopConfiguration(directory);
  if(expectedRevision!==previous.revision)throw Error('应用设置已变化，请刷新后重新保存');
  const parsed=desktopConfigSchema.parse(input);
  const protectedNames=protectedDirectoryNames;
  const projectRoots=parsed.projectRoots.map(path=>{
    if(!isAbsolute(path)||!statSync(path).isDirectory())throw Error('项目根目录必须是已有绝对目录');
    const root=realpathSync(path);
    if(root==='/'||root===realpathSync(homedir())||root.split(sep).some(p=>protectedNames.has(p.toLowerCase())))throw Error('请选择具体项目目录，不允许主目录、系统根目录或凭据目录');
    return root;
  });
  let qoderCLI=parsed.qoderCLI;
  if(qoderCLI) {
    if(!isAbsolute(qoderCLI)||!statSync(qoderCLI).isFile())throw Error('Qoder 路径必须是已有 CLI 文件');
    qoderCLI=realpathSync(qoderCLI);
    if(qoderCLI.split(sep).some(p=>protectedNames.has(p.toLowerCase())))throw Error('不能选择凭据目录中的执行文件');
    if(!/\.[cm]?js$/.test(qoderCLI))accessSync(qoderCLI,constants.X_OK);
  }
  const configuration={...parsed,qoderCLI,projectRoots:[...new Set(projectRoots)]};
  const temporary=join(directory,`.desktop-config-${randomUUID()}.json`);
  writeFileSync(temporary,JSON.stringify(configuration,null,2),{mode:0o600,flag:'wx'});
  renameSync(temporary,join(directory,'desktop-config.json'));
  return {configuration,revision:revision(configuration)};
}
