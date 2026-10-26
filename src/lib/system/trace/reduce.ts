// A trace's spans become the system they ran through: each service a part, each call from one service to another an
// arrow, with what the trace measured (requests a second at the way in, each part's own work per call). Databases,
// caches and queues nobody traced are parts too, from what the spans calling them say. Past twelve parts, services are
// grouped the way a person would sketch them (sidecars folded in, shared prefixes, a caller's leaves of one kind, then
// the quietest as "Other services"), and each grouping is said in a note. The graph goes on to `toDoc`, like any import.

import { KINDS, type PartKind } from "../doc";
import type { Graph, GraphNode } from "../import/graph";
import { kindFromName } from "../import/infer";
import type { Span } from "./span";

/** The most parts a trace is drawn with, Users included: a stage reads best with up to twelve. */
export const MOST_PARTS = 12;

/**
 * How a big trace is grouped: services kept apart as far as the stage allows (`service`), every service sharing its
 * name's first word as one (`prefix`, a team or namespace), or one part per kind of part behind the ways in (`kind`).
 */
export type Grouping = "service" | "prefix" | "kind";
export const GROUPINGS: Grouping[] = ["service", "prefix", "kind"];
const OTHER = "Other services";
/** Sidecars and tracing plumbing, folded into the service beside them when there are too many parts. */
const INFRA = /\b(istio|envoy|linkerd|sidecar|otel|opentelemetry|collector|jaeger|zipkin|tempo|agent)\b/i;
/** What a part only traced from its callers can be: it calls nothing. */
const LEAF_KINDS: PartKind[] = ["service", "external", "database", "cache", "queue", "topic"];
const WORK: PartKind[] = ["service", "worker", "external", "database"];

export interface Reduced {
  graph: Graph;
  notes: string[];
  /** Parts whose kind was taken from their name, for the person to check. */
  guessed: { name: string; kind: PartKind }[];
  /** Requests that came in from outside, and the seconds their starts cover. */
  requests: number;
  seconds: number;
  /** Half of those requests, and 95 in 100, were answered within these ms. */
  p50: number;
  p95: number;
  /** The work done for each request on average, every part's together (ms): what the model is calibrated to. */
  work: number;
  /** The part each span is drawn in, after grouping: what the replay is built from (`replay.ts`). */
  spanPart: string[];
  /** How many of the file's services and stores each grouped part stands for (two or more). */
  merged: Record<string, number>;
}

interface Node {
  name: string;
  /** Calls into it from another part, or from outside. */
  entries: number;
  /** Requests that start here, and jobs taken from it with nothing seen sending them (a queue's consumer roots). */
  roots: number;
  jobs: number;
  traces: Set<number>;
  /** Per trace: its own time (spans' time minus their children's) and the calls into it. */
  self: Map<number, number>;
  calls: Map<number, number>;
}

const plural = (k: PartKind) => `${KINDS[k].name.toLowerCase()}s`;
const list = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
const short = (names: string[], most = 4) => (names.length > most ? `${names.slice(0, most).join(", ")} and ${names.length - most} more` : list(names));
export const msText = (v: number) => (v < 1000 ? `${Math.round(v)} ms` : `${+(v / 1000).toFixed(2)} s`);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
};
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0;
};

