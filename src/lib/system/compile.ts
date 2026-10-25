// A `SystemDoc` becomes a scene the engine runs: each part one station (or a few), each arrow the engine's calls, laid
// out in columns along the flow. Pure and deterministic: the same doc always makes the same scene, so two designs
// compared side by side see the same traffic.

import { rush, scene, wave } from "../lessons/kit";
import type { Call, ClientSpec, NodeSpec, SceneSpec } from "../sim/types";
import { settingsOf, validate, type Issue, type PartDoc, type Settings, type SystemDoc } from "./doc";

/** The tag every person-shaped sender's requests carry. */
export const PEOPLE = "users";

/** Up to this many copies are drawn one by one; more are one station standing for them all. */
export const DRAWN = 4;
/** The most stations a stage draws clearly. */
export const MAX_STATIONS = 16;

/** What a user changes while it runs: parts down (crashed), parts slowed down, and a surge of traffic. */
export interface Faults {
  slow?: string[];
  surge?: boolean;
}

export interface Compiled {
  spec: SceneSpec;
  /** Each part's stations, in order. */
  stations: Map<string, string[]>;
  /** Which part each station belongs to. */
  partOf: Map<string, string>;
  /** What the compiler did that the stage doesn't show, in plain words. */
  notes: string[];
  issues: Issue[];
}

/** Where a request for this part goes first: for reads, and for writes (a database's copies take reads only). */
interface Entry {
  read: Call;
  write: Call;
  /** Every station of the part, for a balancer or a queue spreading work over them. */
  all: string[];
}

const ms = (v: number) => Math.max(1, Math.round(v));

/** The traffic a person-shaped part sends over time: steady, a day's rise and fall, or bursts. */
function rateOf(s: Settings, surge: boolean): ClientSpec["rate"] {
  const r = s.rate * (surge ? 3 : 1);
  if (s.shape === "daily") return wave(r * 0.4, r * 1.6, 8000);
  if (s.shape === "spiky") return rush(r * 0.7, r * 3, 1200, 900, 5000);
  return r;
}

/**
 * Compile a doc. Returns `null` for the scene when the doc has errors (`issues` says what they are): a builder keeps
 * showing the last design that worked.
 */
