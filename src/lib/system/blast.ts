// "What breaks if X dies?": measured, not guessed. For each part, a copy of the system runs headless with that part
// down, beside one where nothing breaks, and the difference is told in a sentence. The engine is deterministic, so the
// same system always gets the same answer.

import { Sim } from "../sim/engine/core";
import type { Done } from "../sim/engine/model";
import { PEOPLE, compile, type Compiled } from "./compile";
import { settingsOf, type PartDoc, type SystemDoc } from "./doc";
import { outage } from "./outage";

/** When the part goes down, and how long the outage is watched, in simulated ms. */
const WARM = 1500;
const DOWN = 3000;
/** Answers in the first moments of an outage are often still the old ones: measure from a little after it starts. */
const SETTLE = 400;

export type Verdict = "spof" | "hurts" | "slower" | "fine";

export interface Blast {
  part: string;
  /** What dies, as a phrase: "Database (its main copy)", "one of 3 App copies". */
  what: string;
  verdict: Verdict;
  /** The share of people's requests failing (or given up on) while it is down. */
  failed: number;
  /** The slowest 1 in 20 while it is down, in ms (null when nothing was answered). */
  p95: number | null;
  /** Jobs waiting in queues by the end, beyond what waits without the outage. */
  piled: number;
  text: string;
  /** What people usually do about it, when it hurts. */
  fix?: string;
  /** The same system with that fix, when it is one the builder can make. */
  fixed?: SystemDoc;
}

export interface BlastReport {
  baseline: { failed: number; p95: number | null };
  parts: Blast[];
}

function percentile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}

/**
 * How a run went over the outage's window, for people's requests (bots' are left out: turning them away is the point):
 * failures, the slowest 1 in 20, and jobs waiting in queues at the end.
 */
function readRun(sim: Sim, from: number, to: number) {
  const done = sim.done.filter((d: Done) => d.t > from && d.t <= to && d.tag === PEOPLE);
  const failed = done.filter((d) => d.result === "error").length / Math.max(1, done.length);
  const p95 = percentile(
    done.filter((d) => d.result !== "rejected" && d.result !== "error").map((d) => d.lat),
    0.95,
  );
  const queued = sim.list.filter((n) => n.spec.kind === "queue").reduce((sum, n) => sum + n.queue.length, 0);
  return { failed, p95, queued };
}

function run(c: Compiled, down: string[] = []) {
  const sim = new Sim({ ...c.spec, windowMs: 1e9, warmMs: 0 });
  sim.step(WARM);
  for (const id of down) sim.setUp(id, false);
  sim.step(DOWN);
  return readRun(sim, WARM + SETTLE, WARM + DOWN);
}


/** The usual remedy for a part whose outage hurts, and the doc with it applied when the builder can draw it. */
function fixOf(p: PartDoc, doc: SystemDoc): { fix: string; fixed?: SystemDoc } | undefined {
  const s = settingsOf(p);
  const swap = (q: PartDoc): SystemDoc => ({ ...doc, parts: doc.parts.map((x) => (x.id === p.id ? q : x)) });
  switch (p.kind) {
    case "service":
    case "worker":
      return (p.count ?? 1) === 1 ? { fix: "Run two copies: one keeps going when the other dies.", fixed: swap({ ...p, count: 2 }) } : undefined;
    case "database":
      return s.shards > 1
        ? { fix: "Give each shard a copy that can take over." }
        : s.replicas > 0 && !s.failover
          ? { fix: "Let a read copy take over when the main copy dies.", fixed: swap({ ...p, set: { ...p.set, failover: true } }) }
          : { fix: "Keep a copy that takes over when the main copy dies.", fixed: swap({ ...p, set: { ...p.set, replicas: Math.max(1, s.replicas), failover: true } }) };
    case "balancer":
    case "dns":
      return { fix: "Real ones run in pairs, sharing an address that moves to the one still standing." };
    case "limiter":
      return { fix: "Run the limit inside every server, or let traffic through when the limiter is down." };
    case "cache":
      return { fix: "Fall back to the database on a miss or an error, and run the cache as a cluster." };
    case "cdn":
      return { fix: "Send users to the next-nearest edge when theirs is down." };
    case "queue":
    case "topic":
      return { fix: "Use a queue that keeps copies on several machines (most managed ones do)." };
    case "external":
      return { fix: "Give up on it quickly, and serve something useful without it." };
    default:
      return undefined;
  }
}

const pct = (v: number) => (v > 0 && v < 0.01 ? "under 1%" : `${Math.round(v * 100)}%`);
const msText = (v: number) => (v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(1)} s`);

/** Each part's outage, worst first. `onPart` hears of each as it is measured. Null when the doc doesn't compile. */
export function blastRadius(doc: SystemDoc, onPart?: (b: Blast) => void): BlastReport | null {
  const c = compile(doc);
  if (!c.spec) return null;
  const compiled = c as Compiled;
  const base = run(compiled);
  const { p95Ms, failed: allowed } = doc.targets;
  const parts: Blast[] = [];
  for (const p of doc.parts) {
    if (p.kind === "users" || p.kind === "bots") continue;
    const o = outage(p, compiled, doc);
    const variant = o.doc ? compile(o.doc) : compiled;
    if (!variant.spec) continue;
    const r = run(variant as Compiled, o.down);
    const piled = Math.max(0, r.queued - base.queued);
    const extraFail = Math.max(0, r.failed - base.failed);
    const verdict: Verdict = extraFail >= 0.5 ? "spof" : extraFail > Math.max(allowed, 0.02) ? "hurts" : r.p95 !== null && r.p95 > p95Ms && (base.p95 ?? 0) <= p95Ms ? "slower" : "fine";
    const single = (p.count ?? 1) === 1;
    const origin = doc.parts.find((q) => q.id === p.to?.[0])?.name ?? "the database";
    const unless =
      p.kind === "cache" ? ` (Unless your code asks ${origin} directly when the cache is down.)` : p.kind === "cdn" ? " (Unless users fall back to the origin.)" : "";
    const text =
      verdict === "spof"
        ? `${pct(r.failed)} of requests fail while it is down: nothing takes its place.${unless}`
        : verdict === "hurts"
          ? `${pct(r.failed)} of requests fail while it is down.${unless}`
          : verdict === "slower"
            ? `Nothing fails, but the slowest 1 in 20 take ${msText(r.p95!)}, past the ${msText(p95Ms)} target.`
            : piled > 5
              ? `Users don't notice: jobs wait in the queue until it is back (${piled} by the end).`
              : p.kind === "worker" && single
                ? "Users don't notice, but the work it does stops while it is down."
                : "Barely noticed: the rest carry on.";
    const fix = verdict === "spof" || verdict === "hurts" ? fixOf(p, doc) : undefined;    const b: Blast = { part: p.id, what: o.what, verdict, failed: r.failed, p95: r.p95, piled, text, ...fix };
    parts.push(b);
    onPart?.(b);
  }
  const rank: Record<Verdict, number> = { spof: 0, hurts: 1, slower: 2, fine: 3 };
  parts.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.failed - a.failed);
  return { baseline: { failed: base.failed, p95: base.p95 }, parts };
}
