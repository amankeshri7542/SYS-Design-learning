import type { Glyph, NodeSpec, SceneSpec } from "./types";

/** wide: desktop. compact: phones and short boxes (tighter, slightly smaller). tall: narrow, tall boxes. */
export type Mode = "wide" | "compact" | "tall";
export type Pt = { x: number; y: number };

export interface Size {
  w: number;
  h: number;
}

export const SIZES: Record<Glyph, Size> = {
  client: { w: 76, h: 56 },
  bot: { w: 76, h: 56 },
  lb: { w: 64, h: 64 },
  router: { w: 64, h: 64 },
  limiter: { w: 64, h: 64 },
  topic: { w: 64, h: 64 },
  server: { w: 96, h: 62 },
  worker: { w: 96, h: 62 },
  cache: { w: 96, h: 58 },
  edge: { w: 96, h: 58 },
  db: { w: 88, h: 72 },
  queue: { w: 156, h: 46 },
};

export function glyphOf(n: NodeSpec): Glyph {
  return n.glyph ?? n.kind;
}

export interface Frame {
  mode: Mode;
  W: number;
  H: number;
  scale: number;
  pos: (at: [number, number]) => Pt;
}

/**
 * Map layout coordinates (along, across) to a viewBox.
 * Wide screens use them directly; phones get the same graph turned on its side, one evenly spaced row per step.
 */
export function frameFor(spec: SceneSpec, mode: Mode): Frame {
  const vs = spec.nodes.map((n) => n.at[1]);
  const vmin = Math.min(...vs);
  const vmax = Math.max(...vs);
  const vmid = (vmin + vmax) / 2;
  if (mode !== "tall") {
    const c = mode === "compact";
    const W = c ? 620 : 960;
    const px = c ? 50 : 84;
    const ys = c ? 0.8 : 1;
    const scale = c ? 0.84 : 1;
    const x = (u: number) => px + (u / 100) * (W - 2 * px);
    if (spec.wideH) {
      const H = spec.wideH * ys;
      const py = 58 * ys;
      return { mode, W, H, scale, pos: ([u, v]) => ({ x: x(u), y: py + (v / 100) * (H - 2 * py) }) };
    }
    const k = 3.4 * ys;
    const H = Math.max(c ? 210 : 250, (c ? 116 : 130) + (vmax - vmin) * k);
    return { mode, W, H, scale, pos: ([u, v]) => ({ x: x(u), y: H / 2 + (v - vmid) * k }) };
  }
  const groups = groupBy(spec.nodes, (n) => n.at[0]);
  const steps = [...groups.keys()].sort((a, b) => a - b);
  // Rows with one node put its label beside it, so they pack tighter; rows of several need room for labels below.
  const ys = new Map<number, number>();
  const py = 64;
  let y = py;
  steps.forEach((u, i) => {
    if (i > 0) y += (groups.get(steps[i - 1])!.length > 1 ? 170 : 128);
    ys.set(u, y);
  });
  const H = Math.max(300, y + py);
  const k = 4.6;
  const W = Math.min(480, Math.max(360, 150 + (vmax - vmin) * k));
  let gap = Infinity;
  for (const g of groups.values()) {
    const across = g.map((n) => n.at[1]).sort((a, b) => a - b);
    for (let i = 1; i < across.length; i++) gap = Math.min(gap, (across[i] - across[i - 1]) * k);
  }
  const scale = Number.isFinite(gap) ? Math.min(1, Math.max(0.7, (gap - 12) / 96)) : 1;
  return {
    mode,
    W,
    H,
    scale,
    pos: ([u, v]) => ({ x: W / 2 + (v - vmid) * k, y: ys.get(u) ?? py }),
  };
}

function groupBy<T>(xs: T[], key: (x: T) => number) {
  const m = new Map<number, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}

export interface Edge {
  a: string;
  b: string;
  style: "flow" | "sync";
}

/** Every link a request can travel along, derived from the node specs. */
export function edgesOf(spec: SceneSpec): Edge[] {
  const seen = new Set<string>();
  const out: Edge[] = [];
  const add = (a: string, b: string, style: Edge["style"]) => {
    const k = [a, b].sort().join("~");
    if (seen.has(k) || a === b) return;
    seen.add(k);
    out.push({ a, b, style });
  };
  const ids = new Set(spec.nodes.map((n) => n.id));
  const flat = (c: NodeSpec["to"]) => (c ?? []).flatMap((x) => (Array.isArray(x) ? x : [x]));
  for (const n of spec.nodes) {
    const targets = [...flat(n.to), ...flat(n.calls?.read), ...flat(n.calls?.write)];
    if (n.leader) targets.push(n.leader);
    for (const t of targets) if (ids.has(t)) add(n.id, t, "flow");
    if (n.replicaOf && ids.has(n.replicaOf)) add(n.replicaOf, n.id, "sync");
    if (n.peer && ids.has(n.peer)) add(n.id, n.peer, "sync");
  }
  return out;
}

/** Cubic curve between two points that leaves and enters along the flow axis. */
export function curve(a: Pt, b: Pt, mode: Mode): [Pt, Pt, Pt, Pt] {
  const flat = mode !== "tall";
  const along = flat ? b.x - a.x : b.y - a.y;
  const d = Math.abs(along) * 0.5;
  if (d < 12) return [a, a, b, b];
  const s = Math.sign(along);
  return flat
    ? [a, { x: a.x + s * d, y: a.y }, { x: b.x - s * d, y: b.y }, b]
    : [a, { x: a.x, y: a.y + s * d }, { x: b.x, y: b.y - s * d }, b];
}

export function bezier(c: [Pt, Pt, Pt, Pt], t: number): Pt {
  const u = 1 - t;
  const [p0, p1, p2, p3] = c;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

export function pathD(c: [Pt, Pt, Pt, Pt]) {
  const [a, p, q, b] = c;
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} C${p.x.toFixed(1)} ${p.y.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}
