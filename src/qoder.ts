import { existsSync } from 'node:fs';
import { join, delimiter, extname } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { errorText } from './redact.js';
import { killOwnedGroup } from './process.js';
import type { ModelOption } from './model-types.js';

export const appRuntime = '/Applications/Qoder CN.app/Contents/Resources/app.asar.unpacked/node_modules/@qoder-ai/qoder-cn-agent-sdk/dist/_worker/qoder-worker-runtime.obf.mjs';
export interface Runtime { command: string; args: string[]; path: string; source: 'official-cli' | 'app-runtime' | 'explicit'; }
export function findRuntime(): Runtime | null {
  const override = process.env.HELMDESK_QODER_CLI;
  if (override) {
    if (!existsSync(override)) throw new Error('HELMDESK_QODER_CLI 路径不存在');
    return { command: /\.[cm]?js$/.test(extname(override)) ? process.execPath : override, args: /\.[cm]?js$/.test(extname(override)) ? [override] : [], path: override, source: 'explicit' };
  }
  // qodercn is also used by an IDE dispatcher; prefer the actual CLI name.
  const candidates = [...(process.env.PATH ?? '').split(delimiter).map(p => join(p, 'qoderclicn')), join(homedir(), '.local/bin/qoderclicn'), join(homedir(), '.qoder-cn/bin/qoderclicn/qoderclicn')];
  for (const path of candidates) if (existsSync(path)) return { command: path, args: [], path, source: 'official-cli' };
  return existsSync(appRuntime) ? { command: process.execPath, args: [appRuntime], path: appRuntime, source: 'app-runtime' } : null;
}

export async function runCommand(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}) {
  return new Promise<{ code: number | null; signal:NodeJS.Signals|null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, CI: '1', ...options.env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', overflow = false;
    const kill = () => {
      try { killOwnedGroup(child.pid); }
      catch (error) { clearTimeout(timer); reject(new Error(`命令进程组清理未确认：${errorText(error)}`)); }
    };
    const timer = setTimeout(kill, options.timeoutMs ?? 15000);
    child.stdout.on('data', chunk => { if (stdout.length < 2_000_000) stdout += chunk; else { overflow = true; kill(); } });
    child.stderr.on('data', chunk => { if (stderr.length < 2_000_000) stderr += chunk; else { overflow = true; kill(); } });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (code,signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr: overflow ? 'Output limit exceeded' : stderr }); });
  });
}

export async function detectAgent() {
  const runtime = findRuntime();
  if (!runtime) return { id: 'qoder-cn', available: false, reason: '未发现 Qoder CN 官方 CLI 或 App 运行时' };
  const [version, help] = await Promise.all([
    runCommand(runtime.command, [...runtime.args, '--version']),
    runCommand(runtime.command, [...runtime.args, '--help'])
  ]);
  return { id: 'qoder-cn', available: version.code === 0 && help.code === 0, runtime, version: version.stdout.trim(),
    authentication: '未验证；需通过官方账号执行受限探测',
    capabilities: { streamJson: help.stdout.includes('--output-format'), maxTurns: help.stdout.includes('--max-turns'), strictMcp: help.stdout.includes('--strict-mcp-config'), tools: help.stdout.includes('--tools'), isolatedConfig: help.stdout.includes('--config-dir') },
    compatibility: runtime.source === 'app-runtime' ? 'App 自带兼容路径；App 更新后需重新验证' : '官方 CLI',
    error: version.code !== 0 ? errorText(version.stderr) : null };
}

export async function listModels() {
  const runtime = findRuntime();
  if (!runtime) throw new Error('Qoder CN CLI 不可用');
  const result = await runCommand(runtime.command, [...runtime.args, '--list-models']);
  if (result.code !== 0) throw new Error(errorText(result.stderr || '模型发现超时或失败'));
  const lines = result.stdout.replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines[0] !== 'MODEL') throw new Error('模型输出格式变化；未猜测模型目录');
  return { source: 'qoderclicn --list-models', sampledAt: new Date().toISOString(), models: lines.slice(1), options: parseModelOptions(lines.slice(1)), availability: '可列出不表示调用成功或额度充足；自定义模型可能使用独立供应商额度' };
}

export function parseModelOptions(models: string[]): ModelOption[] {
  return models.map(label => {
    const match = /^(.*?)\s+\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)$/i.exec(label);
    return match ? { id: match[2]!, label: match[1]!, kind: 'custom' } : { id: label, label, kind: 'platform' };
  });
}
