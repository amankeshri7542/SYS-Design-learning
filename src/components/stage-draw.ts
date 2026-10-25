// Canvas drawing for the stage: requests (batched by look), their trails, waiting-line pressure, and effects.
// Everything here is drawn in viewBox units; `k` (rendered px per unit) converts screen sizes.

import type { NodeRt, Req } from "@/lib/sim/engine";
import type { Mode, Pt } from "@/lib/sim/layout";
import type { FxKind } from "@/lib/sim/types";
import { DUR, easeOut, easeOutQuint } from "@/lib/motion";

export const TAU = Math.PI * 2;

export type Palette = Record<"req" | "ok" | "slow" | "err" | "stale" | "turned" | "ink" | "muted" | "font", string>;

export type Shape = "circle" | "donut" | "diamond" | "square" | "ring" | "hollow";

export interface Look {
  color: string;
  shape: Shape;
  alpha: number;
  small?: boolean;
}

/** The fixed dot vocabulary (CLAUDE.md): what a request looks like right now. */
export function styleOf(r: Req, now: number, slo: number, P: Palette): Look | null {
  // Control traffic: health checks, handshakes and heartbeats, and a cluster's beats and requests for votes.
  if (r.op === "probe" || r.op === "beat" || r.op === "vote") return { color: P.muted, shape: "ring", alpha: 0.9, small: true };
  // News pushed down an open connection: request-coloured, small, coming to the user.
  if (r.op === "push") return { color: P.req, shape: "circle", alpha: 1, small: true };
  // A window update: an ack with nothing to acknowledge, so a hollow ring of answered's green.
  if (r.op === "ack" && r.window >= 0) return { color: P.ok, shape: "ring", alpha: 1, small: true };
  // An ack: answered's green, small, because it carries no answer.
  if (r.ack && r.result !== "error") return { color: P.ok, shape: "circle", alpha: 1, small: true };
  // A copy on its way to a replica: a small hollow square, so it never reads as a request.
  if (r.op === "repl") return { color: P.muted, shape: "hollow", alpha: 0.95, small: true };
  if (r.orphanAt || r.abandoned) return { color: P.err, shape: "ring", alpha: 0.55 };
  // A job is a square; a part of a request sent out to several targets is still a request.
  if (r.detached && !r.parentId) return { color: P.req, shape: "square", alpha: 1 };
  const late = now - r.first > slo;
  if (r.dir === -1) {
    switch (r.result) {
      case "error":
        return { color: P.err, shape: "diamond", alpha: 1 };
      case "rejected":
      case "fallback":
        return { color: P.turned, shape: "square", alpha: 1 };
      default:
        if (r.stale) return { color: P.stale, shape: "donut", alpha: 1 };
        return { color: late ? P.slow : P.ok, shape: "circle", alpha: 1 };
    }
  }
  return { color: late ? P.slow : P.req, shape: "circle", alpha: 1 };
}

/** Add one dot's outline to the current path (no fill or stroke yet), so many dots can share one draw call. */
function trace(ctx: CanvasRenderingContext2D, kind: Shape, x: number, y: number, r: number) {
  switch (kind) {
    case "circle":
    case "ring":
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
      return;
    case "donut":
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TAU);
      ctx.moveTo(x + r * 0.42, y);
      ctx.arc(x, y, r * 0.42, 0, TAU, true);
      return;
    case "diamond": {
      const d = r * 1.3;
      ctx.moveTo(x, y - d);
      ctx.lineTo(x + d, y);
      ctx.lineTo(x, y + d);
      ctx.lineTo(x - d, y);
      ctx.closePath();
      return;
    }
    case "square":
    case "hollow":
      ctx.roundRect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8, Math.min(1.5, r * 0.3));
      return;
  }
}

const stroked = (kind: Shape) => kind === "ring" || kind === "hollow";
const strokeWidth = (kind: Shape, r: number) => (kind === "ring" ? Math.max(1.6, r * 0.28) : Math.max(1.2, r * 0.32));

