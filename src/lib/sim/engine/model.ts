import type { Call, NodeSpec, Op, Result } from "../types";

/** Fixed simulation step in simulated milliseconds. */
export const TICK = 2;

/** `lost`: vanished on a link; it stays only until whoever waits for it gives up. */
export type Phase = "travel" | "wait" | "work" | "parked" | "lost" | "gone";

export interface Frame {
  id: string;
  calls: Call[];
  /** Load balancer: which target this request was sent to. */
  via?: string;
  /** The connection this node sent the request on (its id among the node's `conns`); it is freed when the answer is back. */
  conn?: number;
}

/** One connection a node has open to a target. */
export interface Conn {
  id: number;
  to: string;
  /** Exchanges on it now. */
  busy: number;
  /** When it last carried something (an idle connection closes `keepAliveMs` after this). */
  lastUsed: number;
  /** Its handshake is done: requests on it go at once. */
  ready: boolean;
  /** Round trips of handshake still to make. */
  rtts: number;
  /** The target counted it against its `maxConns`. */
  accepted: boolean;
  /**
   * `multiplex`: a lost answer on it is being resent, and every answer behind it waits: answers due between `from` and
   * `until` arrive at `until`.
   */
  stall: { from: number; until: number };
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
  /**
   * The logical message's identity, the same for every attempt and in every world of a lesson: with `attempt` and
   * `hop` (links crossed so far on this attempt) it decides a link's loss and jitter, never the order things happen in.
   */
  logicalId: number;
  hop: number;
  /** When this crossing vanishes (0: it arrives), and when it was put on the link. */
  lostAt: number;
  sentAt: number;
  /** For a key that doesn't exist. */
  absent: boolean;
  /** Where its time went so far: on links, waiting in line, being worked on (ms). */
  wire: number;
  wait: number;
  work: number;
  /** When it joined the line it is waiting in. */
  queuedAt: number;
  /** Of this crossing's time, how much is sending its payload down a thin link (output only: the stage stretches it). */
  xfer: number;
  /** An acknowledgement: drawn small and green. */
  ack: boolean;
  /** A poison job: every worker fails it. */
  poison: boolean;
  /** A job handed out by a queue that keeps it until acked: the id of this copy's entry there (0: none). */
  deliveryOf: number;
  /** This copy was acknowledged on receipt, so if its worker dies the job is lost. */
  acked: boolean;
  /** Sent by a database's outbox relay. */
  relay: boolean;
  /** On its way to a dead-letter queue: it is stored there, and nothing answers it. */
  deadLetter: boolean;
  /** How many times a connection has resent this crossing after losing it (each resend has its own fate). */
  resent: number;
  /** The page it belongs to (a client with `page`), 0 if none. */
  page: number;
  /** The news item it carries (a news write, a push, or a poll's answer), 0 if none. */
  news: number;
  /** On an answer from a receiver that advertises its room: how many more it can take (-1: it doesn't say). */
  window: number;
  /** A copy sent to a replica while the write it belongs to waits for it (`replication: "sync"`): the write's id. */
  syncFor: number;
  /** Counted in its sender's window (until it is answered or given up on). */
  flew: boolean;
  /** A read answered by a feed: its answer says whether there was news. */
  polled: boolean;
  /** A handshake round trip for this connection of its sender (its id), 0 if none. */
  hand: number;
  /** A heartbeat from a user to the server holding its connection. */
  beat: boolean;
  /** On a connection that resends what it loses: its resend timeout (0: a loss is final). */
  rto: number;
  /** When it left its sender (a sender with a window measures round trips from here). */
  outAt: number;
  /** One part of a request a server sent to several targets at once (`fanout`, a quorum, a commit): the request's id, and which part. */
  parentId: number;
  slot: number;
  /** A booking: the version of its key it read (it writes only if the key still has it); -1 when it read nothing. */
  expect: number;
  /** A booking's progress: 1 while it reads its key, 2 while it writes it. */
  reserving: number;
  /** A saga's request, undoing the steps already done after one failed. */
  undoing: boolean;
  /** A cluster message's term (a heartbeat, or a request for votes). */
  term: number;
}

