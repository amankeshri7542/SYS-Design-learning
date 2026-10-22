"use client";

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { NodeRt, Req, Sim } from "@/lib/sim/engine";
import {
  SIZES,
  TEXT,
  badgeBox,
  bezier,
  combine,
  curve,
  edgesOf,
  fitFrame,
  fitSub,
  glyphOf,
  labelSpot,
  nodeKey,
  pathD,
  placeAll,
  railSpan,
  sceneOf,
  subCurve,
  type Edge,
  type Frame,
  type Mode,
  type Pt,
  type Rect,
  type Scene,
  type Side,
  type Size,
} from "@/lib/sim/layout";
import { flowOf } from "@/lib/sim/metrics";
import type { Glyph, NodeSpec, SceneSpec } from "@/lib/sim/types";
import { DUR, INTRO, TAU as SMOOTH, smooth } from "@/lib/motion";
import { Body, slotSpots, type Spot } from "./glyph";
import { Batch, FAINT, RINGS, TAU, Trails, drawFx, parkSpot, queueSpot, shape, squeeze as squeezeOf, styleOf, wedge, type FxDraw, type Palette } from "./stage-draw";

export type DrawFn = (dt: number) => void;

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  glyph: Glyph;
  spots: Spot[];
  side: Side;
  /** Free room to the left of the node (where its waiting line forms), in viewBox units. */
  room: number;
  /** The label's block, when a rail runs under it and it needs a plate (viewBox units). */
  plate?: Rect;
}

interface Layout {
  frame: Frame;
  boxes: Map<string, Box>;
}

/** Place `spec`'s nodes in a frame fitted for every step of the lesson, so switching steps never rescales. */
function layoutIn(spec: SceneSpec, frame: Frame): Layout {
  const { placed } = placeAll(sceneOf(spec), frame);
  const rects = [...placed.values()];
  const boxes = new Map<string, Box>();
  for (const n of spec.nodes) {
    const p = placed.get(nodeKey(n))!;
    const glyph = glyphOf(n);
    const size = SIZES[glyph];
    const s = frame.scale;
    // The waiting line runs left from the node, up to whatever sits to its left on the same row.
    const left = rects
      .filter((q) => q !== p && q.x < p.x && Math.abs(q.y - p.y) < (q.h + p.h) / 2)
      .flatMap((q) => q.rects)
      .filter((r) => r.y < p.y + p.h / 2 && r.y + r.h > p.y - p.h / 2)
      .map((r) => p.x - p.w / 2 - (r.x + r.w));
    boxes.set(n.id, {
      id: n.id,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      glyph,
      side: p.side,
      plate: p.plate ? p.label : undefined,
      room: Math.max(0, Math.min(p.x - p.w / 2, ...left.filter((d) => d > -p.w))),
      spots: slotSpots(glyph, size.w, size.h, n.slots ?? 0).map((q) => ({ x: p.x + q.x * s, y: p.y + q.y * s, r: q.r * s })),
    });
  }
  return { frame, boxes };
}

/** How many lanes (nodes across) and columns (steps along the flow) a scene has. */
function shapeOf(spec: SceneSpec) {
  const per = new Map<number, number>();
  for (const n of spec.nodes) per.set(n.at[0], (per.get(n.at[0]) ?? 0) + 1);
  return { lanes: Math.max(...per.values()), cols: per.size };
}

/** Rendered size of a node relative to its design size: what "big enough to read" is judged on. */
const nodeScale = (f: Frame) => f.k * f.scale;

/**
 * Biggest zoom on the stations of a wide, uncrowded scene. A single row may grow the most (it would otherwise fill
 * under a fifth of a desktop stage); the crowding check still stops it wherever a waiting line needs the room.
 */
const ZOOM_CEILING = (lanes: number) => (lanes <= 1 ? 2 : lanes <= 2 ? 1.45 : lanes <= 3 ? 1.2 : 1);

/**
 * Pick the layout for the box. Portrait boxes never squeeze a wide scene into the compact layout (only scenes of at
 * most two lanes and three columns may use it); landscape boxes never stack the scene vertically. The wide desktop
 * layout wins whenever its stations come out at 74% of design size or more; otherwise the biggest stations win.
 */
function chooseFrame(scene: Scene, box: Size): Frame {
  const { lanes, cols } = shapeOf(scene.spec);
  const portrait = box.h >= box.w * 0.85;
  const modes: Mode[] = portrait ? (lanes <= 2 && cols <= 3 ? ["wide", "compact", "tall"] : ["wide", "tall"]) : ["wide", "compact"];
  // Layouts where every label found a clear side come first; then the biggest stations.
  const frames = modes.map((m) => fitFrame(scene, m, box));
  const better = (a: Frame, b: Frame) => (b.hits !== a.hits ? b.hits < a.hits : nodeScale(b) > nodeScale(a));
  const wide = frames[0];
  if (nodeScale(wide) < 0.74 || wide.hits) return frames.reduce((a, b) => (better(a, b) ? b : a));
  // A wide stage with spare height draws its stations larger, as long as nothing crowds and nothing has to shrink.
  let best = wide;
  for (let z = 1.05; z <= ZOOM_CEILING(lanes) + 1e-6; z += 0.05) {
    const f = fitFrame(scene, "wide", box, z);
    if (f.k < wide.k * 0.98 || f.hits || crowded(scene, f)) break;
    best = f;
  }
  return best;
}

/** True when stations, labels or the room a waiting line needs would collide at this frame's size. */
function crowded(scene: Scene, f: Frame) {
  const placed = [...placeAll(scene, f).placed.values()];
  // Room for the link and at least three columns of waiting requests between neighbours on a row.
  const lane = Math.max(56, 3 * (2 * dotRadius(f) + 2));
  const hits = (a: Rect, b: Rect, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      const sameRow = Math.abs(a.y - b.y) < (a.h + b.h) / 2;
      if (sameRow && Math.abs(a.x - b.x) - (a.w + b.w) / 2 < lane) return true;
      if (a.rects.some((r) => b.rects.some((q) => hits(r, q, 4)))) return true;
    }
  }
  return false;
}

