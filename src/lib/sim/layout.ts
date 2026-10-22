import type { Glyph, NodeSpec, SceneSpec } from "./types";

/** wide: desktop. compact: phones and short boxes (tighter, slightly smaller). tall: narrow, tall boxes. */
export type Mode = "wide" | "compact" | "tall";
export type Pt = { x: number; y: number };
/**
 * Where a node's label sits: below it, or beside it when below would sit in the path of traffic or a neighbour.
 * The two-part sides keep clear of a rail through the node's centre: "below-right" starts just right of a rail running
 * down from it, "right-high" sits beside it but above a rail leaving sideways, "right-low" below that rail.
 */
export type Side = "below" | "right" | "left" | "below-right" | "below-left" | "right-high" | "left-high" | "right-low" | "left-low";

export interface Size {
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
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

/**
 * Stage text in CSS pixels. Labels keep these sizes on every screen; the frame grows to make room for them instead.
 * `globals.css` sets the same numbers as `--label-px`, `--sub-px` and `--badge-px`.
 */
export const TEXT = { label: 13, sub: 12, badge: 11, line: 1.25, gap: 10, side: 10, gutter: 16, rail: 6 } as const;
// `rail`: how far a label keeps from a rail's centre line (the rail is 8 px wide).
/**
 * Average advance per character, in em: Atkinson Hyperlegible Next bold for labels (measured 0.48–0.5, with a margin)
 * and Overpass Mono for subs and badges. The browser stage-fit test fails if an estimate is ever too small.
 */
const EM = { label: 0.54, mono: 0.6 } as const;

export function glyphOf(n: NodeSpec): Glyph {
  return n.glyph ?? n.kind;
}

export const nodeKey = (n: NodeSpec) => `${n.id}@${n.at.join(",")}`;

/**
 * Every step of a lesson laid over one another: the frame is sized for all of them, so switching steps never
 * rescales. Two nodes can only collide if some step shows both.
 */
export interface Scene {
  spec: SceneSpec;
  steps: SceneSpec[];
  together: (a: string, b: string) => boolean;
}

export function combine(specs: SceneSpec[]): Scene {
  // Keep every distinct position: a node that moves between steps must fit in the frame in both places.
  const nodes = new Map<string, NodeSpec>();
  for (const s of specs) for (const n of s.nodes) nodes.set(nodeKey(n), n);
  const heights = specs.map((s) => s.wideH).filter((h): h is number => !!h);
  const links = Object.assign({}, ...specs.map((s) => s.linkLabels ?? {}));
  const keys = specs.map((s) => new Set(s.nodes.map(nodeKey)));
  return {
    spec: { ...specs[0], nodes: [...nodes.values()], wideH: heights.length ? Math.max(...heights) : undefined, linkLabels: links },
    steps: specs,
    together: (a, b) => keys.some((k) => k.has(a) && k.has(b)),
  };
}

export const sceneOf = (spec: SceneSpec): Scene => ({ spec, steps: [spec], together: () => true });

export interface Frame {
  mode: Mode;
  W: number;
  H: number;
  scale: number;
  /** Rendered CSS px per viewBox unit the frame was fitted for (1 when it was not fitted to a box). */
  k: number;
  /** Spare viewBox units on each side that the box still has room for (a phone's tall layout uses them for labels). */
  spare: number;
  pos: (at: [number, number]) => Pt;
  /** Label side per node, keyed `id@along,across`, decided once for every step the frame covers. */
  sides: Map<string, Side>;
  /** Labels that could not find a free side (0 when everything fits). */
  hits: number;
}

/** Steps along the flow that sit within this distance share a row in the tall layout. */
const SAME_ROW = 6;

/**
 * Map layout coordinates (along, across) to a viewBox. Wide screens use them directly. Phones get the same graph
 * turned on its side, one row per step along the flow, with rows and lanes spaced so labels (at `k` px per unit) fit.
 * `spread` pushes stations further apart without making them bigger, for scenes whose labels need more room.
 */
function baseFrame(scene: Scene, mode: Mode, zoom: number, k = 1, sides: Map<string, Side> = new Map(), spread = 1): Frame {
  const spec = scene.spec;
  const vs = spec.nodes.map((n) => n.at[1]);
  const vmin = Math.min(...vs);
  const vmax = Math.max(...vs);
  const vmid = (vmin + vmax) / 2;
  const out = (W: number, H: number, scale: number, pos: (at: [number, number]) => Pt): Frame => ({
    mode,
    W: W * spread,
    H: H * spread,
    scale,
    k,
    spare: 0,
    sides: new Map(),
    hits: 0,
    pos: (at) => {
      const p = pos(at);
      return { x: p.x * spread, y: p.y * spread };
    },
  });
  if (mode !== "tall") {
    const c = mode === "compact";
    const W = c ? 620 : 960;
    const px = c ? 50 : 84;
    const ys = c ? 0.8 : 1;
    const scale = (c ? 0.84 : 1) * zoom;
    const x = (u: number) => px + (u / 100) * (W - 2 * px);
    if (spec.wideH) {
      const H = spec.wideH * ys;
      const py = 58 * ys;
      return out(W, H, scale, ([u, v]) => ({ x: x(u), y: py + (v / 100) * (H - 2 * py) }));
    }
    const ky = 3.4 * ys;
    const H = Math.max(c ? 210 : 250, (c ? 116 : 130) + (vmax - vmin) * ky);
    return out(W, H, scale, ([u, v]) => ({ x: x(u), y: H / 2 + (v - vmid) * ky }));
  }
  const rowOf = rowsOf(spec);
  const groups = new Map<number, NodeSpec[]>();
  for (const n of spec.nodes) groups.set(rowOf(n), [...(groups.get(rowOf(n)) ?? []), n]);
  const rows = [...groups.keys()].sort((a, b) => a - b);
  const ext = new Map(spec.nodes.map((n) => [nodeKey(n), labelExtent(n, spec, mode, k)]));
  // Lanes spread far enough that neighbours in a row, and the labels below them, never touch.
  let kx = 4.6;
  for (const g of groups.values()) {
    const row = [...g].sort((a, b) => a.at[1] - b.at[1]);
    for (let i = 1; i < row.length; i++) {
      if (!scene.together(nodeKey(row[i]), nodeKey(row[i - 1]))) continue;
      const w = (n: NodeSpec) => Math.max(SIZES[glyphOf(n)].w, ext.get(nodeKey(n))!.w);
      const dv = row[i].at[1] - row[i - 1].at[1];
      if (dv > 0) kx = Math.max(kx, ((w(row[i]) + w(row[i - 1])) / 2 + 12 / k) / dv);
    }
  }
  let gap = Infinity;
  for (const g of groups.values()) {
    const across = [...new Set(g.map((n) => n.at[1]))].sort((a, b) => a - b);
    for (let i = 1; i < across.length; i++) gap = Math.min(gap, (across[i] - across[i - 1]) * kx);
  }
  const scale = Number.isFinite(gap) ? Math.min(1, Math.max(0.7, (gap - 12) / 96)) : 1;
  // Rows: a single node's label goes beside it; a row of several puts labels below, so it needs that room too.
  const side = (n: NodeSpec) => sides.get(nodeKey(n)) ?? (groups.get(rowOf(n))!.length > 1 ? "below" : "right");
  const half = (n: NodeSpec) => (SIZES[glyphOf(n)].h * scale) / 2;
  // Room above a node for its waiting line (rows of four, stacked upward).
  const line = (n: NodeSpec) => (n.slots && n.kind !== "client" ? 1.5 * (2 * 6.4 * Math.max(0.9, scale) + 2) : 0);
  const top = (g: NodeSpec[]) => Math.max(...g.map((n) => half(n) + line(n)));
  const bottom = (g: NodeSpec[]) =>
    Math.max(...g.map((n) => (side(n).startsWith("below") ? half(n) + TEXT.gap / k + ext.get(nodeKey(n))!.h : Math.max(half(n), ext.get(nodeKey(n))!.h / 2))));
  const link = Math.max(36, 34 / k);
  const ys = new Map<number, number>();
  let y = top(groups.get(rows[0])!);
  rows.forEach((r, i) => {
    if (i > 0) y += bottom(groups.get(rows[i - 1])!) + link + top(groups.get(r)!);
    ys.set(r, y);
  });
  const H = y + bottom(groups.get(rows[rows.length - 1])!);
  const W = Math.max(360, 150 + (vmax - vmin) * kx);
  return out(W, H, scale, ([u, v]) => ({ x: W / 2 + (v - vmid) * kx, y: ys.get(rowOf({ at: [u, v] } as NodeSpec)) ?? 0 }));
}

/** Which tall-layout row a node sits in: steps along the flow closer than `SAME_ROW` share one. */
function rowsOf(spec: SceneSpec) {
  const along = [...new Set(spec.nodes.map((n) => n.at[0]))].sort((a, b) => a - b);
  const row = new Map<number, number>();
  let start = along[0];
  for (const u of along) {
    if (u - start > SAME_ROW) start = u;
    row.set(u, start);
  }
  return (n: Pick<NodeSpec, "at">) => row.get(n.at[0]) ?? n.at[0];
}

interface Fit {
  /** Rendered CSS px per viewBox unit. */
  k: number;
  zoom?: number;
  spread?: number;
  /** The box the frame must fit; spare width in it may hold side labels without shrinking anything. */
  box?: Size;
}

/**
 * A frame that fits the scene and every label in a box `k` rendered px per unit wide, so stage text stays at its CSS
 * size. Labels are measured from character counts in CSS px and converted to viewBox units with `k`; the frame then
 * grows to hold them (plus a gutter) and centres the result. Without `fit` it is the plain node-centre frame.
 */
export function frameFor(scene: Scene, mode: Mode, fit?: Fit): Frame {
  if (!fit) return baseFrame(scene, mode, 1);
  const { k, zoom = 1, box, spread = 1 } = fit;
  const spareOf = (f: Frame) => (box ? Math.max(0, (box.w / k - f.W) / 2) : 0);
  let base = baseFrame(scene, mode, zoom, k, undefined, spread);
  base.spare = spareOf(base);
  let { placed, hits } = placeAll(scene, base);
  if (mode === "tall") {
    // Rows were spaced on a guess (single nodes label beside, rows of several below); respace with the real sides.
    const sides = new Map([...placed].map(([key, p]) => [key, p.side]));
    base = baseFrame(scene, mode, zoom, k, sides, spread);
    base.spare = spareOf(base);
    base.sides = sides;
    ({ placed, hits } = placeAll(scene, base));
  }
  const rects = [...placed.values()].flatMap((p) => p.rects);
  for (const step of scene.steps) {
    const at = new Map(step.nodes.map((n) => [n.id, placed.get(nodeKey(n))!]));
    for (const e of edgesOf(step)) {
      const text = step.linkLabels?.[`${e.a}>${e.b}`] ?? step.linkLabels?.[`${e.b}>${e.a}`];
      const a = at.get(e.a);
      const b = at.get(e.b);
      if (text && a && b) rects.push(linkLabelRect(text, a, b, mode, k));
    }
  }
  const all = bounds(rects);
  const g = TEXT.gutter / k;
  const W = Math.max(base.W, all.w + 2 * g);
  const H = Math.max(base.H, all.h + 2 * g);
  const dx = (W - all.w) / 2 - all.x;
  const dy = (H - all.h) / 2 - all.y;
  // Now the frame is sized, labels across a rail may move to a side that still fits in it.
  ({ placed } = placeAll(scene, { ...base, sides: new Map([...placed].map(([key, p]) => [key, p.side])) }, { x: g - dx, y: g - dy, w: W - 2 * g, h: H - 2 * g }));
  const sides = new Map([...placed].map(([key, p]) => [key, p.side]));
  const pos = base.pos;
  return { ...base, W, H, k, spare: 0, sides, hits, pos: (at) => { const p = pos(at); return { x: p.x + dx, y: p.y + dy }; } };
}

/** Where a link's label sits (beside an upright link, above a level one) and how big it is, in viewBox units. */
export function linkLabelRect(text: string, a: Pt, b: Pt, mode: Mode, k: number): Rect {
  const mid = bezier(curve(a, b, mode), 0.5);
  const w = (text.length * EM.mono * TEXT.sub) / k;
  const h = (TEXT.sub * TEXT.line) / k;
  return Math.abs(b.x - a.x) < Math.abs(b.y - a.y)
    ? { x: mid.x + 12 / k, y: mid.y + 4 / k - TEXT.sub / k, w, h }
    : { x: mid.x - w / 2, y: mid.y - 10 / k - TEXT.sub / k, w, h };
}

const SPREADS = [1, 1.12, 1.25, 1.4, 1.6, 1.85, 2.1];

/**
 * Fit a frame to a box: estimate k from the plain frame, add label room, re-measure k with the bigger frame, and
 * repeat until k settles. If some label finds no free side, spread the stations apart and try again; the first
 * spread where everything fits wins (or the one with the fewest collisions).
 */
export function fitFrame(scene: Scene, mode: Mode, box: Size, zoom = 1): Frame {
  const kOf = (f: Frame) => Math.min(box.w / f.W, box.h / f.H);
  let best: Frame | null = null;
  for (const spread of SPREADS) {
    let frame = frameFor(scene, mode, { k: kOf(baseFrame(scene, mode, zoom, 1, undefined, spread)), zoom, box, spread });
    for (let i = 0; i < 4; i++) {
      const k = kOf(frame);
      if (Math.abs(k - frame.k) / k < 0.01) break;
      frame = frameFor(scene, mode, { k, zoom, box, spread });
    }
    frame = { ...frame, k: kOf(frame) };
    if (!best || frame.hits < best.hits) best = frame;
    if (frame.hits === 0) break;
  }
  return best!;
}

export interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
  side: Side;
  /** The node, its label block and (where one can appear) its shoulder badges, in viewBox units. */
  rects: Rect[];
  label: Rect;
  /** The label still lies across a rail: it gets a plate in the sheet's colour, so the rail passes under it. */
  plate: boolean;
}

