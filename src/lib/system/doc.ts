// A system someone describes for themselves (My System): plain, versioned JSON, small enough for a link. Every way in
// (a template, the builder, an import, a trace) makes one of these, and `compile.ts` turns it into a scene the engine
// runs. It names parts the way people do, and hides the engine's tuning behind a few settings per kind.

export type PartKind =
  | "users"
  | "bots"
  | "dns"
  | "cdn"
  | "balancer"
  | "limiter"
  | "service"
  | "worker"
  | "external"
  | "cache"
  | "database"
  | "queue"
  | "topic";

export interface Settings {
  /** Users and bots: requests a second. */
  rate: number;
  /** Users: the share that are writes, 0–1. */
  writes: number;
  /** Users: how traffic moves over time. */
  shape: "steady" | "daily" | "spiky";
  /** Users: the share asking for one popular item (a celebrity key), 0–0.6. */
  hot: number;
  /** Users: how long a person waits before giving up, in ms. */
  timeoutMs: number;
  /** Users: how many times a request that failed or timed out is sent again, with growing waits. */
  retries: number;
  /** Services, workers, databases, outside services: requests each copy works on at once. */
  workers: number;
  /** Services, workers, databases, outside services: ms of work per request. */
  ms: number;
  /** Caches and CDNs: answers kept. */
  capacity: number;
  /** Caches and CDNs: how long an answer stays fresh, in ms. */
  ttlMs: number;
  /** Databases: read copies, 0–3. */
  replicas: number;
  /** Databases: how late each write reaches a copy, in ms. */
  lagMs: number;
  /** Databases: when the main copy dies, promote a read copy. */
  failover: boolean;
  /** Databases: split the keys across this many databases, 1–4. */
  shards: number;
  /** Balancers: check each target is healthy, and stop sending to one that isn't. */
  health: boolean;
  /** Balancers: how they pick. */
  algo: "round-robin" | "least" | "sticky";
  /** Rate limiters: requests a second each client may send. */
  rps: number;
  /** Queues: keep each job until a worker says it is done (and give up on it after four tries). */
  ack: boolean;
  /** Queues with `ack`: set aside jobs that keep failing. */
  deadLetter: boolean;
  /** Services: stop calling a part that keeps failing, for a moment (a circuit breaker). */
  breaker: boolean;
}

export interface PartDoc {
  /** Stable: links and the share format use it. Letters, digits and dashes. */
  id: string;
  kind: PartKind;
  /** What the stage calls it ("Orders API"). */
  name: string;
  /** Copies: up to 4 are drawn one by one; more are one station standing for them all. */
  count?: number;
  /** The parts it sends to, in the order it calls them. */
  to?: string[];
  /** Only what differs from the kind's defaults (`DEFAULTS`). */
  set?: Partial<Settings>;
}

export interface SystemDoc {
  v: 1;
  name: string;
  /** The template it started from, if any. */
  template?: string;
  parts: PartDoc[];
  /** What "working" means: the slowest 1 in 20 within `p95Ms`, and at most `failed` (0–1) failing. */
  targets: { p95Ms: number; failed: number };
}

/** The most parts a system may have before compiling (an import groups beyond this). */
export const MAX_PARTS = 24;
/** The most copies of one part. */
export const MAX_COUNT = 64;

/** What each kind is, in a few plain words, for menus. */
export const KINDS: Record<PartKind, { name: string; says: string }> = {
  users: { name: "Users", says: "people sending requests" },
  bots: { name: "Bots", says: "a program sending too many" },
  dns: { name: "DNS", says: "sends each user to the nearest place" },
  cdn: { name: "CDN", says: "copies near the users" },
  balancer: { name: "Load balancer", says: "spreads requests over copies" },
  limiter: { name: "Rate limiter", says: "turns away too many" },
  service: { name: "Service", says: "runs your code" },
  worker: { name: "Worker", says: "does jobs in the background" },
  external: { name: "Outside service", says: "someone else's API" },
  cache: { name: "Cache", says: "remembers answers" },
  database: { name: "Database", says: "keeps the data" },
  queue: { name: "Queue", says: "holds jobs for later" },
  topic: { name: "Topic", says: "copies each message to every listener" },
};

/** Each kind's settings when the doc says nothing: the course's own numbers, so a system behaves like the lessons. */
export const DEFAULTS: Settings = {
  rate: 40,
  writes: 0.1,
  shape: "steady",
  hot: 0,
  timeoutMs: 1600,
  retries: 0,
  workers: 4,
  ms: 60,
  capacity: 100,
  ttlMs: 20000,
  replicas: 0,
  lagMs: 150,
  failover: false,
  shards: 1,
  health: true,
  algo: "round-robin",
  rps: 20,
  ack: false,
  deadLetter: false,
  breaker: false,
};

/** Per kind, what differs from `DEFAULTS`. */
const KIND_DEFAULTS: Partial<Record<PartKind, Partial<Settings>>> = {
  bots: { rate: 60, writes: 0 },
  database: { workers: 4, ms: 90 },
  worker: { workers: 1, ms: 200 },
  external: { workers: 16, ms: 120 },
  cdn: { capacity: 60, ttlMs: 30000 },
};

