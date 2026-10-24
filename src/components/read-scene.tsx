"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DOTS } from "./legend";

/** The rail every specimen runs on: from the user (left) to a station (right), in the specimen's own units. */
const FROM = 30;
const TO = 166;

/** What each mark shows happening: where the dot comes from and where it rests, and anything the story needs drawn. */
const SPECIMENS: Record<string, { from: number; rest: number; back?: boolean; extra?: ReactNode }> = {
  req: { from: FROM, rest: 118 },
  late: { from: FROM, rest: 148, extra: <Target /> },
  ok: { from: TO, rest: 64, back: true },
  stale: { from: TO, rest: 76, back: true },
  turned: { from: FROM, rest: 56, extra: <Gate /> },
  failed: { from: FROM, rest: 158 },
  gaveup: { from: FROM, rest: 150 },
};

/**
 * How to read a scene: the seven marks a request can be, each shown happening once on its own short rail as the list
 * comes into view (and again on request). Under reduced motion each rests where it tells its story.
 */
export function ReadScene() {
  const ref = useRef<HTMLOListElement>(null);
  const [playing, setPlaying] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || playing) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setPlaying(true), { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [playing]);
  const kinds = DOTS.filter((d) => d.kind in SPECIMENS);
  return (
    <div className="read-scene">
      <ol ref={ref} key={round} className={`specimens${playing ? " playing" : ""}`}>
        {kinds.map((d, i) => {
          const s = SPECIMENS[d.kind];
          return (
            <li key={d.kind} className={`specimen spec-${d.kind}`} style={{ "--i": i, "--from": `${s.from}px`, "--rest": `${s.rest}px` } as CSSProperties}>
              <svg viewBox="0 0 200 46" aria-hidden="true">
                <circle cx="12" cy="20" r="7" className="spec-user" />
                <path d={`M${FROM - 8} 20H${TO + 6}`} className="spec-rail" />
                <path d={`M${FROM - 8} 20H${TO + 6}`} className="spec-core" />
                <rect x={TO + 8} y="7" width="24" height="26" rx="5" className="spec-station" />
                {s.extra}
                {d.kind === "gaveup" && <circle cx="12" cy="20" r="10.5" className="spec-gaveup" />}
                <g className="spec-mover">
                  <Mark kind={d.kind} />
                </g>
              </svg>
              <p>
                <strong>{d.name}.</strong> {d.text}
              </p>
            </li>
          );
        })}
      </ol>
      <button type="button" className="btn btn-replay" onClick={() => (setRound((r) => r + 1), setPlaying(true))}>
        <svg viewBox="0 0 16 16" aria-hidden="true" className="stroke">
          <path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5M3.2 2.6v2.6h2.6" />
        </svg>
        Play them again
      </button>
    </div>
  );
}

/** The dot itself, in the stage's shapes: a circle, a donut, a square, a diamond. */
function Mark({ kind }: { kind: string }) {
  switch (kind) {
    case "late":
      return (
        <>
          <circle r="6" className="m-req m-before" />
          <circle r="6" className="m-slow m-after" />
        </>
      );
    case "ok":
      return <circle r="6" className="m-ok" />;
    case "stale":
      return <path d="M0-6a6 6 0 1 1 0 12a6 6 0 1 1 0-12zM0-2.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z" fillRule="evenodd" className="m-stale" />;
    case "turned":
      return <rect x="-5.5" y="-5.5" width="11" height="11" rx="1.6" className="m-turned" />;
    case "failed":
      return <path d="M0-7.5L7.5 0L0 7.5L-7.5 0Z" className="m-err" />;
    default:
      return <circle r="6" className="m-req" />;
  }
}

/** The latency target, as a tick on the rail: a request still going past it is late. */
function Target() {
  return (
    <g className="spec-target">
      <path d="M100 10V30" />
      <text x="100" y="43" textAnchor="middle">
        target
      </text>
    </g>
  );
}

/** A rate limiter's gate across the rail. */
function Gate() {
  return <path d="M86 9V31" className="spec-gate" />;
}
