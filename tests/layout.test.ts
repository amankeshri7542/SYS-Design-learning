import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL_LESSONS, ALL_STORIES } from "../src/lib/lessons/all";
import { buildSteps, defaultsOf } from "../src/lib/lessons/types";
import { TEXT, combine, fitFrame, placeAll, sceneOf, type Mode, type Scene, type Size } from "../src/lib/sim/layout";
import { compile, type Compiled } from "../src/lib/system/compile";
import { TEMPLATES } from "../src/lib/system/templates";
import { openTrace } from "../src/lib/system/trace/open";
import { jaeger, shop } from "./traces";

// The stage's frame: a frame that says its labels fit has them fit at the size it is drawn, and a dense scene of
// someone's own (here a trace's ten stations in three lanes and five columns) fits a phone's stage by changing its style.

/** The stage's box on the four browser projects (1440×900, 1280×720, a 390×844 phone, an 844×390 landscape phone). */
const BOXES: Record<string, Size> = { desktop: { w: 970, h: 718 }, short: { w: 853, h: 546 }, phone: { w: 372, h: 316.2 }, landscape: { w: 458.6, h: 240 } };
const MODES: Mode[] = ["wide", "compact", "tall"];

const trace = async () => sceneOf((compile((await openTrace(jaeger(shop(60)))).doc!) as Compiled).spec);

test("a frame with no collisions has none at the size it is drawn (to the 1% its fit settles to)", async () => {
  const scenes: [string, Scene, boolean][] = [
    ...ALL_LESSONS.map((l) => [l.slug, combine(buildSteps(l.figures, l.figures.map(defaultsOf))), false] as [string, Scene, boolean]),
    ...ALL_STORIES.map(({ meta, def }) => [meta.slug, sceneOf(def.scene({ ...def.start }, def.stages[0])), false] as [string, Scene, boolean]),
    ...TEMPLATES.map((t) => [t.id, sceneOf((compile(t.doc) as Compiled).spec), true] as [string, Scene, boolean]),
    ["trace", await trace(), true],
  ];
  for (const [name, scene, adapt] of scenes) {
    for (const [where, box] of Object.entries(BOXES)) {
      for (const mode of MODES) {
        const f = fitFrame(scene, mode, box, 1, adapt);
        if (f.hits) continue;
        const at = `${name} ${mode} on ${where} at k ${f.k.toFixed(3)}`;
        assert.equal(placeAll(scene, { ...f, k: f.k / 0.99 }).hits, 0, `${at}: labels collide`);
        // An adapted frame keeps at least half its gutter clear of labels: room for a word wider than its estimate.
        if (!adapt) continue;
        const g = TEXT.gutter / 2 / f.k;
        for (const [key, { label: r }] of placeAll(scene, f).placed) {
          assert.ok(r.x >= g && r.y >= g && r.x + r.w <= f.W - g && r.y + r.h <= f.H - g, `${at}: ${key}'s label is too near the edge`);
        }
      }
    }
  }
});

test("a dense trace fits a phone's stage, with names only where secondary labels can't fit", async () => {
  const scene = await trace();
  for (const [where, mode] of [["phone", "tall"], ["landscape", "compact"]] as const) {
    const authored = fitFrame(scene, mode, BOXES[where]);
    assert.ok(authored.hits > 0, `as placed, its labels collide on a ${where}`);
    const f = fitFrame(scene, mode, BOXES[where], 1, true);
    assert.equal(f.hits, 0, `adapted, every label is clear on a ${where}`);
    assert.equal(f.subs, false, `names only on a ${where}`);
    assert.ok(f.k * f.scale > 0.25, `stations at ${(f.k * f.scale).toFixed(2)} of their size on a ${where}`);
  }
  // A desktop has room for everything as placed.
  const wide = fitFrame(scene, "wide", BOXES.desktop, 1, true);
  assert.equal(wide.hits, 0);
  assert.ok(wide.subs && !wide.packed);
});