/** Width and height of a node's label block in viewBox units (`k` = rendered px per unit). */
export function labelExtent(n: NodeSpec, spec: SceneSpec, mode: Mode, k: number): Size {
  const sub = Math.max(0, ...subsFor(n, spec, mode).map((s) => s.length));
  const w = Math.max(n.label.length * EM.label * TEXT.label, sub * EM.mono * TEXT.sub);
  const h = TEXT.label * TEXT.line + (sub ? TEXT.sub * TEXT.line : 0);
  return { w: w / k, h: h / k };
}

/**
 * Where a label block sits relative to its node's centre, in viewBox units: the x its text is anchored at, the top of
 * the block, and the text anchor. `w` and `h` are the node's size and `block` the label block's height, all in viewBox
 * units; `k` is rendered px per unit. The layout and the renderer both use this, so they always agree.
 */
export function labelSpot(side: Side, w: number, h: number, block: number, k: number) {
  const [where, lift] = side.split("-") as ["below" | "right" | "left", "right" | "left" | "high" | "low" | undefined];
  // As far off a rail's centre line as a label sits from its node: clear of the rail's own width and its margin.
  const off = TEXT.side / k;
  if (where === "below") {
    const x = lift === "right" ? off : lift === "left" ? -off : 0;
    return { x, top: h / 2 + TEXT.gap / k, anchor: lift === "right" ? "start" : lift === "left" ? "end" : "middle" } as const;
  }
  const x = where === "right" ? w / 2 + TEXT.side / k : -w / 2 - TEXT.side / k;
  const top = lift === "high" ? -off - block : lift === "low" ? off : -block / 2;
  return { x, top, anchor: where === "right" ? "start" : "end" } as const;
}

