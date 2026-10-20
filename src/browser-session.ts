import {createHash, randomBytes} from 'node:crypto';

/** Browser capabilities are sent explicitly, never as host-scoped loopback cookies. */
export class BrowserSessions {
  private readonly sessions = new Map<string, {csrf:string; expiresAt:number}>();
  constructor(private readonly now = Date.now) {}
  issue() {
    this.prune();
    if (this.sessions.size >= 128) throw Error('网页会话过多，请稍后重试');
    const browserToken=randomBytes(32).toString('hex'), csrf=randomBytes(32).toString('hex');
    const expiresAt=this.now()+12*60*60*1000;
    this.sessions.set(this.hash(browserToken),{csrf,expiresAt});
    return {browserToken,csrf,expiresAt:new Date(expiresAt).toISOString()};
  }
  get(value:unknown) {
    this.prune();
    if(typeof value!=='string'||! /^[a-f0-9]{64}$/.test(value)) return undefined;
    return this.sessions.get(this.hash(value));
  }
  private hash(value:string) {return createHash('sha256').update(value).digest('hex');}
  private prune() {for(const [key,value] of this.sessions)if(value.expiresAt<=this.now())this.sessions.delete(key);}
}

/** Owner-issued bootstrap tickets carry browser authority, never the service bearer. */
export class BrowserTickets {
  private readonly tickets = new Map<string, number>();
  constructor(private readonly now = Date.now) {}

  issue() {
    this.prune();
    if (this.tickets.size >= 32) throw Error('待使用的网页入口过多，请稍后重试');
    const ticket = randomBytes(32).toString('hex'), expiresAt = this.now() + 60_000;
    this.tickets.set(this.hash(ticket), expiresAt);
    return {ticket, expiresAt: new Date(expiresAt).toISOString()};
  }

  consume(ticket: unknown) {
    this.prune();
    if (typeof ticket !== 'string' || ticket.length !== 64 || !/^[a-f0-9]{64}$/.test(ticket)) return false;
    const key = this.hash(ticket), expiresAt = this.tickets.get(key);
    this.tickets.delete(key);
    return expiresAt !== undefined && expiresAt > this.now();
  }

  private hash(ticket: string) { return createHash('sha256').update(ticket).digest('hex'); }
  private prune() {
    for (const [key, expiresAt] of this.tickets) if (expiresAt <= this.now()) this.tickets.delete(key);
  }
}
