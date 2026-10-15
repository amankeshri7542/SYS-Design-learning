import { SIZES } from "@/lib/sim/layout";
import type { Glyph } from "@/lib/sim/types";
import { Body } from "./glyph";

const DOTS: { shape: string; cls: string; name: string; text: string }[] = [
  { shape: "circle", cls: "req", name: "Request", text: "On its way, or waiting its turn." },
  { shape: "circle", cls: "slow", name: "Running late", text: "Past the latency target and still going." },
  { shape: "circle", cls: "ok", name: "Answered", text: "Heading back to the user with a good result." },
  { shape: "donut", cls: "stale", name: "Stale answer", text: "Answered, but with out-of-date data." },
  { shape: "square", cls: "turned", name: "Turned away", text: "Refused fast on purpose: rate-limited or a fallback." },
  { shape: "diamond", cls: "err", name: "Failed", text: "An error. Dropped requests fall off the stage." },
  { shape: "ring", cls: "err", name: "Gave up", text: "The user timed out. The work may still be running." },
];

const PARTS: { glyph: Glyph; name: string; text: string; slots?: number }[] = [
  { glyph: "client", name: "Users", text: "Where requests come from." },
  { glyph: "lb", name: "Load balancer", text: "Picks which server gets each request." },
  { glyph: "server", name: "Server", text: "Each socket is a worker. A filled socket is busy, a hollow one is stuck waiting.", slots: 4 },
  { glyph: "cache", name: "Cache", text: "Fast copies. The bar shows how full it is." },
  { glyph: "db", name: "Database", text: "The source of truth. Slow, and hard to scale.", slots: 3 },
  { glyph: "queue", name: "Queue", text: "Work waiting for a worker (small squares are jobs)." },
];

export function Dot({ shape, cls }: { shape: string; cls: string }) {
  return (
    <svg viewBox="-8 -8 16 16" className={`dot dot-${cls}`} aria-hidden="true">
      {shape === "circle" && <circle r="5.5" />}
      {shape === "donut" && <path d="M0-5.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11zM0-2.3a2.3 2.3 0 1 0 0 4.6a2.3 2.3 0 1 0 0-4.6z" fillRule="evenodd" />}
      {shape === "square" && <rect x="-5" y="-5" width="10" height="10" rx="1.5" />}
      {shape === "diamond" && <path d="M0-7L7 0L0 7L-7 0Z" />}
      {shape === "ring" && <circle r="4.8" className="ring" />}
    </svg>
  );
}

/** "How to read a scene": the visual vocabulary every lesson uses. */
export function Legend() {
  return (
    <div className="legend">
      <div>
        <h3 className="legend-h">Dots are requests</h3>
        <ul className="legend-dots">
          {DOTS.map((d) => (
            <li key={d.name}>
              <Dot shape={d.shape} cls={d.cls} />
              <span>
                <strong>{d.name}</strong> {d.text}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="legend-h">Shapes are parts of the system</h3>
        <ul className="legend-parts">
          {PARTS.map((p) => {
            const s = SIZES[p.glyph];
            return (
              <li key={p.name}>
                <svg viewBox={`${-s.w / 2 - 4} ${-s.h / 2 - 4} ${s.w + 8} ${s.h + 8}`} className="part" aria-hidden="true">
                  <g className={`node g-${p.glyph}`}>
                    <Body glyph={p.glyph} w={s.w} h={s.h} slots={p.slots ?? 0} />
                  </g>
                </svg>
                <span>
                  <strong>{p.name}</strong> {p.text}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