const overlaps = (a: Rect, b: Rect, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

/** Does the segment p→q pass through r, grown by m on every side? (Liang–Barsky clipping.) */
function crosses(p: Pt, q: Pt, r: Rect, m: number): boolean {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let t0 = 0;
  let t1 = 1;
  for (const [d, room] of [[-dx, p.x - (r.x - m)], [dx, r.x + r.w + m - p.x], [-dy, p.y - (r.y - m)], [dy, r.y + r.h + m - p.y]]) {
    if (d === 0) {
      if (room < 0) return false;
      continue;
    }
    const t = room / d;
    if (d < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/** Each link of every step as a polyline (the stretch its rail is drawn on), with the two stations it joins. */
function railsOf(scene: Scene, frame: Frame, placed: Map<string, Placed>): { ends: [string, string]; pts: Pt[] }[] {
  return scene.steps.flatMap((st) => {
    const key = new Map(st.nodes.map((n) => [n.id, nodeKey(n)]));
    return edgesOf(st).flatMap((e) => {
      const ka = key.get(e.a);
      const kb = key.get(e.b);
      const a = ka && placed.get(ka);
      const b = kb && placed.get(kb);
      if (!a || !b) return [];
      const [t0, t1] = railSpan(a, b, frame.mode, frame.k);
      const c = subCurve(curve(a, b, frame.mode), t0, t1);
      return [{ ends: [ka, kb] as [string, string], pts: Array.from({ length: 25 }, (_, i) => bezier(c, i / 24)) }];
    });
  });
}

/**
 * Place every node of the scene in `frame`: its box, its label and its badges. Unless the frame already knows a
 * node's side, the label takes the first side, in order of preference, that is clear of every station and every
 * label placed so far in a step that shows both. `hits` counts the labels that found no clear side.
 *
 * With `within` (the frame's room, once it is sized), labels that came to lie across a rail then move to another
 * side if one is clear of stations, labels and rails and still inside that room: keeping a label off a rail is never
 * worth growing the frame and shrinking the scene. A label that stays on a rail is marked for a plate.
 */
export function placeAll(scene: Scene, frame: Frame, within?: Rect): { placed: Map<string, Placed>; hits: number } {
  const spec = scene.spec;
  const k = frame.k;
  const s = frame.scale;
  const gap = TEXT.gap / k;
  const side = TEXT.side / k;
  const margin = 3 / k;
  const boxes = spec.nodes.map((n) => {
    const size = SIZES[glyphOf(n)];
    const p = frame.pos(n.at);
    const w = size.w * s;
    const h = size.h * s;
    const key = nodeKey(n);
    const solid: Rect[] = [{ x: p.x - w / 2, y: p.y - h / 2, w, h }];
    // Shoulder badges: the state on the top-right corner, the role on the top-left.
    const { state, role } = badgeChars(n, spec);
    for (const [chars, dir] of [[state, 1], [role, -1]] as const) {
      if (!chars) continue;
      const b = badgeBox(chars, k, s);
      solid.push({ x: p.x + dir * (w / 2 - b.inset) - b.w / 2, y: p.y - h / 2 + b.dy - b.h / 2, w: b.w, h: b.h });
    }
    return { n, key, x: p.x, y: p.y, w, h, solid, ext: labelExtent(n, spec, frame.mode, k) };
  });
  const linked = new Set(scene.steps.flatMap((st) => edgesOf(st).flatMap((e) => [`${e.a}~${e.b}`, `${e.b}~${e.a}`])));
  const rectFor = (a: (typeof boxes)[number], sd: Side): Rect => {
    const { w: tw, h: th } = a.ext;
    const spot = labelSpot(sd, a.w, a.h, th, k);
    const left = spot.anchor === "start" ? spot.x : spot.anchor === "end" ? spot.x - tw : spot.x - tw / 2;
    return { x: a.x + left, y: a.y + spot.top, w: tw, h: th };
  };
  const prefer = (a: (typeof boxes)[number]): Side[] => {
    if (frame.mode !== "tall") {
      // A neighbour straight below, or a link running down through the label: beside is better than below.
      const stacked = boxes.some(
        (b) => b !== a && Math.abs(a.x - b.x) <= 4 && scene.together(a.key, b.key) && (Math.abs(a.y - b.y) - a.h / 2 - b.h / 2 < a.ext.h + gap * 3 || linked.has(`${a.n.id}~${b.n.id}`)),
      );
      return stacked ? ["right", "left", "below"] : ["below", "right", "left"];
    }
    // Phones: traffic flows down through anything below a node, so labels go beside it when there's room.
    const need = Math.max(a.ext.w, 78 / k) + side + gap;
    // Toward a neighbour, a label may only use half the gap; the neighbour may want the other half.
    const row = boxes.filter((b) => b !== a && Math.abs(b.y - a.y) < 4 && scene.together(a.key, b.key));
    const right = Math.min(frame.W + frame.spare - (a.x + a.w / 2), ...row.filter((b) => b.x > a.x).map((b) => (b.x - b.w / 2 - (a.x + a.w / 2)) / 2));
    const left = Math.min(a.x - a.w / 2 + frame.spare, ...row.filter((b) => b.x < a.x).map((b) => (a.x - a.w / 2 - (b.x + b.w / 2)) / 2));
    const order: Side[] = right >= need ? ["right", "left", "below"] : left >= need ? ["left", "right", "below"] : ["below", "right", "left"];
    return order;
  };
  const labels = new Map<string, Rect>();
  const out = new Map<string, Placed>();
  let hits = 0;
  // Clear of every other station and label shown in a step with this one.
  const clear = (a: (typeof boxes)[number], r: Rect) =>
    boxes.every((b) => b === a || !scene.together(a.key, b.key) || b.solid.every((q) => !overlaps(r, q, margin))) &&
    [...labels].every(([key, l]) => key === a.key || !scene.together(a.key, key) || !overlaps(r, l, margin));
  for (const a of boxes) {
    const known = frame.sides.get(a.key);
    const order = known ? [known] : prefer(a);
    const sd = order.find((o) => clear(a, rectFor(a, o))) ?? order[0];
    const label = rectFor(a, sd);
    if (!clear(a, label)) hits++;
    labels.set(a.key, label);
    out.set(a.key, { x: a.x, y: a.y, w: a.w, h: a.h, side: sd, rects: [...a.solid, label], label, plate: false });
  }

  // A rail is 8px wide on screen; keep labels a little further off it than that.
  const rails = railsOf(scene, frame, out);
  const room = TEXT.rail / k;
  const offRails = (a: (typeof boxes)[number], r: Rect) =>
    rails.every(
      (l) => !scene.together(a.key, l.ends[0]) || !scene.together(a.key, l.ends[1]) || l.pts.every((p, i) => i === 0 || !crosses(l.pts[i - 1], p, r, room)),
    );
  const fits = (r: Rect) => !!within && r.x >= within.x && r.y >= within.y && r.x + r.w <= within.x + within.w && r.y + r.h <= within.y + within.h;
  for (const a of boxes) {
    const was = out.get(a.key)!;
    if (offRails(a, was.label)) continue;
    if (!within) {
      out.set(a.key, { ...was, plate: true });
      continue;
    }
    // Nearest first: just beside the rail, then beside the node, then beside it but off the rail's line.
    const sides: Side[] = was.side.startsWith("below")
      ? ["below-right", "below-left", "right", "left", "right-high", "left-high", "right-low", "left-low"]
      : ["right-high", "left-high", "right-low", "left-low", "right", "left", "below", "below-right", "below-left"];
    const sd = sides.find((o) => o !== was.side && fits(rectFor(a, o)) && clear(a, rectFor(a, o)) && offRails(a, rectFor(a, o)));
    if (!sd) {
      out.set(a.key, { ...was, plate: true });
      continue;
    }
    const label = rectFor(a, sd);
    labels.set(a.key, label);
    out.set(a.key, { ...was, side: sd, rects: [...a.solid, label], label });
  }
  return { placed: out, hits };
}

/** A shoulder badge's size and offset in viewBox units: its text stays at `TEXT.badge` px. */
export function badgeBox(chars: number, k: number, scale: number) {
  return { w: (chars * EM.mono * TEXT.badge + 12) / k, h: (TEXT.badge + 8) / k, inset: 6 * scale, dy: -2 * scale };
}

/** The longest state badge (DOWN, OPEN, TESTING, CUT OFF) and role badge (LEADER, FOLLOWER) a node can wear. */
function badgeChars(n: NodeSpec, spec: SceneSpec) {
  const leads = spec.nodes.some((m) => m.leader === n.id);
  const role = n.leader ? 8 : leads ? 6 : 0;
  const state = n.breaker || n.leader ? 7 : n.kind === "server" || n.kind === "db" || n.kind === "cache" ? 4 : 0;
  return { state, role };
}

/**
 * Every secondary label a node can show, at its longest (counts written with the most digits they can reach), so the
 * frame has room for whichever one appears and never rescales while the scene runs. `stage.tsx` writes the live ones.
 */
export function subsFor(n: NodeSpec, spec: SceneSpec, mode: Mode): string[] {
  const pool = spec.nodes.find((m) => m.autoscale && flat(m.to).includes(n.id));
  const checked = spec.nodes.some((m) => m.health && flat(m.to).includes(n.id));
  const states = pool ? ["starting…", "standby", "draining"] : [];
  const all = (): string[] => {
    switch (n.kind) {
      case "client":
        return ["999 req/s"];
      case "lb":
        if (n.autoscale) return ["target 99% busy"];
        if (n.algo === "hash") return ["key → 9 nodes"];
        if (n.algo === "ring") return ["ring of 64 points each"];
        if (n.health) return ["checking health"];
        return [n.algo === "least" ? "least busy" : n.algo === "random" ? "random" : "round robin"];
      case "limiter":
        return ["99/s per client"];
      case "cache":
        return ["99/99 items", "down"];
      case "queue":
        return ["999 waiting"];
      case "topic":
        return ["9 subscribers"];
      default: {
        const down = n.sink ? "paused · jobs wait" : n.downMode === "hang" ? "not responding" : checked ? "down · taken out" : "down";
        // Clients give up long before a line reaches three digits; a queue node can hold more and says so.
        const work = n.slots ? ["99 waiting", `${n.slots}/${n.slots} busy`] : ["stalled · 99 waiting"];
        return [...work, down, ...(checked ? ["rejoining…"] : []), ...states];
      }
    }
  };
  return all().map((s) => fitSub(s, mode));
}

const SHORT: [RegExp, string][] = [
  [/^paused · jobs wait$/, "paused"],
  [/^not responding$/, "hanging"],
  [/^down · taken out$/, "taken out"],
  [/^stalled · (\d+) waiting$/, "stalled · $1"],
  [/^target (\d+)% busy$/, "target $1%"],
  [/^(\d+)\/s per client$/, "$1/s each"],
  [/^key → (\d+) nodes$/, "$1 nodes"],
  [/^ring of 64 points each$/, "ring"],
];

/** The shorter wording a secondary label takes in the narrow (compact and tall) layouts. */
export function fitSub(sub: string, mode: Mode) {
  if (mode === "wide") return sub;
  for (const [re, to] of SHORT) if (re.test(sub)) return sub.replace(re, to);
  return sub;
}

function flat(c: NodeSpec["to"]) {
  return (c ?? []).flatMap((x) => (Array.isArray(x) ? x : [x]));
}

function bounds(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
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

/** The part of a cubic curve between t0 and t1, as a cubic curve of its own (de Casteljau). */
export function subCurve(c: [Pt, Pt, Pt, Pt], t0: number, t1: number): [Pt, Pt, Pt, Pt] {
  if (t0 <= 0 && t1 >= 1) return c;
  const lerp = (p: Pt, q: Pt, t: number) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
  // Split at t, keeping the part after it (or before it).
  const split = ([p0, p1, p2, p3]: [Pt, Pt, Pt, Pt], t: number, after: boolean): [Pt, Pt, Pt, Pt] => {
    const a = lerp(p0, p1, t);
    const b = lerp(p1, p2, t);
    const d = lerp(p2, p3, t);
    const e = lerp(a, b, t);
    const f = lerp(b, d, t);
    const m = lerp(e, f, t);
    return after ? [m, f, d, p3] : [p0, a, e, m];
  };
  const tail = t0 > 0 ? split(c, t0, true) : c;
  return t1 < 1 ? split(tail, (t1 - t0) / (1 - t0), false) : tail;
}

/** A station as the rails see it: its centre, size and label side. */
type Station = Pt & { w: number; h: number; side: Side };

/**
 * The stretch of a link (as curve parameters) its rail is drawn on and its traffic travels. In the tall phone layout a
 * label centred below a node sits where a link leaving downward would run, so the rail starts and ends beneath it.
 */
export function railSpan(a: Station, b: Station, mode: Mode, k: number): [number, number] {
  if (mode !== "tall") return [0, 1];
  const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y) * 1.05);
  const below = (TEXT.gap + TEXT.label * TEXT.line + TEXT.sub * TEXT.line + 8) / k;
  const under = (n: Station, other: Station) => n.side === "below" && other.y > n.y + 4;
  return [under(a, b) ? Math.min(0.4, (a.h / 2 + below) / len) : 0, under(b, a) ? Math.max(0.6, 1 - (b.h / 2 + below) / len) : 1];
}

export function pathD(c: [Pt, Pt, Pt, Pt]) {
  const [a, p, q, b] = c;
  return `M${a.x.toFixed(1)} ${a.y.toFixed(1)} C${p.x.toFixed(1)} ${p.y.toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
}
