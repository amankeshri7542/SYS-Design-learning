import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CATALOG, COURSE, FAST_LANE, LINES, PATH, STORIES, entryOf, getLesson, isReady, lessonsOn, neighbours, nextFor } from "../src/lib/lessons";
import { ALL_LESSONS, ALL_STORIES, SCENE_DEFS, STORY_DEFS, lessonOf } from "../src/lib/lessons/all";
import { HERO } from "../src/lib/lessons/hero";
import { SCENES } from "../src/lib/lessons/scenes";
import { STORY_MODULES } from "../src/lib/lessons/stories";
import { holds, type StoryDef } from "../src/lib/lessons/story";
import { GLOSSARY, termOf } from "../src/lib/glossary";
import { termsIn, unresolved, wordCount, type Focus } from "../src/lib/lessons/beats";
import { beatsOf, buildSteps, defaultsOf, headlineOf, type FigureDef, type Lesson, type Values } from "../src/lib/lessons/types";
import { claimOf, stepFiring, walk } from "../src/lib/lessons/walk";
import { Sim } from "../src/lib/sim/engine";
import { betterIs, measure } from "../src/lib/sim/metrics";
import type { SceneSpec } from "../src/lib/sim/types";

const lessons = ALL_LESSONS;
const TONES = ["problem,fix", "problem,explore", "tradeoff,tradeoff", "problem,fix,fix", "problem,fix,tradeoff"];
const LEVEL = { beginner: 0, intermediate: 1, advanced: 2 } as const;

// ------------------------------------------------------------------------------------------------ the catalog

test("catalog: slugs and codes are unique, and every code is the one frozen in tests/catalog.snapshot.json", () => {
  assert.equal(new Set(CATALOG.map((e) => e.slug)).size, CATALOG.length);
  assert.equal(new Set(CATALOG.map((e) => e.code)).size, CATALOG.length);
  const frozen = JSON.parse(readFileSync(new URL("./catalog.snapshot.json", import.meta.url), "utf8")) as Record<string, string>;
  assert.deepEqual(Object.fromEntries(CATALOG.map((e) => [e.slug, e.code])), frozen, "a code changed: codes are frozen once assigned (plan A6)");
});

test("catalog: each line numbers its stations in level order, with its own letter", () => {
  for (const line of LINES) {
    const on = CATALOG.filter((e) => e.line === line.id);
    on.forEach((e, i) => {
      const prefix = line.id === "stories" ? "S" : line.letter;
      assert.match(e.code, new RegExp(`^${prefix}\\d+$`), `${e.slug}: ${e.code} belongs to the ${line.name} line`);
      if (i === 0) return;
      const before = on[i - 1];
      assert.ok(Number(e.code.slice(1)) > Number(before.code.slice(1)), `${line.name}: ${before.code} comes before ${e.code}`);
      if (line.id !== "stories") assert.ok(LEVEL[e.level] >= LEVEL[before.level], `${line.name}: ${e.code} is not easier than ${before.code}`);
    });
  }
  assert.equal(new Set(LINES.map((l) => l.letter)).size, LINES.length, "line letters are unique");
});

test("catalog: every entry has a level, minutes in range, a tag, a short why, and a line that exists", () => {
  for (const e of CATALOG) {
    assert.ok(LINES.some((l) => l.id === e.line), `${e.slug}: line ${e.line}`);
    assert.ok(e.level in LEVEL, `${e.slug}: level`);
    const [lo, hi] = e.kind === "story" ? [15, 25] : [3, 12];
    assert.ok(e.minutes >= lo && e.minutes <= hi, `${e.slug}: ${e.minutes} minutes`);
    assert.ok(e.tags.length >= 1, `${e.slug}: at least one tag`);
    assert.ok(e.why.length < 220, `${e.slug}: why is short`);
    assert.equal(e.kind === "story", e.line === "stories", `${e.slug}: stories, and only stories, are journeys`);
  }
});

test("catalog: the path lists every entry exactly once", () => {
  assert.equal(new Set(PATH).size, PATH.length, "no slug twice");
  assert.deepEqual([...PATH].sort(), CATALOG.map((e) => e.slug).sort());
  assert.deepEqual(
    COURSE.map((e) => e.slug),
    PATH.filter((s) => entryOf(s)!.status === "live"),
    "the live course follows the path",
  );
  for (const s of FAST_LANE) assert.ok(entryOf(s), `fast lane: ${s} is in the catalog`);
});

