import type { Op, Result } from "../types";
import { TICK, type NodeRt, type Req } from "./model";
import { hashStr, sampleCdf } from "../rng";
import { Sim } from "./sim";

/** Clients: arrivals on each client's own random stream (independent of anything downstream), and how a request ends there: answered, timed out, retried. */
const clients: Partial<Sim> & ThisType<Sim> = {
  rate(n: NodeRt) {
    const r = n.spec.client?.rate ?? 0;
    return typeof r === "function" ? r(this.t) : r;
  },

  gap(n: NodeRt, rate: number) {
    return (-Math.log(1 - n.rng()) / rate) * 1000;
  },

  arrivals() {
    const t = this.t;
    for (const n of this.list) {
      const c = n.spec.client;
      if (!c) continue;
      let guard = 0;
      while (n.nextArrival <= t && guard++ < 50) {
        const rate = this.rate(n);
        if (rate <= 0) {
          n.nextArrival = t + 50;
          break;
        }
        const u = n.rng();
        const key = c.hot && u < c.hot ? 0 : sampleCdf(n.cdf!, n.rng());
        const op: Op = c.writes && n.rng() < c.writes ? "write" : "read";
        const cost = c.heavy && n.rng() < c.heavy.share ? c.heavy.cost : 1;
        // A request for a key that doesn't exist: a read of a key no one ever writes. Drawn only when the scene asks.
        const absent = !!c.absent && n.rng() < c.absent;
        const k = absent ? 1_000_000 + Math.floor(n.rng() * (c.absentKeys ?? 1_000_000)) : key;
        // Held clients keep their clock and their draws, and send nothing: whenever the traffic starts, it is the
        // same traffic from then on.
        if (!this.holding) this.spawn(n, k, absent ? "read" : op, t, 0, absent ? 1 : cost, { absent });
        n.nextArrival += this.gap(n, rate);
      }
    }
    if (this.retrying.length) {
      const due = this.retrying.filter((p) => p.at <= t);
      if (due.length) {
        this.retrying = this.retrying.filter((p) => p.at > t);
        for (const p of due) {
          const n = this.nodes.get(p.client);
          if (n) this.spawn(n, p.key, p.op, p.first, p.attempt, p.cost, p);
        }
      }
    }
  },

  spawn(n: NodeRt, key: number, op: Op, first: number, attempt: number, cost: number, extra = {}) {
    const c = n.spec.client!;
    const r = this.make(n.spec.id, op, key, c.tag ?? "user");
    r.first = first;
    r.attempt = attempt;
    r.cost = cost;
    // One identity for the logical request, the same in every world: a retry keeps it.
    r.logicalId = extra.logicalId ?? (hashStr(n.spec.id) ^ Math.imul(++n.spawned, 0x9e3779b1)) >>> 0;
    r.absent = !!extra.absent;
    const timeout = c.timeoutMs ?? this.spec.timeoutMs;
    if (extra.deadline !== undefined && c.retry?.deadline === "shared") r.deadline = extra.deadline;
    else if (timeout) r.deadline = this.t + timeout;
    this.attempts.add(this.t);
    if (attempt === 0) this.logical.add(this.t);
    if (attempt === 0 && this.tracing) this.trace.push({ t: this.t, client: n.spec.id, key, op, cost });
    const target = n.spec.to?.[0];
    if (target) this.send(r, this.resolve(n, target));
  },

  finishAtClient(n: NodeRt, r: Req) {
    r.phase = "gone";
    if (r.abandoned || r.detached) return;
    const res: Result = r.result === "ok" && r.stale ? "stale" : (r.result ?? "error");
    if (res === "error" && this.retry(n, r)) return;
    this.record(r, res);
  },

  timeout(r: Req) {
    r.abandoned = true;
    // Lost on a link: it was kept only until now, when the client stops waiting for it.
    if (r.phase === "lost") r.phase = "gone";
    if (r.op === "probe") {
      const lb = this.nodes.get(r.client);
      if (lb) this.healthResult(lb, r.probeOf, false);
      if (r.phase === "parked") r.phase = "gone";
      return;
    }
    // Nobody waits for a ghost: the server that gave up on it already answered its caller.
    if (r.detached || r.orphanAt) return;
    this.effect("timeout", r.client);
    const n = this.nodes.get(r.client);
    if (n && this.retry(n, r)) return;
    this.record(r, "error");
  },

  retry(n: NodeRt, r: Req) {
    const p = n.spec.client?.retry;
    if (!p || p.mode === "none" || r.attempt >= p.max) return false;
    if (p.budget !== undefined && this.retries.count(this.t) >= p.budget * this.logical.count(this.t)) return false;
    const base = p.baseMs ?? 100;
    const delay = p.mode === "now" ? 0 : this.retryRng() * base * Math.pow(2, r.attempt);
    const at = this.t + Math.max(TICK, delay);
    // One deadline for every attempt: once it has passed, there is no point trying again.
    if (p.deadline === "shared" && r.deadline <= at) return false;
    this.retries.add(this.t);
    this.retrying.push({ at, client: n.spec.id, key: r.key, op: r.op, first: r.first, attempt: r.attempt + 1, cost: r.cost, logicalId: r.logicalId, absent: r.absent, deadline: r.deadline });
    return true;
  },
};

Object.assign(Sim.prototype, clients);