/** Draw a single dot now. */
export function shape(ctx: CanvasRenderingContext2D, kind: Shape, x: number, y: number, r: number) {
  ctx.beginPath();
  if (stroked(kind)) {
    ctx.lineWidth = strokeWidth(kind, r);
    trace(ctx, kind, x, y, kind === "ring" ? Math.max(1, r - 0.8) : r);
    ctx.stroke();
  } else {
    trace(ctx, kind, x, y, r);
    ctx.fill();
  }
}

/**
 * Dots that share a look (colour, shape, opacity, and for outlines their stroke width) go into one path, so a frame of
 * a hundred requests costs a handful of fills instead of a hundred.
 */
export class Batch {
  private groups = new Map<string, { color: string; kind: Shape; alpha: number; width: number; dots: number[] }>();

  add(look: Look, alpha: number, x: number, y: number, r: number) {
    const width = stroked(look.shape) ? Math.round(strokeWidth(look.shape, r) * 4) / 4 : 0;
    const a = Math.round(alpha * 20) / 20;
    if (a <= 0) return;
    const key = `${look.color}|${look.shape}|${a}|${width}`;
    let g = this.groups.get(key);
    if (!g) this.groups.set(key, (g = { color: look.color, kind: look.shape, alpha: a, width, dots: [] }));
    g.dots.push(x, y, look.shape === "ring" ? Math.max(1, r - 0.8) : r);
  }

