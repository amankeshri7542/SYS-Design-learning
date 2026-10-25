// What a station shows under its name, and the state it is in: read by the stage (`stage.tsx`) every tick, and by a
// station's card (`part-card.tsx`) to say the same in words. Output only: reading it never changes a run.

import type { NodeRt, Sim } from "./engine/core";
import { windowSub } from "./layout";

export type BreakerState = "closed" | "half" | "open";

/** A station's state class, its sub-label, its state badge and, for a circuit breaker, its state. */
export interface View {
  cls: string;
  sub: string;
  badge?: { text: string; tone: string };
  pill?: BreakerState;
}

/** `sub` is the long wording; `fitSub` shortens it for narrow layouts. */
export function describe(sim: Sim, n: NodeRt, lbs: NodeRt[]): View {
  const s = n.spec;
  if (!n.on) return { cls: "off", sub: "standby" };
  if (n.bootUntil) return { cls: "booting", sub: "starting…" };
  if (!n.ready) return { cls: "draining", sub: "draining" };
  const benched = lbs.some((lb) => sim.flat(lb.spec.to).includes(s.id) && lb.health.get(s.id)?.ok === false);
  if (!n.up) {
    const sub = s.sink ? "paused · jobs wait" : n.restartAt ? "restarting…" : s.downMode === "hang" ? "not responding" : benched ? "down · taken out" : "down";
    return { cls: "down", sub, badge: { text: "DOWN", tone: "bad" } };
  }
  if (benched) return { cls: "benched", sub: "rejoining…" };
  if (lbs.some((lb) => lb.rolledBack.has(s.id))) return { cls: "benched", sub: "rolled back" };
  let sub = "";
  const slots = s.slots ?? 0;
  const busy = n.work.length + n.held.length;
  switch (s.kind) {
    case "client": {
      const r = s.client?.rate;
      const rate = typeof r === "function" ? r(sim.t) : (r ?? 0);
      if (s.client?.window) sub = `${n.flying}/${sim.windowOf(n)} in flight`;
      else if (s.client?.poll) sub = `ask every ${s.client.poll} ms`;
      else if (s.client?.subscribe) sub = `${n.subOf.size} connected`;
      else sub = s.connect ? `${Math.round(rate)} req/s · ${n.conns.length} open` : `${Math.round(rate)} req/s`;
      break;
    }
    case "lb":
      if (s.promote) sub = "to the primary";
      else if (s.glyph === "router" && sim.flat(s.to).length === 1) sub = "shares one line";
      else if (s.layer === 4) sub = "per connection";
      else if (s.autoscale) sub = `target ${Math.round(s.autoscale.target * 100)}% busy`;
      else if (s.algo === "hash") sub = `key → ${sim.flat(s.to).length} nodes`;
      else if (s.algo === "ring") sub = "ring of 64 points each";
      else if (s.algo === "nearest") sub = "nearest healthy";
      else if (s.algo === "weighted") sub = "by weight";
      else if (s.health) sub = "checking health";
      else sub = s.algo === "least" ? "least busy" : s.algo === "random" ? "random" : "round robin";
      break;
    case "limiter":
      sub = s.limit?.shared ? `lets in ${s.limit.rps}/s` : `${s.limit?.rps}/s per client`;
      break;
    case "cache":
      sub = s.writeMode === "behind" && n.dirty.size ? `${n.cache.size}/${s.capacity ?? 0} · ${n.dirty.size} unsaved` : `${n.cache.size}/${s.capacity ?? 0} items`;
      break;
    case "queue":
      // Jobs out with workers and not yet acked, or producers held back by back-pressure, are news too.
      sub = `${n.queue.length} waiting${n.inflight.size ? ` · ${n.inflight.size} out` : n.waiting.length ? ` · ${n.waiting.length} held` : ""}`;
      break;
    case "topic":
      sub = `${sim.flat(s.to).length} subscribers`;
      break;
    default:
      if (s.cluster) sub = n.raft.role === "leader" ? `leads · term ${n.raft.term}` : n.raft.role === "candidate" ? "asks for votes" : `term ${n.raft.term}`;
      else if (s.lock) sub = `${n.locks.size} held · ${[...n.waiters.values()].reduce((a, w) => a + w.length, 0)} waiting`;
      else if (s.quorum) sub = `W=${s.quorum.w} R=${s.quorum.r}`;
      else if (s.window) sub = windowSub(s.window);
      else if (s.hold) sub = `${n.subs.length}/${s.hold.max} open`;
      else if (s.maxConns !== undefined && !n.queue.length) sub = `${n.accepted}/${s.maxConns} connections`;
      else if (!slots) sub = n.queue.length ? `stalled · ${n.queue.length} waiting` : "stalled";
      else if (n.queue.length) sub = `${n.queue.length} waiting`;
      else {
        // Just back from a crash under load: fewer workers until it has warmed up.
        const can = sim.slotsOf(n);
        sub = can < slots ? `warming up · ${busy}/${can} busy` : `${busy}/${slots} busy`;
      }
  }
  const pill = s.breaker ? n.breaker.state : undefined;
  // Shedding holds its badge a moment past each refusal, so it doesn't flicker as the line crosses the mark.
  const shedding = s.shed && sim.t - n.shedAt < 300;
  // A sender told its receiver has no room waits for word that it has.
  const waiting = s.client?.window && n.peerWindow === 0;
  const badge = s.kind === "db" && s.leader && sim.partitioned ? { text: "CUT OFF", tone: "bad" } : shedding ? { text: "SHEDDING", tone: "warn" } : waiting ? { text: "WAIT", tone: "warn" } : undefined;
  // A station with no workers at all is stalled: news, even before a line forms.
  const stalled = (s.kind === "server" || s.kind === "db") && !slots && !s.sink;
  // A dead-letter queue keeps the jobs given up on: a red rim, the colour of failure.
  const dlq = s.kind === "queue" && sim.list.some((q) => q.spec.ack?.deadLetter === s.id);
  return { cls: n.hot ? "hot" : stalled ? "stalled" : dlq ? "dlq" : "", sub, badge, pill };
}