test("catalog: prerequisites exist, come earlier on the path, form no cycle, and a live entry needs only live ones", () => {
  const at = new Map(PATH.map((s, i) => [s, i]));
  for (const e of CATALOG) {
    for (const r of e.requires ?? []) {
      const p = entryOf(r);
      assert.ok(p, `${e.slug} requires ${r}, which is in the catalog`);
      assert.ok(at.get(r)! < at.get(e.slug)!, `${e.slug} requires ${r}, which comes earlier on the path`);
      if (e.status === "live") assert.equal(p!.status, "live", `${e.slug} is live, so ${r} must be too (or the map dims it for good)`);
    }
  }
  // Earlier-on-the-path already rules out a cycle; check it directly anyway.
  const seen = new Set<string>();
  const visit = (s: string, trail: string[]) => {
    assert.ok(!trail.includes(s), `cycle: ${[...trail, s].join(" → ")}`);
    if (seen.has(s)) return;
    seen.add(s);
    for (const r of entryOf(s)!.requires ?? []) visit(r, [...trail, s]);
  };
  for (const e of CATALOG) visit(e.slug, []);
});

test("catalog: the lazy maps and the all-at-once map hold every live lesson and story, and nothing else", async () => {
  const live = (kind: "lesson" | "story") => COURSE.filter((e) => e.kind === kind).map((e) => e.slug).sort();
  assert.deepEqual(Object.keys(SCENES).sort(), live("lesson"));
  assert.deepEqual(Object.keys(SCENE_DEFS).sort(), live("lesson"));
  assert.deepEqual(Object.keys(STORY_MODULES).sort(), live("story"));
  assert.deepEqual(Object.keys(STORY_DEFS).sort(), live("story"));
  // Each lazy import is the module the tests run.
  for (const [slug, load] of Object.entries(SCENES)) assert.equal((await load()).default, SCENE_DEFS[slug], `${slug}: SCENES loads its scene file`);
  for (const [slug, load] of Object.entries(STORY_MODULES)) assert.equal((await load()).default, STORY_DEFS[slug], `${slug}: STORY_MODULES loads its story`);
});

test("the route: the dock's next stop follows the path, from its first live stop to its last", () => {
  assert.equal(neighbours(COURSE[0].slug).prev, undefined);
  assert.equal(neighbours(COURSE[COURSE.length - 1].slug).next, undefined);
  for (let i = 1; i < COURSE.length; i++) assert.equal(neighbours(COURSE[i - 1].slug).next, COURSE[i]);
  assert.equal(getLesson("request-and-response"), undefined, "a planned lesson has no page yet");
  // Where to go next: the first stop not yet visited, after the one you were on.
  const visited = new Set(COURSE.slice(0, 3).map((e) => e.slug));
  assert.equal(nextFor(null, new Set()), COURSE[0]);
  assert.equal(nextFor(null, visited), COURSE[3]);
  assert.equal(nextFor(COURSE[1].slug, new Set([COURSE[2].slug])), COURSE[3]);
  assert.equal(nextFor(null, new Set(COURSE.map((e) => e.slug))), undefined);
  // A station is dimmed until what it needs has been visited.
  const needy = COURSE.find((e) => e.requires?.length)!;
  assert.equal(isReady(needy.slug, new Set()), false);
  assert.equal(isReady(needy.slug, new Set(needy.requires)), true);
  for (const line of LINES) for (const e of lessonsOn(line.id)) assert.equal(e.status, "live");
});

test("every story rides at least three lessons, its stops are live, and its stages have names and briefs", () => {
  for (const meta of STORIES) {
    assert.ok((meta.requires ?? []).length >= 3, `${meta.slug}: rides at least three lessons`);
    const def = STORY_DEFS[meta.slug];
    assert.ok(def.stages.length >= 3, `${meta.slug}: at least three stages`);
    for (const c of def.controls) assert.ok(c.id in def.start, `${meta.slug}: ${c.id} starts somewhere`);
  }
});