  draw(ctx: CanvasRenderingContext2D) {
    for (const g of this.groups.values()) {
      ctx.globalAlpha = g.alpha;
      ctx.beginPath();
      for (let i = 0; i < g.dots.length; i += 3) trace(ctx, g.kind, g.dots[i], g.dots[i + 1], g.dots[i + 2]);
      if (stroked(g.kind)) {
        ctx.strokeStyle = g.color;
        ctx.lineWidth = g.width;
        ctx.stroke();
      } else {
        ctx.fillStyle = g.color;
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    this.groups.clear();
  }
}

/**
 * Trails: behind each travelling request, a faint stroke over the last stretch of its trip (a fixed slice of simulated
 * time, so a fast link draws long tails), batched by colour.
 */
export class Trails {
  private lines = new Map<string, number[][]>();

  add(color: string, pts: Pt[]) {
    let list = this.lines.get(color);
    if (!list) this.lines.set(color, (list = []));
    list.push(pts.flatMap((p) => [p.x, p.y]));
  }

  draw(ctx: CanvasRenderingContext2D, width: number, fade: number) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = width;
    ctx.globalAlpha = 0.28 * fade;
    for (const [color, list] of this.lines) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (const l of list) {
        ctx.moveTo(l[0], l[1]);
        for (let i = 2; i < l.length; i += 2) ctx.lineTo(l[i], l[i + 1]);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    this.lines.clear();
  }
}

/** The stretch of the station a waiting line uses: its box and the free room to its left (wide) or above (tall). */
export interface QueueBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A long line packs tighter, so its length reads as pressure: full spacing up to six waiting, then closer. */
export const squeeze = (len: number) => (len <= 6 ? 1 : len <= 12 ? 0.88 : 0.78);

/** Where the i-th request in a node's waiting line stands. */
export function queueSpot(n: NodeRt, b: QueueBox, i: number, mode: Mode, pitch: number): Pt {
  if (n.spec.kind === "queue") {
    const s = b.h / 46;
    const cols = Math.floor((b.w / s - 24) / 11);
    const row = Math.floor(i / cols) % 2;
    const col = i % cols;
    return { x: b.x + b.w / 2 - (17 + col * 11) * s, y: b.y + (row ? 7 : -7) * s };
  }
  const step = pitch * squeeze(n.queue.length);
  if (mode !== "tall") {
    const col = Math.floor(i / 3);
    const row = i % 3;
    return { x: b.x - b.w / 2 - pitch / 2 - 4 - col * step, y: b.y + (row - 1) * pitch };
  }
  // Phones: rows of four stacked upward, at most three rows, so the line never reaches the node above.
  const row = Math.floor(i / 4);
  const col = i % 4;
  return { x: b.x + (col - 1.5) * pitch, y: b.y - b.h / 2 - pitch / 2 - 4 - row * step };
}

export function parkSpot(b: QueueBox, i: number, mode: Mode, pitch: number): Pt {
  const col = i % 6;
  const row = Math.floor(i / 6);
  if (mode !== "tall") return { x: b.x - 2.5 * pitch + col * pitch, y: b.y - b.h / 2 - pitch / 2 - 4 - row * pitch };
  return { x: b.x + b.w / 2 + pitch / 2 + 4 + row * pitch, y: b.y - 2.5 * pitch + col * pitch };
}

/**
 * Pressure: a faint warm wedge behind a waiting line, wide at the station and narrowing to the line's tail, stronger
 * the closer the line is to full.
 */
export function wedge(ctx: CanvasRenderingContext2D, b: QueueBox, tail: Pt, mode: Mode, pitch: number, pressure: number, color: string) {
  if (pressure <= 0) return;
  ctx.globalAlpha = 0.05 + 0.09 * Math.min(1, pressure);
  ctx.fillStyle = color;
  ctx.beginPath();
  if (mode !== "tall") {
    const x0 = b.x - b.w / 2;
    const x1 = Math.min(x0 - pitch, tail.x - pitch * 0.6);
    const half = Math.min(b.h / 2, pitch * 1.9);
    ctx.moveTo(x0, b.y - half);
    ctx.lineTo(x1, b.y - pitch * 0.9);
    ctx.lineTo(x1, b.y + pitch * 0.9);
    ctx.lineTo(x0, b.y + half);
  } else {
    const y0 = b.y - b.h / 2;
    const y1 = Math.min(y0 - pitch, tail.y - pitch * 0.6);
    const half = Math.min(b.w / 2, pitch * 2.6);
    ctx.moveTo(b.x - half, y0);
    ctx.lineTo(b.x - pitch * 2, y1);
    ctx.lineTo(b.x + pitch * 2, y1);
    ctx.lineTo(b.x + half, y0);
  }
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** One effect in flight on the canvas. */
export interface FxDraw {
  kind: FxKind;
  x: number;
  y: number;
  r: number;
  born: number;
  vx: number;
  vy: number;
  /** Where a filling square slides to (the end of the cache's bar). */
  tx?: number;
  ty?: number;
}

/** Effects that say a node changed state: each draws one ring. */
export const RINGS = new Set<FxKind>(["crash", "recover", "open", "close", "boot", "hot", "dupe", "redeliver", "dead", "promote", "elect", "conflict"]);
/**
 * A cache's hits and misses: on the dot first (a hit pops, a miss's copy slides in), with a faint ring as a second cue.
 * A lookup the existence check answered ("no such key") gets the hit's faint ring.
 */
export const FAINT = new Set<FxKind>(["hit", "miss", "filtered"]);

const LIFE: Partial<Record<FxKind, number>> = {
  drop: DUR.hero,
  lost: 700,
  evict: 700,
  late: 700,
  fill: DUR.base + DUR.fast,
  hit: 400,
  miss: 400,
  filtered: 400,
  crash: 1100,
  recover: 1100,
  boot: DUR.hero,
  open: DUR.hero,
  close: DUR.hero,
  hot: DUR.switch,
  dupe: DUR.hero,
  redeliver: DUR.hero,
  dead: DUR.hero,
  promote: DUR.hero,
  elect: DUR.hero,
  conflict: DUR.hero,
};

/** Draw one effect at `real` ms; false once it has finished. Under reduced motion nothing moves or grows. */
export function drawFx(ctx: CanvasRenderingContext2D, f: FxDraw, real: number, P: Palette, reduced: boolean, R: number) {
  const life = reduced ? Math.min(400, LIFE[f.kind] ?? 400) : (LIFE[f.kind] ?? 400);
  const age = real - f.born;
  if (age > life) return false;
  const u = age / life;
  const s = age / 1000;
  switch (f.kind) {
    case "drop": {
      // Dropped at a full line: a red diamond falls from the line's tail and spins away.
      const x = reduced ? f.x : f.x + f.vx * s;
      const y = reduced ? f.y : f.y + f.vy * s + 0.5 * 700 * s * s;
      ctx.globalAlpha = 1 - u;
      ctx.fillStyle = P.err;
      if (reduced) shape(ctx, "diamond", x, y, R * 0.72);
      else {
        // The diamond turned by s·6 radians, without a save/restore per effect.
        const a = s * 6;
        const d = R * 0.72 * 1.3;
        const c = Math.cos(a) * d;
        const n = Math.sin(a) * d;
        ctx.beginPath();
        ctx.moveTo(x + n, y - c);
        ctx.lineTo(x + c, y + n);
        ctx.lineTo(x - n, y + c);
        ctx.lineTo(x - c, y - n);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case "lost": {
      // Lost on its link: a red cross opens where the message vanished, and fades. Not a diamond, which is an answer
      // that failed: nothing answered this one, and whoever waits for it will give up.
      const d = R * 0.55 * (reduced ? 1 : 0.7 + 0.3 * easeOut(Math.min(1, age / DUR.base)));
      ctx.globalAlpha = 1 - u;
      ctx.strokeStyle = P.err;
      ctx.lineWidth = Math.max(1.6, R * 0.34);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(f.x - d, f.y - d);
      ctx.lineTo(f.x + d, f.y + d);
      ctx.moveTo(f.x + d, f.y - d);
      ctx.lineTo(f.x - d, f.y + d);
      ctx.stroke();
      ctx.lineCap = "butt";
      break;
    }
    case "evict":
    case "late": {
      // Pushed out of a full cache (or a count too late for its window): a chip drops from the bottom edge. A flat chip in
      // ink, never a dot's shape or colour, because an evicted entry is data, not a request.
      const y = reduced ? f.y : f.y + 0.5 * 600 * s * s;
      ctx.globalAlpha = reduced ? 0.8 : (1 - easeOut(u) * 0.9) * 0.8;
      ctx.fillStyle = P.muted;
      ctx.beginPath();
      ctx.roundRect(f.x - R, y - R * 0.3, R * 2, R * 0.6, R * 0.3);
      ctx.fill();
      break;
    }
    case "fill": {
      // A miss came back: its copy (a small cobalt square) slides into the cache's bar.
      if (reduced) return false;
      const slide = Math.min(1, age / DUR.base);
      const e = easeOutQuint(slide);
      const x = f.x + ((f.tx ?? f.x) - f.x) * e;
      const y = f.y + ((f.ty ?? f.y) - f.y) * e;
      ctx.globalAlpha = age < DUR.base ? 1 : 1 - (age - DUR.base) / DUR.fast;
      ctx.fillStyle = P.req;
      shape(ctx, "square", x, y, R * 0.5);
      break;
    }
    case "hit":
    case "miss":
    case "filtered": {
      // Faint and small: one at a time per cache, so a busy cache never wears a stack of rings.
      const grow = reduced ? 0 : 12 * easeOut(u);
      ctx.globalAlpha = (1 - u) * 0.45;
      ctx.strokeStyle = f.kind === "miss" ? P.slow : P.ok;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * 0.62 + grow, 0, TAU);
      ctx.stroke();
      break;
    }
    default: {
      if (!RINGS.has(f.kind)) return false;
      // A state change: one ring grows out of the node and fades.
      // A repeat answered from notes is turned away on purpose (slate); a job handed out again is a request again.
      const color =
        f.kind === "recover" || f.kind === "close" ? P.ok : f.kind === "boot" || f.kind === "redeliver" || f.kind === "promote" || f.kind === "elect" ? P.req : f.kind === "hot" ? P.slow : f.kind === "dupe" ? P.turned : P.err;
      const grow = reduced ? 0 : (f.kind === "hot" ? 18 : 30) * easeOut(u);
      ctx.globalAlpha = (1 - u) * 0.75;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * 0.62 + grow, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  return true;
}
