import { defaults, getLesson } from "../lessons";

export const MODEL_VERSION = 2;
export type Config = {
  version: number;
  lesson: string;
  seed: number;
  values: Record<string, number>;
  faults: { at: number; active: boolean }[];
};
export type Node = {
  id: string;
  label: string;
  aws: string;
  status: string;
  detail: string;
};
export type Entity = {
  id: string;
  kind: string;
  location: string;
  state: string;
  value: number | string;
  version?: number;
  expires?: number;
  last?: number;
  hits?: number;
  attempts?: number;
  available?: number;
  group?: string;
  operation?: string;
  owner?: string;
  position?: number;
};
export type Metric = {
  key: string;
  label: string;
  value: number;
  unit: string;
};
export type DomainEvent = {
  id: number;
  time: number;
  type: string;
  title: string;
  why: string;
  next: string;
  path: string[];
  entity?: string;
};
export type World = {
  time: number;
  nodes: Node[];
  edges: [string, string][];
  entities: Entity[];
  counters: Record<string, number>;
  fields: Record<string, string | number>;
  failed: boolean;
};
export type Frame = { event: DomainEvent; world: World; metrics: Metric[] };
export type Run = {
  config: Config;
  frames: Frame[];
  summary: string;
  assumptions: string;
};

export function makeConfig(id: string, contrast = false): Config {
  const l = getLesson(id);
  const faults = ["circuit-breaker", "cap", "health-checks"].includes(id)
    ? [
        { at: 4, active: true },
        { at: 10, active: false },
      ]
    : id === "dead-letter"
      ? [
          { at: 0, active: true },
          { at: 16, active: false },
        ]
      : [];
  return {
    version: MODEL_VERSION,
    lesson: id,
    seed: 42,
    values: { ...defaults(id), ...(contrast ? l.contrast : {}) },
    faults,
  };
}
export function validateConfig(raw: unknown): Config {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Experiment configuration is missing.");
  const c = raw as Config;
  if (c.version !== MODEL_VERSION)
    throw new Error("This experiment uses an unsupported model version.");
  const l = getLesson(c.lesson);
  if (!Number.isInteger(c.seed) || c.seed < 1 || c.seed > 999999)
    throw new Error("Seed must be an integer from 1 to 999999.");
  if (
    !c.values ||
    typeof c.values !== "object" ||
    Array.isArray(c.values) ||
    Object.keys(c.values).length !== l.controls.length
  )
    throw new Error("Experiment controls do not match this lesson.");
  for (const k of l.controls)
    if (
      !Number.isInteger(c.values[k.key]) ||
      c.values[k.key] < k.min ||
      c.values[k.key] > k.max
    )
      throw new Error(`${k.label} is outside its supported range.`);
  if (
    !Array.isArray(c.faults) ||
    c.faults.length > 24 ||
    (!l.fault && c.faults.length)
  )
    throw new Error("Unsupported failure schedule.");
  let previous = -1;
  for (const f of c.faults) {
    if (
      !f ||
      !Number.isInteger(f.at) ||
      f.at < 0 ||
      f.at > 32 ||
      f.at <= previous ||
      typeof f.active !== "boolean"
    )
      throw new Error(
        "Failure times must be ordered, unique simulated seconds from 0 to 32.",
      );
    previous = f.at;
  }
  return {
    version: MODEL_VERSION,
    lesson: l.id,
    seed: c.seed,
    values: Object.fromEntries(l.controls.map((k) => [k.key, c.values[k.key]])),
    faults: c.faults.map((f) => ({ at: f.at, active: f.active })),
  };
}
export function experimentQuery(c: Config): string {
  return `?experiment=${encodeURIComponent(JSON.stringify(validateConfig(c)))}`;
}
export function comparisonConfig(c: Config): Config {
  const base = makeConfig(c.lesson);
  base.seed = c.seed;
  // Offered load is held constant; compare architecture/strategy against baseline settings.
  for (const key of ["rate", "arrivals", "duplicates", "history", "size"])
    if (key in c.values) base.values[key] = c.values[key];
  return base;
}
export function restoreExperiment(search: string): Config | null {
  if (search.length > 7000) throw new Error("Experiment URL is too large.");
  const params = new URLSearchParams(search),
    encoded = params.get("experiment");
  if (encoded) {
    let raw: unknown;
    try {
      raw = JSON.parse(encoded);
    } catch {
      throw new Error("Experiment URL contains invalid JSON.");
    }
    return validateConfig(raw);
  }
  const legacy = params.get("concept");
  return legacy ? makeConfig(legacy) : null;
}
// Independent deterministic draws keep workloads identical when controls change branching.
export function hash(text: string, seed = 42): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  return h >>> 0;
}
export const sample = (seed: number, key: string) =>
  hash(key, seed) / 4294967296;
