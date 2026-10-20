import test from 'node:test';
import assert from 'node:assert/strict';
import {BrowserTickets} from '../src/browser-session.js';

function fakeClock(start = 1_700_000_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => { current += ms; },
  };
}

test('issue returns 64-char lowercase hex ticket and ISO expiry 60s ahead', () => {
  const clock = fakeClock();
  const tickets = new BrowserTickets(clock.now);
  const {ticket, expiresAt} = tickets.issue();
  assert.match(ticket, /^[a-f0-9]{64}$/);
  assert.equal(ticket.length, 64);
  assert.equal(expiresAt, new Date(clock.now() + 60_000).toISOString());
  assert.equal(Date.parse(expiresAt), clock.now() + 60_000);
});

test('consume succeeds once, replay returns false', () => {
  const clock = fakeClock();
  const tickets = new BrowserTickets(clock.now);
  const {ticket} = tickets.issue();
  assert.equal(tickets.consume(ticket), true);
  assert.equal(tickets.consume(ticket), false);
});

test('malformed, non-string, and unknown tickets are rejected without consuming a valid ticket', () => {
  const clock = fakeClock();
  const tickets = new BrowserTickets(clock.now);
  const {ticket} = tickets.issue();

  const badInputs: unknown[] = [
    '',
    'abc',
    ticket.slice(0, 63),
    ticket + '0',
    'F'.repeat(64),
    'z'.repeat(64),
    'f'.repeat(64),
    null,
    undefined,
    123,
    {},
    [],
    true,
    Symbol('ticket'),
  ];
  for (const bad of badInputs) {
    assert.equal(tickets.consume(bad), false, `expected false for ${String(bad)}`);
  }

  assert.equal(tickets.consume(ticket), true, 'valid ticket must still be consumable after rejected attempts');
});

test('ticket is denied at exactly 60s after issue and consumed before', () => {
  const clock = fakeClock();
  const tickets = new BrowserTickets(clock.now);

  const early = tickets.issue().ticket;
  clock.advance(59_999);
  assert.equal(tickets.consume(early), true, 'ticket just before expiry must be accepted');

  const atExpiry = tickets.issue().ticket;
  clock.advance(60_000);
  assert.equal(tickets.consume(atExpiry), false, 'ticket at exact expiry instant must be denied');

  const late = tickets.issue().ticket;
  clock.advance(60_001);
  assert.equal(tickets.consume(late), false, 'ticket past expiry must be denied');
});

test('at most 32 outstanding tickets; consuming one frees capacity', () => {
  const clock = fakeClock();
  const tickets = new BrowserTickets(clock.now);
  const issued: string[] = [];
  for (let i = 0; i < 32; i++) issued.push(tickets.issue().ticket);

  assert.throws(() => tickets.issue(), /过多/);

  assert.equal(tickets.consume(issued[0]), true);
  const freed = tickets.issue();
  assert.match(freed.ticket, /^[a-f0-9]{64}$/);
  assert.throws(() => tickets.issue(), /过多/);
});

test('expired tickets free capacity', () => {
  const clock = fakeClock();
  const tickets = new BrowserTickets(clock.now);
  for (let i = 0; i < 32; i++) tickets.issue();
  assert.throws(() => tickets.issue(), /过多/);

  clock.advance(60_000);
  const {ticket} = tickets.issue();
  assert.match(ticket, /^[a-f0-9]{64}$/);
  assert.equal(tickets.consume(ticket), true);
});

test('distinct issued tickets are independent', () => {
  const clock = fakeClock();
  const tickets = new BrowserTickets(clock.now);
  const a = tickets.issue().ticket;
  const b = tickets.issue().ticket;
  assert.notEqual(a, b);

  assert.equal(tickets.consume(a), true);
  assert.equal(tickets.consume(b), true, 'consuming one ticket must not affect another');
  assert.equal(tickets.consume(a), false);
  assert.equal(tickets.consume(b), false);
});

test('tickets are not transferable between BrowserTickets instances', () => {
  const clock = fakeClock();
  const issuer = new BrowserTickets(clock.now);
  const other = new BrowserTickets(clock.now);
  const {ticket} = issuer.issue();
  assert.equal(other.consume(ticket), false);
  assert.equal(issuer.consume(ticket), true);
});