/** Spans as the system they ran through, grouped `by` service, prefix or kind; null when no request starts in them. */
export function reduce(spans: Span[], by: Grouping = "service", limit = MOST_PARTS): Reduced | null {
  const n = spans.length;
  const kids: number[][] = Array.from({ length: n }, () => []);
  spans.forEach((s, i) => s.parent >= 0 && kids[s.parent].push(i));

  // Each span's own time: its length less the time covered by its children.
  const self = spans.map((s, i) => {
    const iv = kids[i].map((k) => [Math.max(s.start, spans[k].start), Math.min(s.end, spans[k].end)]).filter(([a, b]) => b > a);
    iv.sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let to = -Infinity;
    for (const [a, b] of iv) {
      if (b <= to) continue;
      covered += b - Math.max(a, to);
      to = b;
    }
    return Math.max(0, s.end - s.start - covered);
  });

  // A call to something nobody traced (a database, a cache, a queue, a named service) runs "in" that part, so its
  // time is the callee's, not the caller's. A message sent to a queue always goes through it.
  const leafKind = new Map<string, PartKind | undefined>();
  const svc = spans.map((s, i) => {
    const leaf = s.peer && (s.kind === "producer" || (kids[i].length === 0 && (s.kind === "client" || (s.kind === "internal" && s.peer.kind))));
    if (!leaf) return s.service;
    if (!leafKind.get(s.peer!.name)) leafKind.set(s.peer!.name, s.peer!.kind);
    return s.peer!.name;
  });
  const traced = new Set(spans.filter((s, i) => svc[i] === s.service).map((s) => s.service));
  // A job taken from a queue with no parent came from whoever sent it, outside the file: it enters at its queue.
  const takesFrom = (i: number) => spans[i].peer?.name ?? "Messages";
  for (let i = 0; i < n; i++) if (spans[i].parent < 0 && spans[i].kind === "consumer" && !leafKind.has(takesFrom(i))) leafKind.set(takesFrom(i), spans[i].peer?.kind ?? "queue");

  const guessed = new Set<string>();
  // A traced service is a service, or a balancer by its name ("frontend-proxy"); one only a queue feeds becomes a
  // worker in `toDoc`, by what calls it.
  const baseKind = (name: string): PartKind => {
    if (traced.has(name) || !leafKind.has(name)) {
      if (kindFromName(name) !== "balancer") return "service";
      guessed.add(name);
      return "balancer";
    }
    const known = leafKind.get(name);
    if (known) return known;
    const k = kindFromName(name);
    guessed.add(name);
    return LEAF_KINDS.includes(k) ? k : "service";
  };

  // Grouping maps each original name to the part it is drawn in.
  const group = new Map<string, string>();
  const kinds = new Map<string, PartKind>();
  const at = (x: string) => group.get(x) ?? x;
  const originals = new Set([...svc, ...[...leafKind.keys()]]);
  const merge = (names: string[], into: string, kind: PartKind) => {
    const set = new Set(names);
    for (const o of originals) if (set.has(at(o))) group.set(o, into);
    kinds.set(into, kind);
  };
  const kindOf = (name: string) => kinds.get(name) ?? baseKind(name);

  // When each request started, so calls can be put in the order they are made.
  const began = new Map<number, number>();
  for (const sp of spans) if (sp.parent < 0) began.set(sp.trace, Math.min(began.get(sp.trace) ?? Infinity, sp.start));

  const measure = () => {
    const nodes = new Map<string, Node>();
    /** Each arrow's calls, and the sum of how far into their request they were made. */
    const edges = new Map<string, { calls: number; at: number }>();
    const node = (name: string) => {
      let x = nodes.get(name);
      if (!x) nodes.set(name, (x = { name, entries: 0, roots: 0, jobs: 0, traces: new Set(), self: new Map(), calls: new Map() }));
      return x;
    };
    const call = (from: string, to: Node, i: number) => {
      const e = edges.get(`${from}\u0000${to.name}`) ?? { calls: 0, at: 0 };
      e.calls++;
      e.at += spans[i].start - (began.get(spans[i].trace) ?? spans[i].start);
      edges.set(`${from}\u0000${to.name}`, e);
      to.entries++;
      to.calls.set(spans[i].trace, (to.calls.get(spans[i].trace) ?? 0) + 1);
    };
    for (let i = 0; i < n; i++) {
      const s = spans[i];
      const me = node(at(svc[i]));
      me.traces.add(s.trace);
      me.self.set(s.trace, (me.self.get(s.trace) ?? 0) + self[i]);
      if (s.parent >= 0) {
        const from = at(svc[s.parent]);
        if (from !== me.name) call(from, me, i);
      } else if (s.kind === "consumer") {
        const q = node(at(takesFrom(i)));
        q.jobs++;
        q.traces.add(s.trace);
        if (q !== me) call(q.name, me, i);
      } else {
        me.roots++;
        me.entries++;
        me.calls.set(s.trace, (me.calls.get(s.trace) ?? 0) + 1);
      }
    }
    const callsOf = (a: string, b: string) => edges.get(`${a}\u0000${b}`)?.calls ?? 0;
    // A part's targets in the order it calls them (how far into a request, on average); its callers by most calls.
    const outs = new Map<string, [string, number][]>();
    const ins = new Map<string, [string, number][]>();
    for (const [e, { calls, at: sum }] of edges) {
      const [a, b] = e.split("\u0000");
      outs.set(a, [...(outs.get(a) ?? []), [b, sum / calls]]);
      ins.set(b, [...(ins.get(b) ?? []), [a, -calls]]);
    }
    const sorted = (list: [string, number][] = []) => list.sort((p, q) => p[1] - q[1] || (p[0] < q[0] ? -1 : 1)).map(([x]) => x);
    const outBy = new Map([...outs].map(([x, l]) => [x, sorted(l)]));
    const inBy = new Map([...ins].map(([x, l]) => [x, sorted(l)]));
    const outOf = (x: string) => outBy.get(x) ?? [];
    const into = (x: string) => inBy.get(x) ?? [];
    // Where requests come in: where they start, or a queue whose jobs nobody in the file sent.
    const entries = [...nodes.values()]
      .filter((x) => x.roots > 0 || (x.jobs > 0 && !into(x.name).length))
      .sort((p, q) => q.roots + q.jobs - p.roots - p.jobs || (p.name < q.name ? -1 : 1));
    const size = nodes.size + Math.min(2, entries.length);
    // Names in a fixed order, whatever order the file listed its spans in.
    const names = [...nodes.keys()].sort();
    return { nodes, edges, callsOf, into, outOf, entries, ways: new Set(entries.map((e) => e.name)), size, names };
  };

  let m = measure();
  if (!m.entries.length) return null;
  const notes: string[] = [];
  const isEntry = (x: string) => m.ways.has(x);
  /** Groups of names under a key, biggest first, then by key, so any file of the same requests groups the same. */
  const groups = (key: (x: string) => string | null) => {
    const by = new Map<string, string[]>();
    for (const x of m.names) {
      const k = key(x);
      if (k !== null) by.set(k, [...(by.get(k) ?? []), x]);
    }
    return [...by].filter(([, v]) => v.length > 1).sort((p, q) => q[1].length - p[1].length || (p[0] < q[0] ? -1 : 1));
  };

  // By kind: behind the ways in, every part of one kind is one part ("Services", "Databases").
  if (by === "kind") {
    const byKind = new Map<PartKind, string[]>();
    for (const x of m.names) if (!isEntry(x)) byKind.set(kindOf(x), [...(byKind.get(kindOf(x)) ?? []), x]);
    const made: string[] = [];
    for (const [k, names] of [...byKind].sort((p, q) => q[1].length - p[1].length || (p[0] < q[0] ? -1 : 1))) {
      if (names.length < 2) continue;
      const word = plural(k);
      const into = `${word[0].toUpperCase()}${word.slice(1)}`;
      merge(names, m.names.includes(into) && !names.includes(into) ? `All ${word}` : into, k);
      made.push(`${into} (${names.length})`);
    }
    if (made.length) {
      notes.push(`Grouped by kind: behind the way in, each kind of part is one part: ${short(made, 6)}.`);
      m = measure();
    }
  }
  // 1. Sidecars and tracing plumbing fold into the busiest service calling them.
  if (m.size > limit) {
    const folded: string[] = [];
    for (const x of m.names) {
      const by = m.into(x)[0];
      if (!INFRA.test(x) || isEntry(x) || !by) continue;
      merge([x, by], at(by), kindOf(at(by)));
      folded.push(x);
    }
    if (folded.length) {
      notes.push(`${short(folded)} ${folded.length === 1 ? "is" : "are"} folded into the services calling them: ${folded.length === 1 ? "it passes" : "they pass"} requests on.`);
      m = measure();
    }
  }
  // 2. Services sharing the first word of their name, and of one kind, become one part: as many as the stage needs, or
  // every such group when grouping by prefix.
  if (m.size > limit || by === "prefix") {
    let size = m.size;
    const made: string[] = [];
    for (const [key, names] of groups((x) => (x.split(/[-_. /:]/)[0].length < 3 || x === OTHER ? null : `${x.split(/[-_. /:]/)[0].toLowerCase()}\u0000${kindOf(x)}`))) {
      if (size <= limit && by !== "prefix") break;
      const kind = key.split("\u0000")[1] as PartKind;
      const word = names[0].split(/[-_. /:]/)[0];
      const taken = m.names.some((x) => !names.includes(x) && x.toLowerCase() === word.toLowerCase());
      const into = taken ? `${word} ${plural(kind)}` : word;
      merge(names, into, kind);
      size -= names.length - 1;
      made.push(`${into} (${names.length})`);
    }
    if (made.length) {
      notes.push(`Services that share a name are drawn as one part each: ${short(made, 6)}.`);
      m = measure();
    }
  }
  // 3. A caller's leaves of one kind (three caches behind one service) become one part.
  if (m.size > limit) {
    let size = m.size;
    const made: string[] = [];
    for (const [key, names] of groups((x) => (m.outOf(x).length || m.into(x).length !== 1 || isEntry(x) || x === OTHER ? null : `${m.into(x)[0]}\u0000${kindOf(x)}`))) {
      if (size <= limit) break;
      const [caller, kind] = key.split("\u0000") as [string, PartKind];
      const into = `${caller} ${plural(kind)}`;
      merge(names, into, kind);
      size -= names.length - 1;
      made.push(`${into} (${list(names.slice(0, 3))}${names.length > 3 ? "…" : ""})`);
    }
    if (made.length) {
      notes.push(`What one service calls, of one kind, is drawn as one part: ${short(made, 3)}.`);
      m = measure();
    }
  }
  // 4. The least used parts become "Other services", each with what only it calls (a team's database goes with the
  // team), until the stage fits.
  const others: string[] = [];
  for (let round = 0; m.size > limit && round < 4; round++) {
    const has = m.nodes.has(OTHER);
    const own = new Map<string, string[]>();
    for (const y of m.names) if (!m.outOf(y).length && m.into(y).length === 1 && !isEntry(y)) own.set(m.into(y)[0], [...(own.get(m.into(y)[0]) ?? []), y]);
    const lone = new Set([...own.values()].flat());
    const used = (x: string) => m.nodes.get(x)!.traces.size;
    const pool = m.names.filter((x) => x !== OTHER && !lone.has(x) && !isEntry(x)).sort((p, q) => used(p) - used(q) || m.nodes.get(p)!.entries - m.nodes.get(q)!.entries);
    const need = m.size - limit + (has ? 0 : 1);
    const take: string[] = [];
    for (const x of pool) {
      if (take.length >= need) break;
      take.push(x, ...(own.get(x) ?? []));
    }
    // Nothing left to group but the ways in: the least used of them go too.
    if (take.length < need) take.push(...m.entries.map((e) => e.name).reverse().slice(0, need - take.length));
    others.push(...take);
    merge(has ? [...take, OTHER] : take, OTHER, "service");
    m = measure();
  }
  if (others.length) notes.push(`The ${others.length} least used parts are drawn as one, “${OTHER}”, so the stage stays readable: ${short(others.sort(), 5)}.`);

  // Kinds, now that the parts are settled. A balancer by name that calls more than services does the work of one; a
  // cache with no database behind it is the store itself.
  const kind = new Map(m.names.map((x) => [x, kindOf(x)]));
  // One that calls on more than once for each request it gets (a gateway gathering several answers) is a service.
  const onward = (x: string) => m.outOf(x).reduce((sum, y) => sum + m.callsOf(x, y), 0) / Math.max(1, m.nodes.get(x)?.entries ?? 0);
  for (const x of m.names) if (kind.get(x) === "balancer" && (m.outOf(x).some((y) => !["service", "balancer"].includes(kind.get(y)!)) || onward(x) > 1.05)) kind.set(x, "service");
  for (const x of m.names) {
    if (kind.get(x) !== "cache" || m.outOf(x).length) continue;
    if (m.into(x).some((c) => m.outOf(c).some((y) => kind.get(y) === "database"))) continue;
    kind.set(x, "database");
    notes.push(`${x} is drawn as a database: nothing behind it holds the data.`);
  }

  // The parts in the order a request meets them, each arrow in the order its part calls; arrows that would send a
  // request round in a loop are left out.
  const order: string[] = [];
  const kept: [string, string][] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (x: string) => {
    state.set(x, 1);
    order.push(x);
    for (const y of m.outOf(x)) {
      if (state.get(y) === 1) {
        notes.push(`${x} → ${y} is left out: with it, requests would go round in a loop.`);
        continue;
      }
      kept.push([x, y]);
      if (!state.has(y)) visit(y);
    }
    state.set(x, 2);
  };
  for (const e of m.entries) if (!state.has(e.name)) visit(e.name);
  for (const x of m.names) if (!state.has(x)) visit(x);

  // Each part's work per call, as the model makes them: the middle of its own time per call into it, times how many
  // calls the trace made for each one the model makes. The model sends every request down every arrow, so a part
  // gets a call for each request reaching any of its callers (`visits`, counted from the way in).
  const entriesOf = (x: string) => m.nodes.get(x)?.entries ?? 0;
  const seen = new Map<string, number>();
  const visits = (x: string): number => {
    if (seen.has(x)) return seen.get(x)!;
    seen.set(x, 0);
    const me = m.nodes.get(x)!;
    const v = me.roots + me.jobs + kept.filter(([, b]) => b === x).reduce((sum, [a]) => sum + visits(a), 0);
    seen.set(x, v);
    return v;
  };
  const nodes: GraphNode[] = order.map((name) => {
    const x = m.nodes.get(name)!;
    const k = kind.get(name)!;
    const node: GraphNode = { name: x.name, kind: k };
    if (isEntry(x.name)) node.public = true;
    if (WORK.includes(k)) {
      const per = [...x.self].map(([t, v]) => v / Math.max(1, x.calls.get(t) ?? 0));
      const v = visits(name);
      node.ms = Math.max(1, median(per) * (v ? x.entries / v : 1));
    }
    return node;
  });

  // Requests through a part that go different ways: in the model each takes every arrow, doing that share of the work.
  const share = (a: string, b: string) => m.callsOf(a, b) / Math.max(1, entriesOf(a));
  const split = order
    .filter((a) => kept.filter(([x]) => x === a).length > 1 && kept.some(([x, y]) => x === a && share(a, y) < 0.9))
    .sort((p, q) => entriesOf(q) - entriesOf(p))[0];
  if (split) {
    const ways = kept.filter(([x]) => x === split).map(([, y]) => (share(split, y) >= 0.995 ? `all to ${y}` : `${Math.max(1, Math.round(100 * share(split, y)))}% to ${y}`));
    notes.push(`Requests through ${split} go different ways (${short(ways)}); in the model each takes every arrow, doing that share of the work, so each part is as busy as in the trace.`);
  }
  // Several calls for each one the model makes: the model's one call does them all.
  const repeats = kept
    .map(([a, b]) => ({ a, b, k: share(a, b) }))
    .filter((r) => r.k >= 2 && WORK.includes(kind.get(r.b)!))
    .sort((p, q) => q.k - p.k);
  if (repeats[0]) {
    const { a, b, k } = repeats[0];
    notes.push(`${a} calls ${b} about ${Math.round(k)} times for each request it gets; the model makes one call that does the work of all ${Math.round(k)}.`);
  }
  // Calls made at the same time: the model makes them one after the other. A call is a child in another part, or the
  // caller's own client span around one.
  const together = new Map<string, number>();
  const callee = (k: number, i: number) => {
    if (at(svc[k]) !== at(svc[i])) return at(svc[k]);
    const far = kids[k].find((g) => at(svc[g]) !== at(svc[i]));
    return far !== undefined && spans[k].kind === "client" ? at(svc[far]) : null;
  };
  for (let i = 0; i < n; i++) {
    const out = kids[i].map((k) => ({ k, to: callee(k, i) })).filter((c) => c.to !== null).sort((a, b) => spans[a.k].start - spans[b.k].start);
    for (let j = 1; j < out.length; j++) {
      const [p, q] = [spans[out[j - 1].k], spans[out[j].k]];
      if (q.start < p.end - 0.5 * Math.min(p.end - p.start, q.end - q.start) && out[j - 1].to !== out[j].to) {
        const key = [at(svc[i]), ...[out[j - 1].to!, out[j].to!].sort()].join("\u0000");
        together.set(key, (together.get(key) ?? 0) + 1);
      }
    }
  }
  const most = [...together].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  if (most && most[1] >= Math.max(2, 0.2 * visits(most[0].split("\u0000")[0]))) {
    const [c, p, q] = most[0].split("\u0000");
    notes.push(`${c} calls ${p} and ${q} at the same time; the model calls them one after the other, so its requests can take longer.`);
  }

  // People in front of each way in, sending what the trace measured. Two ways in get their own; more share one Users.
  const roots = spans.map((s, i) => (s.parent < 0 && s.kind !== "consumer" ? i : -1)).filter((i) => i >= 0);
  const starts = (roots.length ? roots : spans.map((s, i) => (s.parent < 0 ? i : -1)).filter((i) => i >= 0)).map((i) => spans[i].start);
  // A big file holds tens of thousands of requests: too many to spread into Math.max.
  const seconds = starts.length > 1 ? (starts.reduce((a, b) => Math.max(a, b)) - starts.reduce((a, b) => Math.min(a, b))) / 1000 : 0;
  const requests = m.entries.reduce((s, e) => s + e.roots + e.jobs, 0);
  const measured = requests >= 10 && seconds >= 1 ? (requests - 1) / seconds : 0;
  const rate = measured ? Math.min(400, Math.max(10, measured)) : 40;
  if (!measured) notes.push(`${requests === 1 ? "One request is" : `${requests} requests are`} too few to measure traffic, so Users send ${rate} a second. Set yours under Users.`);
  else if (rate !== measured)
    notes.push(`The trace has about ${measured < 10 ? +measured.toFixed(1) : Math.round(measured)} requests a second; Users send ${rate}${rate > measured ? ", as traces are often sampled" : ", the most System Lab runs"}. Set yours under Users.`);
  else notes.push(`Users send ${Math.round(rate)} requests a second, as in the trace.`);
  const ways = m.entries;
  const people = nodes.some((x) => x.name === "Users") ? "People" : "Users";
  if (ways.length === 2) {
    nodes.unshift(...ways.map((e): GraphNode => ({ name: `${e.name} ${people.toLowerCase()}`, kind: "users", rate: Math.max(1, (rate * (e.roots + e.jobs)) / requests) })));
    ways.forEach((e) => kept.push([`${e.name} ${people.toLowerCase()}`, e.name]));
  } else {
    nodes.unshift({ name: people, kind: "users", rate });
    for (const e of ways) kept.push([people, e.name]);
  }

  // Requests' times, and the stories of the slowest and of one that failed.
  const durations = roots.map((i) => spans[i].end - spans[i].start);
  const byTrace = new Map<number, number[]>();
  spans.forEach((s, i) => (byTrace.get(s.trace) ?? byTrace.set(s.trace, []).get(s.trace)!).push(i));
  const what = (i: number) => (spans[i].name ? ` (${spans[i].name})` : "");
  if (roots.length > 1) {
    const slow = roots.reduce((a, b) => (spans[b].end - spans[b].start > spans[a].end - spans[a].start ? b : a));
    const own = new Map<string, number>();
    for (const i of byTrace.get(spans[slow].trace) ?? []) own.set(at(svc[i]), (own.get(at(svc[i])) ?? 0) + self[i]);
    const [where, t] = [...own].sort((a, b) => b[1] - a[1])[0];
    notes.push(`The slowest request${what(slow)} took ${msText(spans[slow].end - spans[slow].start)}, ${msText(t)} of it in ${where}.`);
  }
  const failed = roots.filter((i) => spans[i].error);
  const hurt = roots.filter((i) => (byTrace.get(spans[i].trace) ?? []).some((j) => spans[j].error));
  const first = failed[0] ?? hurt[0];
  if (first !== undefined) {
    // Where it broke: the deepest span that failed, and the way there.
    const errs = (byTrace.get(spans[first].trace) ?? []).filter((j) => spans[j].error);
    const depth = (j: number) => {
      let d = 0;
      for (let p = spans[j].parent; p >= 0; p = spans[p].parent) d++;
      return d;
    };
    const deepest = errs.sort((a, b) => depth(b) - depth(a))[0];
    const path: string[] = [];
    for (let p = deepest; p >= 0; p = spans[p].parent) if (path[0] !== at(svc[p])) path.unshift(at(svc[p]));
    const share = Math.round((100 * (failed.length || hurt.length)) / roots.length);
    notes.push(
      failed.length
        ? `${share < 1 ? "Under 1" : share}% of requests failed. One${what(first)} broke in ${at(svc[deepest])}, ${msText(spans[deepest].start - spans[first].start)} in: ${path.join(" → ")}. The model's parts don't fail on their own: crash or slow ${at(svc[deepest])} under “Break something” to watch it.`
        : `${share < 1 ? "Under 1" : share}% of requests met an error in ${at(svc[deepest])} and still answered (${path.join(" → ")}).`,
    );
  }

  return {
    graph: { nodes, edges: kept },
    notes,
    guessed: [...guessed].filter((x) => m.nodes.has(x) && !kinds.has(x)).map((x) => ({ name: x, kind: kind.get(x)! })),
    requests,
    seconds,
    spanPart: svc.map(at),
    merged: Object.fromEntries(
      [...[...originals].reduce((c, o) => c.set(at(o), (c.get(at(o)) ?? 0) + 1), new Map<string, number>())].filter(([x, k]) => k > 1 && m.nodes.has(x)),
    ),
    p50: quantile(durations, 0.5),
    p95: quantile(durations, 0.95),
    // Work done while the request was open: a job taken from a queue afterwards is nobody's wait.
    work: roots.reduce((sum, i) => sum + (byTrace.get(spans[i].trace) ?? []).reduce((w, j) => w + (spans[j].start < spans[i].end ? self[j] : 0), 0), 0) / Math.max(1, roots.length),
  };
}
