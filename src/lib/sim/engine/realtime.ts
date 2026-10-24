import { hashStr } from "../rng";
import { TICK, type NodeRt, type Req } from "./model";
import { Sim } from "./sim";

/**
 * News and held connections. A client with `news` publishes numbered items. A client that `subscribe`s keeps one
 * connection per user open at a server with `hold`, which pushes every item it receives down each of them; a client that
 * polls a server with `feed` hears of items only when it asks. Heartbeats let a user notice a connection gone silent.
 */
const realtime: Partial<Sim> & ThisType<Sim> = {
  /**
   * Once traffic starts, each user opens its first connection at a moment of its own within `reconnectMs` (500 ms if
   * 0), or first polls at a moment of its own within its polling interval.
   */
  opens(n: NodeRt) {
    n.opened = true;
    const c = n.spec.client!;
    const spread = c.poll ?? (c.subscribe?.reconnectMs || 500);
    for (let u = 0; u < (c.keys ?? 1); u++) this.resubs.push({ at: this.t + Math.max(TICK, n.rng() * spread), client: n.spec.id, user: u, poll: !!c.poll });
  },

  /** A user opens a connection for news: a request that its server holds open. */
  subscribe(n: NodeRt, user: number) {
    const c = n.spec.client!;
    const r = this.make(n.spec.id, "sub", user, c.tag ?? "user");
    r.logicalId = (hashStr(n.spec.id) ^ Math.imul(user + 1, 0x27d4eb2d) ^ Math.imul(this.t + 1, 0x165667b1)) >>> 0;
    n.subOf.set(user, r);
    const hb = c.subscribe!.heartbeat;
    if (hb) n.beats.set(user, { misses: 0, next: this.t + hb.everyMs, out: 0 });
    const target = n.spec.to?.[0];
    if (target) this.send(r, this.resolve(n, target));
  },

  /**
   * A server with `hold` takes a connection in (a worker's time, then) keeps it open, if it has room for one more; turned
   * away, the user tries again later.
   */
  holdSub(n: NodeRt, r: Req) {
    if (n.subs.length >= n.spec.hold!.max) return this.refuse(n, r);
    r.phase = "wait";
    r.started = this.t;
    n.subs.push(r);
  },

  /** A news item reaches a server with `hold`: a small cobalt push goes down every connection it holds, the way each came. */
  fanOut(n: NodeRt, r: Req) {
    for (const sub of n.subs) {
      const p = this.make(sub.client, "push", sub.key, sub.tag);
      p.detached = true;
      p.news = r.news;
      p.logicalId = (sub.logicalId ^ Math.imul(r.news, 0x9e3779b1)) >>> 0;
      p.stack = sub.stack.map((f) => ({ id: f.id, calls: [] }));
      p.at = n.spec.id;
      this.respond(p, "ok");
    }
  },

  /**
   * News reaches a user. A push carries one item: it is delivered now, logged with how long after it was published. A
   * poll's answer is the feed as it stands: every item newer than the last one the user had is delivered now, and a
   * poll with nothing newer was asked for nothing.
   */
  heard(n: NodeRt, r: Req) {
    const prev = n.seen.get(r.key) ?? 0;
    if (r.op === "read") this.polls.add(this.t);
    if (r.news <= prev) {
      if (r.op === "read") this.empty.add(this.t);
      return;
    }
    for (const item of this.news) if (r.op === "push" ? item.seq === r.news : item.seq > prev && item.seq <= r.news) this.newsLog.push({ t: this.t, lag: this.t - item.t });
    n.seen.set(r.key, r.news);
  },

  /**
   * A user's connection came back closed. A long poll that ran its course opens again at once; one that failed or was
   * turned away opens again after a random wait of up to `reconnectMs` (with none, every user is back at once).
   */
  subEnded(n: NodeRt, r: Req) {
    r.phase = "gone";
    if (n.subOf.get(r.key) !== r) return;
    n.subOf.delete(r.key);
    n.beats.delete(r.key);
    const wait = r.result === "ok" ? 0 : (n.spec.client!.subscribe!.reconnectMs ?? 0) * n.rng();
    this.resubs.push({ at: this.t + Math.max(TICK, wait), client: n.spec.id, user: r.key });
  },

  /** Every 10 ms at a server with `hold`: connections held for their whole `holdMs` are closed (a long poll's answer). */
  expireSubs(n: NodeRt) {
    if (!n.up) return;
    for (const r of [...n.subs]) {
      const hold = this.nodes.get(r.client)?.spec.client?.subscribe?.holdMs ?? Infinity;
      if (this.t - r.started < hold) continue;
      n.subs.splice(n.subs.indexOf(r), 1);
      this.respond(r, "ok");
    }
  },

  /** Every 10 ms at a client with heartbeats: each user with a connection open pings the server holding it, once every `everyMs`. */
  heartbeats(n: NodeRt) {
    const hb = n.spec.client!.subscribe!.heartbeat!;
    for (const [user, b] of n.beats) {
      if (this.t < b.next || b.out) continue;
      const sub = n.subOf.get(user);
      if (!sub) continue;
      // Only a connection held open is pinged: one on its way, or waiting to be taken in, isn't open yet.
      const held = sub.phase === "wait" && !!this.nodes.get(sub.at)?.subs.includes(sub);
      if (!held && (sub.phase === "travel" || sub.phase === "wait" || sub.phase === "work")) continue;
      b.next = this.t + hb.everyMs;
      const p = this.make(n.spec.id, "probe", user, "probe");
      p.beat = true;
      p.probeOf = sub.at;
      p.deadline = this.t + hb.timeoutMs;
      p.logicalId = (sub.logicalId ^ Math.imul(this.t + 1, 0x85ebca6b)) >>> 0;
      b.out = p.id;
      // A connection that was never taken in (hung on its way, or lost) answers no ping: a miss straight away.
      if (!held) {
        p.phase = "gone";
        this.beatResult(n, p, false);
        continue;
      }
      // Along the connection's own path: through whatever it passed on its way in.
      this.send(p, sub.stack[1]?.id ?? sub.at);
    }
  },

  /** A ping came back (`ok`) or didn't. After `missAfter` misses in a row the user gives up on the connection and opens another. */
  beatResult(n: NodeRt, r: Req, ok: boolean) {
    const b = n.beats.get(r.key);
    if (!b || b.out !== r.id) return;
    b.out = 0;
    if (ok) {
      b.misses = 0;
      return;
    }
    const s = n.spec.client!.subscribe!;
    if (++b.misses < s.heartbeat!.missAfter) return;
    const sub = n.subOf.get(r.key);
    n.subOf.delete(r.key);
    n.beats.delete(r.key);
    if (sub) {
      const at = this.nodes.get(sub.at);
      const i = at ? at.subs.indexOf(sub) : -1;
      if (at && i >= 0) {
        at.subs.splice(i, 1);
        // Given up on while its server was fine is a false alarm; otherwise, how long the silence went unnoticed.
        if (at.up) this.falseAlarms.add(this.t);
        else this.detects.push({ t: this.t, ms: this.t - at.downAt });
      }
      sub.abandoned = true;
      this.release(sub);
      if (sub.phase !== "travel") sub.phase = "gone";
    }
    this.resubs.push({ at: this.t + Math.max(TICK, (s.reconnectMs ?? 0) * n.rng()), client: n.spec.id, user: r.key });
  },
};

Object.assign(Sim.prototype, realtime);