/** Request dots, in viewBox units: they grow with the stations, but never below 4.2 px on screen. */
const dotRadius = (f: Frame) => Math.max(6.4 * Math.max(0.9, f.scale), 4.2 / f.k);

/** Layouts to draw before the stage has measured itself (and on the server); CSS shows the one that suits the viewport. */
const NOMINAL: Record<"wide" | "compact", Size> = { wide: { w: 980, h: 700 }, compact: { w: 380, h: 360 } };


/** A request's trail covers this much simulated time behind it: fast links draw long tails. */
const TRAIL_MS = 90;
const MAX_QUEUE_DRAWN = { wide: 24, compact: 18, tall: 12 };

/**
 * The stations of the last stage that left the screen (glyph and label), so the next lesson's intro builds only the
 * parts it adds. A module variable: it survives client navigation and is gone on reload, with no storage involved.
 */
let lastStage: Set<string> | null = null;
const sigOf = (n: NodeSpec) => `${glyphOf(n)}:${n.label}`;

/** The scene intro while it runs: each new part's place in the build order, and the parts the last stage had. */
interface Intro {
  at: number;
  rank: Map<string, number>;
  known: Set<string>;
  /** When the last part has landed (requests appear from then) and when the whole intro is over. */
  landed: number;
  until: number;
}

