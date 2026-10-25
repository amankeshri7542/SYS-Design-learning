"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Focus } from "@/lib/lessons/beats";
import type { Sim } from "@/lib/sim/engine";
import type { Pt, Rect, Size } from "@/lib/sim/layout";
import { freshNote } from "./live";
import { Rich } from "./rich";

// The narration a scene carries on its sheet: the strip, and on wide stages the callout beside the thing a beat names.
// Every player uses them (lessons, journeys, the hero, My System); the lesson's own runner, prediction and checks stay
// in `beats.tsx`, so the others don't carry them.

/** What the strip and the callout show: the current beat. */
export interface BeatView {
  id: string;
  text: string;
  focus: Focus | null;
  /** 1-based position in the step, and how many the step has. */
  n: number;
  total: number;
  /** Paused on it: the learner moves on with Next. */
  waiting: boolean;
  part: boolean;
  /** This beat starts following one request. */
  follow: boolean;
}


/**
 * The narration line on the stage's sheet: along its top edge, or its bottom edge on phones. It says what the scene
 * shows (`lead`), then the current beat (or, in a scene without beats, its events: a fresh one in ink, then the latest
 * one quietly). Wide stages show the beat beside the thing it names instead (the callout); the strip then keeps the
 * step's place in its beats. Phones also give it the slow-motion clock, which the dock has no room for.
 */
export function BeatStrip({
  lead,
  sim,
  clock,
  beat,
  announce,
}: {
  lead?: ReactNode;
  sim: Sim;
  clock?: ReactNode;
  beat?: BeatView | null;
  /** A beat that just fired, in plain words, for screen readers (each one once). */
  announce?: string;
}) {
  const scripted = beat === undefined;
  const fresh = scripted ? freshNote(sim) : null;
  const text = scripted ? (fresh ?? sim.notes[sim.notes.length - 1]?.text ?? "") : "";
  return (
    <div className={`beat${fresh || beat ? " fresh" : ""}${beat?.waiting ? " waiting" : ""}`}>
      {lead}
      <p className="beat-text">
        {beat ? (
          <span key={beat.id}>
            <Rich text={beat.text} />
          </span>
        ) : (
          text && <span key={text}>{text}</span>
        )}
      </p>
      {beat && beat.total > 1 && (
        <span className="beat-pips" role="img" aria-label={`${beat.n} of ${beat.total}`}>
          {Array.from({ length: beat.total }, (_, i) => (
            <i key={i} className={i + 1 === beat.n ? "on" : i + 1 < beat.n ? "past" : undefined} />
          ))}
        </span>
      )}
      {/* Only something new is announced: not the latest beat or event shown again after a step switch. */}
      <span className="sr-only" aria-live="polite">
        {scripted ? (fresh ?? "") : (announce ?? "")}
      </span>
      {clock}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ callout

/** Where a callout may go, in CSS px inside the stage. */
export interface CalloutSpot {
  /** The thing pointed at (a station's body, a waiting line, the middle of a rail). */
  anchor: Rect;
  /** The anchor's whole block (with its label), which the callout keeps clear of. */
  block: Rect;
  /** Every station and label on the stage. */
  obstacles: Rect[];
  /** Rails, as points along them: a callout prefers not to cover traffic. */
  rails: Pt[][];
  box: Size;
}

type Side = "above" | "below" | "right" | "left";

const GAP = 16;
const EDGE = 10;

const overlaps = (a: Rect, b: Rect, m: number) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The best clear place for a w×h callout: inside the stage, off every station and label, over as few rails as possible. */
export function placeCallout(s: CalloutSpot, w: number, h: number): { x: number; y: number; side: Side } | null {
  const { block: b, box } = s;
  const cx = s.anchor.x + s.anchor.w / 2;
  const cy = s.anchor.y + s.anchor.h / 2;
  const fitX = (x: number) => clamp(x, EDGE, box.w - EDGE - w);
  const fitY = (y: number) => clamp(y, EDGE, box.h - EDGE - h);
  const tries: { x: number; y: number; side: Side }[] = [
    { side: "above", x: fitX(cx - w / 2), y: b.y - GAP - h },
    { side: "right", x: b.x + b.w + GAP, y: fitY(cy - h / 2) },
    { side: "left", x: b.x - GAP - w, y: fitY(cy - h / 2) },
    { side: "below", x: fitX(cx - w / 2), y: b.y + b.h + GAP },
  ];
  let best: { x: number; y: number; side: Side } | null = null;
  let score = Infinity;
  tries.forEach((t, i) => {
    const r = { x: t.x, y: t.y, w, h };
    if (r.x < EDGE - 0.5 || r.y < EDGE - 0.5 || r.x + w > box.w - EDGE + 0.5 || r.y + h > box.h - EDGE + 0.5) return;
    if (overlaps(r, b, 4) || s.obstacles.some((o) => overlaps(r, o, 6))) return;
    const rails = s.rails.filter((pts) => pts.some((p) => p.x > r.x - 4 && p.x < r.x + w + 4 && p.y > r.y - 4 && p.y < r.y + h + 4)).length;
    const sc = rails * 10 + i;
    if (sc < score) {
      score = sc;
      best = t;
    }
  });
  return best;
}

/**
 * The beat's words beside the thing they name, with a short ink leader to it. It is placed in the stage's clear space;
 * when there is none, it isn't shown and the strip carries the words instead.
 */
export function Callout({ id, text, spot, waiting }: { id: string; text: string; spot: CalloutSpot; waiting: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number; side: Side; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const p = placeCallout(spot, w, h);
    setAt((was) => (p ? (was && was.x === p.x && was.y === p.y && was.w === w && was.h === h ? was : { ...p, w, h }) : null));
  }, [id, text, spot]);
  const a = spot.anchor;
  let leader: [Pt, Pt] | null = null;
  if (at) {
    const cx = clamp(a.x + a.w / 2, at.x + 14, at.x + at.w - 14);
    const cy = clamp(a.y + a.h / 2, at.y + 10, at.y + at.h - 10);
    const b = spot.block;
    leader =
      at.side === "above"
        ? [{ x: cx, y: at.y + at.h }, { x: a.x + a.w / 2, y: a.y - 3 }]
        : at.side === "below"
          ? [{ x: cx, y: at.y }, { x: a.x + a.w / 2, y: b.y + b.h + 3 }]
          : at.side === "right"
            ? [{ x: at.x, y: cy }, { x: a.x + a.w + 3, y: a.y + a.h / 2 }]
            : [{ x: at.x + at.w, y: cy }, { x: a.x - 3, y: a.y + a.h / 2 }];
  }
  return (
    <>
      {leader && (
        <svg className="callout-leader" key={`l-${id}`} aria-hidden="true">
          <line x1={leader[0].x} y1={leader[0].y} x2={leader[1].x} y2={leader[1].y} />
          <circle cx={leader[1].x} cy={leader[1].y} r="2.5" />
        </svg>
      )}
      <div
        ref={ref}
        key={id}
        className={`callout${waiting ? " waiting" : ""}`}
        data-placed={at ? "" : undefined}
        data-side={at?.side}
        style={at ? { left: at.x, top: at.y } : undefined}
        aria-hidden="true"
      >
        <Rich text={text} />
      </div>
    </>
  );
}
