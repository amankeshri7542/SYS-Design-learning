"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Brand } from "./brand";
import type { Live } from "./live";

/**
 * Space or k toggles playback; arrow keys move between steps; `keys` adds single keys of the player's own ([ and ] for
 * beats, f to follow a request, 1–3 for steps). Ignored while a control has focus.
 */
export function usePlayerKeys(live: Pick<Live, "toggle">, onStep?: (delta: number) => void, keys: Record<string, () => void> = {}) {
  const latest = useRef({ live, onStep, keys });
  latest.current = { live, onStep, keys };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && t.closest("input, select, textarea, button, summary, a, [contenteditable], [popover]")) return;
      const { live, onStep, keys } = latest.current;
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        live.toggle();
      } else if (onStep && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault();
        onStep(e.key === "ArrowRight" ? 1 : -1);
      } else if (keys[e.key]) {
        e.preventDefault();
        keys[e.key]();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/**
 * The one-screen layout. The bar on top; the theatre, where a beat strip sits on the stage's sheet (a followed
 * request's flight strip takes the strip's row while it runs); the panel, whose reading part scrolls while the numbers
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