/** Live scene: SVG stations underneath, a canvas of moving requests on top. It fills its box. */
export function Stage({
  sim,
  spec,
  mode,
  reduced,
  label,
  drawRef,
  frameSpecs,
  focus,
}: {
  sim: Sim;
  spec: SceneSpec;
  mode: Mode | null;
  reduced: boolean;
  label: string;
  drawRef: RefObject<DrawFn | null>;
  /** Size the frame for all of these (every step of a lesson), so switching steps never rescales. */
  frameSpecs?: SceneSpec[];
  /** Node ids the narration is about: everything else on the stage dims. */
  focus?: string[];
}) {
  const scene = useMemo(() => (frameSpecs ? combine(frameSpecs) : sceneOf(spec)), [frameSpecs, spec]);
  const edges = useMemo(() => edgesOf(spec), [spec]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Size | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width: w, height: h } = e.contentRect;
      if (w > 0 && h > 0) setBox((b) => (b && Math.abs(b.w - w) < 1 && Math.abs(b.h - h) < 1 ? b : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // The frame depends only on the box and the lesson's combined scene, so it holds still while the scene runs.
  const frame = useMemo(() => (box ? chooseFrame(scene, box) : null), [scene, box]);
  const layout = useMemo(() => (frame ? layoutIn(spec, frame) : null), [spec, frame]);
  const guesses = useMemo(
    () =>
      layout
        ? null
        : (["wide", "compact"] as const).filter((m) => !mode || m === mode).map((m) => layoutIn(spec, fitFrame(scene, m, NOMINAL[m]))),
    [layout, spec, scene, mode],
  );

  // The intro: once, when the stage first has a layout. Parts build in along the flow; parts the last stage showed
  // are already there. Never under reduced motion, and never again on a resize or a step switch.
  const [intro, setIntro] = useState<{ started: boolean; run: Intro | null }>({ started: false, run: null });
  if (layout && !intro.started) {
    // Worked out in the render that first has a measured layout, so the scene never shows for a frame before its intro.
    const known = lastStage ?? new Set<string>();
    const fresh = spec.nodes.filter((n) => !known.has(sigOf(n)));
    let run: Intro | null = null;
    if (!reduced && fresh.length) {
      const along = [...new Set(fresh.map((n) => n.at[0]))].sort((a, b) => a - b);
      const at = performance.now();
      const last = INTRO.step * (along.length - 1);
      run = { at, known, rank: new Map(fresh.map((n) => [n.id, along.indexOf(n.at[0])])), landed: at + last + INTRO.node, until: at + last + DUR.fast + INTRO.stroke };
    }
    setIntro({ started: true, run });
  }
  const mountedAt = useRef(0);
  const specRef = useRef(spec);
  specRef.current = spec;
  const run = intro.run;
  useEffect(() => {
    if (!run) return;
    const t = setTimeout(() => setIntro({ started: true, run: null }), run.until - performance.now() + 50);
    return () => clearTimeout(t);
  }, [run]);
  useEffect(() => {
    mountedAt.current = performance.now();
    return () => {
      // A real unmount, not a development double-mount: remember what this stage showed.
      if (performance.now() - mountedAt.current > 300) lastStage = new Set(specRef.current.nodes.map(sigOf));
    };
  }, []);

  const focusSet = useMemo(() => (focus?.length ? new Set(focus) : null), [focus]);
  const live = useRef({ sim, reduced, layout, box, intro: run, focus: focusSet });
  live.current = { sim, reduced, layout, box, intro: run, focus: focusSet };
  const st = useRef({
    vis: new Map<number, Pt>(),
    fx: [] as FxDraw[],
    lastFx: -1,
    sim: null as Sim | null,
    palette: null as Palette | null,
    paletteAt: 0,
    paths: new Map<string, { c: [Pt, Pt, Pt, Pt]; tA: number; tB: number }>(),
    pathsFor: null as Layout | null,
    throttle: new Map<string, number>(),
    switchAt: 0,
    pops: new Map<number, number>(),
    dots: new Batch(),
    trails: new Trails(),
  });

  useEffect(() => {
    drawRef.current = (dt: number) => {
      const { sim, reduced, layout: L, box, intro, focus } = live.current;
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!L || !box || !canvas || !wrap) return;
      const mode = L.frame.mode;
      const s = st.current;
      const real = performance.now();
      if (s.sim !== sim) {
        // Another step's world: its requests fade in once the stations have started to move (the switch's first beat).
        if (s.sim) s.switchAt = real;
        s.sim = sim;
        s.vis.clear();
        s.fx = [];
        s.lastFx = -1;
        s.pops.clear();
      }
      if (s.pathsFor !== L) {
        s.paths.clear();
        s.pathsFor = L;
      }
      if (!s.palette || real - s.paletteAt > 1000) {
        const cs = getComputedStyle(wrap);
        const v = (n: string) => cs.getPropertyValue(n).trim();
        s.palette = {
          req: v("--dot-req"),
          ok: v("--dot-ok"),
          slow: v("--dot-slow"),
          err: v("--dot-err"),
          stale: v("--dot-stale"),
          turned: v("--dot-turned"),
          ink: v("--ink"),
          muted: v("--muted"),
          font: v("--font-mono") || "monospace",
        };
        s.paletteAt = real;
      }
      const P = s.palette;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      // The measured box, not a layout read: the canvas fills the stage exactly.
      const cw = box.w;
      const ch = box.h;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Letterbox exactly like the SVG underneath (preserveAspectRatio="xMidYMid meet").
      const k = Math.min(cw / L.frame.W, ch / L.frame.H);
      const ox = (cw - L.frame.W * k) / 2;
      const oy = (ch - L.frame.H * k) / 2;
      ctx.setTransform(k * dpr, 0, 0, k * dpr, ox * dpr, oy * dpr);
      // Requests wait for the intro's stations to land, and fade in after a step switch's first beat.
      const since = (t: number) => Math.min(1, Math.max(0, (real - t) / DUR.base));
      const fade = reduced ? 1 : since(s.switchAt + 60) * (intro ? since(intro.landed) : 1);

      const now = sim.now;
      const slo = sim.spec.sloMs;
      const R = dotRadius(L.frame);
      // Spacing of a waiting line: dots never overlap at rest, however large they are drawn.
      const pitch = 2 * R + 2;
      const place = (r: Req, target: Pt) => {
        const prev = s.vis.get(r.id);
        const p =
          prev && !reduced
            ? { x: smooth(prev.x, target.x, dt, SMOOTH.queue), y: smooth(prev.y, target.y, dt, SMOOTH.queue) }
            : target;
        next.set(r.id, p);
        return p;
      };
      const next = new Map<number, Pt>();

      const path = (from: string, to: string) => {
        const key = `${from}>${to}`;
        let e = s.paths.get(key);
        if (!e) {
          const a = L.boxes.get(from);
          const b = L.boxes.get(to);
          if (!a || !b) return null;
          const c = curve(a, b, mode);
          const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y) * 1.05);
          // Traffic runs on the rail's own stretch (on phones it starts and ends beneath a label below a node), and
          // otherwise starts just outside the station.
          const [s0, s1] = railSpan(a, b, mode, k);
          const tA = s0 > 0 ? s0 : Math.min(0.4, (Math.min(a.w, a.h) / 2 + 3) / len);
          const tB = s1 < 1 ? s1 : Math.max(0.6, 1 - (Math.min(b.w, b.h) / 2 + 3) / len);
          e = { c, tA, tB };
          s.paths.set(key, e);
        }
        return e;
      };
      // Where a travelling request is at simulated time `t`: along its link, on its own lane of the rail.
      const along = (r: Req, e: { c: [Pt, Pt, Pt, Pt]; tA: number; tB: number }, t: number, lane: number) => {
        const span = r.t1 - r.t0;
        const prog = span > 0 ? Math.min(1, Math.max(0, (t - r.t0) / span)) : 1;
        const u = e.tA + (e.tB - e.tA) * prog;
        const a = bezier(e.c, u);
        const b = bezier(e.c, Math.min(1, u + 0.01));
        const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        return { p: { x: a.x - ((b.y - a.y) / d) * lane, y: a.y + ((b.x - a.x) / d) * lane }, prog };
      };

      // Requests that are waiting, working or parked at a node; and each waiting line's pressure.
      const positions = new Map<number, { p: Pt; work?: number; size?: number }>();
      const overflow: { x: number; y: number; n: number; inside: boolean }[] = [];
      const heldRings: { p: Pt; late: boolean; r: number }[] = [];
      const caps = new Map<string, number>();
      for (const n of sim.list) {
        const b = L.boxes.get(n.spec.id);
        if (!b || !n.on) continue;
        const inside = n.spec.kind === "queue";
        const squeeze = squeezeOf(n.queue.length);
        // A queue node holds its line inside the body; elsewhere the line stops where the room to the left runs out.
        const cap = inside
          ? 2 * Math.floor((b.w / L.frame.scale - 24) / 11)
          : mode === "tall"
            ? MAX_QUEUE_DRAWN.tall
            : Math.min(MAX_QUEUE_DRAWN[mode], 3 * Math.max(1, Math.floor((b.room - 6) / (pitch * squeeze))));
        caps.set(n.spec.id, cap);
        const cell = inside ? Math.min(R, 4.6 * L.frame.scale) : undefined;
        n.queue.forEach((r, i) => {
          if (i < cap) positions.set(r.id, { p: queueSpot(n, b, i, mode, pitch), size: cell });
          else if (i === cap) {
            const last = queueSpot(n, b, cap - 1, mode, pitch);
            overflow.push({ ...last, n: n.queue.length - cap, inside });
          }
        });
        if (!inside && n.queue.length && n.spec.slots) {
          const full = n.spec.queueMax ?? n.spec.slots * 6;
          const tail = queueSpot(n, b, Math.min(cap, n.queue.length) - 1, mode, pitch);
          wedge(ctx, b, tail, mode, pitch, (n.queue.length / full) * fade, P.slow);
        }
        n.work.forEach((r, i) => {
          const spot = b.spots[i];
          const pct = r.doneAt > r.started ? Math.min(1, (now - r.started) / (r.doneAt - r.started)) : 1;
          positions.set(r.id, { p: spot ?? { x: b.x, y: b.y }, work: pct, size: spot?.r });
        });
        n.held.forEach((r, j) => {
          const spot = b.spots[n.work.length + j];
          if (spot) heldRings.push({ p: spot, late: now - r.first > slo, r: spot.r });
        });
        let pi = 0;
        for (const r of n.parked) {
          if (r.phase !== "parked") continue;
          positions.set(r.id, { p: parkSpot(b, pi++, mode, pitch) });
        }
        for (const list of n.waiters.values()) {
          for (const r of list) {
            if (r.phase !== "parked") continue;
            positions.set(r.id, { p: parkSpot(b, pi++, mode, pitch) });
          }
        }
      }

      ctx.lineWidth = 1.6;
      ctx.globalAlpha = fade;
      for (const h of heldRings) {
        ctx.strokeStyle = h.late ? P.slow : P.req;
        ctx.beginPath();
        ctx.arc(h.p.x, h.p.y, h.r - 0.6, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Focus: requests not at, or heading to, a station in focus fade back.
      const dim = (r: Req) => (focus && !focus.has(r.at) && !focus.has(r.to) && !focus.has(r.from) ? 0.4 : 1);
      const atClient = (id: string) => sim.nodes.get(id)?.spec.kind === "client";
      const fromCache = (id: string) => sim.nodes.get(id)?.spec.kind === "cache";
      const popped = new Set<number>();
      const wipes: { look: { color: string; shape: Parameters<typeof shape>[1] }; alpha: number; p: Pt; size: number; work: number }[] = [];
      for (const r of sim.reqs) {
        if (r.phase === "gone") continue;
        const look = styleOf(r, now, slo, P);
        if (!look) continue;
        let p: Pt;
        let work: number | undefined;
        let base = look.small ? R * 0.5 : R;
        let size = base;
        if (r.phase === "travel") {
          const e = path(r.from, r.to);
          if (!e) continue;
          const lane = look.small ? 0 : 4 * Math.max(1, L.frame.scale);
          const at = along(r, e, now, lane);
          p = at.p;
          next.set(r.id, p);
          size = base * (r.cost > 1 ? 1.35 : 1);
          if (!reduced) {
            // Requests grow out of the client and shrink back into it, so they don't pop in and out.
            if (r.dir === 1 && atClient(r.from) && at.prog < 0.18) size *= 0.45 + (0.55 * at.prog) / 0.18;
            if (r.dir === -1 && atClient(r.to) && at.prog > 0.82) size *= 1 - (0.6 * (at.prog - 0.82)) / 0.18;
            // A cache hit leaves with a short pop: answered on the spot.
            if (r.hit && r.dir === -1 && fromCache(r.from)) {
              const start = s.pops.get(r.id) ?? real;
              s.pops.set(r.id, start);
              popped.add(r.id);
              const u = (real - start) / DUR.fast;
              if (u < 1) size *= 1 + 0.35 * Math.sin(Math.PI * u);
            }
            // Its trail: where it was a moment of simulated time ago.
            if (r.op !== "probe" && now - TRAIL_MS < r.t1) {
              const from = Math.max(r.t0, now - TRAIL_MS);
              const pts = [0, 1 / 3, 2 / 3, 1].map((f) => along(r, e, from + (now - from) * f, lane).p);
              if (Math.hypot(pts[3].x - pts[0].x, pts[3].y - pts[0].y) > size) s.trails.add(look.color, pts);
            }
          }
        } else {
          const pos = positions.get(r.id);
          if (!pos) continue;
          p = place(r, pos.p);
          work = pos.work;
          if (pos.size && !look.small) base = pos.size;
          size = base * (r.cost > 1 ? 1.35 : 1);
        }
        const alpha = look.alpha * fade * dim(r);
        if (work !== undefined && !reduced) wipes.push({ look, alpha, p, size, work });
        else s.dots.add(look, alpha, p.x, p.y, size);
      }
      for (const id of s.pops.keys()) if (!popped.has(id)) s.pops.delete(id);
      s.trails.draw(ctx, 2.2 / k, fade);
      s.dots.draw(ctx);
      // Requests in service: a ghost of the dot with a clock-wipe of the work still to do.
      for (const w of wipes) {
        ctx.fillStyle = w.look.color;
        ctx.globalAlpha = w.alpha * 0.3;
        shape(ctx, w.look.shape, w.p.x, w.p.y, w.size);
        ctx.globalAlpha = w.alpha;
        ctx.beginPath();
        ctx.moveTo(w.p.x, w.p.y);
        ctx.arc(w.p.x, w.p.y, w.size, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - w.work));
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      s.vis = next;

      if (overflow.length) {
        ctx.fillStyle = P.muted;
        ctx.font = `600 ${TEXT.sub / k}px ${P.font}`;
        ctx.textAlign = "center";
        for (const o of overflow) {
          if (o.inside) ctx.fillText(`+${o.n}`, o.x - 4, o.y - 12);
          else if (mode !== "tall") ctx.fillText(`+${o.n}`, o.x - pitch - 8, o.y + 4);
          else ctx.fillText(`+${o.n}`, o.x + pitch + 10, o.y + 4);
        }
      }

      // Effects. Rings for a station changing state (and a faint one for a cache's hit or miss); drops fall from a full
      // line's tail; a miss's copy slides into the cache's bar, and an eviction drops out of the cache.
      for (const f of sim.fx) {
        if (f.t <= s.lastFx) continue;
        const b = L.boxes.get(f.node);
        const n = sim.nodes.get(f.node);
        if (!b || !n) continue;
        const drawn = RINGS.has(f.kind) || FAINT.has(f.kind) || f.kind === "drop" || f.kind === "fill" || f.kind === "evict";
        if (!drawn) continue;
        // Rings at most one per node and kind every 250 ms (hits and misses share one budget); the rest a little faster.
        const key = `${f.node}:${FAINT.has(f.kind) ? "outcome" : f.kind}`;
        if (real - (s.throttle.get(key) ?? 0) < (RINGS.has(f.kind) || FAINT.has(f.kind) ? 250 : f.kind === "drop" ? 70 : 90)) continue;
        s.throttle.set(key, real);
        const fx: FxDraw = { kind: f.kind, x: b.x, y: b.y, r: Math.max(b.w, b.h) / 2, born: real, vx: (Math.random() - 0.5) * 70, vy: -70 - Math.random() * 40 };
        if (f.kind === "drop" && f.slot !== undefined) {
          const cap = caps.get(f.node) ?? 1;
          Object.assign(fx, queueSpot(n, b, Math.max(0, Math.min(f.slot, cap - 1)), mode, pitch));
        } else if (f.kind === "fill" || f.kind === "evict") {
          const sc = L.frame.scale;
          const cap = n.spec.capacity ?? 1;
          const barX = (u: number) => b.x - b.w / 2 + 12 * sc + (b.w - 24 * sc) * u;
          const barY = b.y + b.h / 2 - 9.5 * sc;
          if (f.kind === "fill") Object.assign(fx, { x: b.x + b.w / 2 - 6 * sc, y: b.y, tx: barX(Math.min(1, n.cache.size / cap)), ty: barY });
          else Object.assign(fx, { x: barX(0.12), y: b.y + b.h / 2 });
        }
        s.fx.push(fx);
      }
      if (sim.fx.length) s.lastFx = sim.fx[sim.fx.length - 1].t;
      if (s.fx.length > 90) s.fx = s.fx.slice(-60);
      s.fx = s.fx.filter((f) => drawFx(ctx, f, real, P, reduced, R));
    };
    return () => {
      drawRef.current = null;
    };
  }, [drawRef]);

  return (
    <div
      className="stage"
      ref={wrapRef}
      data-mode={layout?.frame.mode ?? "auto"}
      data-hits={layout?.frame.hits}
      data-intro={run ? "" : undefined}
      data-focus={focusSet ? "" : undefined}
    >
      {/* The measured layout replaces the first guess outright: stations never glide from a guessed place. */}
      {(layout ? [layout] : (guesses ?? [])).map((l) => (
        <StageSvg key={`${layout ? "" : "guess-"}${l.frame.mode}`} sim={sim} spec={spec} layout={l} edges={edges} label={label} reduced={reduced} intro={run} focus={focusSet} />
      ))}
      <canvas ref={canvasRef} className="stage-canvas" aria-hidden="true" />
    </div>
  );
}

/** A cubic curve's length, from 16 straight pieces (close enough to time a stroke drawing itself). */
function lengthOf(c: [Pt, Pt, Pt, Pt]) {
  let len = 0;
  let p = c[0];
  for (let i = 1; i <= 16; i++) {
    const q = bezier(c, i / 16);
    len += Math.hypot(q.x - p.x, q.y - p.y);
    p = q;
  }
  return len;
}

/** Parts a step switch (or a knob) took away: they fade out where they were, then unmount. */
interface Leaving {
  nodes: NodeSpec[];
  edges: Edge[];
  layout: Layout;
}

function StageSvg({
  sim,
  spec,
  layout,
  edges,
  label,
  reduced,
  intro,
  focus,
}: {
  sim: Sim;
  spec: SceneSpec;
  layout: Layout;
  edges: Edge[];
  label: string;
  reduced: boolean;
  intro: Intro | null;
  focus: Set<string> | null;
}) {
  const { frame, boxes } = layout;
  const k = frame.k;
  const lbViews = [...sim.nodes.values()].filter((n) => n.spec.health);
  const leaders = new Set(spec.nodes.flatMap((n) => (n.leader ? [n.leader] : [])));
  // Nodes that appear after the scene has settled (a step adds a cache, a queue…) enter in the switch's second beat
  // with a one-time accent ring.
  const born = useRef(performance.now());
  const seen = useRef(new Map<string, number>());
  const now = performance.now();
  const fresh = (id: string) => {
    let until = seen.current.get(id);
    if (until === undefined) {
      until = now - born.current > 500 ? now + DUR.switch + 120 : 0;
      seen.current.set(id, until);
    }
    return !reduced && now < until;
  };

  // Parts leaving, worked out while rendering so they never vanish for a frame before they fade.
  const [track, setTrack] = useState<{ spec: SceneSpec; layout: Layout; leaving: Leaving | null }>({ spec, layout, leaving: null });
  if (track.spec !== spec || track.layout !== layout) {
    let leaving = track.leaving;
    if (track.spec !== spec && !reduced) {
      const ids = new Set(spec.nodes.map((n) => n.id));
      const nodes = track.spec.nodes.filter((n) => !ids.has(n.id));
      const keep = new Set(edges.flatMap((e) => [`${e.a}~${e.b}`, `${e.b}~${e.a}`]));
      if (nodes.length) leaving = { nodes, edges: edgesOf(track.spec).filter((e) => !keep.has(`${e.a}~${e.b}`)), layout: track.layout };
    }
    setTrack({ spec, layout, leaving });
  }
  const leaving = track.leaving;
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setTrack((x) => (x.leaving === leaving ? { ...x, leaving: null } : x)), DUR.exit + 60);
    return () => clearTimeout(t);
  }, [leaving]);

  // How much traffic each link carries, against the busiest link on the stage.
  const flows = edges.map((e) => flowOf(sim, e.a, e.b));
  const busiest = Math.max(1, ...flows.map((f) => f.rate));
  // Replicas with a copy still on its way to them are behind.
  const behind = new Set<string>();
  for (const r of sim.reqs) if (r.op === "repl" && r.phase === "travel") behind.add(r.to);
  const rank = (id: string) => intro?.rank.get(id) ?? 0;
  const known = (n: NodeSpec | undefined) => !intro || !n || !intro.rank.has(n.id);

  return (
    <svg
      className={`stage-svg stage-${frame.mode}`}
      viewBox={`0 0 ${frame.W} ${frame.H}`}
      role="img"
      aria-label={label}
      style={{ "--k": k } as CSSProperties}
    >
      <g className="links">
        {leaving?.edges.map((e) => {
          const a = leaving.layout.boxes.get(e.a);
          const b = leaving.layout.boxes.get(e.b);
          if (!a || !b) return null;
          const [t0, t1] = railSpan(a, b, frame.mode, k);
          return (
            <g key={`gone:${e.a}~${e.b}`} className={`link-g ${e.style} leaving`} aria-hidden="true">
              <path className={e.style === "flow" ? "rail" : "link sync"} d={pathD(subCurve(curve(a, b, frame.mode), t0, t1))} />
            </g>
          );
        })}
        {edges.map((e, i) => {
          const a = boxes.get(e.a);
          const b = boxes.get(e.b);
          const A = sim.nodes.get(e.a);
          const B = sim.nodes.get(e.b);
          if (!a || !b || !A?.on || !B?.on) return null;
          const c = curve(a, b, frame.mode);
          const cut = sim.partitioned && !!A.spec.region && !!B.spec.region && A.spec.region !== B.spec.region;
          // An open breaker cuts the link to what it calls: requests fail fast instead of crossing it.
          const cuts = (X: NodeRt, Y: NodeRt) =>
            !!X.spec.breaker && X.breaker.state === "open" && [...sim.flat(X.spec.to), ...sim.flat(X.spec.calls?.read), ...sim.flat(X.spec.calls?.write)].includes(Y.spec.id);
          const broken = !cut && (cuts(A, B) || cuts(B, A));
          const mid = bezier(c, 0.5);
          const ahead = bezier(c, 0.52);
          const [t0, t1] = railSpan(a, b, frame.mode, k);
          const drawn = subCurve(c, t0, t1);
          const f = flows[i];
          const glow = f.rate > 0.05 ? Math.round((0.06 + 0.22 * Math.min(1, f.rate / busiest)) * 50) / 50 : 0;
          const first = a.x + a.y < b.x + b.y ? e.a : e.b;
          return (
            <LinkView
              key={`${e.a}~${e.b}`}
              d={pathD(drawn)}
              len={Math.ceil(lengthOf(drawn) * k)}
              sync={e.style === "sync"}
              cut={cut}
              broken={broken}
              mid={mid}
              angle={(Math.atan2(ahead.y - mid.y, ahead.x - mid.x) * 180) / Math.PI}
              text={spec.linkLabels?.[`${e.a}>${e.b}`] ?? spec.linkLabels?.[`${e.b}>${e.a}`]}
              upright={Math.abs(b.x - a.x) < Math.abs(b.y - a.y)}
              k={k}
              glow={glow}
              failing={f.errors > 0.3}
              i={rank(first)}
              known={known(A.spec) && known(B.spec)}
              focused={!focus || focus.has(e.a) || focus.has(e.b)}
            />
          );
        })}
      </g>
      <g className="nodes">
        {leaving?.nodes.map((n) => {
          const b = leaving.layout.boxes.get(n.id);
          return b ? <GhostNode key={`gone:${n.id}`} n={n} b={b} k={k} s={frame.scale} /> : null;
        })}
        {spec.nodes.map((n) => {
          const b = boxes.get(n.id)!;
          const rt = sim.nodes.get(n.id);
          if (!rt) return null;
          const view = describe(sim, rt, lbViews);
          const detail = fitSub(view.sub, frame.mode);
          // In the compact phone layout, secondary labels appear only when they carry news.
          const sub = frame.mode !== "compact" || view.cls || rt.queue.length || n.kind === "cache" || n.kind === "queue" ? detail : "";
          const m = meterOf(rt);
          return (
            <NodeView
              key={n.id}
              n={n}
              b={b}
              k={k}
              s={frame.scale}
              cls={view.cls}
              sub={sub}
              badge={view.badge?.text}
              tone={view.badge?.tone}
              pill={view.pill}
              role={n.leader ? "FOLLOWER" : leaders.has(n.id) ? "LEADER" : undefined}
              meter={m?.kind}
              level={m?.level}
              meterTone={m?.tone}
              slots={rt.spec.slots ?? 0}
              behind={behind.has(n.id)}
              fresh={fresh(n.id)}
              i={rank(n.id)}
              known={known(n)}
              focused={!focus || focus.has(n.id)}
            />
          );
        })}
      </g>
    </svg>
  );
}

