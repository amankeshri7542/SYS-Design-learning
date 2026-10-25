import assert from "node:assert/strict";
import { test } from "node:test";
import { COURSE } from "../src/lib/lessons";
import { engineNeeds, specsOf } from "../src/lib/lessons/all";
import { HERO } from "../src/lib/lessons/hero";
import { defaultsOf } from "../src/lib/lessons/types";
import { MODULES, Sim, needsOf, type ModuleName } from "../src/lib/sim/engine";
import type { NodeSpec, SceneSpec } from "../src/lib/sim/types";

// A page loads only the optional engine modules its lesson needs (`engineNeeds`, from every scene it can show). These
// tests run every one of those scenes, firing each of its faults, and check that nothing reaches a module the page
// wouldn't load: neither a method called nor a scene a script switches to.

/** Called only when their module is loaded (`MODULES.has`): skipped, harmlessly, on a page without it. */
const GUARDED = new Set(["lose", "connsLost"]);

/** While `record` is set, every optional method called, and every scene reconfigured to, lands in it. */
let record: Set<ModuleName> | null = null;
for (const [name, methods] of MODULES) {
  for (const m of methods) {
    if (GUARDED.has(m)) continue;
    const proto = Sim.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
    const fn = proto[m];
    proto[m] = function (this: Sim, ...a: unknown[]) {
      record?.add(name);
      return fn.apply(this, a);
    };
  }
}
const reconfigure = Sim.prototype.reconfigure;
Sim.prototype.reconfigure = function (this: Sim, spec: SceneSpec) {
  for (const m of needsOf(spec)) record?.add(m);
  return reconfigure.call(this, spec);
};

/** Run a scene a while, then fire each of its faults in turn. */
function exercise(spec: SceneSpec, ms: number) {
  const sim = new Sim(spec);
  sim.step(ms / 2);
  for (const e of spec.script?.events ?? []) {
    if (!e.armed) continue;
    sim.fire(e.label);
    sim.step(ms / 4);
  }
  sim.step(ms / 2);
}

test("every optional module a page's scenes reach is one the page loads", () => {
  for (const e of COURSE) {
    const needs = new Set(engineNeeds(e.slug));
    record = new Set();
    for (const spec of specsOf(e.slug)) exercise(spec, e.kind === "story" ? 1500 : 3000);
    const reached = [...record];
    record = null;
    assert.deepEqual(reached.filter((m) => !needs.has(m)), [], `${e.code} ${e.slug} reaches modules it doesn't load`);
  }
});

test("the home page's hero needs no optional module", () => {
  assert.deepEqual(needsOf(HERO.build(defaultsOf(HERO))), []);
});

test("a scene whose module isn't loaded fails at once, by name", () => {
  const spec: SceneSpec = {
    nodes: [
      { id: "u", kind: "client", label: "u", at: [0, 50], client: { rate: 10, keys: 5, writes: 1 }, to: ["p"] },
      { id: "p", kind: "server", label: "p", at: [50, 50], slots: 2, serviceMs: 1, window: { sizeMs: 500, to: "db" } } as NodeSpec,
      { id: "db", kind: "db", label: "db", at: [90, 50], slots: 2, serviceMs: 5 },
    ],
    sloMs: 400,
  };
  assert.deepEqual(needsOf(spec), ["storage"]);
  const methods = MODULES.get("storage")!;
  MODULES.delete("storage");
  try {
    assert.throws(() => new Sim(spec), /storage module/);
  } finally {
    MODULES.set("storage", methods);
  }
  assert.doesNotThrow(() => new Sim(spec));
});
