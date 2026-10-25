import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// The day and night token blocks at the top of globals.css, read as name → hex colour.
const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

function block(from: number) {
  const open = css.indexOf("{", css.indexOf(":root", from));
  return css.slice(open + 1, css.indexOf("}", open));
}

function tokens(body: string) {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\b/gi)) out.set(m[1], m[2].toLowerCase());
  return out;
}

const day = tokens(block(0));
const night = tokens(block(css.indexOf("@media (prefers-color-scheme: dark)")));
const THEMES = [
  ["day", day],
  ["night", night],
] as const;

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio. */
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** CIE76 colour difference in Lab: how far apart two colours look. */
const deltaE = (a: string, b: string) => {
  const lab = (hex: string) => {
    const [r, g, bl] = channels(hex).map(linear);
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047);
    const y = f(0.2126 * r + 0.7152 * g + 0.0722 * bl);
    const z = f((0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
};

function check(t: Map<string, string>, theme: string, fg: string, bg: string, min: number) {
  const a = t.get(fg);
  const b = t.get(bg);
  assert.ok(a && b, `${theme}: --${fg} and --${bg} are defined`);
  const ratio = contrast(a, b);
  assert.ok(ratio >= min, `${theme}: --${fg} on --${bg} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
}

const SURFACES = ["paper", "surface", "stage", "card"];
const TEXT = ["ink", "ink-2", "muted", "t-ok", "t-warn", "t-bad", "t-stale", "t-req"];
const LINES = ["networking", "foundations", "caching", "data", "async", "resilience", "operating", "stories"];
const DOTS = ["dot-req", "dot-slow", "dot-ok", "dot-stale", "dot-turned", "dot-err"];

test("the night edition redefines every colour the day edition sets", () => {
  assert.ok(day.size > 40, "the day block was found");
  const missing = [...day.keys()].filter((k) => !night.has(k));
  assert.deepEqual(missing, []);
});

for (const [theme, t] of THEMES) {
  test(`${theme}: body text is at least 4.5:1 on every surface`, () => {
    for (const bg of SURFACES) for (const fg of TEXT) check(t, theme, fg, bg, 4.5);
  });

  test(`${theme}: buttons, badges and filled tones carry their text at 4.5:1`, () => {
    check(t, theme, "on-accent", "accent", 4.5);
    check(t, theme, "on-accent", "accent-hover", 4.5);
    for (const tone of ["bad", "warn", "good", "stale"]) check(t, theme, `on-${tone}`, tone, 4.5);
    check(t, theme, "paper", "ink", 4.5);
  });

  test(`${theme}: line colours read as text (ink variants) and as roundels (display text)`, () => {
    for (const line of LINES) {
      for (const bg of ["paper", "surface"]) check(t, theme, `l-${line}-ink`, bg, 4.5);
      // Roundel letters are bold and at least 18.66px: large text, 3:1.
      check(t, theme, "paper", `l-${line}`, 3);
    }
  });

  test(`${theme}: rails stand out from the stage (at least 2:1)`, () => {
    check(t, theme, "rail", "stage", 2);
  });

  test(`${theme}: the new lines look clearly different from every dot and every other line`, () => {
    for (const line of ["networking", "operating"]) {
      const c = t.get(`l-${line}`)!;
      const others = [...DOTS, ...LINES.filter((l) => l !== line && l !== "stories").map((l) => `l-${l}`)];
      for (const o of others) {
        const d = deltaE(c, t.get(o)!);
        assert.ok(d >= 25, `${theme}: --l-${line} vs --${o} differ by ΔE ${d.toFixed(0)}, needs 25`);
      }
    }
  });
}
