// A trace replayed on its system. Three of its requests (a typical one, the slowest and one that failed) as they ran:
// every span to the millisecond, and the way each went, hop by hop, on the system's stations. And "the second": the
// system running as the trace's requests did, each its own way (`ClientSpec.routes`, `NodeSpec.paths`), with the
// trace's own work, wires and failures, checked against the trace. Loaded with the trace readers.

import { Sim, loadModules, needsOf } from "../../sim/engine/core";
import type { Call, NodeSpec, SceneSpec, Step } from "../../sim/types";
import { PEOPLE, type Compiled } from "../compile";
import type { SystemDoc } from "../doc";
import { msText as ms, type Reduced } from "./reduce";
import type { Span } from "./span";

/** One span of a sample request, as the trace measured it: ms from the request's start. */
export interface SampleSpan {
  /** The part it ran in (after grouping). */
  part: string;
  name: string;
  /** How many spans up its parent chain goes. */
  depth: number;
  t0: number;
  t1: number;
  error: boolean;
}

/** A stretch of a sample request's way on the stations: on a wire from one to the next, or at one. */
export interface Hop {
  kind: "travel" | "work";
  /** The station it is at, or heading to. */
  node: string;
  /** On a wire: the station it left. */
  from?: string;
  t0: number;
  t1: number;
  /** On its way out: the parts it called at the same time, which it doesn't follow (it follows the one it waited for). */
  also?: string[];
  /** On a wire: an answer on its way back. */
  back?: boolean;
}

export type SampleKind = "typical" | "slowest" | "failed";

export interface Sample {
  kind: SampleKind;
  /** What the request was ("POST /checkout"), scrubbed. */
  name: string;
  ms: number;
  error: boolean;
  /** Its spans in the order they started, at most `MOST_ROWS`; `more` were left out. */
  spans: SampleSpan[];
  more: number;
  /** Every station it reached. */
  path: string[];
  hops: Hop[];
  /** Where it broke: the part of its deepest failing span, and how far in. */
  broke?: { part: string; at: number };
}

/** The system as the trace ran it, and how close its times come to the trace's. */
export interface Second {
  /** The scene at the trace's own speed, for the stage. */
  spec: SceneSpec;
  /** It was checked this many times slower (every time longer, its traffic thinner), so the engine's ticks round little. */
  slow: number;
  routes: number;
  trace: Times;
  model: Times | null;
  notes: string[];
}

/** Half of requests, and 95 in 100, answered within these ms; the share that failed. */
export interface Times {
  p50: number;
  p95: number;
  failed: number;
}

export interface Replay {
  samples: Sample[];
  second: Second;
}

/** The longest waterfall: a request with hundreds of spans shows its first forty. */
export const MOST_ROWS = 40;
/** At most this many ways through the system; rarer requests go the commonest way from the same people. */
const MOST_ROUTES = 32;
/** How busy the replay's parts are with the work the trace measured: room enough to add little waiting. */
const ROOM = 0.35;
/** A route's work at a part is drawn from this many of the times measured there, fastest to slowest. */
const SPREAD = 16;
/** A wire no client span measured: its time is already in the caller's own (a hop the stage still draws). */
const WIRE = 0.01;
/** Slowed so a typical request takes at least this long (simulated ms), */
const SLOW_TO = 500;
/** and each crossing's rounding to the engine's 2 ms tick is at most this share of it. */
const ROUNDING = 0.02;
/** "The second" is measured over this many requests' worth of traffic, after a warm-up. */
const MEASURE_REQUESTS = 400;

interface Visit {
  part: string;
  /** In the part, and (out0, out1) when the call left its caller and its answer was back there. */
  t0: number;
  t1: number;
  out0: number;
  out1: number;
  kids: Visit[];
  /** A job taken later (from a queue), or begun after its caller was done: no part of the request's time. */
  late: boolean;
  /** Its deepest failing span, if any, and that span's depth. */
  failed: { span: number; depth: number } | null;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0;
};
const flat = (c: Call) => (Array.isArray(c) ? c : [c]);
/** How long a set of intervals covers, overlaps counted once. */
const covered = (iv: number[][]) => {
  let sum = 0;
  let to = -Infinity;
  for (const [a, b] of iv.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0])) {
    if (b <= to) continue;
    sum += b - Math.max(a, to);
    to = b;
  }
  return sum;
};
const same = (a: Step, b: Step) => JSON.stringify(a) === JSON.stringify(b);

