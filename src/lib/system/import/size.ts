// Sizing an imported system. A file says what talks to what, and rarely how many workers each part has, so the course's
// defaults could leave a part overloaded before anything breaks. Each part that does work and wasn't given a size gets
// enough workers to run about 60% busy under the traffic it was given, measured on a headless run of the engine; the
// notes say what changed, so the person can set their own numbers.

import { Sim, loadModules, needsOf } from "../../sim/engine/core";
import { PEOPLE, compile } from "../compile";
import { settingsOf, type PartDoc, type SystemDoc } from "../doc";

const SIZED = ["service", "worker", "database", "external"];
/** How busy a part should start. */
const AIM = 0.6;
/** Busier than this is resized. */
const OVER = 0.75;
/** Each round runs this long, in simulated ms, and is measured after the first `FROM`. */
const RUN = 4000;
const FROM = 1500;
const ROUNDS = 6;
/** The most workers a part can have (as `validate` says). */
const MOST = 64;

/** How busy each part was over a run (the busiest of its stations), whether its line kept growing, the middle and
 * slowest 1 in 20 of people's answers, and the work done for each of them on average (ms, every part's together). */
export async function measure(doc: SystemDoc): Promise<{ parts: Map<string, { busy: number; full: boolean }>; p50: number; p95: number; work: number } | null> {
  const c = compile(doc);
  if (!c.spec) return null;
  await loadModules(needsOf(c.spec));
  const sim = new Sim({ ...c.spec, windowMs: 1e9, warmMs: 0 });
  const sums = new Map<string, number>();
  let samples = 0;
  while (sim.t < RUN) {
    sim.step(100);
    if (sim.t <= FROM) continue;
    samples++;
    for (const n of sim.list) if (n.spec.slots) sums.set(n.spec.id, (sums.get(n.spec.id) ?? 0) + (n.work.length + n.held.length) / n.spec.slots);
  }
  const out = new Map<string, { busy: number; full: boolean }>();
  for (const n of sim.list) {
    const part = c.partOf.get(n.spec.id);
    if (!part || !n.spec.slots) continue;
    const busy = (sums.get(n.spec.id) ?? 0) / Math.max(1, samples);
    const full = busy > 0.95 && n.queue.length > n.spec.slots;
    const had = out.get(part);
    out.set(part, { busy: Math.max(busy, had?.busy ?? 0), full: full || !!had?.full });
  }
  const answered = sim.done.filter((d) => d.t > FROM && d.tag === PEOPLE && d.result === "ok");
  const lat = answered.map((d) => d.lat).sort((a, b) => a - b);
  const work = answered.reduce((s, d) => s + d.work, 0) / Math.max(1, answered.length);
  return { parts: out, p50: lat[Math.floor(lat.length * 0.5)] ?? 0, p95: lat[Math.floor(lat.length * 0.95)] ?? 0, work };
}

/** The same system with workers enough for its traffic, and what was changed, in words. */
export async function sized(doc: SystemDoc): Promise<{ doc: SystemDoc; notes: string[] }> {
  // Only parts that do work and weren't given a number of workers.
  const open = new Set(doc.parts.filter((p) => SIZED.includes(p.kind) && p.set?.workers === undefined).map((p) => p.id));
  let cur = doc;
  for (let round = 0; round < ROUNDS && open.size; round++) {
    const m = await measure(cur);
    if (!m) break;
    let changed = false;
    const parts = cur.parts.map((p) => {
      const r = m.parts.get(p.id);
      if (!r || !open.has(p.id) || (r.busy <= OVER && !r.full)) return p;
      const w = settingsOf(p).workers;
      const next = Math.min(MOST, r.full ? w * 2 : Math.ceil((w * r.busy) / AIM));
      if (next === w) return p;
      changed = true;
      return { ...p, set: { ...p.set, workers: next } };
    });
    cur = { ...cur, parts };
    if (!changed) break;
  }
  const was = (p: PartDoc) => settingsOf(doc.parts.find((q) => q.id === p.id)!).workers;
  const grown = cur.parts.filter((p) => settingsOf(p).workers !== was(p));
  const notes = grown.length
    ? [`Workers are set so each part starts about ${AIM * 100}% busy: ${grown.map((p) => `${p.name} ${was(p)} → ${settingsOf(p).workers}`).join(", ")}. Change them to match yours.`]
    : [];
  // What "working" means: if it already takes longer than the usual target, about half again what it takes now, so an
  // outage shows as a change from how it runs.
  const p95 = (await measure(cur))?.p95 ?? 0;
  if (p95 > cur.targets.p95Ms) {
    const target = Math.ceil((p95 * 1.5) / 100) * 100;
    cur = { ...cur, targets: { ...cur.targets, p95Ms: target } };
    notes.push(`Its slowest 1 in 20 take about ${Math.round(p95)} ms, so working means answered within ${target} ms. Set your own under “Working means”.`);
  }
  return { doc: cur, notes };
}
