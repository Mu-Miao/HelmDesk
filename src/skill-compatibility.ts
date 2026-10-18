export interface SkillFile {
  path: string;
  content: string;
}

export type CompatibilityStatus = 'compatible' | 'needs_adaptation' | 'blocked';

export interface CompatibilityResult {
  status: CompatibilityStatus;
  reasons: string[];
}

interface ProseRule {
  pattern: RegExp;
  reason: string;
}

const BLOCKED_PROSE_RULES: ProseRule[] = [
  { pattern: /\b(?:install|add)\b[^.\n]{0,60}\bplugins?\b/i, reason: '要求安装插件' },
  { pattern: /安装[^。\n]{0,20}插件/, reason: '要求安装插件' },
  { pattern: /\b(?:change|modify|update|edit)\b[^\n]{0,40}\bCodex\b[^\n]{0,20}\bconfig(?:uration)?\b/i, reason: '要求修改 Codex 配置' },
  { pattern: /(?:修改|更改|更新)[^。\n]{0,20}Codex[^。\n]{0,10}配置/i, reason: '要求修改 Codex 配置' },
  { pattern: /\b(?:update|write|overwrite|modify)\b[^.\n]{0,60}\bmemory\b/i, reason: '要求写入或更新记忆' },
  { pattern: /(?:写入|更新|修改|覆盖)[^。\n]{0,12}记忆/, reason: '要求写入或更新记忆' },
  { pattern: /~[\/\\]\.(?:codex|agents)\b/, reason: '要求写入 ~/.codex 或 ~/.agents 目录' },
];

const ADAPTATION_PROSE_RULES: ProseRule[] = [
  { pattern: /\bfunctions\.exec\b|\bcua_repl\b|\bnode_repl\b|\bimagegen\b|\bmcp__/, reason: '引用 Codex 专用工具' },
  { pattern: /\b(?:run|execute|invoke)\b[^.\n]{0,40}\b(?:shell|bash|script|command)/i, reason: '要求执行 shell 或脚本' },
  { pattern: /执行[^。\n]{0,12}(?:脚本|命令|shell)/i, reason: '要求执行 shell 或脚本' },
];

const EXTERNAL_LINK_PATTERN = /\]\(\s*(?:file:\/\/|~\/|\.\.\/|\/)/;
const SCRIPT_EXTENSION_PATTERN = /\.(?:py|sh|js|mjs)$/i;

function isUnsafePath(path: string): boolean {
  if (!path || path.includes('\0') || path.split('/').some(segment => !segment)) return true;
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return true;
  if (path.includes('\\')) return true;
  return path.split('/').some((segment) => segment === '.' || segment === '..');
}

function suggestsCredentials(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    /(?:^|\/)\.env(?:$|\.)/.test(lower) ||
    lower.endsWith('.pem') ||
    lower.includes('id_rsa')
  );
}

function basename(path: string): string {
  const segments = path.split(/[\\/]/);
  return segments[segments.length - 1] || path;
}

export function analyzeSkillCompatibility(files: SkillFile[]): CompatibilityResult {
  const reasons = new Set<string>();
  let blocked = false;
  let needsAdaptation = false;

  const addBlocked = (reason: string): void => {
    blocked = true;
    reasons.add(reason);
  };
  const addAdaptation = (reason: string): void => {
    needsAdaptation = true;
    reasons.add(reason);
  };

  const hasEntry = files.some(
    (file) => file.path === 'SKILL.md',
  );
  if (!hasEntry) {
    addBlocked('缺少 SKILL.md 入口文件');
  }

  for (const file of files) {
    if (isUnsafePath(file.path)) {
      addBlocked(`文件路径不安全：${file.path}`);
    }
    if (suggestsCredentials(file.path)) {
      addBlocked(`疑似凭据文件：${basename(file.path)}`);
    }
    if (SCRIPT_EXTENSION_PATTERN.test(file.path)) {
      addAdaptation('包含可执行脚本文件（.py/.sh/.js/.mjs）');
    }

    for (const rule of BLOCKED_PROSE_RULES) {
      if (rule.pattern.test(file.content)) {
        addBlocked(rule.reason);
      }
    }
    for (const rule of ADAPTATION_PROSE_RULES) {
      if (rule.pattern.test(file.content)) {
        addAdaptation(rule.reason);
      }
    }
    if (EXTERNAL_LINK_PATTERN.test(file.content)) {
      addAdaptation('Markdown 链接指向外部文件系统位置');
    }
  }

  const status: CompatibilityStatus = blocked
    ? 'blocked'
    : needsAdaptation
      ? 'needs_adaptation'
      : 'compatible';

  return { status, reasons: [...reasons] };
}
