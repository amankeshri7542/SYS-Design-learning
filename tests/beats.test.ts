import assert from "node:assert/strict";
import { test } from "node:test";
import { lessonOf } from "../src/lib/lessons/all";
import { BeatRunner, GRID, fillIn, placeholdersIn, plainText, sequenceOf, stepGrid, termsIn, unresolved, wordCount, type Beat } from "../src/lib/lessons/beats";
import { beatsOf, buildSteps, defaultsOf, holdsTraffic } from "../src/lib/lessons/types";
import { walk } from "../src/lib/lessons/walk";
import { Sim } from "../src/lib/sim/engine";
import { measure } from "../src/lib/sim/metrics";
import type { NodeSpec, SceneSpec } from "../src/lib/sim/types";

// Beats fire from the simulation alone: the same beats at the same simulated moments at any speed, on any machine.

const node = (id: string, extra: Partial<NodeSpec> = {}): NodeSpec => ({ id, kind: "server", label: id, at: [50, 50], slots: 4, serviceMs: 50, ...extra });
const scene = (extra: Partial<SceneSpec> = {}): SceneSpec => ({
  nodes: [{ id: "u", kind: "client", label: "Users", at: [0, 50], client: { rate: 30, keys: 50 }, to: ["s"] }, node("s")],
  sloMs: 400,
  timeoutMs: 1600,
  seed: 3,
  ...extra,
});

/** Run a lesson's first step frame by frame at a given frame length, firing beats on the grid as the player does. */
function play(slug: string, frameMs: number, until = 6000) {
  const lesson = lessonOf(slug)!;
  const f = lesson.figures[0];
  const sims = buildSteps(lesson.figures, lesson.figures.map(defaultsOf)).map((s) => new Sim(s));
  if (holdsTraffic(lesson.figures)) for (const s of sims) s.hold();
  for (const s of sims) s.step(400);
  const r = new BeatRunner(beatsOf(f), { timeScale: 0.1, askBefore: f.predict?.before, onStart: () => sims.forEach((s) => s.start()) });
  const fired: string[] = [];
  while (sims[0].t < until && !r.done) {
    stepGrid(sims, frameMs, (ss) => {
      const b = r.tick(ss[0], false, ss);
      if (b) fired.push(`${b.beat.id}@${b.t}`);
      // The learner moves on at once: release pauses, answer the question, press the break.
      if (r.waiting === "beat") {
        if (f.break && r.current?.beat.id === f.break.beat) lesson.figures.forEach((g, j) => g.actions?.find((a) => a.id === f.break!.action)?.run(ss[j], true));
        r.release();
      }
      if (r.waiting === "ask") r.answer();
      return false;
    });
  }
  return fired;
}

test("beats fire at the same simulated moments whatever the frame rate and speed", () => {
  for (const slug of ["latency-and-throughput", "caching", "retries-and-backoff"]) {
    // 60 fps at 1× (1.67 ms of simulated time a frame), at 2×, at 0.5×, and a slow 10 fps machine at 2×.
    const runs = [1000 / 60 / 10, 1000 / 60 / 5, 1000 / 60 / 20, 20].map((ms) => play(slug, ms));
    assert.ok(runs[0].length >= 4, `${slug}: beats fired (${runs[0].join(", ")})`);
    for (const r of runs.slice(1)) assert.deepEqual(r, runs[0], `${slug}: same beats, same moments`);
    for (const b of runs[0]) assert.equal(Number(b.split("@")[1]) % GRID, 0, `${slug}: ${b} fired on the grid`);
  }
});

test("stepping on the grid gives exactly the run that one big step gives", () => {
  const a = new Sim(scene());
  const b = new Sim(scene());
  a.step(3000);
  let stops = 0;
  // Frames of an odd length, each stopping at every grid point on the way.
  for (let i = 0; i < 300; i++) stepGrid([b], 10, () => (stops++, false));
  assert.equal(stops, 300);
  assert.equal(b.t, a.t);
  assert.ok(a.done.length > 50);
  assert.deepEqual(b.done, a.done);
  const c = new Sim(scene());
  for (let ms = 0; ms < 3000; ms += 7.3) stepGrid([c], Math.min(7.3, 3000 - ms), () => false);
  assert.deepEqual(c.done, a.done);
});