/** One link: its rail (with a glow as strong as the traffic it carries), and any mark or label on it. */
const LinkView = memo(function LinkView({
  d,
  len,
  sync,
  cut,
  broken,
  mid,
  angle,
  text,
  upright,
  k,
  glow,
  failing,
  i,
  known,
  focused,
}: {
  d: string;
  /** Length on screen in px (rails keep a constant width, so their dashes are measured on screen). */
  len: number;
  sync: boolean;
  cut: boolean;
  broken: boolean;
  mid: Pt;
  angle: number;
  text?: string;
  upright: boolean;
  k: number;
  glow: number;
  failing: boolean;
  i: number;
  known: boolean;
  focused: boolean;
}) {
  return (
    <g className={`link-g ${sync ? "sync" : "flow"}${cut ? " cut" : ""}${known ? " known" : ""}${focused ? "" : " dim"}`} style={{ "--i": i, "--len": len } as CSSProperties}>
      {sync ? (
        <path className="link sync" d={d} />
      ) : (
        <>
          <path className="rail" d={d} />
          <path className="rail-core" d={d} />
          <path className={`link-flow${failing ? " failing" : ""}`} d={d} style={{ opacity: cut || broken ? 0 : glow }} />
        </>
      )}
      {cut && (
        <g className="cut-mark" transform={`translate(${mid.x} ${mid.y}) scale(${1 / Math.max(0.6, k)})`}>
          <g className="mark">
            <circle r="11" />
            <path d="M-4.5-4.5l9 9M4.5-4.5l-9 9" />
          </g>
        </g>
      )}
      {broken && (
        // A circuit breaker open: a break in the rail, the gap flanked by two bars.
        <g className="break-mark" transform={`translate(${mid.x} ${mid.y}) rotate(${angle}) scale(${1 / Math.max(0.6, k)})`}>
          <g className="mark">
            <rect x="-6" y="-9" width="12" height="18" />
            <path d="M-6-9v18M6-9v18" />
          </g>
        </g>
      )}
      {text && !cut && (
        <text className="link-label" x={upright ? mid.x + 12 / k : mid.x} y={upright ? mid.y + 4 / k : mid.y - 10 / k} textAnchor={upright ? "start" : "middle"}>
          {text}
        </text>
      )}
    </g>
  );
});