test("every lesson has a one-line why, a problem then a fix (or a trade-off pair), and short takeaways", () => {
  for (const l of lessons) {
    assert.ok(l.why.length < 220, `${l.slug} why is short`);
    assert.ok(l.figures.length >= 2, `${l.slug} has at least two scenes`);
    const tones = l.figures.map((f) => f.tone).join(",");
    assert.ok(TONES.includes(tones), `${l.slug}: ${tones}`);
    assert.ok(l.figures.every((f) => f.short.length <= 16), `${l.slug} step names fit a tab`);
    for (const f of l.figures) {
      assert.ok((f.knobs ?? []).length <= 2, `${l.slug} keeps knobs to two`);
      assert.ok(f.metrics.length <= 4, `${l.slug} keeps metrics to four`);
      assert.ok(f.caption.split(/\s+/).length < 60, `${l.slug} caption is brief`);
    }
  }
});

test("every scene builds and runs at every knob extreme without throwing", () => {
  const figures: FigureDef[] = [HERO, { ...HERO, build: () => HERO.build({ compact: 1 }) }, ...lessons.flatMap((l) => l.figures)];
  for (const f of figures) {
    const corners = [defaultsOf(f)];
    for (const k of f.knobs ?? []) {
      const values = "options" in k ? k.options.map((o) => o.value) : [k.min, k.max];
      for (const v of values) corners.push({ ...defaultsOf(f), [k.id]: v });
    }
    for (const v of corners) {
      const sim = new Sim(f.build(v));
      sim.step(1500);
      for (const a of f.actions ?? []) {
        a.run(sim, true);
        sim.step(200);
        assert.equal(a.isOn(sim), true, `${f.title}: ${a.label} reports its state`);
        a.run(sim, false);
      }
      sim.step(500);
    }
  }
});

test("a fault offered in several steps is one fault: the same label always has the same id", () => {
  for (const l of lessons) {
    const ids = new Map<string, string>();
    for (const f of l.figures) {
      const own = (f.actions ?? []).map((a) => a.id);
      assert.equal(new Set(own).size, own.length, `${l.slug}: action ids are unique within “${f.short}”`);
      for (const a of f.actions ?? []) {
        const id = ids.get(a.label) ?? a.id;
        ids.set(a.label, id);
        assert.equal(a.id, id, `${l.slug}: “${a.label}” has one id in every step`);
      }
    }
  }
});

// Lockstep fairness: the problem and the fix (or both sides of a trade-off) share the clock and the targets,
// and their clients send exactly the same requests at the same moments. Explore figures change the traffic
// on purpose, so they are exempt.
for (const lesson of lessons) {
  const compared = lesson.figures.flatMap((f, i) => (i > 0 && f.tone !== "explore" ? [i] : []));
  if (!compared.length) continue;
  test(`${lesson.code} ${lesson.title}: every step sees the same clock, targets and traffic`, () => {
    const specs = buildSteps(lesson.figures, lesson.figures.map(defaultsOf));
    const trace = (spec: SceneSpec) => {
      const sim = new Sim(spec, { trace: true });
      sim.step(5000);
      return sim.trace;
    };
    const first = trace(specs[0]);
    assert.ok(first.length > 50, `${lesson.slug}: the first step has traffic`);
    for (const i of compared) {
      for (const k of ["sloMs", "timeoutMs", "timeScale", "windowMs"] as const)
        assert.equal(specs[i][k], specs[0][k], `${lesson.slug}: “${lesson.figures[i].short}” has the same ${k}`);
      assert.deepEqual(trace(specs[i]), first, `${lesson.slug}: “${lesson.figures[i].short}” sees the same arrivals`);
    }
  });
}

// The teaching claim of each lesson: the second step measurably beats the first on its headline metric.
for (const lesson of lessons) {
  const [, fix] = lesson.figures;
  if (!fix || fix.tone === "explore") continue;
  test(`${lesson.code} ${lesson.title}: the fix beats the problem`, () => {
    const label = headlineOf(lesson.figures);
    const metric = fix.metrics.find((m) => m.label === label);
    assert.ok(metric, `${lesson.slug}: the headline “${label}” is one of the fix's metrics`);
    assert.notEqual(betterIs(metric), "neutral", `${lesson.slug}: the headline has a better direction`);
    const claim = claimOf(lesson)!;
    assert.ok(claim.gain > 0.08, `${metric.label}: fix ${claim.fix.toFixed(3)} vs without ${claim.problem.toFixed(3)}`);
  });
}