/** Calls that overlap by half the shorter one are made at the same time; the rest one after another. */
function together(kids: Visit[]): Visit[][] {
  const out: Visit[][] = [];
  const now = kids.filter((k) => !k.late).sort((a, b) => a.out0 - b.out0 || (a.part < b.part ? -1 : 1));
  let start = 0;
  let end = -Infinity;
  for (const k of now) {
    const g = out[out.length - 1];
    if (g && k.out0 < end - 0.5 * Math.min(k.out1 - k.out0, end - start)) {
      g.push(k);
      end = Math.max(end, k.out1);
    } else {
      out.push([k]);
      start = k.out0;
      end = k.out1;
    }
  }
  return out;
}

/**
 * Replay a reduced trace on its system: `doc` is what `toDoc` drew from `red`, and `compiled` its scene. The spans are
 * read here and let go; what is kept is scrubbed, numbered and timed.
 */
export async function replayOf(spans: Span[], red: Reduced, doc: SystemDoc, compiled: Compiled): Promise<Replay> {
  const n = spans.length;
  const kids: number[][] = Array.from({ length: n }, () => []);
  spans.forEach((s, i) => s.parent >= 0 && kids[s.parent].push(i));
  const part = red.spanPart;
  const depthOf = (i: number) => {
    let d = 0;
    for (let p = spans[i].parent; p >= 0; p = spans[p].parent) d++;
    return d;
  };

  // Stations: each part's first station, and the rails between them.
  const idOf = new Map(doc.parts.map((p) => [p.name, p.id]));
  const stationsOf = (name: string) => compiled.stations.get(idOf.get(name.slice(0, 40)) ?? "") ?? [];
  const station = (name: string) => stationsOf(name)[0];
  const nodes = new Map(compiled.spec.nodes.map((x) => [x.id, x]));
  const sends = (x: NodeSpec): Call[] => x.calls?.read ?? x.to ?? [];
  /** The stations on the drawn way from a to b (both ends), or null when no rail leads there. */
  const railMemo = new Map<string, string[] | null>();
  const reach = (a: string, b: string): string[] | null => {
    const key = `${a}>${b}`;
    if (railMemo.has(key)) return railMemo.get(key)!;
    const prev = new Map<string, string>([[a, ""]]);
    const queue = [a];
    while (queue.length && !prev.has(b)) {
      const x = queue.shift()!;
      for (const c of sends(nodes.get(x)!)) for (const y of flat(c)) if (!prev.has(y) && nodes.has(y)) prev.set(y, x), queue.push(y);
    }
    let way: string[] | null = null;
    if (prev.has(b)) {
      way = [];
      for (let x = b; x; x = prev.get(x)!) way.unshift(x);
    }
    railMemo.set(key, way);
    return way;
  };
  /** A wire's way on the stage: along the rails out, back along them for an answer, or straight across. */
  const rail = (a: string, b: string) => reach(a, b) ?? reach(b, a)?.slice().reverse() ?? [a, b];
  const clients = compiled.spec.nodes.filter((x) => x.kind === "client");
  /** Who sends a request to this way in: the people whose rails reach it soonest. */
  const sender = (entry: string) =>
    clients
      .map((c) => ({ c: c.id, way: reach(c.id, entry) }))
      .filter((x) => x.way)
      .sort((p, q) => p.way!.length - q.way!.length)[0]?.c;

  // Each request as visits: the stretch it spent in one part, and the calls that part made.
  const build = (i: number): Visit => {
    const s = spans[i];
    const v: Visit = { part: part[i], t0: s.start, t1: s.end, out0: s.start, out1: s.end, kids: [], late: s.kind === "consumer", failed: null };
    const take = (j: number) => {
      if (spans[j].error) {
        const d = depthOf(j);
        if (!v.failed || d > v.failed.depth) v.failed = { span: j, depth: d };
      }
      // A client span around another part's answer: the call left when it began and was back when it ended.
      const wraps = spans[j].kind === "client" && kids[j].length === 1 && part[kids[j][0]] !== v.part;
      for (const k of kids[j]) {
        if (part[k] === v.part) {
          take(k);
          continue;
        }
        const c = build(k);
        if (wraps) [c.out0, c.out1] = [spans[j].start, spans[j].end];
        if (spans[k].start >= v.t1) c.late = true;
        v.kids.push(c);
      }
    };
    take(i);
    return v;
  };
  const roots = spans.map((s, i) => (s.parent < 0 && s.kind !== "consumer" ? i : -1)).filter((i) => i >= 0);
  const trees = new Map(roots.map((i) => [i, build(i)]));
  const byTrace = new Map<number, number[]>();
  spans.forEach((s, i) => (byTrace.get(s.trace) ?? byTrace.set(s.trace, []).get(s.trace)!).push(i));
  /** The visit where a failed request broke: its deepest failing span. */
  const brokeIn = (v: Visit): Visit | null => {
    let best: Visit | null = v.failed ? v : null;
    for (const k of v.kids) {
      if (k.late) continue;
      const b = brokeIn(k);
      if (b && (!best || b.failed!.depth > best.failed!.depth)) best = b;
    }
    return best;
  };

  // ------------------------------------------------------------------------------------------- the samples

  const dur = (i: number) => spans[i].end - spans[i].start;
  // In the order they began; at the same moment, by what they are, never by where the file listed them.
  const order = (a: number, b: number) =>
    spans[a].start - spans[b].start || depthOf(a) - depthOf(b) || (part[a] < part[b] ? -1 : part[a] > part[b] ? 1 : 0) || (spans[a].name < spans[b].name ? -1 : spans[a].name > spans[b].name ? 1 : 0) || spans[a].end - spans[b].end || a - b;
  const middle = quantile(roots.map(dur), 0.5);
  const pick = (list: number[], score: (i: number) => number) => [...list].sort((a, b) => score(a) - score(b) || order(a, b))[0];
  const picks: [SampleKind, number | undefined][] = [
    ["typical", pick(roots.filter((i) => !spans[i].error), (i) => Math.abs(dur(i) - middle)) ?? pick(roots, (i) => Math.abs(dur(i) - middle))],
    ["slowest", pick(roots, (i) => -dur(i))],
  ];
  const failed = roots.filter((i) => spans[i].error);
  if (failed.length) picks.push(["failed", pick(failed, (i) => Math.abs(dur(i) - quantile(failed.map(dur), 0.5)))]);

  const sampleOf = (kind: SampleKind, root: number): Sample => {
    const r = spans[root];
    const at = (t: number) => t - r.start;
    const mine = (byTrace.get(r.trace) ?? []).filter((i) => spans[i].start <= r.end).sort(order);
    const rows = mine.map((i) => ({ part: part[i], name: spans[i].name, depth: depthOf(i), t0: at(spans[i].start), t1: at(spans[i].end), error: spans[i].error }));
    // The way it went, following at each set of calls made together the one it waited for.
    const parts: Hop[] = [];
    const walk = (v: Visit) => {
      let cursor = v.t0;
      for (const g of together(v.kids)) {
        const next = g.reduce((a, b) => (b.out1 > a.out1 ? b : a));
        if (next.out0 > cursor) parts.push({ kind: "work", node: v.part, t0: at(cursor), t1: at(next.out0) });
        const also = g.filter((x) => x !== next).map((x) => x.part);
        parts.push({ kind: "travel", from: v.part, node: next.part, t0: at(Math.max(cursor, next.out0)), t1: at(next.t0), ...(also.length ? { also } : {}) });
        walk(next);
        parts.push({ kind: "travel", from: next.part, node: v.part, t0: at(next.t1), t1: at(next.out1), back: true });
        cursor = Math.max(cursor, next.out1);
      }
      if (v.t1 > cursor) parts.push({ kind: "work", node: v.part, t0: at(cursor), t1: at(v.t1) });
    };
    const tree = trees.get(root)!;
    walk(tree);
    // On the stations: each wire along its rails (a call past a cache goes through it), people first and last.
    const entry = station(tree.part);
    const users = sender(entry);
    const hops: Hop[] = [];
    const along = (way: string[], t0: number, t1: number, also?: string[], back?: boolean) =>
      way.slice(1).forEach((to, k) =>
        hops.push({
          kind: "travel",
          from: way[k],
          node: to,
          t0: t0 + ((t1 - t0) * k) / (way.length - 1),
          t1: t0 + ((t1 - t0) * (k + 1)) / (way.length - 1),
          ...(k === 0 && also ? { also } : {}),
          ...(back ? { back } : {}),
        }),
      );
    if (users) along(rail(users, entry), 0, 0);
    for (const h of parts) {
      const to = station(h.node);
      if (h.kind === "work") hops.push({ kind: "work", node: to, t0: h.t0, t1: h.t1 });
      else along(rail(station(h.from!), to), h.t0, h.t1, h.also, h.back);
    }
    if (users) along(rail(entry, users), at(r.end), at(r.end), undefined, true);
    const path = [...new Set([...hops.flatMap((h) => [h.from ?? h.node, h.node]), ...mine.map((i) => station(part[i])).filter(Boolean)])];
    const sample: Sample = { kind, name: r.name, ms: dur(root), error: r.error, spans: rows.slice(0, MOST_ROWS), more: Math.max(0, rows.length - MOST_ROWS), path, hops };
    const b = r.error ? brokeIn(tree) : null;
    if (b) sample.broke = { part: b.part, at: at(spans[b.failed!.span].start) };
    return sample;
  };
  const samples = picks.filter(([, i]) => i !== undefined).map(([k, i]) => sampleOf(k, i!));

  // ------------------------------------------------------------------------------------------- the second

  // Each request's way, station by station: the calls it made there (in order, those made together as one step) and
  // the work each visit took. Requests that went the same way are one route.
  const notes: string[] = [];
  let skipped = 0;
  let twice = 0;
  const callFor = (from: string, to: string): { call: Call; via: boolean } | null => {
    const want = new Set(stationsOf(to));
    const list = sends(nodes.get(from)!);
    const direct = list.find((c) => flat(c).some((x) => want.has(x)));
    if (direct) return { call: direct, via: false };
    // A call to the database behind a cache goes through the cache, which asks the database itself on a miss.
    const via = list.find((c) => nodes.get(flat(c)[0])?.kind === "cache" && sends(nodes.get(flat(c)[0])!).some((d) => flat(d).some((x) => want.has(x))));
    return via ? { call: via, via: true } : null;
  };
  interface Way {
    users: string;
    count: number;
    at: Map<string, { steps: Step[]; ms: number[] }>;
  }
  const ways = new Map<string, Way>();
  const visits = new Map<string, number>();
  const breaks = new Map<string, number>();
  const wires = new Map<string, number[]>();
  let crossings = 0;
  for (const root of roots) {
    const tree = trees.get(root)!;
    const entry = station(tree.part);
    const users = sender(entry);
    if (!entry || !users) continue;
    const at = new Map<string, { steps: Step[]; ms: number[] }>();
    // Through a balancer in front of the way in: it sends this request there.
    const way = rail(users, entry);
    for (let k = 1; k < way.length - 1; k++) at.set(way[k], { steps: [callFor(way[k], tree.part)?.call ?? way[k + 1]], ms: [] });
    const walk = (v: Visit) => {
      const here = station(v.part);
      if (!here) return;
      visits.set(here, (visits.get(here) ?? 0) + 1);
      crossings += 2;
      // Its calls in order, those made together as one step. A call the drawing has no arrow for (a grouping or a loop
      // left it out) can't be made: the time waited on it is this part's own.
      const steps: Step[] = [];
      const next: Visit[] = [];
      for (const g of together(v.kids)) {
        const calls = g.map((k) => ({ k, c: callFor(here, k.part) })).filter((x): x is { k: Visit; c: { call: Call; via: boolean } } => !!x.c);
        skipped += g.length - calls.length;
        if (!calls.length) continue;
        next.push(...calls.map((x) => x.k));
        // The miss behind a cache is the cache's to make: one call to the cache covers both. Two calls to one part (a
        // grouped one) made at the same time are two calls.
        const made = calls.filter((x) => !(x.c.via && calls.some((y) => y !== x && !y.c.via && same(y.c.call, x.c.call))));
        if (made.length > 1) steps.push({ all: made.map((x) => x.c.call) });
        else if (!(made[0].c.via && steps.length && same(steps[steps.length - 1], made[0].c.call))) steps.push(made[0].c.call);
      }
      // Its own time: the time it was here, less the calls it waited on that the model makes too.
      const own = v.t1 - v.t0 - covered(next.map((k) => [Math.max(v.t0, k.out0), Math.min(v.t1, k.out1)]));
      const had = at.get(here);
      if (had) {
        // Reached again doing something else (a grouped part): the visit that does the most is the one replayed.
        if (had.steps.length !== steps.length || !had.steps.every((x, i) => same(x, steps[i]))) twice++;
        if (steps.length > had.steps.length) had.steps = steps;
        had.ms.push(own);
      } else at.set(here, { steps, ms: [own] });
      for (const k of next) {
        const to = station(k.part);
        if (to && to !== here && k.t0 >= k.out0 && k.out1 >= k.t1) {
          const key = here < to ? `${here}>${to}` : `${to}>${here}`;
          (wires.get(key) ?? wires.set(key, []).get(key)!).push((k.t0 - k.out0 + k.out1 - k.t1) / 2);
        }
        walk(k);
      }
    };
    walk(tree);
    if (spans[root].error) {
      const b = brokeIn(tree);
      const where = b && station(b.part);
      if (where) breaks.set(where, (breaks.get(where) ?? 0) + 1);
    }
    const key = `${users}\u0000${JSON.stringify([...at].map(([s, x]) => [s, x.steps]).sort((p, q) => (p[0] < q[0] ? -1 : 1)))}`;
    const w = ways.get(key);
    if (w) {
      w.count++;
      for (const [s, x] of at) w.at.get(s)!.ms.push(...x.ms);
    } else ways.set(key, { users, count: 1, at });
  }
  // The commonest ways, in a fixed order; a rarer request goes the commonest way from the same people.
  const sorted = [...ways].sort((p, q) => q[1].count - p[1].count || (p[0] < q[0] ? -1 : 1));
  const kept = sorted.slice(0, MOST_ROUTES);
  for (const [, w] of sorted.slice(MOST_ROUTES)) {
    const home = kept.find(([, k]) => k.users === w.users)?.[1];
    if (home) home.count += w.count;
  }
  if (sorted.length > MOST_ROUTES) notes.push(`Its requests went ${sorted.length} different ways; the ${sorted.length - MOST_ROUTES} rarest go the commonest way here.`);
  if (skipped) notes.push(`${skipped} ${skipped === 1 ? "call goes" : "calls go"} where the drawing has no arrow (a grouping or a loop left it out), so the replay leaves ${skipped === 1 ? "it" : "them"} out.`);
  if (twice > roots.length * 0.05) notes.push("Some requests reach a part twice and do different things there; the replay has them do the first each time.");

  const routeNames = kept.map((_, i) => `r${i + 1}`);
  const spec: SceneSpec = { ...compiled.spec, nodes: compiled.spec.nodes.map((x) => ({ ...x, client: x.client ? { ...x.client } : undefined })) };
  const node = new Map(spec.nodes.map((x) => [x.id, x]));
  kept.forEach(([, w], i) => {
    const name = routeNames[i];
    const users = node.get(w.users)!;
    users.client!.routes = { ...users.client!.routes, [name]: w.count };
    for (const [s, x] of w.at) {
      const it = node.get(s)!;
      // The times measured there: sixteen steps from fastest to slowest, or each of a few.
      const ms = x.ms.length > SPREAD ? Array.from({ length: SPREAD }, (_, q) => quantile(x.ms, (q + 0.5) / SPREAD)) : [...x.ms].sort((a, b) => a - b);
      // Servers and databases do their route's work; a balancer only sends it on. Caches, queues and topics do as usual.
      if (it.kind === "server" || it.kind === "db") it.paths = { ...it.paths, [name]: { calls: x.steps, ...(ms.length ? { ms: ms.map((v) => Math.max(0.01, v)) } : {}) } };
      else if (it.kind === "lb" && x.steps.length) it.paths = { ...it.paths, [name]: { calls: x.steps } };
    }
  });
  // The trace's times already hold whatever waiting its parts did: each station gets workers enough to be about a third
  // busy with the work measured there, so the replay adds little waiting of its own.
  const total = kept.reduce((sum, [, w]) => sum + w.count, 0);
  const busy = new Map<string, number>();
  for (const [, w] of kept) {
    const rate = (typeof node.get(w.users)!.client!.rate === "number" ? (node.get(w.users)!.client!.rate as number) : 0) * (w.count / Math.max(1, total));
    for (const [st, x] of w.at) busy.set(st, (busy.get(st) ?? 0) + (rate * x.ms.reduce((a, b) => a + b, 0)) / Math.max(1, w.count) / 1000);
  }
  let roomier = 0;
  for (const [st, b] of busy) {
    const it = node.get(st)!;
    const need = Math.ceil(b / ROOM);
    if (it.slots && need > it.slots) {
      it.slots = need;
      it.queueMax = need * 25;
      roomier++;
    }
  }
  if (roomier) notes.push(`The trace's times already include any waiting its parts did, so the replay gives ${roomier === 1 ? "one part" : `${roomier} parts`} workers enough to be about a third busy: it adds little waiting of its own.`);
  // Failures where the trace's failed requests broke, as often per visit as there.
  for (const [s, k] of breaks) node.get(s)!.failRate = k / Math.max(1, visits.get(s) ?? 1);
  // Every rail's wire as measured (out and back, halved), or a data centre's hop where nothing measured it.
  const links: Record<string, number> = {};
  for (const x of spec.nodes)
    for (const c of [...(x.to ?? []), ...(x.calls?.read ?? []), ...(x.calls?.write ?? [])])
      for (const y of flat(c)) {
        const key = x.id < y ? `${x.id}>${y}` : `${y}>${x.id}`;
        links[key] = wires.has(key) ? Math.max(0.01, mean(wires.get(key)!)) : WIRE;
      }
  // People's requests to a queue are jobs, answered once queued: not counted with requests.
  for (const c of spec.nodes) if (c.client && nodes.get(flat(c.to?.[0] ?? "")[0])?.kind === "queue") c.client.tag = "jobs";

  const times = (lat: { lat: number; failed: boolean }[]): Times => ({
    p50: quantile(lat.map((d) => d.lat), 0.5),
    p95: quantile(lat.map((d) => d.lat), 0.95),
    failed: lat.filter((d) => d.failed).length / Math.max(1, lat.length),
  });
  const trace = times(roots.map((i) => ({ lat: dur(i), failed: spans[i].error })));
  // A crossing waits for the next 2 ms tick: slowed enough, a request's crossings add little to it.
  const each = crossings / Math.max(1, roots.length);
  const slow = Math.max(1, Math.min(200, Math.ceil(Math.max(SLOW_TO, (2 * each) / ROUNDING) / Math.max(1, trace.p50))));
  const rate = clients.reduce((s, c) => s + (typeof c.client?.rate === "number" ? c.client.rate : 0), 0);
  const longest = Math.max(2 * roots.reduce((m, i) => Math.max(m, dur(i)), 0), 1600);
  const model = await measureSecond(slowDown({ ...spec, links }, slow, longest, rate), slow, rate);
  if (model) {
    const off = Math.round((100 * Math.abs(model.p95 - trace.p95)) / Math.max(1, trace.p95));
    notes.unshift(
      `Replayed the way the trace's requests went (checked ${slow > 1 ? `${slow} times slower, so the engine's 2 ms steps round nothing` : "as it ran"}), 95 in 100 were answered within ${ms(model.p95)}, against ${ms(trace.p95)} in the trace (${off < 1 ? "under 1" : off}% off); half within ${ms(model.p50)}, against ${ms(trace.p50)}.`,
    );
  }
  // The stage's copy runs at the trace's own speed; calls made together need the engine's gathering, loaded now.
  const live = slowDown({ ...spec, links }, 1, longest, rate);
  await loadModules(needsOf(live));
  return { samples, second: { spec: live, slow, routes: kept.length, trace, model, notes } };
}