const PILL = {
  closed: { at: 0, word: "CLOSED", tone: "good" },
  half: { at: 1, word: "TESTING", tone: "warn" },
  open: { at: 2, word: "OPEN", tone: "bad" },
} as const;

/** A station: body, meter, label and sub-label, and the badges on its shoulders. Re-renders only when these change. */
const NodeView = memo(function NodeView({
  n,
  b,
  k,
  s,
  cls,
  sub,
  badge,
  tone,
  pill,
  role,
  meter,
  level,
  meterTone,
  slots,
  behind,
  fresh,
  i,
  known,
  focused,
}: {
  n: NodeSpec;
  b: Box;
  k: number;
  s: number;
  cls: string;
  sub: string;
  badge?: string;
  tone?: string;
  pill?: keyof typeof PILL;
  role?: string;
  meter?: "cache" | "load";
  level?: number;
  meterTone?: string;
  slots: number;
  behind: boolean;
  fresh: boolean;
  i: number;
  known: boolean;
  focused: boolean;
}) {
  const size = SIZES[b.glyph];
  // CSS px to the node's own units: stage text keeps its size however the scene is scaled.
  const u = 1 / (k * s);
  const block = TEXT.label * TEXT.line + (sub ? TEXT.sub * TEXT.line : 0);
  // The layout's spot, in viewBox units, brought into the node's own (scaled) units.
  const spot = labelSpot(b.side, size.w * s, size.h * s, block / k, k);
  const top = spot.top / s;
  const x = spot.x / s;
  return (
    // Outer group glides between positions; inner group plays the entrances and state changes.
    <g className={`node-pos${focused ? "" : " dim"}`} style={{ transform: `translate(${b.x}px, ${b.y}px) scale(${s})`, "--ns": s } as CSSProperties}>
      <g className={`node g-${b.glyph} ${cls}${fresh ? " entering" : ""}${known ? " known" : ""}`} style={{ "--i": i } as CSSProperties}>
        {fresh && <rect className="fresh-ring" x={-size.w / 2 - 8} y={-size.h / 2 - 8} width={size.w + 16} height={size.h + 16} rx="16" />}
        <g className="frame">
          <Body glyph={b.glyph} w={size.w} h={size.h} slots={slots} />
          {meter && <Meter kind={meter} level={level ?? 0} tone={meterTone} w={size.w} h={size.h} db={n.kind === "db"} />}
        </g>
        {n.replicaOf && <path className={`behind-mark${behind ? " on" : ""}`} d={`M${-size.w * 0.26} ${size.h / 2 + 8}H${size.w * 0.26}`} />}
        {b.plate && (
          // A sign over the track: the rail it could not avoid passes under the label.
          <rect className="label-plate" x={(b.plate.x - b.x) / s - 3 * u} y={(b.plate.y - b.y) / s - 2 * u} width={b.plate.w / s + 6 * u} height={b.plate.h / s + 4 * u} rx={4 * u} />
        )}
        <text className="node-label" x={x} y={top + TEXT.label * u} textAnchor={spot.anchor}>
          {n.label}
        </text>
        {sub && (
          <text className="node-sub" x={x} y={top + (TEXT.label * TEXT.line + TEXT.sub) * u} textAnchor={spot.anchor}>
            {sub}
          </text>
        )}
        {pill ? (
          <BreakerPill state={pill} x={size.w / 2} y={-size.h / 2} k={k} s={s} />
        ) : (
          badge && <Badge text={badge} tone={tone ?? "bad"} x={size.w / 2} y={-size.h / 2} k={k} s={s} dir={1} />
        )}
        {role && <Badge text={role} tone="role" x={-size.w / 2} y={-size.h / 2} k={k} s={s} dir={-1} />}
      </g>
    </g>
  );
});

