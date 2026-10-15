"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { NodeRt, Req, Sim } from "@/lib/sim/engine";
import { SIZES, bezier, curve, edgesOf, frameFor, glyphOf, pathD, type Frame, type Mode, type Pt } from "@/lib/sim/layout";
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
  /** Where the label goes: below, or beside the node when below would sit in the path of traffic or a neighbour. */
  side: "below" | "right" | "left";
}

interface Layout {
  frame: Frame;
  boxes: Map<string, Box>;
}

/** Lay out `spec` inside a frame sized for `frameSpec` (all steps of a lesson), so switching steps never rescales. */
function layoutFor(spec: SceneSpec, mode: Mode, frameSpec: SceneSpec = spec, zoom = 1): Layout {
  const base = frameFor(frameSpec, mode);
  const frame = zoom === 1 ? base : { ...base, scale: base.scale * zoom };
  const boxes = new Map<string, Box>();
  for (const n of spec.nodes) {
    const glyph = glyphOf(n);
    const size = SIZES[glyph];
    const p = frame.pos(n.at);
    const s = frame.scale;
    boxes.set(n.id, {
      id: n.id,
      ...p,
      w: size.w * s,
      h: size.h * s,
      glyph,
      spots: slotSpots(glyph, size.w, size.h, n.slots ?? 0).map((q) => ({ x: p.x + q.x * s, y: p.y + q.y * s, r: q.r * s })),
      side: "below",
    });
  }
  if (mode !== "tall") {
    // Crowded columns, or a link running straight down through the label: put labels on the right.
    const linked = new Set(edgesOf(spec).flatMap((e) => [`${e.a}~${e.b}`, `${e.b}~${e.a}`]));
    for (const a of boxes.values()) {
      for (const b of boxes.values()) {
        if (a === b || Math.abs(a.x - b.x) > 4) continue;
        const gap = Math.abs(a.y - b.y);
        if (gap < a.h / 2 + b.h / 2 + 44 || linked.has(`${a.id}~${b.id}`)) a.side = "right";
      }
    }
  } else {
    // Phones: traffic flows down through anything below a node, so labels go beside it when there's room.
    const specs = new Map(spec.nodes.map((n) => [n.id, n]));
    for (const a of boxes.values()) {
      const n = specs.get(a.id)!;
      const need = Math.max(n.label.length * 8.6, 78) + 12;
      // Toward a neighbour, a label may only use half the gap; the neighbour may want the other half.
      const row = [...boxes.values()].filter((b) => b !== a && Math.abs(b.y - a.y) < 4);
      const rightN = row.filter((b) => b.x > a.x).map((b) => (b.x - b.w / 2 - (a.x + a.w / 2)) / 2);
      const leftN = row.filter((b) => b.x < a.x).map((b) => (a.x - a.w / 2 - (b.x + b.w / 2)) / 2);
      const right = Math.min(frame.W - (a.x + a.w / 2), ...rightN);
      const left = Math.min(a.x - a.w / 2, ...leftN);
      a.side = right >= need ? "right" : left >= need ? "left" : "below";
    }
  }
  return { frame, boxes };
}

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

/** Pick the layout that draws the scene biggest in the available box; ties go to the wide layout. */
const LABEL_PX: Record<Mode, number> = { wide: 13.5, compact: 16, tall: 16 };

/** Pick the layout whose labels come out largest on screen; the wide desktop layout wins whenever it reads well. */
function pickMode(layouts: Record<Mode, Layout>, box: { w: number; h: number }): Mode {
  const fit = (m: Mode) => Math.min(box.w / layouts[m].frame.W, box.h / layouts[m].frame.H);
  if (fit("wide") >= 0.74) return "wide";
  return (["wide", "compact", "tall"] as Mode[]).sort((a, b) => fit(b) * LABEL_PX[b] - fit(a) * LABEL_PX[a])[0];
}

