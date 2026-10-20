import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { CompanionAuth, CompanionError, type CompanionPermission } from '../src/companion-auth.js';

const START = Date.parse('2026-10-19T00:00:00Z');

function fixture() {
  const db = new DatabaseSync(':memory:');
  let clock = START;
  const auths: CompanionAuth[] = [];
  const make = () => { const auth = new CompanionAuth(db, () => clock); auths.push(auth); return auth; };
  return {
    db, auth: make(), make,
    advance: (ms: number) => { clock += ms; },
    cleanup: () => { for (const auth of auths) auth.close(); db.close(); },
  };
}
type Fixture = ReturnType<typeof fixture>;

function throwsCode(fn: () => unknown, code: CompanionError['code']) {
  try { fn(); } catch (error) {
    assert.ok(error instanceof CompanionError, 'expected CompanionError');
    assert.equal(error.code, code);
    return;
  }
  assert.fail(`expected CompanionError(${code})`);
}

function pair(auth: CompanionAuth, permissions?: CompanionPermission[]) {
  const { invitation } = auth.invite();
  const { requestId, claim } = auth.beginPairing(invitation, 'companion');
  if (permissions) auth.approve(requestId, permissions); else auth.approve(requestId);
  const result = auth.claimPairing(requestId, claim);
  assert.equal(result.status, 'paired');
  return result as { status: 'paired'; credential: string; device: { id: string; permissions: CompanionPermission[] } };
}

test('claim before Mac approval stays pending and creates no device', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const { invitation } = f.auth.invite();
  const { requestId, claim } = f.auth.beginPairing(invitation, 'phone');
  assert.equal(f.auth.claimPairing(requestId, claim).status, 'pending');
  assert.deepEqual(f.auth.devices(), []);
  f.auth.approve(requestId);
  const result = f.auth.claimPairing(requestId, claim);
  assert.equal(result.status, 'paired');
  assert.equal(f.auth.devices().length, 1);
});

test('wrong invitation or wrong claim never creates a device', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const { invitation } = f.auth.invite();
  throwsCode(() => f.auth.beginPairing('not-the-invitation', 'phone'), 'invalid_pairing');
  const { requestId, claim } = f.auth.beginPairing(invitation, 'phone');
  f.auth.approve(requestId);
  throwsCode(() => f.auth.claimPairing(requestId, claim.slice(0, -2) + 'xx'), 'invalid_pairing');
  assert.deepEqual(f.auth.devices(), []);
});

test('invitation and claim cannot be replayed', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const { invitation } = f.auth.invite();
  const { requestId, claim } = f.auth.beginPairing(invitation, 'phone');
  throwsCode(() => f.auth.beginPairing(invitation, 'second'), 'invalid_pairing');
  f.auth.approve(requestId);
  assert.equal(f.auth.claimPairing(requestId, claim).status, 'paired');
  throwsCode(() => f.auth.claimPairing(requestId, claim), 'invalid_pairing');
  assert.equal(f.auth.devices().length, 1);
});

test('default approval is read-only; forged or read-less permissions reject', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const { credential, device } = pair(f.auth);
  assert.deepEqual(device.permissions, ['read']);
  const session = f.auth.createSession(credential);
  throwsCode(() => f.auth.authorizeSession(session.id, 'cancel', session.csrf), 'forbidden');

  const { invitation } = f.auth.invite();
  const { requestId, claim } = f.auth.beginPairing(invitation, 'forger');
  assert.throws(() => f.auth.approve(requestId, ['read', 'admin'] as CompanionPermission[]));
  assert.throws(() => f.auth.approve(requestId, ['cancel']));
  assert.throws(() => f.auth.approve(requestId, ['read', 'read']));
  assert.equal(f.auth.claimPairing(requestId, claim).status, 'pending');
  assert.equal(f.auth.devices().length, 1);
});

test('writes need the per-session CSRF; cross-device CSRF fails', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const a = pair(f.auth, ['read', 'cancel']);
  const b = pair(f.auth, ['read', 'cancel']);
  const sa = f.auth.createSession(a.credential);
  const sb = f.auth.createSession(b.credential);
  throwsCode(() => f.auth.authorizeSession(sa.id, 'cancel'), 'forbidden');
  throwsCode(() => f.auth.authorizeSession(sa.id, 'cancel', 'x'.repeat(43)), 'forbidden');
  throwsCode(() => f.auth.authorizeSession(sa.id, 'cancel', sb.csrf), 'forbidden');
  assert.equal(f.auth.authorizeSession(sa.id, 'cancel', sa.csrf).device.id, a.device.id);
  assert.equal(f.auth.authorizeSession(sa.id, 'read').device.id, a.device.id);
});

