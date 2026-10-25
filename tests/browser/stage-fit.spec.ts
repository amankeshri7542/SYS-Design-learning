import { expect, test } from "./fixtures";
import { measure, overlap } from "./stage-measure";
import { COURSE } from "../../src/lib/lessons";
import { lessonOf } from "../../src/lib/lessons/all";
import { buildSteps, defaultsOf, type Lesson } from "../../src/lib/lessons/types";

// Every lesson, every step, on every project: stage text is legible and inside the stage, labels never collide,
// no rail shows through a label, nothing floats over the stage, phone controls are big enough to tap, and a single row of
// stations doesn't float in an empty desktop stage.
// Reduced motion makes each measurement a settled still frame (no entrances or glides in flight).
test.use({ reducedMotion: "reduce" });

/** Lanes (most stations at one step along the flow) and columns (steps along the flow) across all of a lesson's steps. */
function shapeOf(lesson: Pick<Lesson, "figures">) {
  const specs = buildSteps(lesson.figures, lesson.figures.map(defaultsOf));
  const per = new Map<number, number>();
  for (const n of new Map(specs.flatMap((s) => s.nodes.map((m) => [`${m.id}@${m.at}`, m] as const))).values()) per.set(n.at[0], (per.get(n.at[0]) ?? 0) + 1);
  return { lanes: Math.max(...per.values()), cols: per.size };
}

// Every live page: a lesson's steps, or a story's first stage.
for (const entry of COURSE) {
  const lesson = lessonOf(entry.slug) ?? { ...entry, figures: [] as Lesson["figures"] };
  const steps = lesson.figures.length ? lesson.figures.map((f) => f.short) : [null];
  steps.forEach((step, i) => {
    test(`${lesson.code} ${lesson.slug}${step ? ` · ${step}` : ""}: stage text is legible, inside the stage and clear of other labels`, async ({ page, isMobile }, info) => {
      await page.goto(`/learn/${lesson.slug}`);
      if (i > 0) await page.getByRole("tab").nth(i).click();
      await expect(page.locator(".theatre .stage")).not.toHaveAttribute("data-mode", "auto");
      const mode = await page.locator(".theatre .stage").getAttribute("data-mode");
      const shape = lesson.figures.length ? shapeOf(lesson) : null;
      // A landscape phone never stacks the scene; a portrait phone never squeezes a wide scene into the compact layout.
      if (info.project.name === "phone-landscape") expect.soft(mode, "landscape phones never use the tall layout").not.toBe("tall");
      if (info.project.name === "mobile") {
        expect.soft(mode, "portrait phones never use the desktop layout").not.toBe("wide");
        if (shape && mode === "compact") expect.soft(shape.lanes <= 2 && shape.cols <= 3, "only small scenes use compact in portrait").toBe(true);
      }
      const m = await measure(page);
      expect(m.texts.length, "the stage has labels").toBeGreaterThan(0);

      for (const t of m.texts) {
        const where = `“${t.text}” (${t.kind})`;
        expect.soft(t.l, `${where} starts inside the stage`).toBeGreaterThanOrEqual(-0.5);
        expect.soft(t.t, `${where} starts inside the stage`).toBeGreaterThanOrEqual(-0.5);
        expect.soft(t.r, `${where} ends inside the stage`).toBeLessThanOrEqual(m.stage.w + 0.5);
        expect.soft(t.b, `${where} ends inside the stage`).toBeLessThanOrEqual(m.stage.h + 0.5);
        const min = t.kind === "node-label" ? 12 : 11;
        expect.soft(t.px, `${where} renders at ${min}px or more`).toBeGreaterThanOrEqual(min - 0.05);
      }

      const labels = m.texts.filter((t) => t.kind === "node-label" || t.kind === "node-sub");
      const collisions = labels.flatMap((a, j) => labels.slice(j + 1).filter((b) => a.owner !== b.owner && overlap(a, b)).map((b) => `“${a.text}” × “${b.text}”`));
      expect.soft(collisions, "no two stations' labels overlap").toEqual([]);

      expect.soft(m.covered, "nothing floats over a station").toEqual([]);
      expect.soft(m.stripOverlap, "the beat strip has its own row").toBeLessThanOrEqual(0.5);
      expect.soft(m.onRail, "no rail shows through a station label").toEqual([]);
      if (isMobile) expect.soft(m.small, "every control is at least 40×40").toEqual([]);

      if (!isMobile && shape?.lanes === 1 && info.project.name.startsWith("desktop")) {
        expect.soft(m.fill, "a single row of stations fills at least a fifth of the stage height").toBeGreaterThanOrEqual(0.2);
      }
    });
  });
}
