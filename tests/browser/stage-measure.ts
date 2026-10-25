import type { Page } from "./fixtures";

// Reading a stage the way the stage-fit tests judge it: every SVG text box, its rendered size, how much of the stage the
// stations fill, small tap targets, stations something covers, how the beat strip and the stage overlap, and labels a
// rail shows through. Shared by the lessons' and My System's stage-fit specs.

export interface Box {
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
  /** Station labels with a rail showing through them (a label may only lie across a rail on a plate that hides it). */
  onRail: string[];
}

/** Read the stage once: every SVG text box (relative to the stage), its rendered size, station fill, and small tap targets. */
export const measure = (page: Page) =>
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
    // Sample every rail's centre line on screen; a station's label or sub-label must not sit on one.
    const railPts = [...svg.querySelectorAll<SVGPathElement>(".rail-core, .link.sync")].flatMap((path) => {
      const m = path.getScreenCTM()!;
      const len = path.getTotalLength();
      return Array.from({ length: 81 }, (_, i) => path.getPointAtLength((len * i) / 80).matrixTransform(m));
    });
    const onRail = [...svg.querySelectorAll<SVGTextElement>(".node-label, .node-sub")]
      .filter((t) => {
        const r = t.getBoundingClientRect();
        const plate = t.parentElement?.querySelector(".label-plate")?.getBoundingClientRect();
        const hidden = plate && plate.left <= r.left + 1 && plate.right >= r.right - 1 && plate.top <= r.top + 1 && plate.bottom >= r.bottom - 1;
        return !hidden && railPts.some((p) => p.x > r.left - 3 && p.x < r.right + 3 && p.y > r.top - 3 && p.y < r.bottom + 3);
      })
      .map((t) => t.textContent ?? "");
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
    return { stage: { w: sr.width, h: sr.height }, texts, fill, small, covered: [...new Set(covered)], stripOverlap, onRail };
  });

export const overlap = (a: Box, b: Box) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > 0.5 && Math.min(a.b, b.b) - Math.max(a.t, b.t) > 0.5;