/** A station on its way out: its body and name only, fading where it stood. */
function GhostNode({ n, b, k, s }: { n: NodeSpec; b: Box; k: number; s: number }) {
  const size = SIZES[b.glyph];
  const u = 1 / (k * s);
  const spot = labelSpot(b.side, size.w * s, size.h * s, (TEXT.label * TEXT.line) / k, k);
  return (
    <g className="node-pos" style={{ transform: `translate(${b.x}px, ${b.y}px) scale(${s})`, "--ns": s } as CSSProperties} aria-hidden="true">
      <g className={`node g-${b.glyph} leaving`}>
        <Body glyph={b.glyph} w={size.w} h={size.h} slots={n.slots ?? 0} />
        <text className="node-label" x={spot.x / s} y={spot.top / s + TEXT.label * u} textAnchor={spot.anchor}>
          {n.label}
        </text>
      </g>
    </g>
  );
}

/**
 * A circuit breaker's state as a fixed-width pill: the word for the state, and a marker that slides along the pill's
 * foot between its three places (closed, testing, open), so the state machine reads as movement, not a swapped word.
 */
function BreakerPill({ state, x, y, k, s }: { state: keyof typeof PILL; x: number; y: number; k: number; s: number }) {
  const p = PILL[state];
  const b = badgeBox(PILL.half.word.length, k, s);
  const u = 1 / (k * s);
  const w = b.w / s;
  const h = b.h / s;
  const seg = (w - 8 * u) / 3;
  return (
    <g className={`badge pill badge-${p.tone}`} data-state={state} transform={`translate(${x - b.inset / s} ${y + b.dy / s})`}>
      <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} />
      <text textAnchor="middle" y={2.5 * u}>
        {p.word}
      </text>
      <rect className="pill-track" x={-w / 2 + 4 * u} y={h / 2 - 4 * u} width={w - 8 * u} height={1.5 * u} rx={0.75 * u} />
      <rect className="pill-marker" x={-w / 2 + 4 * u} y={h / 2 - 4.25 * u} width={seg} height={2 * u} rx={u} style={{ transform: `translateX(${p.at * seg}px)` }} />
    </g>
  );
}

