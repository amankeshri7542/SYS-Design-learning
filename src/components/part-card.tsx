"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { FigureDef, PageNav } from "@/lib/lessons/types";
import { record } from "@/lib/record";
import { describe } from "@/lib/sim/describe";
import type { Sim } from "@/lib/sim/engine/core";
import { conceptKey, conceptOf, hereOf, nowOf, readOf, setupOf } from "@/lib/sim/part-words";
import type { SceneSpec } from "@/lib/sim/types";

/**
 * What a stage needs to explain its stations: the page's lesson, the lessons its cards point to (sent by its server
 * page, so the catalog never reaches the page) and, for a lesson, its figures and the step shown.
 */
export interface Explain {
  lesson: string;
  learn?: PageNav["learn"];
  figs?: FigureDef[];
  step?: number;
  /** My System: the card can open the station's part for changing. */
  edit?: (station: string) => void;
}

/**
 * A station's card, opened from its name on the stage (`Stage`): what it is, what it does here, what it is doing now,
 * how to read its drawing, and the lesson that teaches it. Beside the station when there is room, else under or over
 * it, and placed again whenever the station moves. A hover shows it while the pointer stays; a click or tap pins it
 * until Esc, the close button or a press elsewhere. Loaded the first time a card opens.
 */
export default function PartCard({
  id,
  anchor,
  spot,
  pinned,
  sim,
  spec,
  explain,
  onClose,
  onHold,
  onLeave,
}: {
  id: string;
  /** The station's button, wherever it is now. */
  anchor: () => HTMLElement | undefined;
  /** Where that button is: the card is placed again when it changes. */
  spot: string;
  pinned: boolean;
  sim: Sim;
  spec: SceneSpec;
  explain: Explain;
  onClose: () => void;
  onHold: () => void;
  onLeave: () => void;
}) {
  const pop = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const n = spec.nodes.find((x) => x.id === id);
  const rt = sim.nodes.get(id);
  const here = useMemo(() => (n ? (hereOf(n, explain.figs, explain.step ?? 0) ?? setupOf(n)) : ""), [n, explain]);

  useLayoutEffect(() => {
    const el = pop.current;
    if (!el || !anchor()) return;
    if (!el.matches(":popover-open")) el.showPopover();
    // Beside the station, under or over it, or under or beside the whole stage: the first spot inside the window that covers the
    // fewest other stations (never this one), so the scene stays in view and every other name stays one tap away. Placed
    // again when the station moves, and when the card's own height changes with what its station is doing.
    const place = () => {
      const from = anchor();
      const stage = from?.parentElement;
      if (!from || !stage) return;
      const r = from.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      const others = [...stage.querySelectorAll(".part-hit")].filter((h) => h !== from).map((h) => h.getBoundingClientRect());
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const m = 12;
      const fit = (x: number, y: number) => ({ x: Math.max(m, Math.min(x, innerWidth - w - m)), y: Math.max(m, Math.min(y, innerHeight - h - m)) });
      const spots = [
        fit(r.right + 10, r.top),
        fit(r.left - 10 - w, r.top),
        fit(r.left + r.width / 2 - w / 2, r.bottom + 8),
        fit(r.left + r.width / 2 - w / 2, r.top - 8 - h),
        fit(sr.left + sr.width / 2 - w / 2, sr.bottom + 8),
        fit(sr.right + 8, r.top),
        fit(sr.left - 8 - w, r.top),
      ];
      const area = (a: DOMRect, x: number, y: number) => Math.max(0, Math.min(a.right, x + w) - Math.max(a.left, x)) * Math.max(0, Math.min(a.bottom, y + h) - Math.max(a.top, y));
      const cost = ({ x, y }: { x: number; y: number }) => area(r, x, y) * 10 + others.reduce((sum, o) => sum + area(o, x, y), 0);
      const best = spots.reduce((a, b) => (cost(b) < cost(a) - 1 ? b : a));
      el.style.left = `${best.x}px`;
      el.style.top = `${best.y}px`;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
  }, [anchor, id, spot]);

  // The learning record: a card pinned open, or one read for a moment under the pointer, once per opening.
  const noted = useRef("");
  useEffect(() => {
    if (!n || noted.current === id) return;
    const note = () => {
      noted.current = id;
      record("part", { label: n.label });
    };
    if (pinned) return note();
    const t = setTimeout(note, 1200);
    return () => clearTimeout(t);
  }, [id, pinned, n]);

  useEffect(() => {
    if (pinned) close.current?.focus({ preventScroll: true });
  }, [pinned, id]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onClose();
      anchor()?.focus({ preventScroll: true });
    };
    // A press outside the card closes it; one on another station's name opens that station's card instead.
    const down = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!pop.current?.contains(t) && !t.closest?.(".part-hit")) onClose();
    };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", down);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("pointerdown", down);
    };
  }, [anchor, onClose]);

  if (!n || !rt) return null;
  const key = conceptKey(n, spec);
  const c = conceptOf(n, spec);
  const view = describe(sim, rt, [...sim.nodes.values()].filter((x) => x.spec.health || x.spec.rollback));
  const now = nowOf(sim, rt, view);
  const to = c.learn !== explain.lesson ? c.learn : undefined;
  const learn = to ? explain.learn?.[to] : undefined;

  return (
    <div
      ref={pop}
      className="part-pop"
      popover="manual"
      role="dialog"
      aria-labelledby="part-name"
      onPointerEnter={(e) => e.pointerType === "mouse" && onHold()}
      onPointerLeave={(e) => e.pointerType === "mouse" && onLeave()}
    >
      <div className="term-head">
        <h2 id="part-name">{n.label}</h2>
        <button ref={close} type="button" className="btn btn-icon key-close" onClick={onClose} aria-label="Close">
          <svg viewBox="0 0 16 16" aria-hidden="true" className="stroke">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      {/* What kind of thing it is, unless its name says so already ("App server" is a server). */}
      {!n.label.toLowerCase().includes(c.name.toLowerCase()) && <p className="part-kind">{c.name}</p>}
      <p className="term-short">{c.text}</p>
      <dl className="part-rows">
        {here && (
          <div>
            <dt>Here</dt>
            <dd>{here}</dd>
          </div>
        )}
        {now && (
          <div>
            <dt>Now</dt>
            <dd>{now}</dd>
          </div>
        )}
        <div>
          <dt>Read it</dt>
          <dd>{readOf(rt, key)}</dd>
        </div>
      </dl>
      {explain.edit && (
        <button
          type="button"
          className="btn part-edit"
          onClick={() => {
            explain.edit!(id);
            onClose();
          }}
        >
          Change it
        </button>
      )}
      {to && learn && (
        <Link href={`/learn/${to}`} className="part-learn" onClick={() => record("next", { to, from: "part" })}>
          Learn more in {learn.code} {learn.title}
          <svg viewBox="0 0 16 16" aria-hidden="true" className="stroke">
            <path d="M3 8h10M9 4l4 4-4 4" />
          </svg>
        </Link>
      )}
    </div>
  );
}