export const node = (
  id: string,
  label: string,
  aws: string,
  detail = "Ready to participate.",
): Node => ({ id, label, aws, status: "ready", detail });

export class Timeline {
  frames: Frame[] = [];
  world: World = {
    time: 0,
    nodes: [],
    edges: [],
    entities: [],
    counters: {},
    fields: {},
    failed: false,
  };
  constructor(public config: Config) {}
  count(key: string, by = 1) {
    this.world.counters[key] = (this.world.counters[key] || 0) + by;
  }
  emit(
    time: number,
    type: string,
    title: string,
    why: string,
    next: string,
    path: string[] = [],
    entity?: string,
  ) {
    this.world.time = time;
    const event = {
      id: this.frames.length,
      time,
      type,
      title,
      why,
      next,
      path,
      entity,
    };
    this.frames.push({
      event,
      world: structuredClone(this.world),
      metrics: metrics(this.config.lesson, this.world),
    });
  }
  tick(time: number) {
    const fault = this.config.faults.find((f) => f.at === time);
    if (fault) {
      this.world.failed = fault.active;
      this.emit(
        time,
        fault.active ? "failure" : "recovery",
        fault.active
          ? getLesson(this.config.lesson).fault!
          : "Recovery applied",
        fault.active
          ? "The fault is now active in the environment. Component health still shows its last observation; the next domain action detects the effect."
          : "The environment is available again. Component health still shows its last observation; this lesson’s next action or probe observes recovery.",
        "Step to observe the component’s response; health checks may need several probes.",
      );
    }
  }
  start() {
    this.emit(
      0,
      "ready",
      "Workload ready",
      "The seed fixes request IDs, keys and random choices. Nothing has run yet.",
      "Step once or start playback.",
    );
    this.tick(0);
  }
}
const metricSets: Record<string, [string, string, string][]> = {
  cache: [
    ["hits", "Cache hits", ""],
    ["misses", "Cache misses", ""],
    ["origin", "Origin reads", ""],
    ["stale", "Stale reads", ""],
  ],
  fleet: [
    ["offered", "Offered", "requests"],
    ["accepted", "Accepted", "requests"],
    ["completed", "Completed", "requests"],
    ["rejected", "Rejected / failed", "requests"],
  ],
  queue: [
    ["accepted", "Accepted", "messages"],
    ["completed", "Completed", "messages"],
    ["pending", "Pending", "messages"],
    ["dead", "In DLQ", "messages"],
  ],
  replica: [
    ["reads", "Reads", ""],
    ["stale", "Stale reads", ""],
    ["writes", "Committed writes", ""],
    ["applied", "Replica writes", ""],
  ],
  hash: [
    ["moved", "Ring keys moved", "keys"],
    ["modulo", "Modulo keys moved", "keys"],
    ["maxload", "Busiest node", "keys"],
  ],
  record: [
    ["reads", "Rows examined", ""],
    ["writes", "Committed writes", ""],
    ["conflicts", "Conflicts / rollbacks", ""],
  ],
  circuit: [
    ["attempts", "Dependency calls", ""],
    ["completed", "Successful calls", ""],
    ["blocked", "Rejected locally", ""],
    ["errors", "Dependency errors", ""],
  ],
  workflow: [
    ["attempts", "Actions attempted", ""],
    ["completed", "Actions completed", ""],
    ["errors", "Failed actions", ""],
  ],
  identity: [
    ["allowed", "Allowed", "requests"],
    ["denied", "Denied", "requests"],
    ["refreshes", "Credential refreshes", ""],
  ],
  network: [
    ["offered", "Requests inspected", ""],
    ["allowed", "Reached resource", ""],
    ["denied", "Blocked", ""],
  ],
  "rate-limiting": [
    ["offered", "Offered", "requests"],
    ["completed", "Served", "requests"],
    ["rejected", "Throttled", "requests"],
    ["tokens", "Tokens left", ""],
  ],
  canary: [
    ["stable", "Stable requests", ""],
    ["candidate", "Candidate requests", ""],
    ["errors", "Observed errors", ""],
    ["expected", "Expected error rate", "%"],
  ],
  "blue-green": [
    ["stable", "Blue requests", ""],
    ["candidate", "Green requests", ""],
    ["errors", "Errors", ""],
    ["rollbacks", "Rollbacks", ""],
  ],
  idempotency: [
    ["accepted", "Accepted deliveries", ""],
    ["completed", "Acknowledged deliveries", ""],
    ["effects", "Business effects", ""],
    ["duplicates", "Duplicates suppressed", ""],
  ],
  "event-streams": [
    ["accepted", "Retained records", ""],
    ["completed", "Consumed records", ""],
    ["pending", "Reader lag", "records"],
    ["replayed", "Records replayed", ""],
  ],
  batching: [
    ["accepted", "Accepted", "messages"],
    ["completed", "Completed", "messages"],
    ["invocations", "Worker invocations", ""],
    ["pending", "Pending", "messages"],
  ],
  "event-routing": [
    ["offered", "Published events", ""],
    ["filtered", "Filtered by rule", ""],
    ["accepted", "Target deliveries", ""],
    ["completed", "Completed", ""],
  ],
  backpressure: [
    ["accepted", "Accepted", "messages"],
    ["completed", "Completed", "messages"],
    ["pending", "Pending", "messages"],
    ["rejected", "Admission rejected", "messages"],
  ],
  sharding: [
    ["keys", "Partitioned keys", ""],
    ["maxload", "Busiest partition", "requests"],
    ["minload", "Quietest partition", "requests"],
  ],
  "strong-consistency": [
    ["reads", "Reads", ""],
    ["stale", "Stale reads", ""],
    ["rcu", "Read capacity", "units"],
  ],
  cap: [
    ["reads", "Served reads", ""],
    ["denied", "Quorum rejections", ""],
    ["stale", "Stale reads", ""],
  ],
  "object-storage": [
    ["transferred", "Transferred", "MB"],
    ["remaining", "Remaining", "MB"],
    ["writes", "Ready metadata pointers", ""],
  ],
  "data-lifecycle": [
    ["age", "Object age", "days"],
    ["restores", "Restores completed", ""],
    ["wait", "Restore wait", "s"],
  ],
  "disaster-recovery": [
    ["loss", "Potential loss window", "min"],
    ["rto", "Recovery elapsed", "s"],
    ["completed", "Restores complete", ""],
  ],
  observability: [
    ["requests", "Total requests", ""],
    ["traces", "Sampled traces", ""],
    ["errors", "Error metrics", ""],
  ],
  "event-sourcing": [
    ["replayed", "Events folded", ""],
    ["skipped", "Snapshot events skipped", ""],
    ["balance", "Projected balance", ""],
  ],
  "distributed-locks": [
    ["token", "Latest fence", ""],
    ["writes", "Resource writes", ""],
    ["denied", "Stale writes rejected", ""],
  ],
  timeouts: [
    ["timedout", "Caller timeouts", ""],
    ["completed", "Remote effects completed", ""],
    ["wait", "Caller wait", "s"],
  ],
};
export function metrics(id: string, w: World): Metric[] {
  const set = metricSets[id] || metricSets[getLesson(id).family];
  return set.map(([key, label, unit]) => ({
    key,
    label,
    unit,
    value: Math.round((w.counters[key] || 0) * 100) / 100,
  }));
}
export function finish(t: Timeline): Run {
  const last = t.frames.at(-1)!;
  const c = t.config.values;
  let summary =
    last.metrics
      .map((m) => `${m.label}: ${m.value}${m.unit ? " " + m.unit : ""}`)
      .join(" · ") + ".";
  if (t.config.lesson === "canary")
    summary += ` Expected overall errors: ${c.weight}% × ${c.errors}% = ${Math.round(((c.weight * c.errors) / 100) * 100) / 100}%. Actual counts reflect this finite seeded sample and any injected fault.`;
  if (getLesson(t.config.lesson).family === "queue")
    summary +=
      " Accepted work includes pending work; only acknowledged successful deliveries count as completed. Counts refer to deliveries, not necessarily unique effects.";
  return {
    config: t.config,
    frames: t.frames,
    summary,
    assumptions: getLesson(t.config.lesson).assumptions,
  };
}
