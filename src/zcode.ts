import {existsSync,readFileSync,realpathSync,mkdirSync,writeFileSync,lstatSync} from 'node:fs';
import {homedir} from 'node:os';
import {delimiter,dirname,join} from 'node:path';
import {cleanEnvironment} from './executor.js';
import {runCommand,type Runtime} from './qoder.js';
import type {AgentInfo} from './agent-types.js';
import type {ModelOption} from './model-types.js';

export const zcodeDefaultModel='GLM-5.3-Flash';
export function findZcode():Runtime|null {
  const override=process.env.HELMDESK_ZCODE_CLI;
  const candidate=override??[...(process.env.PATH??'').split(delimiter).map(p=>join(p,'zcode')), '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs',join(homedir(),'Applications/ZCode.app/Contents/Resources/glm/zcode.cjs')].find(existsSync);
  if(!candidate)return null;
  if(!existsSync(candidate)||!lstatSync(realpathSync(candidate)).isFile())throw Error('ZCode CLI 路径不存在或不是文件');
  const path=realpathSync(candidate);
  return /\.[cm]?js$/.test(path)?{command:realpathSync(process.execPath),args:[path],path,source:'app-runtime'}:{command:path,args:[],path,source:'official-cli'};
}
export function zcodeAccount() {
  const root=join(homedir(),'.zcode/v2'),credentials=join(root,'credentials.json');
  if(!existsSync(credentials))throw Error('请先在官方 ZCode 登录 BigModel 或 Z.ai；不会启动登录弹窗');
  const settings=JSON.parse(readFileSync(join(root,'setting.json'),'utf8'));
  const family=settings.providerFamilyDomain;
  if(family!=='bigmodel')throw Error('当前仅验证 ZCode BigModel 登录；不会自动切换账号');
  return {credentials:realpathSync(credentials),providerId:'account:bigmodel-start-plan'};
}
export function zcodeBuiltin(runtime:Runtime) {
  const candidates=[join(dirname(runtime.path),'provider/zcode-builtin.json'),join(dirname(runtime.path),'../config/provider/zcode-builtin.json'),join(dirname(runtime.path),'../share/zcode/config/provider/zcode-builtin.json')];
  const path=candidates.find(existsSync);
  if(!path)throw Error('未发现 ZCode 随包模型目录；请使用完整官方运行时');
  return realpathSync(path);
}
export function parseZcodeModels(text:string,providerId:string):ModelOption[] {
  const parsed=JSON.parse(text);
  if(parsed.schemaVersion!==1)throw Error('ZCode 模型目录版本不支持');
  const rules=parsed.config?.providerConfigRules?.providerRules;
  const matches=Array.isArray(rules)?rules.filter((r:any)=>r.providerId===providerId):[];
  const models=matches.length===1?matches[0].config?.builtinModelIds:undefined;
  if(!Array.isArray(models)||!models.length||models.some(m=>typeof m!=='string'||!/^GLM-[A-Za-z0-9.-]{1,100}$/.test(m))||new Set(models).size!==models.length)throw Error('ZCode 所选账号模型目录无效；拒绝猜测');
  const supported=models.filter(id=>id===zcodeDefaultModel);
  if(!supported.length)throw Error('ZCode 所选目录未提供 GLM-5.3-Flash；不会选择其他模型');
  return supported.map(id=>({id,label:id,kind:'platform'}));
}
export async function listZcodeModels() {
  const runtime=findZcode();if(!runtime)throw Error('未发现官方 ZCode CLI/App');
  const account=zcodeAccount(),options=parseZcodeModels(readFileSync(zcodeBuiltin(runtime),'utf8'),account.providerId);
  return {source:'ZCode 随包模型目录 · BigModel Start Plan',sampledAt:new Date().toISOString(),options,models:options.map(o=>o.id),defaultModel:zcodeDefaultModel,availability:'目录不代表账号有额度；使用现有 BigModel 登录与 ZCode Start Plan，实际调用失败不换模型、不换账号。'};
}
export async function detectZcode():Promise<AgentInfo> {
  const runtime=findZcode(),base={id:'zcode' as const,label:'ZCode · 辅助',version:null,source:runtime?.path??'官方 CLI/App',modes:['probe','shared'] as AgentInfo['modes']};
  if(!runtime)return {...base,available:false,reason:'未安装官方 ZCode CLI 或 App'};
  try {
    const result=await runCommand(runtime.command,[...runtime.args,'--version'],{env:cleanEnvironment(),replaceEnv:true});
    const version=result.stdout.trim();
    if(result.code!==0||!/^0\.17\.\d+$/.test(version))throw Error('当前仅验证 ZCode CLI 0.17.x 的结构化协议');
    await listZcodeModels();
    return {...base,available:true,version,reason:'辅助分析和共享只读任务；ZCode Start Plan · GLM-5.3-Flash 默认；实际认证和额度以调用为准'};
  }catch {return {...base,available:false,reason:'CLI 协议或账号模型目录未验证；请检查 ZCode 安装和已保存套餐'};}
}
/** Empty task-local user state; account secrets never enter the CLI filesystem. */
export function prepareZcodeState(root:string) {
  const state=join(root,'zcode-state'),v2=join(state,'.zcode/v2'),cli=join(state,'.zcode/cli');
  mkdirSync(v2,{recursive:true,mode:0o700});mkdirSync(cli,{recursive:true,mode:0o700});
  writeFileSync(join(v2,'provider_config.json'),JSON.stringify({schemaVersion:1,config:{providerConfigRules:{providerRules:[]},modelConfigRules:{providerModelRules:[],manualProviderModelRules:[]}}}),{mode:0o600});
  writeFileSync(join(cli,'config.json'),JSON.stringify({features:{mcp:false,subagent:false,memory:false,skill:false,rewind:false},memory:{use:false},plugins:{enabled:false},skills:{enabled:false},hooks:{enabled:false}}),{mode:0o600});
  mkdirSync(join(root,'zcode-workspace'),{recursive:true,mode:0o700});mkdirSync(join(root,'tmp'),{recursive:true,mode:0o700});
  return state;
}
export function zcodeEnvironment(root:string,builtin:string):NodeJS.ProcessEnv {
  const state=join(root,'zcode-state');
  return {...cleanEnvironment(),HOME:state,ZCODE_DATA_BASE_DIR:state,ZCODE_STORAGE_DIR:join(state,'.zcode'),ZCODE_PERSONAL_PROVIDER_CONFIG_FILE:join(state,'.zcode/v2/provider_config.json'),ZCODE_BUILTIN_PROVIDER_CONFIG_FILE:builtin,ZCODE_BUILTIN_PROVIDER_BUNDLED_CONFIG_FILE:builtin,
    ZCODE_LOG_DIR:join(root,'zcode-logs'),ZCODE_SESSION_DB_PATH:join(state,'sessions.sqlite'),TMPDIR:join(root,'tmp'),TMP:join(root,'tmp'),TEMP:join(root,'tmp'),CI:'1',NO_COLOR:'1',BROWSER:'/usr/bin/false'};
}
