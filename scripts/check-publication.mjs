// Inspect the Git index, not the working tree. Never print potential secret values.
import {execFileSync} from 'node:child_process';

const git=args=>execFileSync('git',args,{maxBuffer:20_000_000});
const publicRoots=new Set(['.gitignore','.npmrc','README.md','THIRD_PARTY_NOTICES.md','package.json','package-lock.json','tsconfig.json','tsconfig.test.json','tsconfig.web.json','vite.config.ts']);
const publicExtras=new Set(['docs/codex-mcp.toml.example','docs/sharing.example.json','docs/v0.1日常使用与验收.md','docs/quickstart.md','docs/macos-install.md','docs/公开范围.md','docs/third-party/react-bits-LICENSE.md','scripts/register-codex-mcp.mjs','scripts/check-publication.mjs','scripts/fixtures/readonly-mcp.mjs','native/Package.swift','native/Resources/Info.plist','native/Resources/Node-LICENSE.txt','native/Resources/Node-VERSION','script/build_and_run.sh','script/package_macos.sh']);
const rules=[
  ['private-key',/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g],
  ['github-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g],
  ['model-token',/\b(?:sk-|qoder_pat_)[A-Za-z0-9_-]{20,}\b/g],
  ['aws-access-key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['jwt',/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/g],
  ['credential-url',/https?:\/\/[^\s/@]+:[^\s/@]+@/g],
  ['personal-home',/\/(?:Users|home)\/[A-Za-z0-9_.-]+/g],
  ['personal-windows-home',/[A-Za-z]:\\Users\\[A-Za-z0-9_.-]+/g],
  ['credential-literal',/(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*[=:]\s*["'][A-Za-z0-9_+\/-]{24,}["']/gi]
];
const entries=git(['ls-files','--stage','-z']).toString('utf8').split('\0').filter(Boolean);
const issues=[];let bytes=0;
for(const entry of entries){
  const match=/^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/.exec(entry);
  if(!match)throw Error('Unrecognized index entry');
  const [,mode,sha,stage,path]=match;
  const blocked=path.split('/').some(p=>/^(?:\.helmdesk|\.env.*|\.git|\.aws|\.codex|\.agents|\.qoder|\.serena|\.build|\.swiftpm|xcuserdata|node_modules|dist|coverage)$/.test(p))||/\.(?:sqlite.*|db|log|pem|key|p12|pfx)$/i.test(path);
  const portableMac=new Set(['.github/workflows/ci.yml','scripts/audit-macos-bundle.mjs','script/distribute_macos.sh','script/install_macos.sh','docs/macos-roadmap.md','docs/release-checklist.md']);
  const allowed=publicRoots.has(path)||publicExtras.has(path)||portableMac.has(path)||/^(?:src|test)\/[^/]+\.ts$/.test(path)||/^native\/(?:macOS|Tests)\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.swift$/.test(path)||/^web\/(?:index\.html|src\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:tsx?|css|md))$/.test(path);
  if(blocked||!allowed)issues.push({path,rule:'non-public-path'});
  if(!['100644','100755'].includes(mode)||stage!=='0')issues.push({path,rule:'non-regular-or-unmerged-file'});
  const buffer=git(['cat-file','blob',sha]);bytes+=buffer.length;
  if(buffer.includes(0)||buffer.length>2_000_000){issues.push({path,rule:'binary-or-oversize'});continue;}
  const text=buffer.toString('utf8');
  for(const [rule,pattern]of rules){pattern.lastIndex=0;for(const hit of text.matchAll(pattern))issues.push({path,rule,line:text.slice(0,hit.index).split('\n').length});}
}
if(!entries.length)issues.push({rule:'empty-index'});
console.log(JSON.stringify({ok:issues.length===0,files:entries.length,bytes,issues},null,2));
if(issues.length)process.exitCode=1;