/** A request a server sent to several targets at once, waiting for enough of them. */
export interface Gather {
  parent: Req;
  node: string;
  /** What each part does at its target: a read, a copy to store (`repl`)… */
  op: Op;
  need: number;
  got: number;
  bad: number;
  /** The freshest copy a part brought back (a quorum read). */
  best: number;
  slots: { call: string | string[]; done: boolean; sentAt: number; hedged: boolean; kids: Req[] }[];
}

export interface Entry {
  seq: number;
  exp: number;
  last: number;
  /** A remembered "not found". */
  absent?: boolean;
}

export interface Done {
  t: number;
  lat: number;
  result: Result;
  tag: string;
  op: Op;
  /** The answered attempt's time on links, waiting and in service (ms). */
  wire: number;
  wait: number;
  work: number;
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
  /** Client: logical requests sent so far (their ids come from it). */
  spawned: number;
  /** Requests for absent keys the existence check answered. */
  filtered: Win;
  /** Overload: since when the node has been past its mark (-1: it isn't), when it restarts, when its cold ramp began. */
  overSince: number;
  restartAt: number;
  coldFrom: number;
  /** Balancer: answers back from each target, for rolling a canary back; the targets it stopped sending to. */
  results: Map<string, { ok: Win; err: Win }>;
  rolledBack: Set<string>;
  /** When it last turned a request away by shedding (output only: the stage's SHEDDING badge). */
  shedAt: number;
  /** Sessions it holds in memory (`client:key`), lost when it crashes. */
  sessions: Set<string>;
  /** Idempotency notes: each logical message it finished (`client:logicalId`), when, and with what result. */
  done: Map<string, { t: number; id: number; result: Result }>;
  /** When it did a message's work again (not idempotent). */
  dupes: Win;
  /** Queue with acks: jobs handed out and not yet acknowledged, by the copy's id. */
  inflight: Map<number, { job: Req; at: number }>;
  /** Queue with back-pressure: producers' requests held until there is room. Primary replicating `sync`: writes waiting for their copies. */
  waiting: Req[];
  /** Database with an outbox: events not yet accepted downstream. */
  outbox: { id: number; key: number; tag: string; t: number; sentAt: number }[];
  nextRelay: number;
  /** Connections it has open, and requests waiting at it to be sent: for a connection, or for room in its window. */
  conns: Conn[];
  sendq: Req[];
  /** Connections it accepted (counted against `maxConns`). */
  accepted: number;
  /** Sender with a window: requests in flight, the window, its slow-start mark, the room the receiver last advertised, a round-trip estimate, and when it last halved. */
  flying: number;
  cwnd: number;
  ssthresh: number;
  peerWindow: number;
  srtt: number;
  cutAt: number;
  /** Receiver that advertises: the senders it told there was no room, owed a window update. */
  starved: Set<string>;
  /** Balancer at layer 4: the target each connection is pinned to. */
  pins: Map<string, string>;
  /** Server with `hold`: subscribers' connections it holds open. Server with `feed`: the latest news item it has. */
  subs: Req[];
  latest: number;
  /** Client that subscribes: each user's connection, its heartbeat (misses so far, next ping), and the latest news item each user has seen. */
  subOf: Map<number, Req>;
  beats: Map<number, { misses: number; next: number; out: number }>;
  seen: Map<number, number>;
  /** Client with `page`: pages still loading, by id. */
  pages: Map<number, { t0: number; left: number }>;
  /** Balancer that promotes: the target it treats as primary now. */
  primary: string;
  /** When it last went down. */
  downAt: number;
  /** Sender with a window: when the receiver last said it had no room (-1: it has room). */
  zeroAt: number;
  /** Client that subscribes or polls: how its users are keeping up now ("sub" or "poll"; "" before they start). */
  opened: "" | "sub" | "poll";
  /**
   * Cluster member: its role, its term, who it voted for this term, the votes it has as a candidate, when it last heard
   * a leader, its election timeout for this term, and the leader it knows of.
   */
  raft: { role: "follower" | "candidate" | "leader"; term: number; votedFor: string; votes: Set<string>; lastBeat: number; timeout: number; leader: string; nextBeat: number };
  /** Lock: the request holding each key, and until when its lease lasts. */
  locks: Map<number, { holder: number; until: number }>;
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
