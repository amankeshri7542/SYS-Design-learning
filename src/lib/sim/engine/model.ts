import type { Call, NodeSpec, Op, Result } from "../types";

/** Fixed simulation step in simulated milliseconds. */
export const TICK = 2;

export type Phase = "travel" | "wait" | "work" | "parked" | "gone";

export interface Frame {
  id: string;
  calls: Call[];
  /** Load balancer: which target this request was sent to. */
  via?: string;
}

export interface Req {
  id: number;
  op: Op;
  key: number;
  tag: string;
  client: string;
  /** When the logical request (first attempt) started. */
  first: number;
  born: number;
  attempt: number;
  deadline: number;
  stack: Frame[];
  dir: 1 | -1;
  phase: Phase;
  /** Node the request is at (when not travelling). */
  at: string;
  from: string;
  to: string;
  t0: number;
  t1: number;
  doneAt: number;
  started: number;
  calledAt: number;
  result: Result | null;
  seq: number;
  stale: boolean;
  hit: boolean;
  abandoned: boolean;
  detached: boolean;
  /** Set when a server gave up waiting for this request; it is now a ghost. */
  orphanAt: string;
  cost: number;
  probeOf: string;
}

export interface Entry {
  seq: number;
  exp: number;
  last: number;
}

export interface Done {
  t: number;
  lat: number;
  result: Result;
  tag: string;
  op: Op;
}

/** Counts timestamps inside a sliding window. */
export class Win {
  private ts: number[] = [];
  private head = 0;
  constructor(private w: number) {}
  add(t: number) {
    this.ts.push(t);
  }
  count(now: number) {
    const from = now - this.w;
    while (this.head < this.ts.length && this.ts[this.head] <= from) this.head++;
    if (this.head > 1024) {
      this.ts = this.ts.slice(this.head);
      this.head = 0;
    }
    return this.ts.length - this.head;
  }
}

export interface NodeRt {
  spec: NodeSpec;
  up: boolean;
  /** Exists and is drawn (autoscaled servers can be off). */
  on: boolean;
  /** Can receive traffic (false while booting or draining). */
  ready: boolean;
  bootUntil: number;
  work: Req[];
  held: Req[];
  queue: Req[];
  parked: Req[];
  incoming: number;
  rr: number;
  out: Map<string, number>;
  cache: Map<number, Entry>;
  waiters: Map<number, Req[]>;
  data: Map<number, number>;
  buckets: Map<string, { tokens: number; t: number }>;
  /** `trialId`: the request sent as the half-open breaker's one trial (0 when none). */
  breaker: { state: "closed" | "open" | "half"; fails: number; openedAt: number; trial: boolean; trialId: number };
  health: Map<string, { ok: boolean; fails: number; passes: number }>;
  load: number;
  /** Running hot: its line passed twice its workers, and has not yet fallen back to its workers' count. */
  hot: boolean;
  hits: Win;
  misses: Win;
  arrivals: Win;
  served: number;
  nextArrival: number;
  nextProbe: number;
  nextScale: number;
  lastScaleOut: number;
  moved: number;
  movedAt: number;
  rng: () => number;
  cdf: number[] | null;
}

export interface Note {
  t: number;
  text: string;
}

/** A logical request's first attempt leaving its client. */
export interface Spawn {
  t: number;
  client: string;
  key: number;
  op: Op;
  cost: number;
}
