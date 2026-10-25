"use client";

import type { FlightView } from "./follow";

// Loaded the first time someone follows a request.

/**
 * The flight strip: one followed request's life as a timeline, in the strip's row while it runs. Rails are thin lines,
 * waiting is an open box, work a filled one: ink and outline only, since the dot colours are taken.
 */
export function FlightStrip({ v, onClose }: { v: FlightView; onClose: () => void }) {
  const span = Math.max(1, v.to - v.from);
  const ms = (n: number) => `${Math.round(n)} ms`;
  return (
    <div className="flight" data-done={v.end ? "" : undefined}>
      <span className="flight-tag">Following</span>
      <p className="flight-text" aria-live="polite">
        {v.text}
      </p>
      <span className="flight-bar" aria-hidden="true">
        {v.hops.map((h, i) => (
          <i
            key={i}
            className={`hop hop-${h.kind}`}
            title={`${h.kind === "travel" ? "On the wire to" : h.kind === "wait" ? "Waiting at" : "Worked on at"} ${v.label(h.node)}: ${ms(h.t1 - h.t0)}`}
            style={{ flexGrow: Math.max(0.01, (Math.min(h.t1, v.to) - h.t0) / span) }}
          />
        ))}
      </span>
      <span className="flight-sum">
        <span>wait {ms(v.sum.wait)}</span>
        <span>work {ms(v.sum.work)}</span>
        <span>wire {ms(v.sum.travel)}</span>
      </span>
      <button type="button" className="btn btn-icon flight-close" onClick={onClose} aria-label="Stop following">
        <svg viewBox="0 0 16 16" aria-hidden="true" className="stroke">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  );
}
