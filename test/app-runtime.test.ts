import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appIdentity } from '../src/app-runtime.js';
import { ensureLocalService } from '../src/local-service.js';

test('application startup authenticates the recorded instance and does not invoke model tools', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'helm-app-identity-'));
  const identity = appIdentity(directory, 14317);
  const token = 'a'.repeat(64);
  writeFileSync(join(directory, 'connection.json'), JSON.stringify({ ...identity, token, pid: process.pid }));
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:14317/api/runtime');
    assert.equal(init.method, 'GET');
    assert.equal((init.headers as Record<string, string>).Authorization, `Bearer ${token}`);
    return new Response(JSON.stringify({ ...identity, activeTasks: 2 }));
  });
  try { await ensureLocalService(directory, 1, true); assert.equal(calls, 1); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});

test('application startup rejects foreign instances, incompatible protocols, paths and unauthorized servers', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'helm-app-reject-'));
  const identity = appIdentity(directory, 14318);
  writeFileSync(join(directory, 'connection.json'), JSON.stringify({ ...identity, token: 'b'.repeat(64) }));
  let response = new Response('{}', { status: 401 });
  t.mock.method(globalThis, 'fetch', async () => response);
  try {
    await assert.rejects(ensureLocalService(directory, 1, true), /身份校验/);
    for (const patch of [{ instanceId: 'foreign' }, { protocolVersion: 2 }, { dataDirectory: '/foreign' }, { port: 14319 }, { service: 'other' }]) {
      response = new Response(JSON.stringify({ ...identity, ...patch }));
      await assert.rejects(ensureLocalService(directory, 1, true), /不一致/);
    }
    writeFileSync(join(directory, 'connection.json'), JSON.stringify({ port: 14318, token: 'legacy' }));
    await assert.rejects(ensureLocalService(directory, 1, true), /不支持应用身份协议/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
