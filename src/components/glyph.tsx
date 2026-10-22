import type { Glyph } from "@/lib/sim/types";

/** Small line icons, drawn in a 16×16 box centred on the origin. */
function Icon({ glyph }: { glyph: Glyph }) {
  switch (glyph) {
    case "client":
      return (
        <g className="ico">
          <circle cx="-3" cy="-3.5" r="2.6" />
          <path d="M-8 6c0-3.3 2.2-5.5 5-5.5s5 2.2 5 5.5" />
          <circle cx="4.5" cy="-2" r="2.1" />
          <path d="M3.4 2.2c2.6-.3 4.8 1.4 4.8 3.8" />
        </g>
      );
    case "bot":
      return (
        <g className="ico">
          <rect x="-6" y="-4" width="12" height="9" rx="2.5" />
          <path d="M0-4v-3M-2.5 0.2h0.1M2.5 0.2h0.1M-2.5 3h5" />
        </g>
      );
    case "server":
      return (
        <g className="ico">
          <rect x="-6.5" y="-6" width="13" height="5" rx="1.5" />
          <rect x="-6.5" y="1" width="13" height="5" rx="1.5" />
          <path d="M-3.8-3.5h0.1M-3.8 3.5h0.1" />
        </g>
      );
    case "worker":
      return (
        <g className="ico">
          <circle r="3" />
          <path d="M0-7v2.5M0 4.5V7M-7 0h2.5M4.5 0H7M-5-5l1.8 1.8M3.2 3.2L5 5M-5 5l1.8-1.8M3.2-3.2L5-5" />
        </g>
      );
    case "cache":
      return (
        <g className="ico">
          <path d="M1.5-7L-4.5 1h4l-1 6 6-8h-4z" />
        </g>
      );
    case "edge":
      return (
        <g className="ico">
          <circle r="6.5" />
          <path d="M-6.5 0h13M0-6.5c2.6 2.4 2.6 10.6 0 13M0-6.5c-2.6 2.4-2.6 10.6 0 13" />
        </g>
      );
    case "db":
      return null;
    case "lb":
      return (
        <g className="ico">
          <path d="M-7 0h4M-3 0c2.5 0 3-5 6.5-5H7M-3 0h10M-3 0c2.5 0 3 5 6.5 5H7" />
        </g>
      );
    case "router":
      return (
        <g className="ico">
          <path d="M-2.5-6.5l-1.5 13M3.5-6.5l-1.5 13M-6-2.5h12.5M-6.5 2.5H6" />
        </g>
      );
    case "limiter":
      return (
        <g className="ico">
          <path d="M-7-6h14l-5.5 6.5V6l-3 1.5v-7z" />
        </g>
      );
    case "topic":
      return (
        <g className="ico">
          <circle r="1.8" />
          <path d="M-4.2-4.2a6 6 0 0 0 0 8.4M4.2-4.2a6 6 0 0 1 0 8.4M-7-7a10 10 0 0 0 0 14M7-7a10 10 0 0 1 0 14" />
        </g>
      );
    case "queue":
      return null;
  }
}

/** A short rule under a station, like the platform edge on a transit diagram. */
const Platform = ({ w, h }: { w: number; h: number }) => <path className="platform" d={`M${-w * 0.26} ${h / 2 + 4}H${w * 0.26}`} />;

/** The body of a node, drawn as ink line art: shape, icon, slot sockets and platform. Centred on the origin. */
export function Body({ glyph, w, h, slots }: { glyph: Glyph; w: number; h: number; slots: number }) {
  const sockets = slotSpots(glyph, w, h, slots);
  if (glyph === "lb" || glyph === "router" || glyph === "limiter") {
    const s = w * 0.74;
    return (
      <>
        <rect className="body" x={-s / 2} y={-s / 2} width={s} height={s} rx="8" transform="rotate(45)" />
        <Icon glyph={glyph} />
      </>
    );
  }
  if (glyph === "topic") {
    return (
      <>
        <circle className="body" r={w / 2} />
        <Icon glyph={glyph} />
      </>
    );
  }
  if (glyph === "db") {
    const rx = w / 2;
    const ry = 9;
    const top = -h / 2 + ry;
    const bottom = h / 2 - ry;
    return (
      <>
        <path className="body" d={`M${-rx} ${top}A${rx} ${ry} 0 0 1 ${rx} ${top}V${bottom}A${rx} ${ry} 0 0 1 ${-rx} ${bottom}Z`} />
        <path className="rim" d={`M${-rx} ${top}A${rx} ${ry} 0 0 0 ${rx} ${top}`} />
        {sockets.map((p, i) => (
          <circle key={i} className="socket" cx={p.x} cy={p.y} r={p.r} />
        ))}
        <Platform w={w} h={h} />
      </>
    );
  }
  if (glyph === "queue") {
    const n = Math.floor((w - 24) / 11);
    return (
      <>
        <rect className="body" x={-w / 2} y={-h / 2} width={w} height={h} rx={h / 2} />
        {Array.from({ length: n - 1 }, (_, i) => (
          <line key={i} className="tick" x1={w / 2 - 22.5 - i * 11} x2={w / 2 - 22.5 - i * 11} y1={-h / 2 + 10} y2={h / 2 - 10} />
        ))}
      </>
    );
  }
  const client = glyph === "client" || glyph === "bot";
  return (
    <>
      <rect className="body" x={-w / 2} y={-h / 2} width={w} height={h} rx={client ? h / 2 : 10} />
      <g transform={client ? "translate(0 0)" : `translate(${-w / 2 + 14} ${-h / 2 + 13})`}>
        <Icon glyph={glyph} />
      </g>
      {sockets.map((p, i) => (
        <circle key={i} className="socket" cx={p.x} cy={p.y} r={p.r} />
      ))}
      {!client && <Platform w={w} h={h} />}
    </>
  );
}

export interface Spot {
  x: number;
  y: number;
  r: number;
}

/** Where in-service requests sit inside a node (relative to its centre). A working request fills its socket exactly. */
export function slotSpots(glyph: Glyph, w: number, h: number, slots: number): Spot[] {
  if (!slots || slots > 16 || !["server", "worker", "db"].includes(glyph)) return [];
  const perRow = slots <= 6 ? slots : Math.ceil(slots / 2);
  const rows = Math.ceil(slots / perRow);
  const gap = perRow > 6 ? 11 : 15;
  const r = perRow > 6 ? 4.6 : 6.2;
  const baseY = glyph === "db" ? 6 : rows > 1 ? 5.5 : 7;
  const out: Spot[] = [];
  for (let i = 0; i < slots; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const inRow = Math.min(perRow, slots - row * perRow);
    out.push({
      x: (col - (inRow - 1) / 2) * gap,
      y: baseY + (rows === 1 ? 0 : (row - 0.5) * 13.5),
      r,
    });
  }
  return out;
}