/**
 * The scene slowed down `k` times: every time in it k times longer and its traffic k times thinner, so each part is
 * exactly as busy, and the engine's 2 ms ticks round a 1 ms hop by little (k = 1: as it ran). `longest` (trace ms) is
 * the slowest request, so nobody gives up on one the trace answered.
 */
function slowDown(spec: SceneSpec, k: number, longest: number, rate: number): SceneSpec {
  const t = (v: number | undefined) => (v === undefined ? undefined : v * k);
  const was = spec.timeoutMs ?? 1600;
  const timeout = Math.max(was, longest);
  // About a hundred requests in the window the table reads, whatever the traffic.
  const windowMs = Math.max(1000, Math.round((100 / Math.max(1, rate)) * 1000)) * k;
  return {
    ...spec,
    sloMs: spec.sloMs * k,
    timeoutMs: timeout * k,
    windowMs,
    warmMs: (spec.warmMs ?? 0) * k,
    timeScale: (spec.timeScale ?? 0.1) * k,
    links: Object.fromEntries(Object.entries(spec.links ?? {}).map(([key, v]) => [key, typeof v === "number" ? v * k : { ...v, ms: t(v.ms) }])),
    nodes: spec.nodes.map((x) => ({
      ...x,
      serviceMs: t(x.serviceMs),
      ttlMs: t(x.ttlMs),
      lagMs: t(x.lagMs),
      callTimeoutMs: x.callTimeoutMs === undefined ? undefined : Math.round((x.callTimeoutMs * timeout * k) / was),
      health: x.health ? { ...x.health, everyMs: x.health.everyMs * k, timeoutMs: x.health.timeoutMs * k } : undefined,
      ack: x.ack ? { ...x.ack, visibilityMs: x.ack.visibilityMs * k } : undefined,
      paths: x.paths ? Object.fromEntries(Object.entries(x.paths).map(([r, p]) => [r, { ...p, ms: Array.isArray(p.ms) ? p.ms.map((v) => v * k) : t(p.ms) }])) : undefined,
      client: x.client
        ? {
            ...x.client,
            rate: typeof x.client.rate === "number" ? x.client.rate / k : ((f) => (at: number) => f(at / k) / k)(x.client.rate),
            timeoutMs: x.client.timeoutMs === undefined ? undefined : timeout * k,
            retry: x.client.retry ? { ...x.client.retry, baseMs: t(x.client.retry.baseMs) } : undefined,
          }
        : undefined,
    })),
  };
}

/** Run the slowed scene headless for about `MEASURE_REQUESTS` people's requests, and give their times in trace ms. */
export async function measureSecond(spec: SceneSpec, slow: number, rate: number): Promise<Times | null> {
  await loadModules(needsOf(spec));
  const sim = new Sim({ ...spec, warmMs: 0 });
  const warm = 3000 * slow;
  const until = warm + Math.min(60_000, Math.max(10_000, (MEASURE_REQUESTS / Math.max(1, rate)) * 1000)) * slow;
  const seen: { lat: number; failed: boolean }[] = [];
  let last = 0;
  while (sim.t < until) {
    sim.step(Math.min(spec.windowMs ?? 1000, until - sim.t));
    for (const d of sim.done) if (d.t > last && d.t > warm && d.tag === PEOPLE && d.result !== "rejected") seen.push({ lat: d.lat / slow, failed: d.result === "error" });
    last = sim.t;
  }
  if (seen.length < 20) return null;
  const lat = seen.map((d) => d.lat).sort((a, b) => a - b);
  return { p50: lat[Math.floor(lat.length * 0.5)], p95: lat[Math.floor(lat.length * 0.95)], failed: seen.filter((d) => d.failed).length / seen.length };
}
