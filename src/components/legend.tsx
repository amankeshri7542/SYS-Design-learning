"use client";

import { useEffect, useRef } from "react";
import type { DotKind } from "@/lib/lessons/beats";

const DOTS: { kind: DotKind; shape: string; cls: string; name: string; text: string }[] = [
  { kind: "req", shape: "circle", cls: "req", name: "Request", text: "On its way, or waiting its turn." },
  { kind: "late", shape: "circle", cls: "slow", name: "Running late", text: "Past the latency target and still going." },
  { kind: "ok", shape: "circle", cls: "ok", name: "Answered", text: "Heading back to the user with a good result." },
  { kind: "stale", shape: "donut", cls: "stale", name: "Stale answer", text: "Answered, but with out-of-date data." },
  { kind: "turned", shape: "square", cls: "turned", name: "Turned away", text: "Refused fast on purpose: rate-limited or a fallback." },
  { kind: "failed", shape: "diamond", cls: "err", name: "Failed", text: "An error. Dropped requests fall off the stage." },
  { kind: "gaveup", shape: "ring", cls: "err", name: "Gave up", text: "The user timed out. The work may still be running." },
  { kind: "copy", shape: "hollow", cls: "copy", name: "Copy", text: "A write on its way to a replica, which is behind until it lands." },
  { kind: "job", shape: "square", cls: "req", name: "Job", text: "Work left on a queue or sent to a subscriber, waiting for a worker." },
  { kind: "probe", shape: "ring-sm", cls: "copy", name: "Health check", text: "A small ping from a balancer, asking a server if it is up." },
];

export function Dot({ shape, cls }: { shape: string; cls: string }) {
  return (
    <svg viewBox="-8 -8 16 16" className={`dot dot-${cls}`} aria-hidden="true">
      {shape === "circle" && <circle r="5.5" />}
      {shape === "donut" && <path d="M0-5.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11zM0-2.3a2.3 2.3 0 1 0 0 4.6a2.3 2.3 0 1 0 0-4.6z" fillRule="evenodd" />}
      {shape === "square" && <rect x="-5" y="-5" width="10" height="10" rx="1.5" />}
      {shape === "diamond" && <path d="M0-7L7 0L0 7L-7 0Z" />}
      {shape === "ring" && <circle r="4.8" className="ring" />}
      {shape === "ring-sm" && <circle r="3" className="ring" />}
      {shape === "hollow" && <rect x="-3.6" y="-3.6" width="7.2" height="7.2" rx="1" className="hollow" />}
    </svg>
  );
}

/**
 * The dot vocabulary, opened from a button in the bar. A lesson's own dots come first; the rest of the course's follow.
 * It is a native popover: opening it moves focus to its close button, and Esc, a click outside or the close button
 * shuts it and gives focus back to the Key button.
 */
export function KeyPopover({ dots }: { dots?: DotKind[] }) {
  const here = dots?.length ? DOTS.filter((d) => dots.includes(d.kind)) : DOTS.filter((d) => d.kind !== "job" && d.kind !== "probe");
  const rest = dots?.length ? DOTS.filter((d) => !dots.includes(d.kind)) : [];
  const pop = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const el = pop.current;
    if (!el) return;
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === "open") close.current?.focus();
    };
    el.addEventListener("toggle", onToggle);
    return () => el.removeEventListener("toggle", onToggle);
  }, []);
  return (
    <>
      <button type="button" className="btn key-btn" popoverTarget="key-pop">
        Key
      </button>
      <div id="key-pop" ref={pop} className="key-pop" popover="auto" role="dialog" aria-labelledby="key-title">
        <div className="key-head">
          <h2 id="key-title">What the dots mean</h2>
          <button ref={close} type="button" className="btn btn-icon key-close" popoverTarget="key-pop" popoverTargetAction="hide" aria-label="Close the key">
            <svg viewBox="0 0 16 16" aria-hidden="true" className="stroke">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        {rest.length > 0 && <p className="key-sub">In this lesson</p>}
        <ul>
          {here.map((d) => (
            <li key={d.name}>
              <Dot shape={d.shape} cls={d.cls} />
              <span>
                <strong>{d.name}.</strong> {d.text}
              </span>
            </li>
          ))}
          <li>
            <svg viewBox="-8 -8 16 16" className="dot" aria-hidden="true">
              <circle r="5.5" className="socket-demo" />
            </svg>
            <span>
              <strong>Sockets</strong> inside a server are its workers; a hollow ring is a worker stuck waiting.
            </span>
          </li>
        </ul>
        {rest.length > 0 && (
          <details className="key-rest">
            <summary>Elsewhere in the course</summary>
            <ul>
              {rest.map((d) => (
                <li key={d.name}>
                  <Dot shape={d.shape} cls={d.cls} />
                  <span>
                    <strong>{d.name}.</strong> {d.text}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </>
  );
}

/** Compact strip of the dot vocabulary for the home page. */
export function DotStrip() {
  return (
    <ul className="dot-strip" aria-label="What the dots mean">
      {DOTS.filter((d) => d.kind !== "job" && d.kind !== "probe").map((d) => (
        <li key={d.name}>
          <Dot shape={d.shape} cls={d.cls} />
          {d.name}
        </li>
      ))}
    </ul>
  );
}
