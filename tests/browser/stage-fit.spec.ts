import { expect, test, type Page } from "@playwright/test";
import { LESSONS } from "../../src/lib/lessons";
import { buildSteps, defaultsOf, type Lesson } from "../../src/lib/lessons/types";

// Every lesson, every step, on every project: stage text is legible and inside the stage, labels never collide,
// nothing floats over the stage, phone controls are big enough to tap, and a single row of stations doesn't float in
// an empty desktop stage.
// Reduced motion makes each measurement a settled still frame (no entrances or glides in flight).
test.use({ reducedMotion: "reduce" });

/** Lanes (most stations at one step along the flow) and columns (steps along the flow) across all of a lesson's steps. */
function shapeOf(lesson: Lesson) {
  const specs = buildSteps(lesson.figures, lesson.figures.map(defaultsOf));
  const per = new Map<number, number>();
  for (const n of new Map(specs.flatMap((s) => s.nodes.map((m) => [`${m.id}@${m.at}`, m] as const))).values()) per.set(n.at[0], (per.get(n.at[0]) ?? 0) + 1);
  return { lanes: Math.max(...per.values()), cols: per.size };
}

interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

interface Measured {
  stage: { w: number; h: number };
  texts: (Box & { kind: string; owner: string; text: string; px: number })[];
  fill: number;
  small: { what: string; w: number; h: number }[];
  /** Stations with something else on top of them: nothing may float over the stage. */
  covered: string[];
  /** How far the beat strip and the stage overlap, in px (they are separate rows of the sheet). */
  stripOverlap: number;
}

/** Read the stage once: every SVG text box (relative to the stage), its rendered size, station fill, and small tap targets. */
const measure = (page: Page) =>
  page.evaluate((): Measured => {
    const stage = document.querySelector<HTMLElement>(".theatre .stage")!;
    const sr = stage.getBoundingClientRect();
    const svg = [...stage.querySelectorAll<SVGSVGElement>("svg.stage-svg")].find((s) => getComputedStyle(s).display !== "none")!;
    const texts = [...svg.querySelectorAll<SVGTextElement>("text")].map((t) => {
      const r = t.getBoundingClientRect();
      const m = t.getScreenCTM()!;
      return {
        kind: t.getAttribute("class") ?? (t.closest(".badge") ? "badge" : "text"),
        owner: t.closest(".node-pos")?.querySelector(".node-label")?.textContent ?? `link:${t.textContent}`,
        text: t.textContent ?? "",
        l: r.left - sr.left,
        t: r.top - sr.top,
        r: r.right - sr.left,
        b: r.bottom - sr.top,
        px: parseFloat(getComputedStyle(t).fontSize) * Math.hypot(m.a, m.b),
      };
    });
    const nodes = [...svg.querySelectorAll(".node")].map((n) => n.getBoundingClientRect());
    // The top-most element at each station's centre must be the stage itself (the canvas lets clicks through).
    const covered = [...svg.querySelectorAll(".node .body")]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !top || !stage.contains(top);
      })
      .map((b) => b.closest(".node")!.querySelector(".node-label")?.textContent ?? "?");
    const strip = document.querySelector(".theatre .beat")!.getBoundingClientRect();
    const stripOverlap = Math.max(0, Math.min(strip.bottom, sr.bottom) - Math.max(strip.top, sr.top));
    const fill = (Math.max(...nodes.map((r) => r.bottom)) - Math.min(...nodes.map((r) => r.top))) / sr.height;
    const small = [...document.querySelectorAll<HTMLElement>("a[href], button, summary, input:not([type=radio]):not([type=checkbox]), [role=tab], .seg label, label.toggle")]
      .filter((e) => e.getClientRects().length && !e.classList.contains("skip") && getComputedStyle(e).visibility !== "hidden")
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { what: (e.getAttribute("aria-label") || e.textContent || e.className).trim().slice(0, 30), w: r.width, h: r.height };
      })
      .filter((x) => x.w < 40 || x.h < 40);
    return { stage: { w: sr.width, h: sr.height }, texts, fill, small, covered: [...new Set(covered)], stripOverlap };
  });

const overlap = (a: Box, b: Box) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;

for (const lesson of LESSONS) {
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
      if (isMobile) expect.soft(m.small, "every control is at least 40×40").toEqual([]);

      if (!isMobile && shape?.lanes === 1 && info.project.name.startsWith("desktop")) {
        expect.soft(m.fill, "a single row of stations fills at least a fifth of the stage height").toBeGreaterThanOrEqual(0.2);
      }
    });
  });
}