/** A small uppercase tag on a node's shoulder: state on the right (DOWN, CUT OFF), role on the left (LEADER). */
function Badge({ text, tone, x, y, k, s, dir }: { text: string; tone: string; x: number; y: number; k: number; s: number; dir: 1 | -1 }) {
  const b = badgeBox(text.length, k, s);
  const u = 1 / (k * s);
  return (
    <g className={`badge badge-${tone}`} transform={`translate(${x - (dir * b.inset) / s} ${y + b.dy / s})`}>
      <rect x={-b.w / s / 2} y={-b.h / s / 2} width={b.w / s} height={b.h / s} rx={b.h / s / 2} />
      <text textAnchor="middle" y={4 * u}>
        {text}
      </text>
    </g>
  );
}

/** A cache's fill or a station's load, in 2% steps (the bar's own transition smooths between them). */
function meterOf(n: NodeRt): { kind: "cache" | "load"; level: number; tone?: string } | null {
  const step = (v: number) => Math.round(Math.min(1, v) * 50) / 50;
  if (n.spec.kind === "cache") {
    const cap = n.spec.capacity ?? 0;
    return { kind: "cache", level: step(cap ? n.cache.size / cap : 0) };
  }
  if ((n.spec.kind === "server" || n.spec.kind === "db") && n.spec.slots) {
    const load = Math.min(1, n.load);
    return { kind: "load", level: step(load), tone: load > 0.9 ? "bad" : load > 0.7 ? "warn" : "good" };
  }
  return null;
}