test("an armed event never runs from the loop; fire() plays its sequence once, in every world it is fired in", () => {
  const stalled: number[] = [];
  const spec = scene({
    script: {
      loopMs: 1000,
      events: [
        { at: 100, label: "Stall", armed: true, node: "s", run: (s) => (stalled.push(s.t), s.setUp("s", false)) },
        { at: 400, label: "Back", armed: true, node: "s", run: (s) => s.setUp("s", true) },
      ],
    },
  });
  const sim = new Sim(spec);
  sim.step(3000);
  assert.deepEqual(stalled, [], "nothing fires by itself");
  assert.equal(sim.fire("Stall"), true);
  assert.equal(sim.nodes.get("s")!.up, false, "it runs at once");
  assert.deepEqual(sim.pending.map((p) => [p.label, p.at - sim.t, p.node]), [["Back", 300, "s"]], "the rest of the run waits, keeping its spacing");
  sim.step(299);
  assert.equal(sim.nodes.get("s")!.up, false);
  sim.step(2);
  assert.equal(sim.nodes.get("s")!.up, true);
  assert.deepEqual(sim.pending, []);
  sim.step(3000);
  assert.equal(stalled.length, 1, "and never loops");
  assert.equal(sim.fire("Nope"), false);
  assert.deepEqual(
    sim.notes.map((n) => n.text),
    ["Stall", "Back"],
  );
});

test("held clients send nothing until started, and both worlds then send the same requests", () => {
  const worlds = [new Sim(scene(), { trace: true }), new Sim(scene({ nodes: [...scene().nodes, node("x", { at: [80, 50] })] }), { trace: true })];
  for (const w of worlds) w.hold();
  for (const w of worlds) w.step(500);
  assert.equal(worlds[0].trace.length, 0);
  assert.equal(worlds[0].started, false);
  for (const w of worlds) w.start();
  for (const w of worlds) w.step(2000);
  assert.ok(worlds[0].trace.length > 30);
  assert.deepEqual(worlds[1].trace, worlds[0].trace);
});

test("Succeeded reads 0%, not “no data”, when requests went out for a whole window and none came back", () => {
  const sim = new Sim(scene({ nodes: [{ ...scene().nodes[0], client: { rate: 30, keys: 50, timeoutMs: 5000 } }, node("s", { slots: 0 })], windowMs: 700 }));
  sim.step(2000);
  assert.equal(measure(sim, { id: "answered", label: "" }), 0);
  assert.equal(measure(sim, { id: "answered", label: "", tag: "user" }), null, "a share of one group of users still needs data");
  const fresh = new Sim(scene({ nodes: [scene().nodes[0], node("s", { slots: 0 })] }));
  fresh.step(300);
  assert.equal(measure(fresh, { id: "answered", label: "" }), null, "the opening moments are still no data");
});

test("the runner fires in order, waits on a paused beat and on the question, and lets Next skip a beat that never comes", () => {
  const beats: Beat[] = [
    { id: "a", when: { at: 0 }, text: "A." },
    { id: "b", when: { wait: 0 }, text: "B.", pause: true },
    { id: "c", when: { note: "never" }, text: "C." },
  ];
  const sim = new Sim(scene());
  let started = 0;
  const r = new BeatRunner(beats, { timeScale: 0.1, askBefore: "c", onStart: () => started++ });
  const run = (ms: number) => stepGrid([sim], ms, (ss) => (r.tick(ss[0]), false));
  run(10);
  assert.equal(started, 1, "traffic starts when there are no parts to introduce");
  assert.deepEqual(r.fired.map((f) => f.beat.id), ["a"]);
  run(200);
  assert.deepEqual(r.fired.map((f) => f.beat.id), ["a"], "the next beat waits until this one has had its moment");
  run(200);
  assert.deepEqual(r.fired.map((f) => f.beat.id), ["a", "b"]);
  assert.equal(r.waiting, "beat");
  run(1000);
  assert.equal(r.fired.length, 2, "a paused beat holds everything after it");
  r.release();
  run(10);
  assert.equal(r.waiting, "ask", "the question comes before its beat, straight after a released one");
  r.answer();
  run(2000);
  assert.equal(r.fired.length, 2, "a trigger that never holds never fires");
  assert.equal(r.skip(sim)?.beat.id, "c");
  assert.equal(r.done, true);
});