export function compile(doc: SystemDoc, faults: Faults = {}): Compiled | { spec: null; issues: Issue[] } {
  const issues = validate(doc);
  if (issues.some((i) => i.level === "error")) return { spec: null, issues };
  const notes: string[] = [];
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  const slow = new Set(faults.slow ?? []);
  const nodes: NodeSpec[] = [];
  const stations = new Map<string, string[]>();
  const partOf = new Map<string, string>();
  const entries = new Map<string, Entry>();
  const add = (part: PartDoc, n: NodeSpec) => {
    nodes.push(n);
    partOf.set(n.id, part.id);
    stations.set(part.id, [...(stations.get(part.id) ?? []), n.id]);
  };
  const timeout = Math.max(...doc.parts.filter((p) => p.kind === "users").map((p) => settingsOf(p).timeoutMs), 1600);
  const lone = doc.parts.filter((p) => p.kind === "database").length === 1;

  // 1. Stations, and where each part's requests enter it. Links come after, once every part has its entry.
  for (const p of doc.parts) {
    const s = settingsOf(p);
    const work = ms(s.ms * (slow.has(p.id) ? 5 : 1));
    const copies = p.count ?? 1;
    const drawn = copies > DRAWN ? 1 : copies;
    const ids = drawn === 1 ? [p.id] : Array.from({ length: drawn }, (_, i) => `${p.id}-${i + 1}`);
    const label = (i: number) => (copies > DRAWN ? `${p.name} ×${copies}` : drawn === 1 ? p.name : `${p.name} ${i + 1}`);
    const slots = s.workers * (copies > DRAWN ? copies : 1);
    if (copies > DRAWN) notes.push(`${p.name} ×${copies} is drawn as one station with all ${slots} workers.`);
    const pool = (list: string[]): Call => (list.length === 1 ? list[0] : list);
    switch (p.kind) {
      case "users":
      case "bots": {
        add(p, {
          id: p.id,
          kind: "client",
          label: p.name,
          glyph: p.kind === "bots" ? "bot" : undefined,
          at: [0, 50],
          client: {
            rate: p.kind === "bots" ? s.rate : rateOf(s, !!faults.surge),
            keys: 200,
            skew: 1.1,
            hot: s.hot || undefined,
            writes: s.writes,
            timeoutMs: s.timeoutMs,
            retry: s.retries > 0 ? { mode: "backoff", max: s.retries, baseMs: 100 } : undefined,
            // People share one tag, so the numbers can count them apart from bots (a limiter then gives them one
            // budget: "Users" stands for many people anyway).
            tag: p.kind === "users" ? PEOPLE : p.id,
          },
        });
        entries.set(p.id, { read: p.id, write: p.id, all: [p.id] });
        break;
      }
      case "service":
      case "worker":
      case "external": {
        ids.forEach((id, i) =>
          add(p, {
            id,
            kind: "server",
            label: label(i),
            glyph: p.kind === "worker" ? "worker" : undefined,
            at: [0, 50],
            slots,
            serviceMs: work,
            queueMax: slots * 25,
            sink: p.kind === "worker" || undefined,
            downMode: p.kind === "external" ? "hang" : undefined,
            breaker: s.breaker ? { threshold: 5, cooldownMs: 800 } : undefined,
          }),
        );
        entries.set(p.id, { read: pool(ids), write: pool(ids), all: ids });
        break;
      }
      case "cache":
      case "cdn": {
        ids.forEach((id, i) =>
          add(p, {
            id,
            kind: "cache",
            label: label(i),
            glyph: p.kind === "cdn" ? "edge" : undefined,
            at: [0, 50],
            capacity: s.capacity,
            ttlMs: s.ttlMs,
            invalidate: true,
          }),
        );
        entries.set(p.id, { read: pool(ids), write: pool(ids), all: ids });
        break;
      }
      case "database": {
        // A lone database's extra stations go by short names ("Writer", "Copy 1"); with several, each says whose it is.
        const own = (what: string) => (lone ? what : `${p.name} ${what.toLowerCase()}`);
        const shards = Math.max(1, Math.min(4, Math.round(s.shards)));
        if (shards > 1) {
          const router = `${p.id}-router`;
          const ids = Array.from({ length: shards }, (_, i) => `${p.id}-${i + 1}`);
          add(p, { id: router, kind: "lb", label: own("Shard router"), glyph: "router", at: [0, 50], algo: "hash", to: ids });
          ids.forEach((id, i) => add(p, { id, kind: "db", label: own(`Shard ${i + 1}`), at: [0, 50], slots: s.workers, serviceMs: work, queueMax: s.workers * 25 }));
          entries.set(p.id, { read: router, write: router, all: [router] });
          break;
        }
        add(p, { id: p.id, kind: "db", label: p.name, at: [0, 50], slots: s.workers, serviceMs: work, queueMax: s.workers * 25 });
        const replicas = Math.max(0, Math.min(3, Math.round(s.replicas)));
        const copies = Array.from({ length: replicas }, (_, i) => `${p.id}-copy-${i + 1}`);
        copies.forEach((id, i) =>
          add(p, { id, kind: "db", label: own(`Copy ${i + 1}`), at: [0, 50], slots: s.workers, serviceMs: work, queueMax: s.workers * 25, replicaOf: p.id, lagMs: s.lagMs }),
        );
        let write: Call = p.id;
        if (replicas && s.failover) {
          const writer = `${p.id}-writer`;
          add(p, {
            id: writer,
            kind: "lb",
            label: own("Writer"),
            at: [0, 50],
            to: [p.id, ...copies],
            promote: true,
            health: { everyMs: 100, failAfter: 2, passAfter: 2, timeoutMs: 150 },
          });
          write = writer;
        }
        entries.set(p.id, { read: replicas ? pool(copies) : p.id, write, all: [p.id] });
        break;
      }
      case "queue": {
        add(p, { id: p.id, kind: "queue", label: p.name, at: [0, 50] });
        if (s.ack && s.deadLetter) add(p, { id: `${p.id}-dead`, kind: "queue", label: "Dead letters", at: [0, 50] });
        entries.set(p.id, { read: p.id, write: p.id, all: [p.id] });
        break;
      }
      case "topic": {
        add(p, { id: p.id, kind: "topic", label: p.name, at: [0, 50] });
        entries.set(p.id, { read: p.id, write: p.id, all: [p.id] });
        break;
      }
      case "balancer":
      case "dns": {
        add(p, {
          id: p.id,
          kind: "lb",
          label: p.name,
          glyph: p.kind === "dns" ? "router" : undefined,
          at: [0, 50],
          algo: p.kind === "dns" ? "nearest" : s.algo === "sticky" ? "hash" : s.algo,
          health: s.health ? { everyMs: 120, failAfter: 2, passAfter: 2, timeoutMs: 150 } : undefined,
        });
        entries.set(p.id, { read: p.id, write: p.id, all: [p.id] });
        break;
      }
      case "limiter": {
        add(p, { id: p.id, kind: "limiter", label: p.name, at: [0, 50], limit: { rps: s.rps, burst: Math.max(2, Math.round(s.rps / 2)) } });
        entries.set(p.id, { read: p.id, write: p.id, all: [p.id] });
        break;
      }
    }
  }

  // 2. Links: who each station sends to. A service calls its targets in order; a read goes to a cache (or a database's
  // copies), a write through the cache (or straight to a database's writer).
  const node = (id: string) => nodes.find((n) => n.id === id)!;
  const dedupe = (calls: Call[]) => calls.filter((c, i) => calls.findIndex((d) => JSON.stringify(d) === JSON.stringify(c)) === i);
  for (const p of doc.parts) {
    const targets = (p.to ?? []).map((t) => byId.get(t)!).filter(Boolean);
    const s = settingsOf(p);
    const mine = stations.get(p.id) ?? [];
    switch (p.kind) {
      case "users":
      case "bots":
      case "limiter": {
        // Everything a sender sends goes one way: to a database, that is its main copy (writes can't go to read copies).
        const t = targets[0];
        if (t) node(p.id).to = [t.kind === "database" ? entries.get(t.id)!.write : entries.get(t.id)!.read];
        break;
      }
      case "balancer":
      case "dns":
        node(p.id).to = targets.flatMap((t) => entries.get(t.id)!.all);
        break;
      case "cache":
      case "cdn":
        for (const id of mine) if (targets[0]) node(id).to = [entries.get(targets[0].id)!.read];
        break;
      case "queue": {
        const q = node(p.id);
        q.to = targets.flatMap((t) => entries.get(t.id)!.all);
        if (s.ack) {
          const slowest = Math.max(100, ...targets.map((t) => settingsOf(t).ms));
          q.ack = { mode: "finish", visibilityMs: Math.max(600, slowest * 3), maxDeliveries: 4, deadLetter: s.deadLetter ? `${p.id}-dead` : undefined };
        }
        break;
      }
      case "topic":
        node(p.id).to = targets.map((t) => entries.get(t.id)!.read);
        break;
      case "service":
      case "worker":
      case "external": {
        if (!targets.length) break;
        const read = dedupe(targets.map((t) => entries.get(t.id)!.read));
        // Writes go through a cache, which passes them on and forgets its copy, so it never answers with old data; past
        // it, when the database behind it has read copies (a cache has one way on, and writes must reach the main copy).
        // A database's writes go to its writer, never its copies.
        const write = dedupe(
          targets.map((t) => {
            if (t.kind !== "cache") return entries.get(t.id)!.write;
            const origin = byId.get(t.to?.[0] ?? "");
            const split = origin?.kind === "database" && settingsOf(origin).replicas > 0 && settingsOf(origin).shards <= 1;
            return split ? entries.get(origin.id)!.write : entries.get(t.id)!.read;
          }),
        );
        for (const id of mine) {
          const n = node(id);
          n.calls = { read, write };
          n.callTimeoutMs = Math.round(timeout * 0.6);
        }
        break;
      }
    }
  }

  if (nodes.length > MAX_STATIONS) notes.push(`${nodes.length} stations is a lot for one stage; counts above ${DRAWN} copies draw as one.`);
  layout(nodes);
  const spec = scene(nodes, {
    sloMs: doc.targets.p95Ms,
    timeoutMs: timeout,
    msPerUnit: 0.35,
    windowMs: 1000,
    // Opens a few seconds in, so caches are warm and the numbers have settled on the first frame.
    warmMs: 2500,
    wideH: nodes.length > 8 ? 460 : undefined,
  });
  return { spec, stations, partOf, notes, issues };
}

