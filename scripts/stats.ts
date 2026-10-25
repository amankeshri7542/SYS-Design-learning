// Reads learning records exported from /progress and prints, per lesson, the numbers to tune it by
// (docs/research/pedagogy.md §5).
//
//   npm run stats -- <export.json> [more.json…]
//
// Several exports (several learners) are added together. Each lesson shows how many opened it, how many predictions
// were right (aim for 50–70%: a prompt everyone gets is too easy, one nobody gets isn't set up), checks right on the
// first try (aim for 60–80%), the share of its beats seen, how many reached the Recap, and how it felt. Numbers outside
// their aim are marked with a "!".
import { readFileSync } from "node:fs";
import { ALL_LESSONS, ALL_STORIES } from "../src/lib/lessons/all";
import { beatsOf } from "../src/lib/lessons/types";
import type { RecordEvent, Tally } from "../src/lib/record";

interface Export {
  events?: RecordEvent[];
  tallies?: Record<string, Tally>;
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: npm run stats -- <export.json> [more.json…]");
  process.exit(1);
}

type Row = { learners: number; opened: number; predicted: number; right: number; checks: number; checksRight: number; recap: number; stages: number[]; seen: Set<string>; feel: Record<string, number>; metrics: Record<string, number>; terms: Record<string, number> };
const rows = new Map<string, Row>();
const row = (slug: string) => {
  let r = rows.get(slug);
  if (!r) rows.set(slug, (r = { learners: 0, opened: 0, predicted: 0, right: 0, checks: 0, checksRight: 0, recap: 0, stages: [], seen: new Set(), feel: {}, metrics: {}, terms: {} }));
  return r;
};

for (const file of files) {
  const data = JSON.parse(readFileSync(file, "utf8")) as Export;
  for (const [slug, t] of Object.entries(data.tallies ?? {})) {
    const r = row(slug);
    r.learners++;
    r.opened += t.opened;
    r.predicted += t.predicted;
    r.right += t.predictedRight;
    r.checks += t.checks;
    r.checksRight += t.checksRight;
    if (t.recap) r.recap++;
    r.stages.push(...(t.stages ?? []));
    for (const b of t.beats) r.seen.add(`${file}:${b}`);
    if (t.feel) r.feel[t.feel] = (r.feel[t.feel] ?? 0) + 1;
  }
  for (const e of data.events ?? []) {
    const r = row(e.lesson);
    if (e.kind === "metric") r.metrics[String(e.data?.label)] = (r.metrics[String(e.data?.label)] ?? 0) + 1;
    if (e.kind === "term") r.terms[String(e.data?.key)] = (r.terms[String(e.data?.key)] ?? 0) + 1;
  }
}

const pct = (n: number, of: number, lo?: number, hi?: number) => {
  if (!of) return "—";
  const p = Math.round((100 * n) / of);
  const off = lo !== undefined && hi !== undefined && (p < lo || p > hi);
  return `${p}%${off ? "!" : ""} (${n}/${of})`;
};
const top = (counts: Record<string, number>) =>
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, n]) => `${k} ×${n}`)
    .join(", ");

const beatsIn = new Map(ALL_LESSONS.map((l) => [l.slug, l.figures.reduce((n, f) => n + beatsOf(f).length, 0)]));
for (const l of ALL_LESSONS) {
  const r = rows.get(l.slug);
  if (!r) continue;
  const beats = (beatsIn.get(l.slug) ?? 0) * r.learners;
  console.log(`${l.code.padEnd(4)} ${l.title}`);
  console.log(`     learners ${r.learners} · opened ${r.opened} · predictions right ${pct(r.right, r.predicted, 50, 70)} · checks right first try ${pct(r.checksRight, r.checks, 60, 80)}`);
  console.log(`     beats seen ${pct(r.seen.size, beats)} · reached the Recap ${r.recap} · felt ${top(r.feel) || "—"}`);
  if (Object.keys(r.metrics).length) console.log(`     metrics opened: ${top(r.metrics)}`);
  if (Object.keys(r.terms).length) console.log(`     terms opened: ${top(r.terms)}`);
}
// Journeys: how many opened each, and how far they got (how many cleared each stage).
for (const { meta, def } of ALL_STORIES) {
  const r = rows.get(meta.slug);
  if (!r) continue;
  const cleared = def.stages.map((s, i) => `${s.name} ${r.stages.filter((x) => x === i).length}`).join(" · ");
  console.log(`${meta.code.padEnd(4)} ${meta.title}`);
  console.log(`     opened ${r.opened} · stages cleared: ${cleared}`);
}

