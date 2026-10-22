"use client";

import { useEffect, type ReactNode } from "react";
import type { Sim } from "@/lib/sim/engine";
import { Brand } from "./brand";
import { freshNote, type Live } from "./live";

/** Space or k toggles playback; arrow keys move between steps. Ignored while a control has focus. */
export function usePlayerKeys(live: Live, onStep?: (delta: number) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && t.closest("input, select, textarea, button, summary, a, [contenteditable], [popover]")) return;
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        live.toggle();
      } else if (onStep && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault();
        onStep(e.key === "ArrowRight" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, onStep]);
}

/**
 * The one-screen layout. The bar on top; the theatre, where a beat strip sits on the stage's sheet (and a flight
 * strip will sit under it, once a request can be followed); the panel, whose reading part scrolls while the numbers
 * stay pinned below it; and the dock. Phones add a summary row of the headline number. The document never scrolls.
 */
export function Shell({
  className,
  rootRef,
  simTime,
  bar,
  beat,
  stage,
  flight,
  panel,
  pinned,
  summary,
  dock,
}: {
  className: string;
  rootRef: React.Ref<HTMLDivElement>;
  simTime: number;
  bar: ReactNode;
  beat: ReactNode;
  stage: ReactNode;
  flight?: ReactNode;
  panel: ReactNode;
  pinned?: ReactNode;
  summary?: ReactNode;
  dock: ReactNode;
}) {
  return (
    <div className={`shell ${className}`} ref={rootRef}>
      <header className="bar">
        <Brand compact />
        {bar}
      </header>
      <section className="theatre" aria-label="Simulation" data-sim-time={Math.round(simTime)}>
        <div className="sheet">
          {beat}
          {stage}
          {flight}
        </div>
      </section>
      {summary && <div className="summary-row">{summary}</div>}
      <aside className="panel" aria-label="Lesson">
        <div className="panel-scroll">{panel}</div>
        {pinned && <div className="panel-pin">{pinned}</div>}
      </aside>
      <footer className="dock">{dock}</footer>
    </div>
  );
}

/**
 * The narration line on the stage's sheet: along its top edge, or its bottom edge on phones. Until scripted beats
 * arrive it says what the scene shows (`lead`) and carries the scene's events: a fresh one in ink, then the latest
 * one quietly until the next. Phones also give it the slow-motion clock, which the dock has no room for.
 */
export function BeatStrip({ lead, sim, clock }: { lead?: ReactNode; sim: Sim; clock?: ReactNode }) {
  const fresh = freshNote(sim);
  const text = fresh ?? sim.notes[sim.notes.length - 1]?.text ?? "";
  return (
    <div className={`beat${fresh ? " fresh" : ""}`}>
      {lead}
      <p className="beat-text">{text && <span key={text}>{text}</span>}</p>
      {/* Only a fresh event is announced, not the latest one shown again after a step switch. */}
      <span className="sr-only" aria-live="polite">
        {fresh ?? ""}
      </span>
      {clock}
    </div>
  );
}
