import { X509Certificate, createPrivateKey, createPublicKey } from 'node:crypto';
import { existsSync, lstatSync, mkdtempSync, readFileSync, renameSync, rmSync, chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from './qoder.js';

export interface CompanionIdentity {
  key: Buffer; cert: Buffer; fingerprint: string; validUntil: string;
}

function privateFile(path: string) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid()) {
    throw new Error('手机连接身份文件必须是当前用户的私有普通文件');
  }
  return readFileSync(path);
}

function load(directory: string, now: number): CompanionIdentity {
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077 || process.getuid && stat.uid !== process.getuid()) {
    throw new Error('手机连接身份目录权限无效');
  }
  const key = privateFile(join(directory, 'key.pem')), cert = privateFile(join(directory, 'cert.pem'));
  const certificate = new X509Certificate(cert);
  if (!certificate.verify(certificate.publicKey) || !certificate.checkHost('helmdesk.local') ||
      Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now) {
    throw new Error('手机连接证书无效或已过期；不会静默更换配对身份');
  }
  const publicKey = createPublicKey(createPrivateKey(key)).export({ type: 'spki', format: 'der' });
  if (!certificate.publicKey.export({ type: 'spki', format: 'der' }).equals(publicKey)) throw new Error('手机连接证书与私钥不匹配');
  return { key, cert, fingerprint: certificate.fingerprint256.replaceAll(':', '').toLowerCase(), validUntil: new Date(certificate.validTo).toISOString() };
}

/** Exact certificate pinning is independent of LAN addresses. No listener is created here. */
export async function companionIdentity(dataDirectory: string, now?: number, execute = runCommand): Promise<CompanionIdentity> {
  const directory = join(dataDirectory, 'companion-identity');
  if (existsSync(directory)) return load(directory, now ?? Date.now());
  const stage = mkdtempSync(join(dataDirectory, '.companion-identity-'));
  chmodSync(stage, 0o700);
  try {
    const config = join(stage, 'request.cnf');
    writeFileSync(config, '[req]\nprompt=no\ndistinguished_name=dn\nx509_extensions=v3\n[dn]\nCN=HelmDesk\n[v3]\nsubjectAltName=DNS:helmdesk.local\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\n', { mode: 0o600 });
    const result = await execute('/usr/bin/openssl', ['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-x509', '-sha256', '-days', '365', '-config', config, '-keyout', join(stage, 'key.pem'), '-out', join(stage, 'cert.pem')], { timeoutMs: 10_000 });
    if (result.code !== 0) throw new Error('无法生成手机连接的本机 TLS 身份');
    chmodSync(join(stage, 'key.pem'), 0o600); chmodSync(join(stage, 'cert.pem'), 0o600);
    // Issuance may cross a wall-clock second; validate against time after issuance.
    load(stage, now ?? Date.now());
    rmSync(config);
    try { renameSync(stage, directory); }
    catch (error: any) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error; }
    return load(directory, now ?? Date.now());
  } finally { rmSync(stage, { recursive: true, force: true }); }
}