/** Every station a node sends to: its pools spread, its calls, its copies' primary, a queue's dead letters. */
function sendsOf(n: NodeSpec): string[] {
  const flat = (cs?: Call[]) => (cs ?? []).flatMap((c) => (Array.isArray(c) ? c : [c]));
  return [...flat(n.to), ...flat(n.calls?.read), ...flat(n.calls?.write), ...(n.ack?.deadLetter ? [n.ack.deadLetter] : [])];
}

/**
 * Columns along the flow, by the longest way in from a sender; rows across it, each station near the stations that
 * send to it, so rails run as straight as they can. A database's copies stand in their primary's column.
 */
export function layout(nodes: NodeSpec[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const into = new Map<string, string[]>();
  for (const n of nodes) for (const t of sendsOf(n)) if (byId.has(t)) into.set(t, [...(into.get(t) ?? []), n.id]);
  const depth = new Map<string, number>();
  const depthOf = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const from = into.get(id) ?? [];
    const d = from.length ? Math.max(...from.map((f) => depthOf(f, seen) + 1)) : 0;
    depth.set(id, d);
    return d;
  };
  for (const n of nodes) depthOf(n.id);
  for (const n of nodes) if (n.replicaOf && depth.has(n.replicaOf)) depth.set(n.id, depth.get(n.replicaOf)!);
  const max = Math.max(0, ...depth.values());
  const columns: string[][] = Array.from({ length: max + 1 }, () => []);
  for (const n of nodes) columns[depth.get(n.id)!].push(n.id);
  const across = new Map<string, number>();
  const spread = (ids: string[]) => ids.forEach((id, i) => across.set(id, ids.length === 1 ? 50 : 12 + (76 * i) / (ids.length - 1)));
  spread(columns[0]);
  for (let c = 1; c <= max; c++) {
    const col = columns[c];
    // Order by where the stations sending to each one sit (the mean of their rows), then spread evenly.
    const at = (id: string) => {
      const from = (into.get(id) ?? []).filter((f) => across.has(f));
      const replica = byId.get(id)?.replicaOf;
      return from.length ? from.reduce((s, f) => s + across.get(f)!, 0) / from.length : replica ? (across.get(replica) ?? 50) + 1 : 50;
    };
    col.sort((a, b) => at(a) - at(b));
    if (col.length === 1) across.set(col[0], Math.max(14, Math.min(86, at(col[0]))));
    else spread(col);
  }
  for (const n of nodes) n.at = [max ? 6 + (88 * depth.get(n.id)!) / max : 50, Math.round(across.get(n.id)!)];
}
