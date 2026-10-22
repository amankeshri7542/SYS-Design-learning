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

export type Op = "read" | "write" | "probe" | "repl";

/** How a request ended, from the client's point of view. */
export type Result = "ok" | "stale" | "fallback" | "rejected" | "error";

/** A call target: one node, or a pool picked round-robin among healthy members. */
export type Call = string | string[];

export type Algo = "round-robin" | "random" | "least" | "hash" | "ring";

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
  };
  tag?: string;
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
}

export interface ScriptEvent {
  at: number;
  label: string;
  run: (sim: Sim) => void;
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
  /** Latency overrides, keyed "a>b" (applies both ways). */
  links?: Record<string, number>;
  /** Text shown on a link, keyed like `links`. */
  linkLabels?: Record<string, string>;
  script?: { loopMs: number; events: ScriptEvent[] };
  windowMs?: number;
  /** Simulated time to run before the scene is first shown, so it opens mid-flow. */
  warmMs?: number;
  /** Fixed wide-layout height; otherwise the stage fits its nodes. */
  wideH?: number;
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
  | "hot";

export interface Fx {
  t: number;
  kind: FxKind;
  node: string;
  /** For a drop at a full waiting line: the slot it would have taken (the line's tail). */
  slot?: number;
}