/** Live scene: SVG stations underneath, a canvas of moving requests on top. It fills its box. */
export function Stage({
  sim,
  spec,
  mode,
  reduced,
  label,
  drawRef,
  frameSpec,
}: {
  sim: Sim;
  spec: SceneSpec;
  mode: Mode | null;
  reduced: boolean;
  label: string;
  drawRef: RefObject<DrawFn | null>;
  /** Size the frame for this spec instead (e.g. every step of a lesson combined). */
  frameSpec?: SceneSpec;
}) {
  const base = useMemo(
    () => ({
      wide: layoutFor(spec, "wide", frameSpec),
      compact: layoutFor(spec, "compact", frameSpec),
      tall: layoutFor(spec, "tall", frameSpec),
    }),
    [spec, frameSpec],
  );
  const lanes = useMemo(() => {
    const per = new Map<number, number>();
    for (const n of (frameSpec ?? spec).nodes) per.set(n.at[0], (per.get(n.at[0]) ?? 0) + 1);
    return Math.max(...per.values());
  }, [spec, frameSpec]);
  const edges = useMemo(() => edgesOf(spec), [spec]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
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
  const fitMode = box ? pickMode(base, box) : mode;
  // A wide stage with plenty of spare height draws its stations a little larger (uncrowded scenes only).
  const zoom = useMemo(() => {
    if (!box || fitMode !== "wide" || lanes > 3) return 1;
    const f = base.wide.frame;
    const slack = box.h / box.w / (f.H / f.W);
    return Math.round(Math.min(1.2, Math.max(1, 1 + (slack - 1.4) * 0.25)) * 20) / 20;
  }, [box, fitMode, lanes, base]);
  const layouts = useMemo(
    () => (zoom === 1 ? base : { ...base, wide: layoutFor(spec, "wide", frameSpec, zoom) }),
    [base, zoom, spec, frameSpec],
  );
  const live = useRef({ sim, spec, mode: fitMode, reduced, layouts });
  live.current = { sim, spec, mode: fitMode, reduced, layouts };
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
      const { sim, mode, reduced, layouts } = live.current;
      const canvas = canvasRef.current;
      const wrap = wrapRef.current;
      if (!mode || !canvas || !wrap) return;
      const L = layouts[mode];
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
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
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
      const R = 5.2 * Math.max(0.85, L.frame.scale);
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
          // On phones a label below a node sits in the path of traffic leaving downward: start and end beneath it.
          const under = (n: Box, other: Box) => mode === "tall" && n.side === "below" && other.y > n.y + 4;
          const ra = under(a, b) ? a.h / 2 + 40 : Math.min(a.w, a.h) / 2 + 3;
          const rb = under(b, a) ? b.h / 2 + 40 : Math.min(b.w, b.h) / 2 + 3;
          const tA = Math.min(0.4, ra / len);
          const tB = Math.max(0.6, 1 - rb / len);
          e = { c, tA, tB };
          s.paths.set(key, e);
        }
        return e;
      };

      // Requests that are waiting, working or parked at a node.
      const positions = new Map<number, { p: Pt; work?: number }>();
      const overflow: { x: number; y: number; n: number; inside: boolean }[] = [];
      const heldRings: { p: Pt; late: boolean; r: number }[] = [];
      for (const n of sim.list) {
        const b = L.boxes.get(n.spec.id);
        if (!b || !n.on) continue;
        const cap = n.spec.kind === "queue" ? 2 * Math.floor((b.w / L.frame.scale - 24) / 11) : MAX_QUEUE_DRAWN[mode];
        n.queue.forEach((r, i) => {
          if (i < cap) positions.set(r.id, { p: queueSpot(n, b, i, mode) });
          else if (i === cap) {
            const last = queueSpot(n, b, cap - 1, mode);
            overflow.push({ ...last, n: n.queue.length - cap, inside: n.spec.kind === "queue" });
          }
        });
        n.work.forEach((r, i) => {
          const spot = b.spots[i];
          const pct = r.doneAt > r.started ? Math.min(1, (now - r.started) / (r.doneAt - r.started)) : 1;
          positions.set(r.id, { p: spot ?? { x: b.x, y: b.y }, work: pct });
        });
        n.held.forEach((r, j) => {
          const spot = b.spots[n.work.length + j];
          if (spot) heldRings.push({ p: spot, late: now - r.first > slo, r: spot.r });
        });
        let pi = 0;
        for (const r of n.parked) {
          if (r.phase !== "parked") continue;
          positions.set(r.id, { p: parkSpot(b, pi++, mode) });
        }
        for (const list of n.waiters.values()) {
          for (const r of list) {
            if (r.phase !== "parked") continue;
            positions.set(r.id, { p: parkSpot(b, pi++, mode) });
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
          const lane = look.small ? 0 : 4;
          p = { x: a.x - (dy / d) * lane, y: a.y + (dx / d) * lane };
          next.set(r.id, p);
        } else {
          const pos = positions.get(r.id);
          if (!pos) continue;
          p = place(r, pos.p);
          work = pos.work;
        }
        let size = (look.small ? 3.2 : R) * (r.cost > 1 ? 1.35 : 1);
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
        ctx.font = `600 11px ${P.font}`;
        ctx.textAlign = "center";
        for (const o of overflow) {
          if (o.inside) ctx.fillText(`+${o.n}`, o.x - 4, o.y - 12);
          else if (mode !== "tall") ctx.fillText(`+${o.n}`, o.x - 18, o.y + 4);
          else ctx.fillText(`+${o.n}`, o.x + 22, o.y + 4);
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
      s.fx = s.fx.filter((f) => drawFx(ctx, f, real, P, reduced));
    };
    return () => {
      drawRef.current = null;
    };
  }, [drawRef]);

  const modes: Mode[] = fitMode ? [fitMode] : ["wide", "compact"];

  return (
    <div className="stage" ref={wrapRef} data-mode={fitMode ?? "auto"}>
      {modes.map((m) => (
        <StageSvg key={m} sim={sim} spec={spec} layout={layouts[m]} edges={edges} label={label} />
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
}: {
  sim: Sim;
  spec: SceneSpec;
  layout: Layout;
  edges: ReturnType<typeof edgesOf>;
  label: string;
}) {
  const { frame, boxes } = layout;
  const lbViews = [...sim.nodes.values()].filter((n) => n.spec.health);
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
    return now < until;
  };
  return (
    <svg className={`stage-svg stage-${frame.mode}`} viewBox={`0 0 ${frame.W} ${frame.H}`} role="img" aria-label={label}>
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
          return (
            <g key={`${e.a}~${e.b}`} className="link-g">
              <path className={`link ${e.style}${cut ? " cut" : ""}`} d={pathD(c)} />
              {cut && (
                <g className="cut-mark" transform={`translate(${mid.x} ${mid.y})`}>
                  <circle r="11" />
                  <path d="M-4.5-4.5l9 9M4.5-4.5l-9 9" />
                </g>
              )}
              {text && !cut && (
                <text className="link-label" x={upright ? mid.x + 14 : mid.x} y={upright ? mid.y + 4 : mid.y - 12} textAnchor={upright ? "start" : "middle"}>
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
          const { cls, sub: detail, badge } = describe(sim, rt, lbViews);
          const size = SIZES[b.glyph];
          // In the compact phone layout, secondary labels appear only when they carry news.
          const sub = frame.mode !== "compact" || cls || rt.queue.length || n.kind === "cache" || n.kind === "queue" ? detail : "";
          return (
            // Outer group glides between positions; inner group plays the one-time entrance.
            <g key={n.id} className="node-pos" style={{ transform: `translate(${b.x}px, ${b.y}px) scale(${frame.scale})` }}>
              <g className={`node g-${b.glyph} ${cls}`}>
              {fresh(n.id) && <rect className="fresh-ring" x={-size.w / 2 - 8} y={-size.h / 2 - 8} width={size.w + 16} height={size.h + 16} rx="18" />}
              <Body glyph={b.glyph} w={size.w} h={size.h} slots={rt.spec.slots ?? 0} />
              {meter(rt, size.w, size.h)}
              <text className="node-label" x={labelX(b, size.w)} y={b.side === "below" ? size.h / 2 + 17 : -2} textAnchor={ANCHOR[b.side]}>
                {n.label}
              </text>
              {sub && (
                <text className="node-sub" x={labelX(b, size.w)} y={b.side === "below" ? size.h / 2 + 31 : 14} textAnchor={ANCHOR[b.side]}>
                  {sub}
                </text>
              )}
              {badge && (
                <g className={`badge badge-${badge.tone}`} transform={`translate(${size.w / 2 - 6} ${-size.h / 2 - 2})`}>
                  <rect x={-badge.w / 2} y="-9" width={badge.w} height="18" rx="9" />
                  <text textAnchor="middle" y="4">
                    {badge.text}
                  </text>
                </g>
              )}
              </g>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

const ANCHOR = { below: "middle", right: "start", left: "end" } as const;

function labelX(b: Box, w: number) {
  return b.side === "right" ? w / 2 + 10 : b.side === "left" ? -w / 2 - 10 : 0;
}

function meter(n: NodeRt, w: number, h: number) {
  const k = n.spec.kind;
  if (k === "cache") {
    const cap = n.spec.capacity ?? 0;
    const fill = cap ? Math.min(1, n.cache.size / cap) : 0;
    return (
      <g className="meter" transform={`translate(${-w / 2 + 12} ${h / 2 - 12})`}>
        <rect className="track" width={w - 24} height="5" rx="2.5" />
        <rect className="fill fill-cache" width={(w - 24) * fill} height="5" rx="2.5" />
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
        <rect className={`fill fill-${tone}`} width={(w - 24) * load} height="3" rx="1.5" />
      </g>
    );
  }
  return null;
}

function describe(sim: Sim, n: NodeRt, lbs: NodeRt[]): { cls: string; sub: string; badge?: { text: string; tone: string; w: number } } {
  const s = n.spec;
  if (!n.on) return { cls: "off", sub: "standby" };
  if (n.bootUntil) return { cls: "booting", sub: "starting…" };
  if (!n.ready) return { cls: "draining", sub: "draining" };
  const benched = lbs.some((lb) => sim.flat(lb.spec.to).includes(s.id) && lb.health.get(s.id)?.ok === false);
  if (!n.up) {
    const sub = s.sink ? "paused · jobs wait" : s.downMode === "hang" ? "not responding" : benched ? "down · taken out" : "down";
    return { cls: "down", sub, badge: { text: "DOWN", tone: "bad", w: 44 } };
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
  let badge: { text: string; tone: string; w: number } | undefined;
  if (s.breaker) {
    const b = n.breaker.state;
    badge = b === "open" ? { text: "OPEN", tone: "bad", w: 46 } : b === "half" ? { text: "TESTING", tone: "warn", w: 62 } : { text: "CLOSED", tone: "good", w: 56 };
  }
  if (s.kind === "db" && s.leader && sim.partitioned) badge = { text: "CUT OFF", tone: "bad", w: 62 };
  return { cls: hot ? "hot" : "", sub, badge };
}

function queueSpot(n: NodeRt, b: Box, i: number, mode: Mode): Pt {
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
    return { x: b.x - b.w / 2 - 12 - col * 12, y: b.y + (row - 1) * 12 };
  }
  // Phones: rows of four stacked upward, at most three rows, so the line never reaches the node above.
  const row = Math.floor(i / 4);
  const col = i % 4;
  return { x: b.x + (col - 1.5) * 11, y: b.y - b.h / 2 - 11 - row * 11 };
}

function parkSpot(b: Box, i: number, mode: Mode): Pt {
  const col = i % 6;
  const row = Math.floor(i / 6);
  if (mode !== "tall") return { x: b.x - 30 + col * 12, y: b.y - b.h / 2 - 14 - row * 12 };
  return { x: b.x + b.w / 2 + 14 + row * 12, y: b.y - 30 + col * 12 };
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
      ctx.lineWidth = 1.6;
      ctx.arc(x, y, Math.max(1, r - 0.8), 0, TAU);
      ctx.stroke();
      return;
  }
}

const FX_LIFE: Partial<Record<FxKind, number>> = { drop: 900, crash: 1100, recover: 1100, boot: 900, open: 900, close: 900 };

function drawFx(ctx: CanvasRenderingContext2D, f: FxDraw, real: number, P: Palette, reduced: boolean) {
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
    shape(ctx, "diamond", 0, 0, 4.6);
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
