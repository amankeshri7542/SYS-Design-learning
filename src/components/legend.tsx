
const DOTS: { shape: string; cls: string; name: string; text: string }[] = [
  { shape: "circle", cls: "req", name: "Request", text: "On its way, or waiting its turn." },
  { shape: "circle", cls: "slow", name: "Running late", text: "Past the latency target and still going." },
  { shape: "circle", cls: "ok", name: "Answered", text: "Heading back to the user with a good result." },
  { shape: "donut", cls: "stale", name: "Stale answer", text: "Answered, but with out-of-date data." },
  { shape: "square", cls: "turned", name: "Turned away", text: "Refused fast on purpose: rate-limited or a fallback." },
  { shape: "diamond", cls: "err", name: "Failed", text: "An error. Dropped requests fall off the stage." },
  { shape: "ring", cls: "err", name: "Gave up", text: "The user timed out. The work may still be running." },
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

/** A small popover with the dot vocabulary, available next to every scene. */
export function Key() {
  return (
    <details className="key">
      <summary>Key</summary>
      <div className="key-pop">
        <ul>
          {DOTS.map((d) => (
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
      </div>
    </details>
  );
}

/** Compact strip of the dot vocabulary for the home page. */
export function DotStrip() {
  return (
    <ul className="dot-strip" aria-label="What the dots mean">
      {DOTS.map((d) => (
        <li key={d.name}>
          <Dot shape={d.shape} cls={d.cls} />
          {d.name}
        </li>
      ))}
    </ul>
  );
}