test('revoke kills sessions and credential but preserves device history', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const { credential, device } = pair(f.auth, ['read', 'cancel']);
  const session = f.auth.createSession(credential);
  const revoked = f.auth.revoke(device.id);
  assert.equal(revoked.revokedAt, new Date(START).toISOString());
  throwsCode(() => f.auth.authorizeSession(session.id, 'read'), 'unauthorized');
  throwsCode(() => f.auth.createSession(credential), 'revoked');
  const devices = f.auth.devices();
  assert.equal(devices.length, 1);
  assert.equal(devices[0]!.id, device.id);
  assert.equal(devices[0]!.name, 'companion');
});

test('restart keeps long credential but drops sessions, invitations, pending claims', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const { credential } = pair(f.auth, ['read', 'cancel']);
  const oldSession = f.auth.createSession(credential);
  const { invitation } = f.auth.invite();
  const { requestId, claim } = f.auth.beginPairing(invitation, 'pending');
  f.auth.approve(requestId);
  const activeInvite = f.auth.invite();

  const auth2 = f.make();
  const fresh = auth2.createSession(credential);
  assert.deepEqual(fresh.device.permissions, ['read', 'cancel']);
  throwsCode(() => auth2.authorizeSession(oldSession.id, 'read'), 'unauthorized');
  throwsCode(() => auth2.beginPairing(activeInvite.invitation, 'x'), 'invalid_pairing');
  throwsCode(() => auth2.claimPairing(requestId, claim), 'invalid_pairing');
  assert.equal(auth2.devices().length, 1);
  assert.ok(f.auth.beginPairing(activeInvite.invitation, 'still-valid-on-original-instance').requestId);
});

test('one paired device cannot occupy every other device session slot', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const a = pair(f.auth), b = pair(f.auth);
  for (let index = 0; index < 4; index++) f.auth.createSession(a.credential);
  throwsCode(() => f.auth.createSession(a.credential), 'capacity');
  assert.ok(f.auth.createSession(b.credential).id);
  f.advance(15 * 60_000);
  assert.ok(f.auth.createSession(a.credential).id);
});

test('approval cannot expand after confirmation and an approved claim still expires', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const pending = f.auth.beginPairing(f.auth.invite().invitation, 'fixture');
  f.auth.approve(pending.requestId, ['read']);
  assert.equal(f.auth.approve(pending.requestId, ['read']).approved, true);
  throwsCode(() => f.auth.approve(pending.requestId, ['read', 'review']), 'forbidden');
  f.advance(5 * 60_000);
  throwsCode(() => f.auth.claimPairing(pending.requestId, pending.claim), 'invalid_pairing');
  assert.equal(f.auth.devices().length, 0);
});

test('expiry: invitation 5min, session 15min, credential 90 days', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const { invitation } = f.auth.invite();
  f.advance(5 * 60_000);
  throwsCode(() => f.auth.beginPairing(invitation, 'late'), 'invalid_pairing');

  const { credential } = pair(f.auth);
  const session = f.auth.createSession(credential);
  f.advance(15 * 60_000);
  throwsCode(() => f.auth.authorizeSession(session.id, 'read'), 'unauthorized');
  f.advance(90 * 24 * 60 * 60_000 - 15 * 60_000 - 1);
  assert.ok(f.auth.createSession(credential).id);
  f.advance(1);
  throwsCode(() => f.auth.createSession(credential), 'expired');
});

test('database and device view never leak raw secrets', (t) => {
  const f = fixture(); t.after(f.cleanup);
  const inv = f.auth.invite();
  const begin = f.auth.beginPairing(inv.invitation, 'companion');
  f.auth.approve(begin.requestId);
  const result = f.auth.claimPairing(begin.requestId, begin.claim);
  assert.equal(result.status, 'paired');
  const credential = (result as { credential: string }).credential;
  const view = f.auth.devices()[0]!;
  assert.ok(!('credential' in view) && !('claim' in view) && !('invitation' in view));
  for (const dump of [JSON.stringify(f.auth.devices()), JSON.stringify(f.db.prepare('SELECT * FROM companion_devices').all())]) {
    for (const value of [credential, inv.invitation, begin.claim]) assert.ok(!dump.includes(value));
  }
});

test('pending pairing capacity is 10 and device capacity is 20', (t) => {
  const f = fixture(); t.after(f.cleanup);
  for (let i = 0; i < 10; i++) f.auth.beginPairing(f.auth.invite().invitation, `pending-${i}`);
  throwsCode(() => f.auth.beginPairing(f.auth.invite().invitation, 'overflow'), 'capacity');
  assert.equal(f.auth.pendingPairings().length, 10);

  const g = fixture(); t.after(g.cleanup);
  for (let i = 0; i < 20; i++) pair(g.auth);
  const { requestId } = g.auth.beginPairing(g.auth.invite().invitation, 'overflow');
  throwsCode(() => g.auth.approve(requestId), 'capacity');
  assert.equal(g.auth.devices().length, 20);
});
