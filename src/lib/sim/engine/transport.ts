import type { Req } from "./model";
import type { Result } from "../types";
import { Sim } from "./sim";

/** Movement: link latency, sending out, answering back, arriving, and unwinding a request whose node was removed. */
const transport: Partial<Sim> & ThisType<Sim> = {
  latency(a: string, b: string) {
    const o = this.spec.links?.[`${a}>${b}`] ?? this.spec.links?.[`${b}>${a}`];
    if (o !== undefined) return o;
    const A = this.nodes.get(a)?.spec.at;
    const B = this.nodes.get(b)?.spec.at;
    if (!A || !B) return 20;
    const d = Math.hypot(A[0] - B[0], (A[1] - B[1]) * 0.6);
    return Math.max(12, d * (this.spec.msPerUnit ?? 1.2));
  },

  send(r: Req, to: string, ms?: number) {
    const from = r.stack[r.stack.length - 1].id;
    r.phase = "travel";
    r.dir = 1;
    r.from = from;
    r.to = to;
    r.t0 = this.t;
    r.t1 = this.t + (ms ?? this.latency(from, to));
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
    if (!r.stack.length) {
      r.phase = "gone";
      return;
    }
    const to = r.stack[r.stack.length - 1].id;
    r.phase = "travel";
    r.dir = -1;
    r.from = from;
    r.to = to;
    r.t0 = this.t;
    r.t1 = this.t + this.latency(from, to);
    if (r.op !== "probe" && r.result === "error") this.link(from, to).failed++;
  },

  arrive(r: Req) {
    const n = this.nodes.get(r.to);
    if (r.dir === 1 && n) n.incoming = Math.max(0, n.incoming - 1);
    if (!n) return this.unwind(r);
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