// ------------------------------------------------------------------------------------------------ beats

const words = (t: string) => wordCount(t);
const isPart = (f: FigureDef) => new Set((f.parts ?? []).map((_, i) => `part-${i}`));

/** Everything a learner reads, in the order they meet it: the hook, then each step, then the Recap. */
function readingOrder(l: Lesson): { where: string; text: string; names?: string }[] {
  const out: { where: string; text: string; names?: string }[] = [];
  const p = l.figures.find((f) => f.predict)?.predict;
  if (l.hook) out.push({ where: "hook", text: l.hook });
  l.figures.forEach((f, i) => {
    out.push({ where: `${i + 1} title`, text: f.title }, { where: `${i + 1} caption`, text: f.caption });
    for (const b of beatsOf(f)) {
      if (f.predict && b.id === f.predict.before) for (const t of [f.predict.prompt, ...f.predict.options]) out.push({ where: `${i + 1} predict`, text: t });
      out.push({ where: `${i + 1} ${b.id}`, text: b.text, names: b.term });
      if (p && b.id === p.reveal.beat) out.push({ where: `${i + 1} reveal`, text: p.reveal.text });
    }
    if (f.predict?.before === "end") for (const t of [f.predict.prompt, ...f.predict.options]) out.push({ where: `${i + 1} predict`, text: t });
  });
  for (const c of l.checks ?? []) for (const t of [c.prompt, ...c.options, c.why]) out.push({ where: "check", text: t });
  for (const t of [l.takeaways.use, l.takeaways.catch, l.takeaways.seen, l.takeaways.rule ?? "", l.takeaways.interview ?? ""]) out.push({ where: "takeaways", text: t });
  return out;
}