/** The settings in force for a part. */
export function settingsOf(p: PartDoc): Settings {
  return { ...DEFAULTS, ...KIND_DEFAULTS[p.kind], ...p.set };
}

/** Which kinds may send to which: where a request can go next. */
const SENDS: Record<PartKind, PartKind[]> = {
  users: ["dns", "cdn", "balancer", "limiter", "service", "cache", "queue", "topic", "database", "external"],
  bots: ["dns", "cdn", "balancer", "limiter", "service", "cache", "queue", "topic", "database", "external"],
  dns: ["cdn", "balancer", "limiter", "service"],
  cdn: ["balancer", "limiter", "service", "cache", "external"],
  balancer: ["service", "cache", "limiter", "balancer"],
  limiter: ["balancer", "service", "queue", "cache"],
  service: ["balancer", "service", "external", "cache", "database", "queue", "topic", "limiter"],
  worker: ["service", "external", "cache", "database", "queue", "topic"],
  external: [],
  cache: ["database", "service", "external"],
  database: [],
  // Jobs and messages go to workers: nobody waits on them for an answer.
  queue: ["worker"],
  topic: ["worker", "queue"],
};

export const canSend = (from: PartKind, to: PartKind) => SENDS[from].includes(to);

/** "a cache", "an outside service": a kind's name with its article, in lower case. */
export const article = (name: string) => `${/^(?:[aeio]|u(?!s))/i.test(name) ? "an" : "a"} ${name.toLowerCase()}`;

/** A problem with a doc, in words someone new could act on. `part` is the part it is about, when there is one. */
export interface Issue {
  level: "error" | "warning";
  text: string;
  part?: string;
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Everything wrong with a doc, errors first. A doc with no errors compiles. */
export function validate(doc: SystemDoc): Issue[] {
  const out: Issue[] = [];
  const err = (text: string, part?: string) => out.push({ level: "error", text, part });
  const warn = (text: string, part?: string) => out.push({ level: "warning", text, part });
  if (doc.v !== 1) err("This system was saved by a newer version of System Lab.");
  if (!doc.parts.length) err("Add a part to begin: Users, then what they talk to.");
  if (doc.parts.length > MAX_PARTS) err(`At most ${MAX_PARTS} parts fit on the stage. Group some: a count of copies stands for many.`);
  const byId = new Map<string, PartDoc>();
  for (const p of doc.parts) {
    if (!ID.test(p.id)) err(`“${p.id}” can't be a part's id: use lower-case letters, digits and dashes.`, p.id);
    if (byId.has(p.id)) err(`Two parts are called “${p.id}”. Give each its own name.`, p.id);
    byId.set(p.id, p);
    if (!(p.kind in KINDS)) err(`“${p.name}” is a kind System Lab doesn't know (${String(p.kind)}).`, p.id);
    if (!p.name.trim()) err("Every part needs a name.", p.id);
    if (p.count !== undefined && (!Number.isInteger(p.count) || p.count < 1 || p.count > MAX_COUNT)) err(`${p.name}: copies must be a whole number from 1 to ${MAX_COUNT}.`, p.id);
  }
  const entries = doc.parts.filter((p) => p.kind === "users" || p.kind === "bots");
  if (doc.parts.length && !entries.length) err("Nothing sends requests yet. Add Users: they are where the traffic starts.");
  for (const p of doc.parts) {
    const to = p.to ?? [];
    for (const t of to) {
      const q = byId.get(t);
      if (!q) err(`${p.name} sends to “${t}”, which isn't a part.`, p.id);
      else if (q === p) err(`${p.name} sends to itself.`, p.id);
      else if (!canSend(p.kind, q.kind)) err(`${article(KINDS[p.kind].name).replace(/^a/, "A")} can't send to ${article(KINDS[q.kind].name)} (${p.name} → ${q.name}).`, p.id);
    }
    if (new Set(to).size !== to.length) warn(`${p.name} sends to the same part twice; once is enough.`, p.id);
    const s = settingsOf(p);
    if ((p.kind === "users" || p.kind === "bots") && !to.length) err(`${p.name} send their requests nowhere. Connect them to the part they talk to first.`, p.id);
    if ((p.kind === "users" || p.kind === "bots") && to.length > 1) err(`${p.name} can talk to one part first; put a load balancer or DNS in front of several.`, p.id);
    if ((p.kind === "cache" || p.kind === "cdn") && !to.length) err(`${p.name} has nowhere to fetch what it doesn't have. Connect it to a database or a service.`, p.id);
    if ((p.kind === "queue" || p.kind === "topic") && !to.length) warn(`Nothing takes jobs from ${p.name}: they will pile up. Connect it to a worker.`, p.id);
    if ((p.kind === "balancer" || p.kind === "dns" || p.kind === "limiter") && !to.length) err(`${p.name} has nowhere to send requests.`, p.id);
    if (p.kind === "limiter" && to.length > 1) err(`${p.name} lets requests through to one part; put a load balancer after it for several.`, p.id);
    if (p.kind === "cache" && to.length > 1) err(`${p.name} fetches misses from one place.`, p.id);
    if ((p.kind === "users" || p.kind === "bots") && (s.rate <= 0 || s.rate > 400)) err(`${p.name}: requests a second must be from 1 to 400.`, p.id);
    if (s.workers < 1 || s.workers > 64) err(`${p.name}: workers must be from 1 to 64.`, p.id);
    if (s.ms < 1 || s.ms > 5000) err(`${p.name}: work per request must be from 1 ms to 5 s.`, p.id);
    if (p.kind === "database" && s.shards > 1 && s.replicas > 0) warn(`${p.name}: shards and read copies together aren't drawn yet; the copies are left out.`, p.id);
  }
  // A loop would send a request round for ever.
  const seen = new Set<string>();
  const stack = new Set<string>();
  const visit = (id: string): boolean => {
    if (stack.has(id)) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    stack.add(id);
    const loop = (byId.get(id)?.to ?? []).some((t) => byId.has(t) && visit(t));
    stack.delete(id);
    return loop;
  };
  for (const p of doc.parts) {
    if (visit(p.id)) {
      err(`Requests could go round in a loop through ${p.name}. Remove one of the arrows in the loop.`, p.id);
      break;
    }
  }
  // Parts nothing reaches still run, but never see a request.
  const reached = new Set<string>();
  const walk = (id: string) => {
    if (reached.has(id)) return;
    reached.add(id);
    for (const t of byId.get(id)?.to ?? []) walk(t);
  };
  for (const e of entries) walk(e.id);
  for (const p of doc.parts) if (!reached.has(p.id) && p.kind !== "users" && p.kind !== "bots") warn(`Nothing sends to ${p.name} yet.`, p.id);
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
}

/** A part's id made from its name: "Orders API" → "orders-api", unique within the doc. */
export function idFor(name: string, taken: Iterable<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "part";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** The range each number may take: anything outside is brought inside, so a doc from a link or a file can't break a run. */
const RANGES: Partial<Record<keyof Settings, [number, number]>> = {
  rate: [1, 400],
  writes: [0, 1],
  hot: [0, 0.6],
  timeoutMs: [100, 10000],
  retries: [0, 3],
  workers: [1, 64],
  ms: [1, 5000],
  capacity: [1, 1000],
  ttlMs: [100, 600000],
  replicas: [0, 3],
  lagMs: [0, 5000],
  shards: [1, 4],
  rps: [1, 400],
};
const CHOICES: Partial<Record<keyof Settings, readonly string[]>> = {
  shape: ["steady", "daily", "spiky"],
  algo: ["round-robin", "least", "sticky"],
};

const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v));