function Meter({ kind, level, tone, w, h, db }: { kind: "cache" | "load"; level: number; tone?: string; w: number; h: number; db: boolean }) {
  if (kind === "cache") {
    return (
      <g className="meter" transform={`translate(${-w / 2 + 12} ${h / 2 - 12})`}>
        <rect className="track" width={w - 24} height="5" rx="2.5" />
        <rect className="fill fill-cache" width={w - 24} height="5" rx="2.5" style={{ transform: `scaleX(${level})` }} />
      </g>
    );
  }
  return (
    <g className="meter" transform={`translate(${-w / 2 + 12} ${db ? h / 2 - 15 : h / 2 - 9})`}>
      <rect className="track" width={w - 24} height="3" rx="1.5" />
      <rect className={`fill fill-${tone}`} width={w - 24} height="3" rx="1.5" style={{ transform: `scaleX(${level})` }} />
    </g>
  );
}

/**
 * A node's state class, its secondary label (the long wording; `fitSub` shortens it for narrow layouts), its state
 * badge, and for a circuit breaker its state.
 */
function describe(sim: Sim, n: NodeRt, lbs: NodeRt[]): { cls: string; sub: string; badge?: { text: string; tone: string }; pill?: keyof typeof PILL } {
  const s = n.spec;
  if (!n.on) return { cls: "off", sub: "standby" };
  if (n.bootUntil) return { cls: "booting", sub: "starting…" };
  if (!n.ready) return { cls: "draining", sub: "draining" };
  const benched = lbs.some((lb) => sim.flat(lb.spec.to).includes(s.id) && lb.health.get(s.id)?.ok === false);
  if (!n.up) {
    const sub = s.sink ? "paused · jobs wait" : s.downMode === "hang" ? "not responding" : benched ? "down · taken out" : "down";
    return { cls: "down", sub, badge: { text: "DOWN", tone: "bad" } };
  }
  if (benched) return { cls: "benched", sub: "rejoining…" };
  let sub = "";
  const slots = s.slots ?? 0;
  const busy = n.work.length + n.held.length;
  switch (s.kind) {
    case "client": {
      const r = s.client?.rate;
      const rate = typeof r === "function" ? r(sim.t) : (r ?? 0);
      sub = `${Math.round(rate)} req/s`;
      break;
    }
    case "lb":
      if (s.autoscale) sub = `target ${Math.round(s.autoscale.target * 100)}% busy`;
      else if (s.algo === "hash") sub = `key → ${sim.flat(s.to).length} nodes`;
      else if (s.algo === "ring") sub = "ring of 64 points each";
      else if (s.health) sub = "checking health";
      else sub = s.algo === "least" ? "least busy" : s.algo === "random" ? "random" : "round robin";
      break;
    case "limiter":
      sub = `${s.limit?.rps}/s per client`;
      break;
    case "cache":
      sub = `${n.cache.size}/${s.capacity ?? 0} items`;
      break;
    case "queue":
      sub = `${n.queue.length} waiting`;
      break;
    case "topic":
      sub = `${sim.flat(s.to).length} subscribers`;
      break;
    default:
      if (!slots) sub = n.queue.length ? `stalled · ${n.queue.length} waiting` : "stalled";
      else if (n.queue.length) sub = `${n.queue.length} waiting`;
      else sub = `${busy}/${slots} busy`;
  }
  const pill = s.breaker ? n.breaker.state : undefined;
  const badge = s.kind === "db" && s.leader && sim.partitioned ? { text: "CUT OFF", tone: "bad" } : undefined;
  return { cls: n.hot ? "hot" : "", sub, badge, pill };
}
