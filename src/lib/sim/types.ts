import type { Sim } from "./engine";

export type Kind =
  | "client"
  | "lb"
  | "server"
  | "cache"
  | "db"
  | "queue"
  | "topic"
  | "limiter";

/** Visual identity. Defaults to the kind; overrides give a node a different glyph. */
export type Glyph = Kind | "edge" | "router" | "worker" | "bot";

export type Op = "read" | "write" | "probe" | "repl" | "ack";

/** How a request ended, from the client's point of view. */
export type Result = "ok" | "stale" | "fallback" | "rejected" | "error";

/** A call target: one node, or a pool picked round-robin among healthy members. */
export type Call = string | string[];

/** `nearest`: the healthy target with the shortest link. `weighted`: at random, in proportion to `weights` (canaries). */
export type Algo = "round-robin" | "random" | "least" | "hash" | "ring" | "nearest" | "weighted";

/**
 * A link's behaviour, beyond its latency. Loss and jitter are decided by a hash of what is crossing which link (the
 * logical request, its attempt and how many links it has crossed), never by when, so a problem and its fix lose the
 * same crossings.
 */
export interface LinkSpec {
  /** One-way latency in ms. Without it, the latency comes from the distance on the stage. */
  ms?: number;
  /** Each crossing takes up to this much longer or shorter, uniformly. */
  jitterMs?: number;
  /** The share of crossings lost on the way (0–1). A scene with loss needs a timeout, or lost requests wait forever. */
  loss?: number;
  /** Crossings in flight at once; the rest wait at the start of the link (a narrow pipe). */
  parallel?: number;
  /** Extra ms per unit of payload (`cost`): bandwidth. The payload is a write's request or a read's answer. */
  perCostMs?: number;
  /** Text drawn on the link. */
  label?: string;
}

export interface ClientSpec {
  /** Requests per (simulated) second, constant or a function of time in ms. */
  rate: number | ((t: number) => number);
  keys?: number;
  /** Zipf exponent over keys. 0 = uniform, ~1 = a few keys are very popular. */
  skew?: number;
  /** Share of all requests that go to key 0 (a "celebrity" key). */
  hot?: number;
  writes?: number;
  /** Some requests cost more to serve. */
  heavy?: { share: number; cost: number };
  timeoutMs?: number;
  retry?: {
    mode: "none" | "now" | "backoff";
    max: number;
    baseMs?: number;
    /** Retries allowed as a share of fresh requests in the window (a retry budget). */
    budget?: number;
    /** A retry gets a fresh timeout (default), or keeps what is left of the first attempt's ("shared": one deadline). */
    deadline?: "fresh" | "shared";
  };
  tag?: string;
  /** Share of requests for keys that don't exist: they always miss a cache, unless it remembers "not found". */
  absent?: number;
  /** How many different missing keys those requests draw from (default a million, so they almost never repeat). */
  absentKeys?: number;
  /** Share of its jobs that are poison: every worker that tries one fails it. */
  poison?: number;
}

export interface NodeSpec {
  id: string;
  kind: Kind;
  label: string;
  glyph?: Glyph;
  /** Layout position: [along the flow, across the flow], each 0–100. */
  at: [number, number];
  to?: Call[];
  /** Server: downstream calls made in order, per operation. Defaults to `to`. */
  calls?: Partial<Record<"read" | "write", Call[]>>;
  client?: ClientSpec;
  slots?: number;
  serviceMs?: number;
  queueMax?: number;
  /** Work ends here (a worker): no response travels back. */
  sink?: boolean;
  /** When down: refuse instantly (default) or hang without answering. */
  downMode?: "refuse" | "hang";
  algo?: Algo;
  health?: { everyMs: number; failAfter: number; passAfter: number; timeoutMs: number };
  autoscale?: { min: number; max: number; target: number; everyMs: number; warmupMs: number };
  capacity?: number;
  ttlMs?: number;
  coalesce?: boolean;
  invalidate?: boolean;
  replicaOf?: string;
  /** Multi-region peer that receives this node's writes. */
  peer?: string;
  /** CP follower: forwards everything to this leader, refuses when cut off. */
  leader?: string;
  lagMs?: number;
  region?: string;
  /** Token bucket per client tag. `tags` limits only those clients (a "Users" node stands for many people). */
  limit?: { rps: number; burst: number; tags?: string[] };
  /** Server keeps a worker busy while it waits on downstream calls (thread-per-request). */
  blocking?: boolean;
  breaker?: { threshold: number; cooldownMs: number };
  callTimeoutMs?: number;

