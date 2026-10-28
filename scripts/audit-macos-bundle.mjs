import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,lstatSync,readdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';
const root=realpathSync(resolve(process.argv[2]??'dist/HelmDesk.app')),resources=join(root,'Contents/Resources');
const required=['Contents/Info.plist','Contents/MacOS/HelmDesk','Contents/Resources/HelmDesk.icns','Contents/Resources/runtime/node','Contents/Resources/runtime/LICENSE','Contents/Resources/runtime/VERSION','Contents/Resources/service/dist/cli.js','Contents/Resources/service/web/dist/index.html','Contents/Resources/service/web/dist/assets/helmdesk.svg','Contents/Resources/service/package-lock.json','Contents/Resources/THIRD_PARTY_NOTICES.md'];
for(const path of required)if(!existsSync(join(root,path)))throw Error(`Missing bundle resource: ${path}`);
const iconName=execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIconFile',join(root,'Contents/Info.plist')],{encoding:'utf8'}).trim();
if(iconName!=='HelmDesk.icns')throw Error('Bundle icon declaration is missing or unexpected');
const icon=readFileSync(join(resources,iconName)),representations=new Set();
if(icon.length<8||icon.toString('ascii',0,4)!=='icns'||icon.readUInt32BE(4)!==icon.length)throw Error('Invalid ICNS header');
for(let offset=8;offset<icon.length;){
  if(offset+8>icon.length)throw Error('Truncated ICNS entry');
  const size=icon.readUInt32BE(offset+4);
  if(size<8||offset+size>icon.length)throw Error('Invalid ICNS entry length');
  representations.add(icon.toString('ascii',offset,offset+4));offset+=size;
}
for(const alternatives of [['ic04','icp4'],['ic05','icp5'],['ic11'],['ic12'],['ic07'],['ic13'],['ic08'],['ic14'],['ic09'],['ic10']]){
  if(!alternatives.some(type=>representations.has(type)))throw Error('Missing macOS icon representation: '+alternatives.join('/'));
}
const privateNames=new Set(['.helmdesk','.codex','.agents','.qoder-cn','.qoderworkcn','.auth','.models','.env','connection.json','helmdesk.sqlite','sharing.json','desktop-config.json']);
const layouts=[['Contents',['Info.plist','MacOS','Resources','_CodeSignature']],['Contents/MacOS',['HelmDesk']],['Contents/Resources',['runtime','service','HelmDesk.icns','THIRD_PARTY_NOTICES.md','Components.json']],['Contents/Resources/runtime',['node','LICENSE','VERSION']],['Contents/Resources/service',['dist','web','node_modules','package.json','package-lock.json','.npmrc']]];
for(const [folder,allowed]of layouts)if(readdirSync(join(root,folder)).some(name=>!allowed.includes(name)))throw Error('Unexpected resource outside the bundle allowlist');
let count=0;
function audit(path){
  for(const name of readdirSync(path)) {
    const next=join(path,name),stat=lstatSync(next);count++;
    if(privateNames.has(name)||/\.(p12|pfx)$/.test(name))throw Error('Bundle contains a prohibited private resource');
    if(stat.isSymbolicLink()) {const target=realpathSync(next);if(!target.startsWith(root+sep))throw Error('Bundle symlink escapes its root');}
    else if(stat.isDirectory())audit(next);
    else if(!stat.isFile())throw Error('Bundle contains a non-regular resource');
  }
}
audit(root);
if(/(?:_authToken|_password|_auth)\s*=/.test(readFileSync(join(resources,'service/.npmrc'),'utf8')))throw Error('Package registry credentials must not be bundled');
const components=[];const modules=join(resources,'service/node_modules');
function component(folder) {
  const path=join(folder,'package.json');if(!existsSync(path))return;
  const pkg=JSON.parse(readFileSync(path,'utf8'));
  const notices=readdirSync(folder).filter(n=>/^(?:license|licence|copying|notice|copyright)(?:\.|$)/i.test(n)&&lstatSync(join(folder,n)).isFile());
  components.push({name:pkg.name,version:pkg.version,license:pkg.license??'not declared',notices:notices.map(n=>relative(resources,join(folder,n)))});
}
for(const name of readdirSync(modules).filter(n=>!n.startsWith('.'))) {
  if(name.startsWith('@'))for(const child of readdirSync(join(modules,name)))component(join(modules,name,child));
  else component(join(modules,name));
}
components.sort((a,b)=>a.name.localeCompare(b.name));
const node=join(resources,'runtime/node'),version=execFileSync(node,['--version'],{encoding:'utf8',timeout:5000}).trim();
if(version!==readFileSync(join(resources,'runtime/VERSION'),'utf8').trim())throw Error('Bundled Node version/license manifest mismatch');
const arches=p=>execFileSync('/usr/bin/lipo',['-archs',p],{encoding:'utf8'}).trim().split(/\s+/);
const architectures=arches(join(root,'Contents/MacOS/HelmDesk')).filter(a=>arches(node).includes(a));
if(!architectures.length)throw Error('Native app and runtime architectures do not overlap');
const manifest={format:1,runtime:{name:'Node.js',version,license:'runtime/LICENSE'},architectures,components};
const manifestPath=join(resources,'Components.json');
if(process.argv.includes('--write'))writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
else if(!existsSync(manifestPath)||JSON.stringify(JSON.parse(readFileSync(manifestPath,'utf8')))!==JSON.stringify(manifest))throw Error('Bundle component manifest is missing or stale');
const hash=createHash('sha256').update(readFileSync(join(resources,'service/package-lock.json'))).digest('hex');
console.log(JSON.stringify({ok:true,files:count,components:components.length,architectures,node:version,lockSHA256:hash}));
