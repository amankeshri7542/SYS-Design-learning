import { hashStr, mix } from "../rng";
import type { Result } from "../types";
import type { Req } from "./model";
import { Sim } from "./sim";

/**
 * A number in [0, 1) that depends only on what is crossing which link: the logical message, its attempt and how many
 * links it has crossed on that attempt. Never on when, so the worlds of a lesson lose and delay the same crossings.
 */
export function fate(link: string, r: Req, salt: number) {
  return mix(hashStr(link) ^ mix(r.logicalId ^ Math.imul(r.attempt + 1, 0x85ebca6b) ^ Math.imul(r.hop + 1, 0xc2b2ae35) ^ salt)) / 2 ** 32;
}

/** Movement: link latency, sending out, answering back, arriving, and unwinding a request whose node was removed. */
const transport: Partial<Sim> & ThisType<Sim> = {
  latency(a: string, b: string) {
    const o = this.spec.links?.[`${a}>${b}`] ?? this.spec.links?.[`${b}>${a}`];
    if (typeof o === "number") return o;
    if (o?.ms !== undefined) return o.ms;
    const A = this.nodes.get(a)?.spec.at;
    const B = this.nodes.get(b)?.spec.at;
    if (!A || !B) return 20;
    const d = Math.hypot(A[0] - B[0], (A[1] - B[1]) * 0.6);
    return Math.max(12, d * (this.spec.msPerUnit ?? 1.2));
  },

  /** A link's own rules, when the scene gives it more than a latency. */
  linkOf(a: string, b: string) {
    const o = this.spec.links?.[`${a}>${b}`] ?? this.spec.links?.[`${b}>${a}`];
    return typeof o === "object" ? o : undefined;
  },

  /**
   * Put a request on the link from → to for `ms`, by the link's rules: a payload takes longer on a thin link, jitter
   * stretches or shortens the trip, a narrow link makes it wait its turn at the start, and a lossy one may drop it.
   */
  cross(r: Req, from: string, to: string, ms: number) {
    let start = this.t;
    r.sentAt = this.t;
    r.hop++;
    r.xfer = 0;
    if (r.op !== "probe") this.crossings.add(this.t);
    const L = this.linkOf(from, to);
    if (L) {
      const key = `${from}>${to}`;
      const payload = r.op === "write" ? r.dir === 1 : r.dir === -1;
      if (L.perCostMs && payload) {
        r.xfer = L.perCostMs * r.cost;
        ms += r.xfer;
      }
      if (L.jitterMs) ms = Math.max(1, ms + L.jitterMs * (2 * fate(key, r, 2) - 1));
      if (L.parallel) {
        const busy = (this.linkBusy.get(key) ?? []).filter((end) => end > this.t).sort((a, b) => a - b);
        if (busy.length >= L.parallel) start = busy[busy.length - L.parallel];
        busy.push(start + ms);
        this.linkBusy.set(key, busy);
      }
      if (L.loss && fate(key, r, 0) < L.loss) {
        r.lostAt = start + (0.35 + 0.5 * fate(key, r, 1)) * ms;
        if (r.op !== "probe") this.lostCrossings.add(this.t);
      }
    }
    r.t0 = start;
    r.t1 = start + ms;
  },

  /** A crossing lost on its link never arrives. Whoever waits for it gives up in time (and may send it again). */
  vanish(r: Req) {
    const frac = r.t1 > r.t0 ? (r.lostAt - r.t0) / (r.t1 - r.t0) : 0.5;
    this.fx.push({ t: this.t, kind: "lost", node: r.to, link: { from: r.from, to: r.to, frac } });
    r.lostAt = 0;
    this.release(r);
    if (r.dir === 1) {
      const dest = this.nodes.get(r.to);
      if (dest) dest.incoming = Math.max(0, dest.incoming - 1);
    }
    r.phase = r.detached ? "gone" : "lost";
  },

  /** A request that ends where it is and never comes back: the balancers on its way stop counting it. */
  release(r: Req) {
    // A ghost's copy already went back through the balancers above the server that gave up on it.
    const from = r.orphanAt ? r.stack.findIndex((f) => f.id === r.orphanAt) + 1 : 0;
    for (let i = from; i < r.stack.length; i++) {
      const { id, via } = r.stack[i];
      const lb = via ? this.nodes.get(id) : undefined;
      if (lb && via) lb.out.set(via, Math.max(0, (lb.out.get(via) ?? 1) - 1));
    }
  },

  send(r: Req, to: string, ms?: number) {
    const from = r.stack[r.stack.length - 1].id;
    r.phase = "travel";
    r.dir = 1;
    r.from = from;
    r.to = to;
    this.cross(r, from, to, ms ?? this.latency(from, to));
    const dest = this.nodes.get(to);
    if (dest) dest.incoming++;
    if (r.op !== "probe") this.link(from, to).sent++;
  },

  link(a: string, b: string) {
    const key = a < b ? `${a}~${b}` : `${b}~${a}`;
    let l = this.links.get(key);
    if (!l) this.links.set(key, (l = { sent: 0, failed: 0 }));
    return l;
  },

  respond(r: Req, result?: Result) {
    if (result && !r.result) r.result = result;
    const from = r.stack.pop()!.id;
    if (this.nodes.get(from)?.spec.replies === "ack") r.ack = true;
    if (!r.stack.length) {
      r.phase = "gone";
      return;
    }
    const to = r.stack[r.stack.length - 1].id;
    r.phase = "travel";
    r.dir = -1;
    r.from = from;
    r.to = to;
    this.cross(r, from, to, this.latency(from, to));
    if (r.op !== "probe" && r.result === "error") this.link(from, to).failed++;
  },

  arrive(r: Req) {
    const n = this.nodes.get(r.to);
    if (r.dir === 1 && n) n.incoming = Math.max(0, n.incoming - 1);
    if (!n) return this.unwind(r);
    r.wire += this.t - r.sentAt;
    r.at = n.spec.id;
    if (r.dir === 1) {
      r.stack.push({ id: n.spec.id, calls: [] });
      this.enter(n, r);
    } else {
      this.back(n, r);
    }
  },

  /** A node on this request's path was removed: hand it back, as an error, to the nearest node that still exists. */
  unwind(r: Req) {
    if (r.dir === 1 && r.phase === "travel") {
      // Still on its way out: the sender's frame is on top.
    } else {
      r.stack.pop();
    }
    while (r.stack.length && !this.nodes.has(r.stack[r.stack.length - 1].id)) r.stack.pop();
    const prev = r.stack.length ? this.nodes.get(r.stack[r.stack.length - 1].id) : undefined;
    if (!prev || r.detached) {
      r.phase = "gone";
      return;
    }
    r.dir = -1;
    r.at = prev.spec.id;
    r.result ??= "error";
    this.back(prev, r);
  },
};

Object.assign(Sim.prototype, transport);