/** Every rule of the beat structure (docs/plan-v3.md §8) a lesson breaks, as readable lines. Empty when it is ready. */
function beatProblems(l: Lesson): string[] {
  const bad: string[] = [];
  const specs = buildSteps(l.figures, l.figures.map(defaultsOf));
  const table = new Set(l.figures.flatMap((f) => f.metrics.map((m) => m.label)));
  const tags = new Set(l.figures.flatMap((f) => f.metrics.flatMap((m) => (m.tag ? [m.tag] : []))));
  const ids = l.figures.flatMap((f) => beatsOf(f).filter((b) => !b.part).map((b) => b.id));
  if (new Set(ids).size !== ids.length) bad.push("beat ids repeat");
  if (!l.hook || words(l.hook) > 16) bad.push("a hook of at most 16 words");
  if (!l.level || !l.minutes) bad.push("a level and minutes");
  if (!l.dots?.length) bad.push("a local key (dots)");
  if (!l.takeaways.rule || words(l.takeaways.rule) > 8) bad.push(`a rule of at most 8 words: “${l.takeaways.rule}”`);
  const checks = l.checks ?? [];
  if (checks.length < 1 || checks.length > 2) bad.push("one or two checks");
  for (const c of checks) {
    if (c.options.length < 2 || c.options.length > 3 || c.answer >= c.options.length) bad.push(`check “${c.prompt}” has 2–3 options and a valid answer`);
    if (words(c.why) > 25) bad.push(`check why is ${words(c.why)} words`);
  }
  if (l.figures.filter((f) => f.predict).length !== 1) bad.push("one prediction");
  l.figures.forEach((f, i) => {
    const spec = specs[i];
    const nodes = new Set(spec.nodes.map((n) => n.id));
    const where = `${l.slug} step ${i + 1}`;
    if (words(f.caption) > 25) bad.push(`${where}: caption is ${words(f.caption)} words`);
    const own = (f.beats ?? []).length;
    if (own < 3 || own > 6) bad.push(`${where}: ${own} beats (3–6)`);
    for (const p of f.parts ?? []) {
      if (words(p.text) > 9) bad.push(`${where}: build line “${p.text}” is ${words(p.text)} words`);
      for (const n of [p.node].flat()) if (!nodes.has(n)) bad.push(`${where}: build line names a missing station ${n}`);
    }
    const parts = isPart(f);
    for (const b of beatsOf(f)) {
      if (!parts.has(b.id) && words(b.text) > 16) bad.push(`${where}: beat ${b.id} is ${words(b.text)} words`);
      const fo: Focus = b.focus ?? {};
      for (const n of [...(fo.nodes ?? []), ...(fo.link ?? [])]) if (!nodes.has(n)) bad.push(`${where}: beat ${b.id} points at a missing station ${n}`);
      if (fo.metric && !table.has(fo.metric)) bad.push(`${where}: beat ${b.id} points at a missing row ${fo.metric}`);
      if (fo.knob && !f.knobs?.some((k) => k.id === fo.knob)) bad.push(`${where}: beat ${b.id} points at a missing knob ${fo.knob}`);
      if (fo.action && !f.actions?.some((a) => a.id === fo.action)) bad.push(`${where}: beat ${b.id} points at a missing fault ${fo.action}`);
      const missing = unresolved(b.text, { tones: l.figures.map((g) => g.tone), current: i, nodes: specs.map((s) => new Set(s.nodes.map((n) => n.id))), tags });
      if (missing.length) bad.push(`${where}: beat ${b.id} reads unknown numbers ${missing.join(" ")}`);
      if (b.term && !b.text.includes(`[[${b.term}`)) bad.push(`${where}: beat ${b.id} names ${b.term} but doesn't mark it`);
      if (!b.focus) bad.push(`${where}: beat ${b.id} points at nothing`);
    }
    if (f.break) {
      if (!f.actions?.some((a) => a.id === f.break!.action)) bad.push(`${where}: the break's fault is not a button here`);
      if (!beatsOf(f).some((b) => b.id === f.break!.beat)) bad.push(`${where}: the break's beat is missing`);
    }
    const p = f.predict;
    if (p) {
      if (p.options.length < 2 || p.options.length > 3 || p.answer >= p.options.length) bad.push(`${where}: prediction has 2–3 options and a valid answer`);
      if (p.before !== "end" && !beatsOf(f).some((b) => b.id === p.before)) bad.push(`${where}: prediction comes before a missing beat`);
      if (!l.figures.some((g) => beatsOf(g).some((b) => b.id === p.reveal.beat))) bad.push(`${where}: prediction is revealed by a missing beat`);
    }
    if (f.headline) {
      if (words(f.headline.sentence) > 25) bad.push(`${where}: headline sentence is ${words(f.headline.sentence)} words`);
      const missing = unresolved(f.headline.sentence, { tones: l.figures.map((g) => g.tone), current: i, nodes: specs.map((s) => new Set(s.nodes.map((n) => n.id))), tags });
      if (missing.length) bad.push(`${where}: headline reads unknown numbers ${missing.join(" ")}`);
    }
  });
  if (!l.figures.some((f) => f.headline)) bad.push("a headline sentence");
  // Terms: each is in the glossary, and nothing uses a term (marked or in plain words) before it is first marked.
  const order = readingOrder(l);
  const marked = new Set(order.flatMap((o) => termsIn(o.text)));
  for (const key of marked) {
    const term = termOf(key);
    if (!term) {
      bad.push(`term ${key} is not in the glossary`);
      continue;
    }
    const plain = new RegExp(`\\b(${[term.name, key.replace(/-/g, " ")].map((w) => w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(e?s)?\\b`, "i");
    const first = order.findIndex((o) => termsIn(o.text).includes(key) || plain.test(o.text.replace(/\[\[[^\]]*\]\]|\{[^}]*\}/g, "")));
    if (first >= 0 && !termsIn(order[first].text).includes(key)) bad.push(`“${term.name}” is used in ${order[first].where} before it is named`);
  }
  for (const o of order) if (o.names && !marked.has(o.names)) bad.push(`${o.where} names ${o.names} without marking it`);
  return bad;
}

for (const lesson of lessons) {
  test(`${lesson.code} ${lesson.title}: beats follow the authoring rules`, () => {
    assert.deepEqual(beatProblems(lesson), []);
  });
  test(`${lesson.code} ${lesson.title}: every beat fires in a learner's run, and the prediction comes true`, () => {
    const w = walk(lesson);
    assert.deepEqual(w.missing, [], `${lesson.slug}: beats that never fired`);
    assert.equal(w.prediction?.holds, true, `${lesson.slug}: prediction before ${w.prediction?.before}, after ${w.prediction?.after}`);
    // Beats that read numbers find them: nothing shows as “—”.
    for (const b of w.fired) assert.ok(!b.text.includes("—"), `${lesson.slug}: ${b.id} reads a number that isn't there yet: “${b.text}”`);
  });
}

