"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CAPSTONE, LINES, lessonsOn } from "@/lib/lessons";
import { markVisited, readVisited } from "@/lib/progress";

const ROW = 104;
const TOP = 62;
const STATION_X = (j: number) => 292 + j * 168;
const TURN_X = (i: number) => 1040 - i * 16;
const TERM_Y = TOP + ROW * 5 + 6;

function split(name: string): string[] {
  if (name.length <= 16) return [name];
  const mid = name.length / 2;
  let best = -1;
  for (let i = 0; i < name.length; i++) if (name[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? [name] : [name.slice(0, best), name.slice(best + 1)];
}

function useVisited() {
  const [visited, setVisited] = useState<Set<string>>(new Set());
  useEffect(() => setVisited(readVisited()), []);
  return visited;
}

/** The course drawn as a transit map: five coloured lines feeding one terminal. */
export function RouteMap() {
  const visited = useVisited();
  const lines = LINES.filter((l) => l.id !== "capstone");
  return (
    <>
      <svg className="route-svg" viewBox={`0 0 1100 ${TERM_Y + 50}`} role="group" aria-label="Route map of all lessons">
        {lines.map((line, i) => {
          const y = TOP + i * ROW;
          const stops = lessonsOn(line.id);
          const tx = TURN_X(i);
          const r = 22;
          return (
            <g key={line.id} className={`route-line line-${line.id}`}>
              <path
                className="track"
                d={`M232 ${y}H${tx - r}Q${tx} ${y} ${tx} ${y + r}V${TERM_Y - 14}`}
              />
              <g className="route-head">
                <circle cx="26" cy={y} r="19" className="roundel" />
                <text x="26" y={y + 6} textAnchor="middle" className="roundel-letter">
                  {line.letter}
                </text>
                <text x="56" y={y + 6} className="route-name">
                  {line.name}
                </text>
              </g>
              {stops.map((l, j) => {
                const x = STATION_X(j);
                const seen = visited.has(l.slug);
                return (
                  <Link key={l.slug} href={`/learn/${l.slug}`} className={`station${seen ? " seen" : ""}`}>
                    <title>{`${l.code} · ${l.title}${seen ? " (visited)" : ""}`}</title>
                    <rect x={x - 76} y={y - 34} width="152" height="96" className="hit" />
                    <text x={x} y={y - 19} textAnchor="middle" className="station-code">
                      {l.code}
                    </text>
                    <circle cx={x} cy={y} r="11" className="station-dot" />
                    {seen && <path d={`M${x - 4.5} ${y}l3 3 6-6.5`} className="station-check" />}
                    {split(l.title).map((part, k) => (
                      <text key={k} x={x} y={y + 31 + k * 17} textAnchor="middle" className="station-name">
                        {part}
                      </text>
                    ))}
                  </Link>
                );
              })}
            </g>
          );
        })}
        <Link href={`/learn/${CAPSTONE.slug}`} className="terminal">
          <title>{`Capstone · ${CAPSTONE.title}`}</title>
          <rect x={TURN_X(4) - 16} y={TERM_Y - 16} width={TURN_X(0) - TURN_X(4) + 32} height="32" rx="16" className="terminal-pill" />
          {lines.map((l, i) => (
            <circle key={l.id} cx={TURN_X(i)} cy={TERM_Y} r="5" className={`terminal-dot line-${l.id}`} />
          ))}
          <text x={TURN_X(4) - 32} y={TERM_Y - 2} textAnchor="end" className="terminal-kicker">
            ★ Capstone
          </text>
          <text x={TURN_X(4) - 32} y={TERM_Y + 18} textAnchor="end" className="terminal-name">
            {CAPSTONE.title}
          </text>
        </Link>
      </svg>

      <ol className="route-list" aria-label="Lessons by line">
        {LINES.map((line) => (
          <li key={line.id} className={`route-row line-${line.id}`}>
            <p className="route-row-head">
              <span className="roundel-sm" aria-hidden="true">
                {line.letter}
              </span>
              <span>
                <strong>{line.name}</strong>
                <span className="route-blurb">{line.blurb}</span>
              </span>
            </p>
            <ol>
              {lessonsOn(line.id).map((l) => (
                <li key={l.slug}>
                  <Link href={`/learn/${l.slug}`} className={visited.has(l.slug) ? "seen" : undefined}>
                    <span className="stop-dot" aria-hidden="true" />
                    <span className="stop-code">{l.code}</span>
                    <span className="stop-name">{l.title}</span>
                    {visited.has(l.slug) && <span className="sr-only"> (visited)</span>}
                  </Link>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </>
  );
}

export function MarkVisited({ slug }: { slug: string }) {
  useEffect(() => markVisited(slug), [slug]);
  return null;
}
