import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, chmodSync, writeFileSync, unlinkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request } from 'node:https';
import { companionIdentity } from '../src/companion-identity.js';
import { runCommand } from '../src/qoder.js';

test('identity issuance crossing a second is checked against completion time', { skip: process.platform !== 'darwin' }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'helm-identity-clock-'));
  try {
    const identity = await companionIdentity(directory, undefined, async (...args) => {
      await new Promise(resolve => setTimeout(resolve, 1100));
      return runCommand(...args);
    });
    assert.match(identity.fingerprint, /^[0-9a-f]{64}$/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('TLS identity is private, stable, and authenticates a real loopback TLS connection', { skip: process.platform !== 'darwin' }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'helm-identity-'));
  let server: ReturnType<typeof createServer> | undefined;
  try {
    const identity = await companionIdentity(directory), reloaded = await companionIdentity(directory);
    assert.equal(identity.fingerprint, reloaded.fingerprint); assert.match(identity.fingerprint, /^[0-9a-f]{64}$/);
    assert.equal(statSync(join(directory, 'companion-identity/key.pem')).mode & 0o777, 0o600);
    assert.equal(statSync(join(directory, 'companion-identity')).mode & 0o777, 0o700);
    server = createServer({ key: identity.key, cert: identity.cert, minVersion: 'TLSv1.3' }, (_req, res) => res.end('pinned-fixture'));
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    const read = (ca?: Buffer) => new Promise<string>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, servername: 'helmdesk.local', ca, minVersion: 'TLSv1.3' }, res => {
        let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve(text));
      }); req.once('error', reject); req.end();
    });
    assert.equal(await read(identity.cert), 'pinned-fixture');
    await assert.rejects(read());
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('invalid or expired identities fail closed instead of silently replacing a paired identity', { skip: process.platform !== 'darwin' }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'helm-identity-invalid-'));
  try {
    const identity = await companionIdentity(directory);
    await assert.rejects(companionIdentity(directory, Date.parse(identity.validUntil) + 1), /过期/);
    const key = join(directory, 'companion-identity/key.pem');
    chmodSync(key, 0o644); await assert.rejects(companionIdentity(directory), /私有普通文件/); chmodSync(key, 0o600);
    writeFileSync(join(directory, 'fake-key'), 'fixture'); unlinkSync(key); symlinkSync(join(directory, 'fake-key'), key);
    await assert.rejects(companionIdentity(directory), /私有普通文件/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
