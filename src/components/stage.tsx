"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
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
  nodeKey,
  pathD,
  placeAll,
  sceneOf,
  type Frame,
  type Mode,
  type Pt,
  type Rect,
  type Scene,
  labelSpot,
  railSpan,
  subCurve,
  type Side,
  type Size,
} from "@/lib/sim/layout";
import type { FxKind, Glyph, SceneSpec } from "@/lib/sim/types";
import { Body, slotSpots, type Spot } from "./glyph";

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

type Palette = Record<"req" | "ok" | "slow" | "err" | "stale" | "turned" | "ink" | "muted" | "font", string>;

interface FxDraw {
  kind: FxKind;
  x: number;
  y: number;
  r: number;
  born: number;
  vx: number;
  vy: number;
}

const TAU = Math.PI * 2;
const MAX_QUEUE_DRAWN = { wide: 24, compact: 18, tall: 12 };

/** Live scene: SVG stations underneath, a canvas of moving requests on top. It fills its box. */
export function Stage({
  sim,
  spec,
  mode,
  reduced,
  label,
  drawRef,
  frameSpecs,
}: {
  sim: Sim;
  spec: SceneSpec;
  mode: Mode | null;
  reduced: boolean;
  label: string;
  drawRef: RefObject<DrawFn | null>;
  /** Size the frame for all of these (every step of a lesson), so switching steps never rescales. */
  frameSpecs?: SceneSpec[];
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
  const live = useRef({ sim, reduced, layout, box });
  live.current = { sim, reduced, layout, box };
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
  });

  useEffect(() => {
    drawRef.current = (dt: number) => {
      const { sim, reduced, layout: L, box } = live.current;
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!L || !box || !canvas || !wrap) return;
      const mode = L.frame.mode;
      const s = st.current;
      const real = performance.now();
      if (s.sim !== sim) {
        // A different simulation (another step of the lesson): fade its requests in rather than popping.
        if (s.sim) s.switchAt = real;
        s.sim = sim;
        s.vis.clear();
        s.fx = [];
        s.lastFx = -1;
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
      const fade = reduced ? 1 : Math.min(1, (real - s.switchAt) / 260);

      const now = sim.now;
      const slo = sim.spec.sloMs;
      const R = dotRadius(L.frame);
      // Spacing of a waiting line: dots never overlap, however large they are drawn.
      const pitch = 2 * R + 2;
      const ease = 1 - Math.exp(-dt / 70);
      const next = new Map<number, Pt>();
      const place = (r: Req, target: Pt) => {
        const prev = s.vis.get(r.id);
        const p = prev && !reduced ? { x: prev.x + (target.x - prev.x) * ease, y: prev.y + (target.y - prev.y) * ease } : target;
        next.set(r.id, p);
        return p;
      };

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

      // Requests that are waiting, working or parked at a node.
      const positions = new Map<number, { p: Pt; work?: number; size?: number }>();
      const overflow: { x: number; y: number; n: number; inside: boolean }[] = [];
      const heldRings: { p: Pt; late: boolean; r: number }[] = [];
      for (const n of sim.list) {
        const b = L.boxes.get(n.spec.id);
        if (!b || !n.on) continue;
        const inside = n.spec.kind === "queue";
        // A queue node holds its line inside the body; elsewhere the line stops where the room to the left runs out.
        const cap = inside
          ? 2 * Math.floor((b.w / L.frame.scale - 24) / 11)
          : mode === "tall"
            ? MAX_QUEUE_DRAWN.tall
            : Math.min(MAX_QUEUE_DRAWN[mode], 3 * Math.max(1, Math.floor((b.room - 6) / pitch)));
        const cell = inside ? Math.min(R, 4.6 * L.frame.scale) : undefined;
        n.queue.forEach((r, i) => {
          if (i < cap) positions.set(r.id, { p: queueSpot(n, b, i, mode, pitch), size: cell });
          else if (i === cap) {
            const last = queueSpot(n, b, cap - 1, mode, pitch);
            overflow.push({ ...last, n: n.queue.length - cap, inside });
          }
        });
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
      for (const h of heldRings) {
        ctx.strokeStyle = h.late ? P.slow : P.req;
        ctx.beginPath();
        ctx.arc(h.p.x, h.p.y, h.r - 0.6, 0, TAU);
        ctx.stroke();
      }

      for (const r of sim.reqs) {
        if (r.phase === "gone") continue;
        const look = styleOf(r, now, slo, P);
        if (!look) continue;
        let p: Pt | null = null;
        let work: number | undefined;
        let base = look.small ? R * 0.5 : R;
        if (r.phase === "travel") {
          const e = path(r.from, r.to);
          if (!e) continue;
          const span = r.t1 - r.t0;
          const prog = span > 0 ? Math.min(1, Math.max(0, (now - r.t0) / span)) : 1;
          const t = e.tA + (e.tB - e.tA) * prog;
          const a = bezier(e.c, t);
          const b2 = bezier(e.c, Math.min(1, t + 0.01));
          const dx = b2.x - a.x;
          const dy = b2.y - a.y;
          const d = Math.hypot(dx, dy) || 1;
          const lane = look.small ? 0 : 4 * Math.max(1, L.frame.scale);
          p = { x: a.x - (dy / d) * lane, y: a.y + (dx / d) * lane };
          next.set(r.id, p);
        } else {
          const pos = positions.get(r.id);
          if (!pos) continue;
          p = place(r, pos.p);
          work = pos.work;
          if (pos.size && !look.small) base = pos.size;
        }
        let size = base * (r.cost > 1 ? 1.35 : 1);
        if (r.phase === "travel" && !reduced) {
          // Requests grow out of the client and shrink back into it, so they don't pop in and out.
          const span = r.t1 - r.t0;
          const prog = span > 0 ? Math.min(1, Math.max(0, (now - r.t0) / span)) : 1;
          const atClient = (id: string) => sim.nodes.get(id)?.spec.kind === "client";
          if (r.dir === 1 && atClient(r.from) && prog < 0.18) size *= 0.45 + (0.55 * prog) / 0.18;
          if (r.dir === -1 && atClient(r.to) && prog > 0.82) size *= 1 - (0.6 * (prog - 0.82)) / 0.18;
        }
        ctx.globalAlpha = look.alpha * fade;
        ctx.fillStyle = look.color;
        ctx.strokeStyle = look.color;
        if (work !== undefined && !reduced) {
          ctx.globalAlpha = look.alpha * 0.3 * fade;
          shape(ctx, look.shape, p.x, p.y, size);
          ctx.globalAlpha = look.alpha * fade;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.arc(p.x, p.y, size, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - work));
          ctx.closePath();
          ctx.fill();
        } else {
          shape(ctx, look.shape, p.x, p.y, size);
        }
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

      // Effects: hit and miss rings, drops falling off the stage, crashes.
      for (const f of sim.fx) {
        if (f.t <= s.lastFx) continue;
        const b = L.boxes.get(f.node);
        if (!b) continue;
        const key = `${f.node}:${f.kind}`;
        if (real - (s.throttle.get(key) ?? 0) < 70) continue;
        s.throttle.set(key, real);
        s.fx.push({
          kind: f.kind,
          x: b.x,
          y: b.y,
          r: Math.max(b.w, b.h) / 2,
          born: real,
          vx: (Math.random() - 0.5) * 70,
          vy: -70 - Math.random() * 40,
        });
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
    <div className="stage" ref={wrapRef} data-mode={layout?.frame.mode ?? "auto"} data-hits={layout?.frame.hits}>
      {(layout ? [layout] : (guesses ?? [])).map((l) => (
        <StageSvg key={l.frame.mode} sim={sim} spec={spec} layout={l} edges={edges} label={label} reduced={reduced} />
      ))}
      <canvas ref={canvasRef} className="stage-canvas" aria-hidden="true" />
    </div>
  );
}

function StageSvg({
  sim,
  spec,
  layout,
  edges,
  label,
  reduced,
}: {
  sim: Sim;
  spec: SceneSpec;
  layout: Layout;
  edges: ReturnType<typeof edgesOf>;
  label: string;
  reduced: boolean;
}) {
  const { frame, boxes } = layout;
  const lbViews = [...sim.nodes.values()].filter((n) => n.spec.health);
  const leaders = new Set(spec.nodes.flatMap((n) => (n.leader ? [n.leader] : [])));
  // Nodes that appear after the scene has settled (a step adds a cache, a queue…) get a one-time accent ring.
  const born = useRef(performance.now());
  const seen = useRef(new Map<string, number>());
  const now = performance.now();
  const fresh = (id: string) => {
    let until = seen.current.get(id);
    if (until === undefined) {
      until = now - born.current > 500 ? now + 900 : 0;
      seen.current.set(id, until);
    }
    return !reduced && now < until;
  };
  const k = frame.k;
  return (
    <svg
      className={`stage-svg stage-${frame.mode}`}
      viewBox={`0 0 ${frame.W} ${frame.H}`}
      role="img"
      aria-label={label}
      style={{ "--k": k } as CSSProperties}
    >
      <g className="links">
        {edges.map((e) => {
          const a = boxes.get(e.a);
          const b = boxes.get(e.b);
          const A = sim.nodes.get(e.a);
          const B = sim.nodes.get(e.b);
          if (!a || !b || !A?.on || !B?.on) return null;
          const c = curve(a, b, frame.mode);
          const cut = sim.partitioned && !!A.spec.region && !!B.spec.region && A.spec.region !== B.spec.region;
          const mid = bezier(c, 0.5);
          const text = spec.linkLabels?.[`${e.a}>${e.b}`] ?? spec.linkLabels?.[`${e.b}>${e.a}`];
          const upright = Math.abs(b.x - a.x) < Math.abs(b.y - a.y);
          const [t0, t1] = railSpan(a, b, frame.mode, k);
          const d = pathD(subCurve(c, t0, t1));
          return (
            <g key={`${e.a}~${e.b}`} className={`link-g ${e.style}${cut ? " cut" : ""}`}>
              {e.style === "flow" ? (
                <>
                  <path className="rail" d={d} />
                  <path className="rail-core" d={d} />
                </>
              ) : (
                <path className="link sync" d={d} />
              )}
              {cut && (
                <g className="cut-mark" transform={`translate(${mid.x} ${mid.y}) scale(${1 / Math.max(0.6, k)})`}>
                  <circle r="11" />
                  <path d="M-4.5-4.5l9 9M4.5-4.5l-9 9" />
                </g>
              )}
              {text && !cut && (
                <text
                  className="link-label"
                  x={upright ? mid.x + 12 / k : mid.x}
                  y={upright ? mid.y + 4 / k : mid.y - 10 / k}
                  textAnchor={upright ? "start" : "middle"}
                >
                  {text}
                </text>
              )}
            </g>
          );
        })}
      </g>
      <g className="nodes">
        {spec.nodes.map((n) => {
          const b = boxes.get(n.id)!;
          const rt = sim.nodes.get(n.id);
          if (!rt) return null;
          const { cls, sub: long, badge } = describe(sim, rt, lbViews);
          const detail = fitSub(long, frame.mode);
          const role = n.leader ? "FOLLOWER" : leaders.has(n.id) ? "LEADER" : null;
          const size = SIZES[b.glyph];
          const s = frame.scale;
          // CSS px to the node's own units: stage text keeps its size however the scene is scaled.
          const u = 1 / (k * s);
          // In the compact phone layout, secondary labels appear only when they carry news.
          const sub = frame.mode !== "compact" || cls || rt.queue.length || n.kind === "cache" || n.kind === "queue" ? detail : "";
          const block = TEXT.label * TEXT.line + (sub ? TEXT.sub * TEXT.line : 0);
          // The layout's spot, in viewBox units, brought into the node's own (scaled) units.
          const spot = labelSpot(b.side, size.w * s, size.h * s, block / k, k);
          const top = spot.top / s;
          const x = spot.x / s;
          return (
            // Outer group glides between positions; inner group plays the one-time entrance.
            <g key={n.id} className="node-pos" style={{ transform: `translate(${b.x}px, ${b.y}px) scale(${s})`, "--ns": s } as CSSProperties}>
              <g className={`node g-${b.glyph} ${cls}`}>
                {fresh(n.id) && <rect className="fresh-ring" x={-size.w / 2 - 8} y={-size.h / 2 - 8} width={size.w + 16} height={size.h + 16} rx="16" />}
                <Body glyph={b.glyph} w={size.w} h={size.h} slots={rt.spec.slots ?? 0} />
                {meter(rt, size.w, size.h)}
                {b.plate && (
                  // A sign over the track: the rail it could not avoid passes under the label.
                  <rect
                    className="label-plate"
                    x={(b.plate.x - b.x) / s - 3 * u}
                    y={(b.plate.y - b.y) / s - 2 * u}
                    width={b.plate.w / s + 6 * u}
                    height={b.plate.h / s + 4 * u}
                    rx={4 * u}
                  />
                )}
                <text className="node-label" x={x} y={top + TEXT.label * u} textAnchor={spot.anchor}>
                  {n.label}
                </text>
                {sub && (
                  <text className="node-sub" x={x} y={top + (TEXT.label * TEXT.line + TEXT.sub) * u} textAnchor={spot.anchor}>
                    {sub}
                  </text>
                )}
                {badge && <Badge text={badge.text} tone={badge.tone} x={size.w / 2} y={-size.h / 2} k={k} s={s} dir={1} />}
                {role && <Badge text={role} tone="role" x={-size.w / 2} y={-size.h / 2} k={k} s={s} dir={-1} />}
              </g>
            </g>
          );
        })}
      </g>
    </svg>
  );
}


/** A small uppercase tag on a node's shoulder: state on the right (DOWN, OPEN), role on the left (LEADER). */
function Badge({ text, tone, x, y, k, s, dir }: { text: string; tone: string; x: number; y: number; k: number; s: number; dir: 1 | -1 }) {
  const b = badgeBox(text.length, k, s);
  const u = 1 / (k * s);
  return (
    <g className={`badge badge-${tone}`} transform={`translate(${x - dir * b.inset / s} ${y + b.dy / s})`}>
      <rect x={-b.w / s / 2} y={-b.h / s / 2} width={b.w / s} height={b.h / s} rx={(b.h / s) / 2} />
      <text textAnchor="middle" y={4 * u}>
        {text}
      </text>
    </g>
  );
}

function meter(n: NodeRt, w: number, h: number) {
  const k = n.spec.kind;
  if (k === "cache") {
    const cap = n.spec.capacity ?? 0;
    const fill = cap ? Math.min(1, n.cache.size / cap) : 0;
    return (
      <g className="meter" transform={`translate(${-w / 2 + 12} ${h / 2 - 12})`}>
        <rect className="track" width={w - 24} height="5" rx="2.5" />
        <rect className="fill fill-cache" width={w - 24} height="5" rx="2.5" style={{ transform: `scaleX(${fill})` }} />
      </g>
    );
  }
  if ((k === "server" || k === "db") && n.spec.slots) {
    const load = Math.min(1, n.load);
    const tone = load > 0.9 ? "bad" : load > 0.7 ? "warn" : "good";
    const y = k === "db" ? h / 2 - 15 : h / 2 - 9;
    return (
      <g className="meter" transform={`translate(${-w / 2 + 12} ${y})`}>
        <rect className="track" width={w - 24} height="3" rx="1.5" />
        <rect className={`fill fill-${tone}`} width={w - 24} height="3" rx="1.5" style={{ transform: `scaleX(${load})` }} />
      </g>
    );
  }
  return null;
}

/** A node's state class, its secondary label (the long wording; `fitSub` shortens it for narrow layouts) and its state badge. */
function describe(sim: Sim, n: NodeRt, lbs: NodeRt[]): { cls: string; sub: string; badge?: { text: string; tone: string } } {
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
  const hot = slots > 0 && (n.queue.length > slots * 2 || (n.load > 0.92 && n.queue.length > 0));
  let badge: { text: string; tone: string } | undefined;
  if (s.breaker) {
    const b = n.breaker.state;
    badge = b === "open" ? { text: "OPEN", tone: "bad" } : b === "half" ? { text: "TESTING", tone: "warn" } : { text: "CLOSED", tone: "good" };
  }
  if (s.kind === "db" && s.leader && sim.partitioned) badge = { text: "CUT OFF", tone: "bad" };
  return { cls: hot ? "hot" : "", sub, badge };
}

function queueSpot(n: NodeRt, b: Box, i: number, mode: Mode, pitch: number): Pt {
  if (n.spec.kind === "queue") {
    const s = b.h / 46;
    const cols = Math.floor((b.w / s - 24) / 11);
    const row = Math.floor(i / cols) % 2;
    const col = i % cols;
    return { x: b.x + b.w / 2 - (17 + col * 11) * s, y: b.y + (row ? 7 : -7) * s };
  }
  if (mode !== "tall") {
    const col = Math.floor(i / 3);
    const row = i % 3;
    return { x: b.x - b.w / 2 - pitch / 2 - 4 - col * pitch, y: b.y + (row - 1) * pitch };
  }
  // Phones: rows of four stacked upward, at most three rows, so the line never reaches the node above.
  const row = Math.floor(i / 4);
  const col = i % 4;
  return { x: b.x + (col - 1.5) * pitch, y: b.y - b.h / 2 - pitch / 2 - 4 - row * pitch };
}

function parkSpot(b: Box, i: number, mode: Mode, pitch: number): Pt {
  const col = i % 6;
  const row = Math.floor(i / 6);
  if (mode !== "tall") return { x: b.x - 2.5 * pitch + col * pitch, y: b.y - b.h / 2 - pitch / 2 - 4 - row * pitch };
  return { x: b.x + b.w / 2 + pitch / 2 + 4 + row * pitch, y: b.y - 2.5 * pitch + col * pitch };
}

type Shape = "circle" | "donut" | "diamond" | "square" | "ring";

function styleOf(r: Req, now: number, slo: number, P: Palette): { color: string; shape: Shape; alpha: number; small?: boolean } | null {
  if (r.op === "probe") return { color: P.muted, shape: "ring", alpha: 0.9, small: true };
  if (r.op === "repl") return { color: P.muted, shape: "circle", alpha: 0.85, small: true };
  if (r.orphanAt || r.abandoned) return { color: P.err, shape: "ring", alpha: 0.55 };
  if (r.detached) return { color: P.req, shape: "square", alpha: 1 };
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

function shape(ctx: CanvasRenderingContext2D, kind: Shape, x: number, y: number, r: number) {
  ctx.beginPath();
  switch (kind) {
    case "circle":
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      return;
    case "donut":
      ctx.arc(x, y, r, 0, TAU);
      ctx.arc(x, y, r * 0.42, 0, TAU, true);
      ctx.fill();
      return;
    case "diamond": {
      const d = r * 1.3;
      ctx.moveTo(x, y - d);
      ctx.lineTo(x + d, y);
      ctx.lineTo(x, y + d);
      ctx.lineTo(x - d, y);
      ctx.closePath();
      ctx.fill();
      return;
    }
    case "square":
      ctx.roundRect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8, 1.5);
      ctx.fill();
      return;
    case "ring":
      ctx.lineWidth = Math.max(1.6, r * 0.28);
      ctx.arc(x, y, Math.max(1, r - 0.8), 0, TAU);
      ctx.stroke();
      return;
  }
}

const FX_LIFE: Partial<Record<FxKind, number>> = { drop: 900, crash: 1100, recover: 1100, boot: 900, open: 900, close: 900 };

function drawFx(ctx: CanvasRenderingContext2D, f: FxDraw, real: number, P: Palette, reduced: boolean, R: number) {
  const life = FX_LIFE[f.kind] ?? 480;
  const age = real - f.born;
  if (age > life) return false;
  const u = age / life;
  const color =
    f.kind === "hit" || f.kind === "recover" || f.kind === "close" || f.kind === "done"
      ? P.ok
      : f.kind === "miss"
        ? P.slow
        : f.kind === "reject"
          ? P.turned
          : f.kind === "boot"
            ? P.req
            : P.err;
  if (f.kind === "drop" && !reduced) {
    const s = age / 1000;
    const x = f.x + f.vx * s;
    const y = f.y + f.vy * s + 0.5 * 700 * s * s;
    ctx.globalAlpha = 1 - u;
    ctx.fillStyle = color;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(s * 6);
    shape(ctx, "diamond", 0, 0, R * 0.72);
    ctx.restore();
    ctx.globalAlpha = 1;
    return true;
  }
  const big = f.kind === "crash" || f.kind === "recover" || f.kind === "open" || f.kind === "close" || f.kind === "boot";
  const grow = reduced ? 0 : (big ? 34 : 14) * (1 - Math.pow(1 - u, 3));
  ctx.globalAlpha = (1 - u) * (big ? 0.8 : 0.55);
  ctx.strokeStyle = color;
  ctx.lineWidth = big ? 3 : 2;
  ctx.beginPath();
  ctx.arc(f.x, f.y, f.r * (f.kind === "done" ? 0.4 : 0.62) + grow, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 1;
  return true;
}