  /** Service time per operation, overriding `serviceMs` (an index makes reads cheap and writes dearer). */
  serviceBy?: Partial<Record<"read" | "write", number>>;
  /** A share of requests take `mult` times as long (the slow tail). */
  tail?: { share: number; mult: number };
  /** Share of completed requests that fail (a bad deploy). */
  failRate?: number;
  /** Turn requests away at once when the line or the load is past a mark; tags in `keep` are never shed. */
  shed?: { queueAbove?: number; loadAbove?: number; keep?: string[] };
  /** Which request in line a free worker takes: the oldest (default) or the newest. */
  order?: "fifo" | "lifo";
  /** Tags served first, most important first; within a tag, `order` holds. */
  priority?: string[];
  /** Workers reserved per tag; untagged work uses the rest. A slow dependency can't take every worker. */
  bulkheads?: Record<string, number>;
  /** Balancer: route by the request's tag to its own targets (an L7 gateway's path routing). */
  byTag?: Record<string, Call[]>;
  /**
   * `honour`: refuse work that can't finish before the request's deadline, turn away work for a request already
   * abandoned, stop work in progress once its deadline passes, and stop waiting on a downstream call then too.
   * `ignore` (default): work on regardless.
   */
  deadlines?: "honour" | "ignore";
  /** Balancer, `algo: "weighted"`: each target's share of the traffic (default 1). */
  weights?: Record<string, number>;
  /** Balancer: stop sending to `target` once its share of errors over the window passes `errorsAbove` (a canary). */
  rollback?: { target: string; errorsAbove: number };
  /** Shown as a badge ("v2"). */
  version?: string;
  /**
   * Server: keeps each user's session in its own memory. A user who signed in on another server, or before this one
   * restarted, is signed out: that request fails, and the next one finds the session here.
   */
  sessions?: boolean;
  /**
   * Keep a note of each logical message this node finishes (by sender and id). `true`: a repeat is answered from the
   * note, without doing the work, or a write's effect, again. `false`: a repeat is done again, and counted as a
   * duplicate. Unset: no notes.
   */
  idempotent?: boolean;
  /** Its responses are acks: drawn small, because they carry no answer. */
  replies?: "ack";
  /**
   * Queue: keep each job it hands out until the worker acknowledges it, on receipt or when finished. A job not
   * acknowledged within `visibilityMs` is handed out again; after `maxDeliveries`, it goes to `deadLetter` (or is
   * dropped). `ordered`: one job out at a time, so jobs finish in the order they arrived.
   */
  ack?: { mode: "receive" | "finish"; visibilityMs: number; maxDeliveries?: number; deadLetter?: string; ordered?: boolean };
  /**
   * Queue: what to do once `high` jobs are waiting. `wait`: hold the producer's request until the line is back to
   * `low` (back-pressure). `reject`: turn the new job away. `drop-oldest`: drop the oldest waiting job to make room.
   */
  backpressure?: { high: number; low?: number; mode: "wait" | "reject" | "drop-oldest" };
  /** Queue: hand each job to the first live worker in `to` (one consumer per partition, failing over in order), not round robin. */
  consumers?: "first";
  /**
   * Database: every write also stores an event, in the same commit, which a relay sends to `to` every `everyMs`
   * until it is accepted (resending after `retryMs`): the outbox.
   */
  outbox?: { to: string; everyMs: number; retryMs?: number };
  /**
   * Crash when the line or the load stays past a mark for `forMs`; come back after `restartMs` with a cold ramp:
   * workers return over `warmMs`.
   */
  overload?: { queueAbove?: number; loadAbove?: number; forMs: number; restartMs: number; warmMs: number };
  /** Cache: also remember "not found", for this long. */
  negativeTtlMs?: number;
  /** Cache or database: an existence check answers most requests for absent keys at once; `fp` slip through. */
  bloom?: { fp: number };
}

export interface ScriptEvent {
  at: number;
  label: string;
  run: (sim: Sim) => void;
  /**
   * Armed events never run from the loop. `sim.fire(label)` plays them once, from that event on: it runs now, and every
   * later armed event follows at the same spacing as their `at`s (a stall, then its end 800 ms later).
   */
  armed?: true;
  /** The station the event happens to: while it is on its way, that station shows a countdown chip. */
  node?: string;
}

export interface SceneSpec {
  nodes: NodeSpec[];
  seed?: number;
  /** Responses slower than this count as slow (amber). */
  sloMs: number;
  /** Default client timeout. */
  timeoutMs?: number;
  /** Simulated ms per real ms at 1× speed. */
  timeScale?: number;
  /** Network latency per layout unit of distance. */
  msPerUnit?: number;
  /** Latency (or a whole link's behaviour), keyed "a>b" (applies both ways). */
  links?: Record<string, number | LinkSpec>;
  /** Text shown on a link, keyed like `links`. */
  linkLabels?: Record<string, string>;
  /** Events on a loop, and armed events that play once when fired (`sim.fire`). */
  script?: { loopMs: number; events: ScriptEvent[] };
  windowMs?: number;
  /** Simulated time to run before the scene is first shown, so it opens mid-flow. */
  warmMs?: number;
  /** Reduced motion: how far past the warm-up the settled still frame the scene opens on is (2600 ms when not given). */
  stillMs?: number;
  /** Fixed wide-layout height; otherwise the stage fits its nodes. */
  wideH?: number;
  /** Availability is measured over this long (default ten metric windows), against `sloTarget` (default 0.999). */
  sloWindowMs?: number;
  sloTarget?: number;
}

export type FxKind =
  | "drop"
  | "hit"
  | "miss"
  | "timeout"
  | "reject"
  | "done"
  | "crash"
  | "recover"
  | "open"
  | "close"
  | "boot"
  /** A cache wrote an entry (a miss coming back fills it). */
  | "fill"
  /** A full cache pushed its least recently used entry out. */
  | "evict"
  /** A node started running hot: its line grew past twice its workers. */
  | "hot"
  /** A crossing was lost on a link (`Fx.link` says where). */
  | "lost"
  /** An existence check answered "not found" without a lookup. */
  | "filtered"
  /** An idempotent node answered a repeat from its notes. */
  | "dupe"
  /** A queue handed out a job again: its worker never acknowledged it. */
  | "redeliver"
  /** A queue gave up on a job and moved it to its dead-letter queue. */
  | "dead";

export interface Fx {
  t: number;
  kind: FxKind;
  node: string;
  /** For a drop at a full waiting line: the slot it would have taken (the line's tail). */
  slot?: number;
  /** For a crossing lost on a link: the link, and how far along it the request was. */
  link?: { from: string; to: string; frac: number };
}