/**
 * A doc from somewhere we don't control (a shared link, a pasted file), made safe: unknown kinds and fields dropped,
 * numbers brought into range, text cut to length. Null when it isn't a System Lab doc at all. What is left may still
 * have problems `validate` names (a link to a part that isn't there): those are the person's to fix.
 */
export function normalize(input: unknown): SystemDoc | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  if (o.v !== 1 || !Array.isArray(o.parts)) return null;
  const parts: PartDoc[] = [];
  for (const raw of o.parts.slice(0, MAX_PARTS * 2)) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const kind = String(p.kind) as PartKind;
    if (!(kind in KINDS)) continue;
    const set: Partial<Settings> = {};
    if (p.set && typeof p.set === "object") {
      for (const [k, v] of Object.entries(p.set as Record<string, unknown>)) {
        const key = k as keyof Settings;
        if (!(key in DEFAULTS)) continue;
        const want = typeof DEFAULTS[key];
        if (want === "number" && typeof v === "number" && Number.isFinite(v)) (set as Record<string, unknown>)[key] = RANGES[key] ? clamp(v, RANGES[key]!) : v;
        else if (want === "boolean" && typeof v === "boolean") (set as Record<string, unknown>)[key] = v;
        else if (want === "string" && typeof v === "string" && CHOICES[key]?.includes(v)) (set as Record<string, unknown>)[key] = v;
      }
    }
    const part: PartDoc = { id: String(p.id ?? "").slice(0, 40), kind, name: String(p.name ?? KINDS[kind].name).slice(0, 40) };
    if (typeof p.count === "number" && Number.isFinite(p.count)) part.count = Math.round(clamp(p.count, [1, MAX_COUNT]));
    if (Array.isArray(p.to)) part.to = p.to.slice(0, 12).map(String);
    if (Object.keys(set).length) part.set = set;
    parts.push(part);
  }
  const t = (o.targets ?? {}) as Record<string, unknown>;
  return {
    v: 1,
    name: String(o.name ?? "My system").slice(0, 60),
    ...(typeof o.template === "string" ? { template: o.template.slice(0, 40) } : {}),
    parts,
    targets: {
      p95Ms: typeof t.p95Ms === "number" && Number.isFinite(t.p95Ms) ? clamp(t.p95Ms, [50, 10000]) : 400,
      failed: typeof t.failed === "number" && Number.isFinite(t.failed) ? clamp(t.failed, [0, 0.5]) : 0.01,
    },
  };
}