test("the hero's looping beats point at stations that exist, in the full scene and the phone's", () => {
  assert.equal(HERO.beats?.length, 3);
  assert.ok(words(HERO.caption) <= 25, "the hero's caption is 25 words or fewer");
  for (const compact of [0, 1]) {
    const hero = HERO.build({ compact });
    const ids = new Set(hero.nodes.map((n) => n.id));
    for (const b of HERO.beats ?? []) {
      assert.ok(words(b.text) <= 16, `hero: ${b.id}`);
      for (const n of b.focus?.nodes ?? []) assert.ok(ids.has(n), `hero (compact ${compact}): ${b.id} points at ${n}`);
      if ("note" in b.when) assert.ok(hero.script?.events.some((e) => e.label === (b.when as { note: string }).note), `hero: ${b.id}'s event is in the loop`);
    }
  }
});

for (const { meta, def } of ALL_STORIES) {
  test(`${meta.code} ${meta.title}: each stage opens with two beats that point at stations it has`, () => {
    def.stages.forEach((stage, i) => {
      assert.equal(stage.beats.length, 2, `stage ${i + 1} opens with two beats`);
      const nodes = new Set(def.scene(def.start, stage).nodes.map((n) => n.id));
      for (const b of stage.beats) {
        assert.ok(words(b.text) <= 16, `stage ${i + 1}: ${b.id}`);
        for (const n of b.focus?.nodes ?? []) assert.ok(nodes.has(n), `stage ${i + 1}: ${b.id} points at ${n}`);
      }
    });
  });

  test(`${meta.code} ${meta.title}: each stage needs the next idea, and the design it was made for clears it`, () => {
    const need = (i: number) => def.stages[i].hold * 1000 * (def.scene(def.start, def.stages[i]).timeScale ?? 0.1);
    def.stages.forEach((stage, i) => {
      assert.ok(bestStreak(def, stage.solution, i) >= need(i), `stage ${i + 1} is clearable`);
      if (i > 0) assert.ok(bestStreak(def, def.stages[i - 1].solution, i) < need(i), `stage ${i + 1} needs a change`);
    });
  });
}

test("every glossary term is named by a lesson, and its Show me points at something in that lesson", () => {
  const named = new Set(lessons.flatMap((l) => l.figures.flatMap((f) => beatsOf(f).flatMap((b) => termsIn(b.text)))));
  for (const t of GLOSSARY.values()) {
    if (t.key !== "p95") assert.ok(named.has(t.key), `${t.key} is named somewhere`);
    assert.ok(words(t.short) <= 20, `${t.key}: short definition`);
    if (!t.show) continue;
    const l = lessonOf(t.show.lesson);
    assert.ok(l, `${t.key}: shown in ${t.show.lesson}`);
    const nodes = new Set(buildSteps(l!.figures, l!.figures.map(defaultsOf)).flatMap((s) => s.nodes.map((n) => n.id)));
    for (const n of [...(t.show.focus.nodes ?? []), ...(t.show.focus.link ?? [])]) assert.ok(nodes.has(n), `${t.key}: shows ${n}`);
  }
});

test("D4: a hash ring moves far fewer keys than hash % N", () => {
  const l = lessonOf("consistent-hashing")!;
  const moved = (f: FigureDef) => {
    const sim = new Sim(f.build(defaultsOf(f)));
    stepFiring(sim, 2400);
    return measure(sim, f.metrics[2])!;
  };
  assert.ok(moved(l.figures[0]) > 0.6);
  assert.ok(moved(l.figures[1]) < 0.35);
});

/** Longest run of simulated ms in which a story's design holds its target at a stage. */
function bestStreak(def: StoryDef, design: Values, stage: number) {
  const sim = new Sim(def.scene(design, def.stages[stage]));
  let streak = 0;
  let best = 0;
  for (let t = 0; t < 8000; t += 50) {
    sim.step(50);
    if (t < 600) continue;
    if (holds(def.targets, (m) => measure(sim, m))) best = Math.max(best, (streak += 50));
    else streak = 0;
  }
  return best;
}
