import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL_LESSONS, ALL_STORIES } from "../src/lib/lessons/all";
import { HERO } from "../src/lib/lessons/hero";
import { defaultsOf, type Action } from "../src/lib/lessons/types";
import { stepFiring } from "../src/lib/lessons/walk";
import { Sim } from "../src/lib/sim/engine";
import { accounted, arrivalTrace, leakedHolds } from "../src/lib/sim/invariants";
import type { SceneSpec } from "../src/lib/sim/types";

// The engine's four properties (docs/research/architecture.md §6.1), over every scene the course shows: each step of each
// lesson at its default knobs, the hero, and each stage of each story as it starts and as solved.

const CASES: { name: string; spec: SceneSpec; actions: Action[] }[] = [
  ...ALL_LESSONS.flatMap((l) => l.figures.map((f, i) => ({ name: `${l.code} ${l.slug}, step ${i + 1}`, spec: f.build(defaultsOf(f)), actions: f.actions ?? [] }))),
  { name: "the hero", spec: HERO.build(defaultsOf(HERO)), actions: [] },
  ...ALL_STORIES.flatMap(({ meta, def }) =>
    def.stages.flatMap((s, i) => [
      { name: `${meta.code} stage ${i + 1}`, spec: def.scene(def.start, s), actions: [] },
      { name: `${meta.code} stage ${i + 1}, solved`, spec: def.scene(s.solution, s), actions: [] },
    ]),
  ),
];

test("property: every scene runs the same twice", () => {
  for (const { name, spec } of CASES) {
    const a = new Sim(spec);
    const b = new Sim(spec);
    stepFiring(a, 7000);
    stepFiring(b, 7000);
    assert.deepEqual(a.done, b.done, name);
    assert.deepEqual(a.fx, b.fx, name);
    assert.deepEqual(a.notes, b.notes, name);
  }
});

test("property: in every scene each logical request is answered or still on its way, and nothing leaks a hold", () => {
  for (const { name, spec, actions } of CASES) {
    const sim = new Sim({ ...spec, windowMs: 1e9 });
    const check = (when: string) => {
      const a = accounted(sim);
      assert.equal(a.done + a.live, a.sent, `${name}, ${when}: ${a.done} answered + ${a.live} on their way, of ${a.sent} sent`);
      assert.deepEqual(leakedHolds(sim).slice(0, 3), [], `${name}, ${when}`);
    };
    for (let t = 0; t < 7000; t += 250) {
      stepFiring(sim, 250);
      if ([1000, 3000, 7000].includes(sim.t)) check(`at ${sim.t} ms`);
      else assert.deepEqual(leakedHolds(sim).slice(0, 3), [], name);
    }
    // And through every fault the learner can cause, on and off again.
    for (const a of actions) {
      a.run(sim, true);
      sim.step(400);
      check(`with ${a.label}`);
      a.run(sim, false);
      sim.step(400);
      check(`after ${a.label}`);
    }
  }
});

test("property: in every scene the traffic is the same whatever is downstream: more or fewer workers, slower service", () => {
  const perturb = (spec: SceneSpec, change: (n: SceneSpec["nodes"][number]) => object): SceneSpec => ({
    ...spec,
    nodes: spec.nodes.map((n) => (n.client ? n : { ...n, ...change(n) })),
  });
  for (const { name, spec } of CASES) {
    const base = arrivalTrace(spec);
    assert.deepEqual(arrivalTrace(perturb(spec, (n) => (n.slots ? { slots: n.slots + 1 } : {}))), base, `${name}: one more worker each`);
    assert.deepEqual(arrivalTrace(perturb(spec, (n) => (n.slots && n.slots > 1 ? { slots: n.slots - 1 } : {}))), base, `${name}: one fewer worker each`);
    assert.deepEqual(arrivalTrace(perturb(spec, (n) => (n.serviceMs ? { serviceMs: n.serviceMs * 2 } : {}))), base, `${name}: service twice as slow`);
  }
});