test("build lines come first, a part at a time, and the traffic starts once they are done", () => {
  const sim = new Sim(scene());
  sim.hold();
  const seq = sequenceOf([{ node: "u", text: "Users: 30 a second." }, { node: "s", text: "Server: 4 workers.", sockets: true }], [{ id: "go", when: { at: 0 }, text: "Watch." }]);
  assert.deepEqual(seq.map((b) => [b.id, b.part ?? false, b.focus?.nodes]), [["part-0", true, ["u"]], ["part-1", true, ["s"]], ["go", false, undefined]]);
  const r = new BeatRunner(seq, { timeScale: 0.1, onStart: () => sim.start() });
  stepGrid([sim], 2000, (ss) => (r.tick(ss[0]), false));
  const t = Object.fromEntries(r.fired.map((f) => [f.beat.id, f.t]));
  // The step begins at the first grid point (10 ms).
  assert.equal(t["part-0"], 70, "after the intro lands (600 ms on screen)");
  assert.equal(t["part-1"], 250, "1.8 s on screen later");
  assert.equal(t.go, 430, "the traffic begins once the last part has had its moment");
  assert.equal(sim.started, true);
});

test("numbers fill in from the named world and node; unknown ones are reported", () => {
  const lesson = lessonOf("caching")!;
  const sims = buildSteps(lesson.figures, lesson.figures.map(defaultsOf)).map((s) => new Sim(s));
  for (const s of sims) s.step(3000);
  const ctx = { sims, tones: ["problem", "fix"], metrics: lesson.figures.flatMap((f) => f.metrics), current: 1 };
  assert.match(fillIn("{p95:problem} and {util:db:fix}, {hit}.", ctx), /^\d+(\.\d)? (ms|s) and \d+%, \d+%\.$/);
  assert.deepEqual(placeholdersIn("{util:db:fix}")[0], { raw: "{util:db:fix}", id: "util", node: "db", world: "fix" });
  assert.deepEqual(placeholdersIn("{queue:app}")[0], { raw: "{queue:app}", id: "queue", node: "app", world: undefined });
  const nodes = sims.map((s) => new Set(s.list.map((n) => n.spec.id)));
  assert.deepEqual(unresolved("{p95:fix} {util:cache:problem} {nope} {hit:3}", { tones: ["problem", "fix"], current: 0, nodes }), ["{util:cache:problem}", "{nope}", "{hit:3}"]);
});

test("a reader's words: terms read as their plain words, numbers as one word", () => {
  assert.equal(plainText("Each socket is a [[worker]]: {p95:fix} [[latency-target|the target]] [[retry-budget]]."), "Each socket is a worker: # the target retry budget.");
  assert.equal(wordCount("Count the line: {queue:app} waiting at [[queue|the line]]."), 8);
  assert.deepEqual(termsIn("A [[hit]] then a [[miss|miss]]."), ["hit", "miss"]);
});

test("A3: retrying at once never recovers from one short stall; backoff with a budget does", () => {
  const lesson = lessonOf("retries-and-backoff")!;
  const [problem, fix] = buildSteps(lesson.figures, lesson.figures.map(defaultsOf)).map((s) => new Sim(s));
  for (const s of [problem, fix]) s.step(1500);
  for (const s of [problem, fix]) s.fire("The service stalls");
  const after: number[][] = [[], []];
  for (let t = 0; t < 22000; t += 250) {
    for (const s of [problem, fix]) s.step(250);
    if (t < 2000) continue;
    [problem, fix].forEach((s, i) => after[i].push(measure(s, lesson.figures[0].metrics[0]) ?? 0));
  }
  assert.ok(Math.max(...after[0]) < 0.1, `problem stays down for 20 s after the stall ended (max ${Math.max(...after[0])})`);
  assert.ok(Math.min(...after[1].slice(4)) > 0.9, `the fix is back within 3 s and stays up (min ${Math.min(...after[1].slice(4))})`);
});

test("the reference walks: every beat fires and every prediction is true", () => {
  for (const slug of ["latency-and-throughput", "caching", "retries-and-backoff"]) {
    const w = walk(lessonOf(slug)!);
    assert.deepEqual(w.missing, [], `${slug}: every beat fires`);
    assert.equal(w.prediction?.holds, true, `${slug}: the prediction's answer is what happens`);
  }
});
