"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type FocusEvent, type PointerEvent } from "react";
import { COURSE, LEVELS, STORIES, isReady, lessonsOn, lineOf, liveLines, nextFor, prerequisitesOf } from "@/lib/lessons";
import type { LessonMeta, Level, Line, LineId } from "@/lib/lessons/types";
import { StationPreview, type PreviewSpot } from "./station-preview";
import { useVisited } from "./visited";

// ------------------------------------------------------------------------------------------------ geometry

/** Between neighbouring stations. */
const COL = 120;
/** A station card's height, near enough, for choosing which side of the station it opens on. */
const CARD_H = 360;
/** A zone's margin either side of its stations. */
const PAD = 20;
const ROW = 104;
/** The zone headers above the first line. */
const TOP = 64;
const END = 24;

export interface MapStop {
  meta: LessonMeta;
  x: number;
  y: number;
}

export interface MapGeometry {
  width: number;
  height: number;
  /** Zones as column bands: a station's column comes from its level, so every line shows where it gets hard. */
  bands: { id: Level; name: string; zone: string; x: number; w: number; count: number }[];
  rows: { line: Line; y: number; stops: MapStop[] }[];
  /** The journeys' terminals, on their own row under the lines. */
  journeys: MapStop[];
  journeyY: number;
}

/** The map's layout, from the catalog: rows are lines, column bands are levels, and journeys end on the last row. */
export function mapGeometry(): MapGeometry {
  const lines = liveLines();
  let x = 0;
  const bands = LEVELS.map((lv) => {
    const cols = Math.max(1, ...lines.map((l) => lessonsOn(l.id).filter((e) => e.level === lv.id).length));
    const band = { ...lv, x, w: 2 * PAD + cols * COL, count: COURSE.filter((e) => e.kind === "lesson" && e.level === lv.id).length };
    x += band.w;
    return band;
  });
  const rowY = (i: number) => TOP + ROW / 2 + i * ROW;
  const rows = lines.map((line, i) => {
    const stops = bands.flatMap((b) =>
      lessonsOn(line.id)
        .filter((e) => e.level === b.id)
        .map((meta, j) => ({ meta, x: b.x + PAD + COL * (j + 0.5), y: rowY(i) })),
    );
    return { line, y: rowY(i), stops };
  });
  const journeyY = rowY(lines.length) - 14;
  const journeys = STORIES.map((meta, j) => {
    const b = bands.find((x) => x.id === meta.level)!;
    return { meta, x: b.x + PAD + j * 300, y: journeyY };
  });
  return { width: x + END, height: journeyY + 44, bands, rows, journeys, journeyY };
}

