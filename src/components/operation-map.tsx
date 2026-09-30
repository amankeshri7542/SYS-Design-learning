import { useState } from "react";
import type { Frame, Node } from "@/lib/engine";

export function OperationMap({
  frame,
  aws,
  inspect,
}: {
  frame: Frame;
  aws: boolean;
  inspect: (n: Node) => void;
}) {
  const [full, setFull] = useState(false);
  const { world: w, event } = frame;
  // These domain events broadcast from the first component to each recipient.
  const fanout = ["dispatch", "replicate", "enqueue"].includes(event.type);
  if (!w.edges.length) return null;
  const levels = new Map(w.nodes.map((n) => [n.id, 0]));
  // Small bounded DAG layout; reverse responses are highlighted on the original connection.
  for (let pass = 0; pass < w.nodes.length; pass++)
    for (const [a, b] of w.edges) {
      if (w.edges.some(([x, y]) => x === b && y === a)) continue;
      levels.set(
        b,
        Math.min(
          w.nodes.length - 1,
          Math.max(levels.get(b) || 0, (levels.get(a) || 0) + 1),
        ),
      );
    }
  const cols = [...new Set(levels.values())].sort((a, b) => a - b);
  const maxRows = Math.max(
    ...cols.map((c) => w.nodes.filter((n) => levels.get(n.id) === c).length),
  );
  const width = Math.max(600, cols.length * 180),
    height = Math.max(112, maxRows * 92 + 16);
  const positions = new Map(
    w.nodes.map((n) => {
      const peers = w.nodes.filter(
        (p) => levels.get(p.id) === levels.get(n.id),
      );
      return [
        n.id,
        {
          x: ((cols.indexOf(levels.get(n.id)!) + 0.5) * width) / cols.length,
          y: ((peers.indexOf(n) + 0.5) * height) / peers.length,
        },
      ];
    }),
  );
  const active = event.path.flatMap((id) => {
    const n = w.nodes.find((n) => n.id === id);
    return n ? [n] : [];
  });
  const shown = full || !active.length ? w.nodes : active;
  return (
    <section
      className={`operation-map ${full ? "show-full" : ""}`}
      aria-label="Connected architecture"
    >
      <div className="map-caption">
        <strong>
          {event.path.length ? "Follow this event" : "Connected architecture"}
        </strong>
        <button
          className="text-button map-focus-toggle"
          aria-pressed={full}
          onClick={() => setFull(!full)}
        >
          {full ? "Focus active operation" : "Show full architecture"}
        </button>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="connected-diagram"
        role="group"
        aria-label={`Connected components. ${event.title}`}
      >
        <defs>
          <marker
            id="operation-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {w.edges.map(([a, b], i) => {
          const from = positions.get(a),
            to = positions.get(b);
          if (!from || !to) return null;
          const forward =
            event.path.some((id, j) => id === a && event.path[j + 1] === b) ||
            (fanout && event.path[0] === a && event.path.slice(1).includes(b));
          const backward = event.path.some(
            (id, j) => id === b && event.path[j + 1] === a,
          );
          const lit = forward || backward;
          const reverse = backward && !forward;
          const start = reverse ? to : from,
            end = reverse ? from : to;
          const direction = Math.sign(end.x - start.x) || 1;
          return (
            <path
              key={`${a}-${b}-${i}`}
              className={lit ? "active-edge" : ""}
              d={`M ${start.x + direction * 78} ${start.y} C ${(start.x + end.x) / 2} ${start.y}, ${(start.x + end.x) / 2} ${end.y}, ${end.x - direction * 81} ${end.y}`}
              markerStart={
                forward && backward ? "url(#operation-arrow)" : undefined
              }
              markerEnd="url(#operation-arrow)"
            />
          );
        })}
        {w.nodes.map((n) => {
          const p = positions.get(n.id)!;
          return (
            <g
              key={n.id}
              role="button"
              tabIndex={0}
              aria-label={`Inspect ${n.label} in diagram`}
              className={`diagram-node health-${n.health} ${event.path.includes(n.id) ? "on-path" : ""}`}
              onClick={() => inspect(n)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  inspect(n);
                }
              }}
              transform={`translate(${p.x},${p.y})`}
            >
              <rect x="-78" y="-32" width="156" height="64" rx="8" />
              <text textAnchor="middle" y="-6">
                {n.label.length > 19 ? n.label.slice(0, 18) + "…" : n.label}
              </text>
              <text textAnchor="middle" y="15" className="node-status">
                {n.status.length > 24 ? n.health : n.status}
              </text>
              <title>{`${n.label}: ${n.status}. ${aws ? n.aws : n.detail}`}</title>
            </g>
          );
        })}
      </svg>
      <svg
        className="mobile-operation"
        viewBox={`0 0 320 ${[...new Set(shown.map((n) => n.id))].length * 86 + 10}`}
        role="group"
        aria-label={`Active operation: ${event.title}`}
      >
        <defs>
          <marker
            id="mobile-operation-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>
        {(() => {
          const nodes = [...new Map(shown.map((n) => [n.id, n])).values()];
          return (
            <>
              {w.edges.map(([a, b], i) => {
                const ai = nodes.findIndex((n) => n.id === a),
                  bi = nodes.findIndex((n) => n.id === b);
                if (ai < 0 || bi < 0) return null;
                const forward =
                    event.path.some(
                      (id, j) => id === a && event.path[j + 1] === b,
                    ) ||
                    (fanout &&
                      event.path[0] === a &&
                      event.path.slice(1).includes(b)),
                  backward = event.path.some(
                    (id, j) => id === b && event.path[j + 1] === a,
                  );
                const reverse = backward && !forward,
                  start = reverse ? bi : ai,
                  end = reverse ? ai : bi;
                const y1 = start * 86 + 43,
                  y2 = end * 86 + 43,
                  dir = Math.sign(end - start);
                const d =
                  Math.abs(end - start) === 1
                    ? `M 172 ${y1 + dir * 28} L 172 ${y2 - dir * 30}`
                    : `M 64 ${y1} H ${20 + i * 6} V ${y2} H 60`;
                return (
                  <path
                    key={`${a}-${b}`}
                    d={d}
                    className={forward || backward ? "active-edge" : ""}
                    markerEnd="url(#mobile-operation-arrow)"
                    markerStart={
                      forward && backward
                        ? "url(#mobile-operation-arrow)"
                        : undefined
                    }
                  />
                );
              })}
              {nodes.map((n, i) => (
                <g
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Inspect ${n.label} in mobile diagram`}
                  className={`diagram-node health-${n.health} ${event.path.includes(n.id) ? "on-path" : ""}`}
                  transform={`translate(172,${i * 86 + 43})`}
                  onClick={() => inspect(n)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      inspect(n);
                    }
                  }}
                >
                  <rect x="-108" y="-28" width="216" height="56" rx="8" />
                  <text textAnchor="middle" y="-4">
                    {n.label}
                  </text>
                  <text textAnchor="middle" y="16" className="node-status">
                    {n.status.length > 28 ? n.health : n.status}
                  </text>
                </g>
              ))}
            </>
          );
        })()}
      </svg>
      {aws && (
        <p className="map-aws-labels">
          {w.nodes.map((n) => `${n.label}: ${n.aws}`).join(" · ")}
        </p>
      )}
    </section>
  );
}
