import { homedir, platform } from 'node:os';
import { resolve, join } from 'node:path';
import { mkdirSync, chmodSync } from 'node:fs';

export function dataDirectory(): string {
  const path = resolve(process.env.HELMDESK_DATA_DIR ?? (platform() === 'darwin'
    ? join(homedir(), 'Library/Application Support/HelmDesk') : join(homedir(), '.local/share/helmdesk')));
  mkdirSync(path, { recursive: true, mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

export const terminalStates = new Set(['completed', 'failed', 'cancelled', 'waiting_user']);