/** A station name in one or two lines of about 16 characters. */
function split(name: string): string[] {
  if (name.length <= 16) return [name];
  const mid = name.length / 2;
  let best = -1;
  for (let i = 0; i < name.length; i++) if (name[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? [name] : [name.slice(0, best), name.slice(best + 1)];
}

/** A journey's dashed route through its stops to its terminal: smooth curves that leave and arrive level. */
function routeD(points: { x: number; y: number }[]) {
  return points
    .map((p, i) => {
      if (i === 0) return `M${p.x} ${p.y}`;
      const q = points[i - 1];
      const dx = Math.max(36, Math.abs(p.x - q.x) / 2);
      return `C${q.x + dx} ${q.y} ${p.x - dx} ${p.y} ${p.x} ${p.y}`;
    })
    .join("");
}

const listOf = (metas: LessonMeta[]) => metas.map((p) => `${p.code} ${p.title}`).join(", ");

/** What a station's link says: its code and name, whether it was visited, and what it is best seen after. */
function stationName(meta: LessonMeta, seen: boolean, ready: boolean, next: boolean) {
  const parts = [`${meta.code} ${meta.title}`];
  if (seen) parts.push("visited");
  if (next) parts.push("your next stop");
  if (!ready) parts.push(`best after ${listOf(prerequisitesOf(meta.slug))}`);
  return parts.join(", ");
}

// ------------------------------------------------------------------------------------------------ the poster (desktop)

/**
 * The course as a transit map: lines as rows, levels as fare zones, journeys ending on the last row. The frame pans
 * sideways when the map is wider than the page; the line heads stay put. Hovering or focusing a station opens its card.
 */
function RoutePoster({ visited, next }: { visited: Set<string>; next?: LessonMeta }) {
  const g = useMemo(mapGeometry, []);
  const posterRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ meta: LessonMeta; spot: PreviewSpot } | null>(null);
  const [journey, setJourney] = useState<string | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const timer = useRef(0);
  const shownJourney = peek ?? journey;

  const show = (meta: LessonMeta, el: Element, delay: number) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const poster = posterRef.current;
      const mark = el.querySelector(".station-dot, .terminal-pill") ?? el;
      if (!poster) return;
      const p = poster.getBoundingClientRect();
      const r = mark.getBoundingClientRect();
      // Below the station when the card fits on screen there; above when it fits there (clear of the sticky header);
      // otherwise wherever there is more room.
      const header = document.querySelector(".site-head")?.getBoundingClientRect().bottom ?? 0;
      const below = innerHeight - r.bottom - 40;
      const above = r.top - 36 - header;
      const side = below >= CARD_H || (above < CARD_H && below >= above) ? "below" : "above";
      const x = Math.max(8, Math.min(p.width - 368, r.left + r.width / 2 - p.left - 180));
      setPreview({ meta, spot: { x, y: side === "below" ? r.bottom - p.top + 40 : r.top - p.top - 36, side } });
    }, delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setPreview(null);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Which edges of the frame have more map beyond them: those edges fade, so the map reads as one that pans.
  const frameRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const measureEdges = () => {
    const f = frameRef.current;
    if (!f) return;
    const left = f.scrollLeft > 2;
    const right = f.scrollLeft + f.clientWidth < f.scrollWidth - 2;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  };
  useEffect(() => {
    const f = frameRef.current;
    if (!f) return;
    const ro = new ResizeObserver(measureEdges);
    ro.observe(f);
    return () => ro.disconnect();
  }, []);

  const handlers = (meta: LessonMeta, journeySlug?: string) => ({
    onPointerEnter: (e: PointerEvent) => {
      if (journeySlug) setPeek(journeySlug);
      if (e.pointerType === "mouse") show(meta, e.currentTarget, 140);
    },
    onPointerLeave: () => {
      if (journeySlug) setPeek(null);
      hide();
    },
    onFocus: (e: FocusEvent) => {
      if (journeySlug) setPeek(journeySlug);
      show(meta, e.currentTarget, 0);
    },
    onBlur: () => {
      if (journeySlug) setPeek(null);
      hide();
    },
  });

  const stopsOf = (story: LessonMeta) => (story.requires ?? []).flatMap((s) => g.rows.flatMap((r) => r.stops).filter((p) => p.meta.slug === s));

  return (
    <div className="route-poster" ref={posterRef}>
      <div className="poster-heads" aria-hidden="true" style={{ paddingTop: TOP }}>
        {g.rows.map(({ line }) => (
          <div key={line.id} className={`poster-head line-${line.id}`} style={{ height: ROW }}>
            <span className="roundel-lg">{line.letter}</span>
            <span>
              <strong>{line.name}</strong>
              <span className="poster-blurb">{line.blurb}</span>
            </span>
          </div>
        ))}
        <div className="poster-head line-stories" style={{ height: g.height - g.journeyY + 30 - TOP / 2 }}>
          <span className="roundel-lg">★</span>
          <span>
            <strong>Journeys</strong>
            <span className="poster-blurb">Real systems that ride several lines.</span>
          </span>
        </div>
      </div>
      <div
        className="poster-frame"
        ref={frameRef}
        data-more-left={more.left ? "" : undefined}
        data-more-right={more.right ? "" : undefined}
        onScroll={() => {
          hide();
          measureEdges();
        }}
      >
        <svg className="route-svg" width={g.width} height={g.height} viewBox={`0 0 ${g.width} ${g.height}`} role="group" aria-label="Route map of every live lesson, by line and level">
          {g.bands.map((b, i) => (
            <g key={b.id} className={`zone zone-${i + 1}`}>
              <rect x={b.x} y={0} width={b.w} height={g.height} className="zone-band" />
              {i > 0 && <path d={`M${b.x} 8V${g.height}`} className="zone-edge" />}
              <text x={b.x + PAD} y={24} className="zone-label">
                {b.zone}
              </text>
              <text x={b.x + PAD} y={46} className="zone-name">
                {b.name}
                <tspan className="zone-count" dx="10">
                  {b.count} {b.count === 1 ? "lesson" : "lessons"}
                </tspan>
              </text>
            </g>
          ))}
          {g.rows.map(({ line, y, stops }) => (
            <g key={line.id} className={`route-line line-${line.id}`}>
              <path className="track" d={`M0 ${y}H${stops[stops.length - 1].x}`} />
              {stops.map(({ meta, x }) => {
                const seen = visited.has(meta.slug);
                const ready = isReady(meta.slug, visited);
                const here = next?.slug === meta.slug;
                return (
                  <Link
                    key={meta.slug}
                    href={`/learn/${meta.slug}`}
                    className={`station${seen ? " seen" : ""}${ready ? "" : " early"}${here ? " next" : ""}`}
                    aria-label={stationName(meta, seen, ready, here)}
                    {...handlers(meta)}
                  >
                    <rect x={x - COL / 2 + 4} y={y - 40} width={COL - 8} height={ROW - 8} rx="10" className="hit" />
                    {here && (
                      <g className="next-flag" transform={`translate(${x} ${y - 44})`}>
                        <rect x="-30" y="-9" width="60" height="18" rx="9" />
                        <text y="4" textAnchor="middle">
                          {visited.size ? "NEXT" : "START"}
                        </text>
                      </g>
                    )}
                    <text x={x} y={y - 20} textAnchor="middle" className="station-code">
                      {meta.code}
                    </text>
                    <circle cx={x} cy={y} r="11" className="station-dot" />
                    {seen && <path d={`M${x - 4.5} ${y}l3 3 6-6.5`} className="station-check" />}
                    {split(meta.title).map((part, k) => (
                      <text key={k} x={x} y={y + 32 + k * 17} textAnchor="middle" className="station-name">
                        {part}
                      </text>
                    ))}
                  </Link>
                );
              })}
            </g>
          ))}
          {g.journeys.map((j) => {
            const route = stopsOf(j.meta);
            const on = shownJourney === j.meta.slug;
            const w = 72 + 7.6 * j.meta.title.length;
            const seen = visited.has(j.meta.slug);
            const ready = isReady(j.meta.slug, visited);
            return (
              <g key={j.meta.slug} className={`journey${on ? " on" : ""}`}>
                {on && <path className="journey-route" d={routeD([...route, { x: j.x + 18, y: j.y }])} />}
                {on && route.map((p) => <circle key={p.meta.slug} cx={p.x} cy={p.y} r="17" className="journey-stop" />)}
                <Link
                  href={`/learn/${j.meta.slug}`}
                  className={`terminal${seen ? " seen" : ""}${ready ? "" : " early"}`}
                  aria-label={stationName(j.meta, seen, ready, false)}
                  {...handlers(j.meta, j.meta.slug)}
                >
                  <rect x={j.x} y={j.y - 17} width={w} height="34" rx="17" className="terminal-pill" />
                  <text x={j.x + 18} y={j.y + 5} className="terminal-code">
                    {j.meta.code}
                  </text>
                  <text x={j.x + 50} y={j.y + 5} className="terminal-name">
                    {j.meta.title}
                  </text>
                </Link>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="poster-tools">
        <p className="poster-key" aria-hidden="true">
          <span className="key-stop" /> a lesson
          <span className="key-stop seen" /> visited
          <span className="key-stop early" /> best after another first
        </p>
        <div className="journey-toggles" role="group" aria-label="Show a journey's stops on the map">
          {STORIES.map((s) => (
            <button key={s.slug} type="button" className="chip-toggle" aria-pressed={journey === s.slug} onClick={() => setJourney((j) => (j === s.slug ? null : s.slug))}>
              Show {s.code}&rsquo;s stops
            </button>
          ))}
        </div>
      </div>
      {preview && <StationPreview key={preview.meta.slug} meta={preview.meta} spot={preview.spot} ready={isReady(preview.meta.slug, visited)} />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the board (phones)

type LevelFilter = Level | "all";

const matches = (e: LessonMeta, words: string[]) => {
  const hay = [e.code, e.title, lineOf(e.line).name, ...e.tags].join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
};

/**
 * Phones: the lines as collapsible groups with their counts, filtered by level and searched by name, tag or alias.
 * The line of your next stop opens first.
 */
function RouteBoard({ visited, next }: { visited: Set<string>; next?: LessonMeta }) {
  const [level, setLevel] = useState<LevelFilter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<LineId> | null>(null);
  const id = useId();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const filtering = level !== "all" || words.length > 0;
  const first = next?.line ?? "foundations";
  const groups: { line: Line; stops: LessonMeta[] }[] = [...liveLines(), lineOf("stories")].map((line) => ({
    line,
    stops: lessonsOn(line.id).filter((e) => (level === "all" || e.level === level) && matches(e, words)),
  }));
  const found = groups.reduce((n, g) => n + g.stops.length, 0);
  const isOpen = (l: LineId) => filtering || (open ?? new Set([first])).has(l);
  const toggle = (l: LineId, to: boolean) =>
    setOpen((was) => {
      const s = new Set(was ?? [first]);
      if (to) s.add(l);
      else s.delete(l);
      return s;
    });

  return (
    <div className="route-board">
      <div className="board-tools">
        <div className="seg board-levels" role="radiogroup" aria-label="Level">
          {(["all", ...LEVELS.map((l) => l.id)] as LevelFilter[]).map((v) => (
            <label key={v}>
              <input type="radio" name={`${id}-level`} checked={level === v} onChange={() => setLevel(v)} />
              <span>{v === "all" ? "All" : LEVELS.find((l) => l.id === v)!.name}</span>
            </label>
          ))}
        </div>
        <label className="board-search">
          <span className="sr-only">Find a lesson</span>
          <svg viewBox="0 0 16 16" aria-hidden="true" className="stroke">
            <circle cx="7" cy="7" r="4.5" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <input type="search" placeholder="Find a lesson: cache, Kafka, 429…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <p className="board-found" aria-live="polite">
          {filtering ? (found ? `${found} ${found === 1 ? "stop" : "stops"}` : "Nothing matches yet. Try another word.") : ""}
        </p>
      </div>
      <ol className="board-lines" aria-label="Lessons by line">
        {groups.map(({ line, stops }) => {
          if (filtering && !stops.length) return null;
          const all = lessonsOn(line.id);
          const seen = all.filter((e) => visited.has(e.slug)).length;
          return (
            <li key={line.id} className={`board-line line-${line.id}`}>
              <details open={isOpen(line.id)} onToggle={(e) => !filtering && e.currentTarget.open !== isOpen(line.id) && toggle(line.id, e.currentTarget.open)}>
                <summary>
                  <span className="roundel-sm" aria-hidden="true">
                    {line.letter}
                  </span>
                  <span className="board-name">
                    <strong>{line.name}</strong>
                    <span className="board-count">
                      {seen} of {all.length} visited
                    </span>
                  </span>
                  <svg viewBox="0 0 16 16" aria-hidden="true" className="stroke board-chevron">
                    <path d="m5 6 3 3 3-3" />
                  </svg>
                </summary>
                <ol>
                  {stops.map((e) => {
                    const ready = isReady(e.slug, visited);
                    const here = next?.slug === e.slug;
                    return (
                      <li key={e.slug}>
                        <Link href={`/learn/${e.slug}`} className={`${visited.has(e.slug) ? "seen" : ""}${ready ? "" : " early"}`}>
                          <span className="stop-dot" aria-hidden="true" />
                          <span className="stop-code">{e.code}</span>
                          <span className="stop-text">
                            <span className="stop-name">{e.title}</span>
                            <span className="stop-meta">
                              {LEVELS.find((l) => l.id === e.level)!.name} · {e.minutes} min
                              {here && <strong className="stop-next"> · {visited.size ? "next stop" : "start here"}</strong>}
                              {!ready && ` · after ${prerequisitesOf(e.slug).map((p) => p.code).join(", ")}`}
                            </span>
                          </span>
                          {visited.has(e.slug) && <span className="sr-only"> (visited)</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </details>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The route: the poster on wide screens, the board on narrow ones (CSS picks). Both read the visited list once. */
export function RouteMap() {
  const { visited } = useVisited();
  const last = [...visited].pop() ?? null;
  const next = nextFor(last, visited) ?? nextFor(null, visited);
  return (
    <>
      <RoutePoster visited={visited} next={next} />
      <RouteBoard visited={visited} next={next} />
    </>
  );
}
