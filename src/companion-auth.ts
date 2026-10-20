import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export const companionPermissions = ['read', 'cancel', 'review', 'disposition'] as const;
export type CompanionPermission = typeof companionPermissions[number];
const nameSchema = z.string().trim().min(1).max(60).refine(value => !/[\x00-\x1f\x7f]/.test(value));
const permissionsSchema = z.array(z.enum(companionPermissions)).min(1).max(4)
  .refine(value => value.includes('read') && new Set(value).size === value.length);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const equal = (left: string, right: string) => {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export class CompanionError extends Error {
  constructor(readonly code: 'invalid_pairing' | 'pending_approval' | 'revoked' | 'unauthorized' | 'forbidden' | 'expired' | 'capacity', message: string) {
    super(message); this.name = 'CompanionError';
  }
}
export interface CompanionDevice {
  id: string; name: string; permissions: CompanionPermission[];
  createdAt: string; expiresAt: string; lastSeenAt: string | null; revokedAt: string | null;
}
interface DeviceRow {
  id: string; name: string; permissions: string; credential_hash: string;
  created_at: number; expires_at: number; last_seen_at: number | null; revoked_at: number | null;
}
interface PendingPairing {
  id: string; name: string; proofHash: string; expires: number;
  approval?: { deviceId: string; permissions: CompanionPermission[] };
}
interface Session { deviceId: string; csrf: string; expires: number }

/** Only device credential hashes persist. Invitations, claims and web sessions die on restart. */
export class CompanionAuth {
  private invitation?: { proofHash: string; expires: number };
  private readonly pending = new Map<string, PendingPairing>();
  private readonly sessions = new Map<string, Session>();
  private readonly invitationTTL = 5 * 60_000;
  private readonly sessionTTL = 15 * 60_000;
  private readonly credentialTTL = 90 * 24 * 60 * 60_000;

  constructor(private readonly database: DatabaseSync, private readonly now = Date.now) {
    database.exec(`CREATE TABLE IF NOT EXISTS companion_devices (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, permissions TEXT NOT NULL,
      credential_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      last_seen_at INTEGER, revoked_at INTEGER
    )`);
  }

  invite() {
    this.prune();
    const proof = secret(), expires = this.now() + this.invitationTTL;
    this.invitation = { proofHash: digest(proof), expires };
    return { invitation: proof, expiresAt: new Date(expires).toISOString() };
  }

  beginPairing(invitation: string, proposedName: string) {
    this.prune();
    const name = nameSchema.parse(proposedName);
    const active = this.invitation;
    if (!active || active.expires <= this.now() || !equal(active.proofHash, digest(invitation))) {
      throw new CompanionError('invalid_pairing', '配对邀请无效、已使用或已过期');
    }
    if (this.pending.size >= 10) throw new CompanionError('capacity', '待确认设备过多，请先处理');
    this.invitation = undefined;
    const id = randomUUID(), proof = secret(), expires = this.now() + this.invitationTTL;
    this.pending.set(id, { id, name, proofHash: digest(proof), expires });
    return { requestId: id, claim: proof, expiresAt: new Date(expires).toISOString() };
  }

  pendingPairings() {
    this.prune();
    return [...this.pending.values()].map(value => ({
      id: value.id, name: value.name, approved: !!value.approval,
      expiresAt: new Date(value.expires).toISOString(),
    }));
  }

  approve(requestId: string, requestedPermissions: CompanionPermission[] = ['read']) {
    this.prune();
    const permissions = permissionsSchema.parse(requestedPermissions);
    const pairing = this.pending.get(requestId);
    if (!pairing) throw new CompanionError('expired', '配对请求已过期');
    if (pairing.approval) {
      if (JSON.stringify(pairing.approval.permissions) !== JSON.stringify(permissions)) {
        throw new CompanionError('forbidden', '已确认的配对权限不能静默更改，请取消后重新配对');
      }
      return { requestId, approved: true };
    }
    if (this.devices().filter(device => !device.revokedAt && Date.parse(device.expiresAt) > this.now()).length >= 20) {
      throw new CompanionError('capacity', '已配对设备达到上限，请先撤销旧设备');
    }
    pairing.approval = { deviceId: randomUUID(), permissions };
    return { requestId, approved: true };
  }

  decline(requestId: string) { this.pending.delete(requestId); }

  claimPairing(requestId: string, proof: string) {
    this.prune();
    const pairing = this.pending.get(requestId);
    if (!pairing || !equal(pairing.proofHash, digest(proof))) {
      throw new CompanionError('invalid_pairing', '配对确认凭据无效或已过期');
    }
    if (!pairing.approval) return { status: 'pending' as const };
    const now = this.now(), approval = pairing.approval;
    // Recheck after approval: several approved claims may race toward the capacity.
    if (this.devices().filter(device => !device.revokedAt && Date.parse(device.expiresAt) > now).length >= 20) {
      throw new CompanionError('capacity', '已配对设备达到上限');
    }
    const credential = `hd1_${approval.deviceId}.${secret()}`;
    this.database.prepare(`INSERT INTO companion_devices
      (id,name,permissions,credential_hash,created_at,expires_at,last_seen_at,revoked_at)
      VALUES(?,?,?,?,?,?,NULL,NULL)`).run(approval.deviceId, pairing.name, JSON.stringify(approval.permissions), digest(credential), now, now + this.credentialTTL);
    this.pending.delete(requestId);
    return { status: 'paired' as const, credential, device: this.device(approval.deviceId) };
  }

  devices(): CompanionDevice[] {
    const rows = this.database.prepare('SELECT * FROM companion_devices ORDER BY created_at DESC, id').all() as unknown as DeviceRow[];
    return rows.map(row => this.view(row));
  }

  private device(id: string): CompanionDevice {
    const row = this.row(id);
    if (!row) throw new CompanionError('unauthorized', '设备凭据无效');
    return this.view(row);
  }

  private row(id: string): DeviceRow | undefined {
    return this.database.prepare('SELECT * FROM companion_devices WHERE id=?').get(id) as DeviceRow | undefined;
  }

  private view(row: DeviceRow): CompanionDevice {
    return {
      id: row.id, name: row.name, permissions: permissionsSchema.parse(JSON.parse(row.permissions)),
      createdAt: new Date(row.created_at).toISOString(), expiresAt: new Date(row.expires_at).toISOString(),
      lastSeenAt: row.last_seen_at === null ? null : new Date(row.last_seen_at).toISOString(),
      revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at).toISOString(),
    };
  }

  private activeDevice(id: string) {
    const row = this.row(id);
    if (!row) throw new CompanionError('unauthorized', '设备凭据无效');
    if (row.revoked_at !== null) throw new CompanionError('revoked', '设备授权已撤销，请重新配对');
    if (row.expires_at <= this.now()) throw new CompanionError('expired', '设备凭据已过期，请重新配对');
    if (row.last_seen_at === null || this.now() - row.last_seen_at >= 60_000) {
      this.database.prepare('UPDATE companion_devices SET last_seen_at=? WHERE id=?').run(this.now(), id);
      row.last_seen_at = this.now();
    }
    return { row, device: this.view(row) };
  }

  createSession(credential: string) {
    this.prune();
    const match = /^hd1_([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(credential);
    if (!match) throw new CompanionError('unauthorized', '设备凭据无效');
    const row = this.row(match[1]!);
    if (!row || !equal(row.credential_hash, digest(credential))) throw new CompanionError('unauthorized', '设备凭据无效');
    const { device } = this.activeDevice(row.id);
    if ([...this.sessions.values()].filter(session => session.deviceId === row.id).length >= 4) {
      throw new CompanionError('capacity', '此设备的活动会话过多，请稍后重试');
    }
    if (this.sessions.size >= 256) throw new CompanionError('capacity', '活动会话过多，请稍后重试');
    const id = secret(), csrf = secret(), expires = this.now() + this.sessionTTL;
    this.sessions.set(digest(id), { deviceId: row.id, csrf, expires });
    return { id, csrf, expiresAt: new Date(expires).toISOString(), device };
  }

  authorizeSession(id: string, required: CompanionPermission = 'read', csrf?: string) {
    this.prune();
    const session = this.sessions.get(digest(id));
    if (!session || session.expires <= this.now()) throw new CompanionError('unauthorized', '设备会话已过期，请重新连接');
    const { device } = this.activeDevice(session.deviceId);
    if (!device.permissions.includes(required)) throw new CompanionError('forbidden', '设备没有此操作权限');
    if (required !== 'read' && (!csrf || !equal(csrf, session.csrf))) throw new CompanionError('forbidden', '写操作需要当前会话的 CSRF 校验');
    return { device, csrf: session.csrf };
  }

  revoke(deviceId: string) {
    const row = this.row(deviceId);
    if (!row) throw new CompanionError('unauthorized', '设备不存在');
    if (row.revoked_at === null) this.database.prepare('UPDATE companion_devices SET revoked_at=? WHERE id=?').run(this.now(), deviceId);
    for (const [key, session] of this.sessions) if (session.deviceId === deviceId) this.sessions.delete(key);
    return this.device(deviceId);
  }

  close() { this.invitation = undefined; this.pending.clear(); this.sessions.clear(); }

  private prune() {
    const now = this.now();
    if (this.invitation && this.invitation.expires <= now) this.invitation = undefined;
    for (const [id, value] of this.pending) if (value.expires <= now) this.pending.delete(id);
    for (const [id, value] of this.sessions) if (value.expires <= now) this.sessions.delete(id);
  }
}
