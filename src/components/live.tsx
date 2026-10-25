"use client";

import { Suspense, lazy, useEffect, useRef, useState, type CSSProperties } from "react";
import { Sim } from "@/lib/sim/engine/core";
import { betterIs, changeSize, formatChange, formatClock, formatDiff, formatMetric, formatTarget, measure, toneOf, type MetricId, type MetricSpec } from "@/lib/sim/metrics";
import { stepGrid } from "@/lib/lessons/beats";
import { record } from "@/lib/record";
import type { SceneSpec } from "@/lib/sim/types";
import { useMode, useReducedMotion, useVisible } from "./hooks";
import type { DrawFn } from "./stage";

// A metric's sentences load the first time one is opened.
const MetricExplanation = lazy(() => import("./metric-explanation"));

const HISTORY = 40;

/** Where an answer's time goes: rows of these show, under each number, its share of the column's whole. */
const SPLIT: MetricId[] = ["wire", "wait", "work"];

/** A time part's share of the whole (travel + waiting + working) in one world, or the error budget left: its bar. */
function shareOf(m: MetricSpec, sim: Sim): number | undefined {
  if (m.id === "budget") return measure(sim, m) ?? undefined;
  if (!SPLIT.includes(m.id)) return undefined;
  const v = measure(sim, m);
  const total = SPLIT.reduce((sum, id) => sum + (measure(sim, { ...m, id, label: id }) ?? 0), 0);
  return v !== null && total > 0 ? v / total : undefined;
}

/** Reduced motion opens on a settled still frame this far past the warm-up (simulated ms). */
const STILL = 2600;

/**
 * Runs one or more simulations in lockstep (a lesson's problem and fix see the same clock and traffic),
 * plus the animation loop and playback state. Nothing advances while the element is off screen.
 *
 * `onGrid` is called on a fixed grid of simulated time (the lesson's beats); returning true pauses every world there.
 * `hold` keeps the clients quiet until `start()`, so a lesson can introduce its parts before any traffic runs.
 */
export function useLiveSims(
  specs: SceneSpec[],
  opts: { onFrame?: (sims: Sim[], realDt: number) => void; onGrid?: (sims: Sim[]) => boolean; warm?: number; hold?: boolean } = {},
) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [epoch, setEpoch] = useState(0);
  const [tick, setTick] = useState(0);
  const mode = useMode();
  const reduced = useReducedMotion();
  const [rootRef, visible] = useVisible<HTMLElement>();
  const warm = opts.warm ?? specs[0]?.warmMs ?? 0;

  const sims = useRef<{ list: Sim[]; epoch: number } | null>(null);
  if (!sims.current || sims.current.epoch !== epoch || sims.current.list.length !== specs.length) {
    const list = specs.map((s) => new Sim(s));
    if (opts.hold) for (const s of list) s.hold();
    if (warm) for (const s of list) s.step(warm);
    sims.current = { list, epoch };
  }
  const list = sims.current.list;

  const applied = useRef(specs);
  useEffect(() => {
    const prev = applied.current;
    applied.current = specs;
    let changed = false;
    specs.forEach((s, i) => {
      if (prev[i] !== s) {
        list[i]?.reconfigure(s);
        changed = true;
      }
    });
    if (changed) setTick((t) => t + 1);
  }, [specs, list]);

  const started = useRef(false);
  useEffect(() => {
    if (!visible || started.current) return;
    started.current = true;
    if (reduced) {
      // A still frame is a settled scene: nothing is held back from it.
      const still = specs[0]?.stillMs ?? STILL;
      for (const s of list) {
        s.start();
        s.step(still);
      }
      setTick((t) => t + 1);
    } else setPlaying(true);
  }, [visible, reduced, list]);

  const drawRef = useRef<DrawFn | null>(null);
  const loop = useRef({ playing, speed, stepUntil: 0, list, onFrame: opts.onFrame, onGrid: opts.onGrid });
  loop.current = { ...loop.current, playing, speed, list, onFrame: opts.onFrame, onGrid: opts.onGrid };
  const timeScale = specs[0]?.timeScale ?? 0.1;

  // The loop only runs while the scene is on screen and the tab is showing: no frames, no wake-ups, otherwise.
  useEffect(() => {
    if (!visible) return;
    let raf = 0;
    let last = 0;
    let lastTick = 0;
    const frame = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const L = loop.current;
      const running = L.playing || now < L.stepUntil;
      if (running) {
        const ms = dt * timeScale * L.speed;
        if (stepGrid(L.list, ms, L.onGrid)) {
          // A beat asked for a pause: every world holds still right where it fired.
          L.playing = false;
          L.stepUntil = 0;
          setPlaying(false);
          setTick((t) => t + 1);
        }
        L.onFrame?.(L.list, dt * L.speed);
      }
      drawRef.current?.(dt);
      if (running && now - lastTick > 90) {
        lastTick = now;
        setTick((t) => t + 1);
      }
      raf = requestAnimationFrame(frame);
    };
    const start = () => {
      if (raf || document.hidden) return;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [timeScale, visible]);

  const restart = () => {
    setEpoch((e) => e + 1);
    setPlaying(!reduced);
    started.current = true;
  };
  const step = () => {
    setPlaying(false);
    loop.current.stepUntil = performance.now() + 700;
  };
  const toggle = () => setPlaying((p) => !p);
  const refresh = () => setTick((t) => t + 1);
  const pause = () => {
    loop.current.playing = false;
    setPlaying(false);
  };
  const play = () => {
    if (!reduced) setPlaying(true);
  };
  /**
   * Fast-forward every world, on the grid, until `until` holds (or `capMs` of simulated time has passed). How the
   * learner skips to the next beat, and how reduced motion steps from one still frame to the next. True if it held.
   */
  const advance = (until: (sims: Sim[]) => boolean, capMs = 30000) => {
    const held = stepGrid(list, capMs, until);
    setTick((t) => t + 1);
    return held;
  };
  /** Let every world's clients send, from now (both worlds together, so the comparison stays fair). */
  const start = () => {
    for (const s of list) s.start();
  };

  return {
    sims: list,
    epoch,
    tick,
    mode,
    reduced,
    playing,
    speed,
    setSpeed,
    toggle,
    step,
    restart,
    refresh,
    pause,
    play,
    advance,
    start,
    rootRef,
    drawRef,
    clock: formatClock(timeScale, speed),
  };
}

export type Live = ReturnType<typeof useLiveSims>;

/** The latest scripted event, while it is fresh (about three seconds of real time). */
export function freshNote(sim: Sim) {
  const recent = sim.notes[sim.notes.length - 1];
  const scale = sim.spec.timeScale ?? 0.1;
  return recent && sim.t - recent.t < 3200 * scale ? recent.text : null;
}

const SPEEDS = [0.5, 1, 2];

/** Play or pause, step a moment, restart, and one button that cycles the speed. */
export function Transport({ live }: { live: Live }) {
  return (
    <div className="transport">
      <button type="button" className="btn btn-play" onClick={live.toggle} aria-pressed={live.playing} aria-label="Play" title={live.playing ? "Pause" : "Play"}>
        {live.playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <button type="button" className="btn btn-icon" onClick={live.step} title="Step forward a moment" aria-label="Step forward a moment">
        <StepIcon />
      </button>
      <button type="button" className="btn btn-icon" onClick={live.restart} title="Restart from the beginning" aria-label="Restart from the beginning">
        <RestartIcon />
      </button>
      <button
        type="button"
        className="btn btn-icon speed-cycle"
        onClick={() => live.setSpeed(SPEEDS[(SPEEDS.indexOf(live.speed) + 1) % SPEEDS.length])}
        aria-label={`${live.speed}× speed: ${live.clock}. Change speed`}
        title="Change speed"
      >
        {live.speed}×
      </button>
    </div>
  );
}

const CLOCK_HINT = "The scene plays in slow motion so you can follow each request. The numbers show the times the system really takes.";

/** States the slow-motion clock in plain words, so the numbers on screen can be read against it. */
export function Clock({ live }: { live: Live }) {
  return (
    <span className="slowmo" title={CLOCK_HINT}>
      {live.clock}
    </span>
  );
}

/** "target ≤ 400 ms" under a response-time label, or any metric that has a target of its own. */
function Target({ m, sloMs }: { m: MetricSpec; sloMs: number }) {
  const t = formatTarget(m, sloMs);
  return t ? <small className="target">{t}</small> : null;
}

/**
 * Cues for changes: `cue(cell, value)` is true for a moment after a cell's value differs from the one it last had.
 * A cell seen for the first time never cues, so nothing moves as the table first appears.
 */
function useCues() {
  const seen = useRef(new Map<string, { v: string; at: number }>());
  const now = performance.now();
  return (cell: string, v: string) => {
    const was = seen.current.get(cell);
    if (!was) {
      seen.current.set(cell, { v, at: -Infinity });
      return false;
    }
    // A value hovering at a boundary would flip every tick: cue a cell at most once in a second and a half.
    if (was.v !== v) seen.current.set(cell, { v, at: now - was.at > 1500 ? now : was.at });
    return now - seen.current.get(cell)!.at < 300;
  };
}

/** Smooths a stream of values so numbers glide instead of flickering at 11 updates a second. */
function useSmoothed() {
  const prev = useRef<Map<string, number>>(new Map());
  return (key: string, v: number | null, m: MetricSpec) => {
    if (v === null) {
      prev.current.delete(key);
      return null;
    }
    if (m.id === "queue" || m.id === "servers" || m.id === "conflicts" || m.id === "inRotation" || m.id === "unsynced") return v;
    const p = prev.current.get(key);
    // Glide toward the value, and land on it once the gap is too small to show (a share easing to 0 reaches 0).
    const step = p === undefined ? v : p + (v - p) * 0.35;
    const next = Math.abs(step - v) < 1e-4 * Math.max(1, Math.abs(v)) ? v : step;
    prev.current.set(key, next);
    return next;
  };
}

function useHistory(sim: Sim, metrics: MetricSpec[], values: (number | null)[]) {
  const history = useRef<Record<string, number[]>>({});
  const lastPush = useRef(-1);
  useEffect(() => {
    if (sim.t < lastPush.current) {
      history.current = {};
      lastPush.current = -1;
    }
    if (sim.t - lastPush.current < 50) return;
    lastPush.current = sim.t;
    metrics.forEach((m, i) => {
      const h = (history.current[m.label] ??= []);
      h.push(values[i] ?? 0);
      if (h.length > HISTORY) h.shift();
    });
  });
  return history.current;
}

/** Compact list of live metrics with sparklines (hero and capstone). */
export function MetricList({ metrics, sim }: { metrics: MetricSpec[]; sim: Sim }) {
  const smooth = useSmoothed();
  const values = metrics.map((m) => smooth(m.label, measure(sim, m), m));
  const history = useHistory(sim, metrics, values);
  return (
    <dl className="mlist">
      {metrics.map((m, i) => (
        <div key={m.label} className={`mrow tone-${toneOf(m, values[i], sim.spec.sloMs)}`}>
          <dt title={m.hint}>
            {m.label}
            <Target m={m} sloMs={sim.spec.sloMs} />
          </dt>
          <dd className="num">{formatMetric(m, values[i])}</dd>
          <dd className="mspark">
            <Spark data={history[m.label] ?? []} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export interface Column {
  label: string;
  sim: Sim;
  active: boolean;
}

/**
 * The same metrics measured in every step's simulation, side by side: the lesson's argument in numbers.
 * `verdict` (a problem and its fix) marks changes better or worse; otherwise they are plain differences.
 * `spot` is the row the narration points at. Tapping a row's name opens its explainer: the number read as sentences,
 * its target, and (`why`) what made it move.
 */
export function Compare({ metrics, columns, verdict, spot, why = {} }: { metrics: MetricSpec[]; columns: Column[]; verdict: boolean; spot?: string; why?: Record<string, string> }) {
  const smooth = useSmoothed();
  const cue = useCues();
  const [open, setOpen] = useState<{ m: MetricSpec; x: number; y: number } | null>(null);
  const pop = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = pop.current;
    if (!el) return;
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === "closed") opener.current?.focus({ preventScroll: true });
    };
    el.addEventListener("toggle", onToggle);
    return () => el.removeEventListener("toggle", onToggle);
  }, []);
  const explain = (m: MetricSpec, from: HTMLButtonElement) => {
    const r = from.getBoundingClientRect();
    opener.current = from;
    record("metric", { label: m.label });
    setOpen({ m, x: Math.max(12, Math.min(r.left, innerWidth - 332)), y: innerHeight - r.top + 8 });
    if (!pop.current?.matches(":popover-open")) pop.current?.showPopover();
  };
  const activeIndex = Math.max(0, columns.findIndex((c) => c.active));
  const cells = metrics.map((m) => columns.map((c, j) => smooth(`${j}:${m.label}`, measure(c.sim, m), m)));
  const history = useHistory(
    columns[activeIndex].sim,
    metrics,
    cells.map((row) => row[activeIndex]),
  );
  const two = columns.length === 2;
  return (
    <>
    <table className="compare" id="compare" tabIndex={-1}>
      <caption className="sr-only">Live metrics for each version of the scene</caption>
      <thead>
        <tr>
          <th scope="col">
            <span className="sr-only">Metric</span>
          </th>
          {columns.map((c) => (
            <th key={c.label} scope="col" className={c.active ? "on" : undefined}>
              {c.label}
            </th>
          ))}
          {two && (
            <th scope="col" className="delta-h">
              Change
            </th>
          )}
          {/* The sparkline is a picture of the recent past; screen readers get the numbers instead. */}
          <th scope="col" className="trend-h" aria-hidden="true" />
        </tr>
      </thead>
      <tbody>
        {metrics.map((m, i) => {
          const row = cells[i];
          const known = row.filter((v): v is number => v !== null);
          const differs = new Set(known.map((v) => formatMetric(m, v))).size > 1;
          const better = verdict ? betterIs(m) : "neutral";
          const best = known.length > 1 && differs && better !== "neutral" ? (better === "low" ? Math.min(...known) : Math.max(...known)) : null;
          const change = two ? changeOf(m, row[0], row[1], better !== "neutral") : null;
          return (
            <tr key={m.label} className={spot === m.label ? "spot" : undefined}>
              <th scope="row" title={m.hint}>
                <button type="button" className="mx" aria-haspopup="dialog" onClick={(e) => explain(m, e.currentTarget)}>
                  {m.label}
                </button>
                <Target m={m} sloMs={columns[0].sim.spec.sloMs} />
              </th>
              {row.map((v, j) => {
                const share = shareOf(m, columns[j].sim);
                return (
                <td
                  key={j}
                  className={`num tone-${toneOf(m, v, columns[j].sim.spec.sloMs)}${columns[j].active ? " on" : ""}${best !== null && v === best ? " best" : ""}${share !== undefined ? " share" : ""}`}
                  style={share !== undefined ? ({ "--share": share.toFixed(3) } as CSSProperties) : undefined}
                >
                  {/* Keyed by tone: a number crossing into a new tone gets a one-time cue (never on first draw). */}
                  <span key={toneOf(m, v, columns[j].sim.spec.sloMs)} className={cue(`${j}:${m.label}`, toneOf(m, v, columns[j].sim.spec.sloMs)) ? "cue" : undefined}>
                    {formatMetric(m, v)}
                  </span>
                </td>
                );
              })}
              {two && (
                <td className={`delta${change?.cls ?? ""}`}>
                  <span key={change ? change.text.charAt(0) + change.cls : "none"} className={cue(`d:${m.label}`, change ? change.text.charAt(0) + change.cls : "none") ? "cue" : undefined}>
                    <ChangeText change={change} />
                  </span>
                </td>
              )}
              <td className="trend" aria-hidden="true">
                <Spark data={history[m.label] ?? []} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
            <div ref={pop} id="metric-pop" className="metric-pop" popover="auto" role="dialog" aria-labelledby="metric-pop-h" style={open ? { left: open.x, bottom: open.y } : undefined}>
              {open && (
                <>
                  <div className="term-head">
                    <h2 id="metric-pop-h">{open.m.label}</h2>
                    <button type="button" className="btn btn-icon key-close" popoverTarget="metric-pop" popoverTargetAction="hide" aria-label="Close">
                      <svg viewBox="0 0 16 16" aria-hidden="true" className="stroke">
                        <path d="M4 4l8 8M12 4l-8 8" />
                      </svg>
                    </button>
                  </div>
                  {open.m.hint && <p className="term-short">{open.m.hint}</p>}
                  <p className="term-alias">{columns[activeIndex].label}, now:</p>
                  <Suspense fallback={null}>
                    <MetricExplanation m={open.m} sim={columns[activeIndex].sim} />
                  </Suspense>
                  {why[open.m.label] && (
                    <p className="metric-why">
                      <strong>Why it moved.</strong> {why[open.m.label]}
                    </p>
                  )}
                </>
              )}
            </div>
    </>
  );
}

interface Change {
  /** " up" (better), " down" (worse), or "" for a plain difference. */
  cls: string;
  text: string;
  verdict: string;
  size: number;
}

/**
 * Change from the first step to the second: relative and marked better or worse when `verdict`, otherwise a plain
 * signed difference in the metric's unit. Null when there is nothing to compare yet, or no visible change.
 */
function changeOf(m: MetricSpec, from: number | null, to: number | null, verdict: boolean): Change | null {
  if (from === null || to === null || formatMetric(m, from) === formatMetric(m, to)) return null;
  const size = changeSize(from, to);
  if (!verdict) return { cls: "", text: formatDiff(m, to - from), verdict: "", size };
  const better = betterIs(m) === "low" ? to < from : to > from;
  return { cls: better ? " up" : " down", text: formatChange(from, to), verdict: better ? "better: " : "worse: ", size };
}

/** A signed number over a thin bar as long as the change. "—" when nothing changed. */
function ChangeText({ change }: { change: Change | null }) {
  if (!change) return "—";
  return (
    <>
      {change.verdict && <span className="sr-only">{change.verdict}</span>}
      {change.text}
      <i className="delta-bar" style={{ transform: `scaleX(${Math.max(0.12, change.size)})` }} aria-hidden="true" />
    </>
  );
}

/**
 * Phones: the lesson's headline metric in every step, and its change, pinned in one row so the number stays in view
 * while you read. Tapping it brings the full table into view.
 */
export function MetricSummary({ metric, columns, verdict, onOpen }: { metric: MetricSpec; columns: Column[]; verdict: boolean; onOpen: () => void }) {
  const smooth = useSmoothed();
  const vals = columns.map((c, j) => smooth(`${j}`, measure(c.sim, metric), metric));
  const change = columns.length === 2 ? changeOf(metric, vals[0], vals[1], verdict && betterIs(metric) !== "neutral") : null;
  return (
    <button type="button" className="summary" onClick={onOpen}>
      <span className="summary-label">{metric.label}</span>
      {formatTarget(metric, columns[0].sim.spec.sloMs) && <span className="sr-only"> ({formatTarget(metric, columns[0].sim.spec.sloMs)})</span>}
      <span className="summary-vals">
        {vals.map((v, j) => (
          <span key={columns[j].label} className={`num tone-${toneOf(metric, v, columns[j].sim.spec.sloMs)}${columns[j].active ? " on" : ""}`}>
            {j > 0 && <ArrowIcon />}
            <span className="sr-only">{columns[j].label}: </span>
            {formatMetric(metric, v)}
          </span>
        ))}
      </span>
      {change && (
        <span className={`delta${change.cls}`}>
          <ChangeText change={change} />
        </span>
      )}
      <span className="sr-only">. Show all numbers</span>
    </button>
  );
}

function Spark({ data }: { data: number[] }) {
  if (data.length < 2) return <svg className="spark" viewBox="0 0 60 18" aria-hidden="true" />;
  const max = Math.max(...data, 1e-9) * 1.1;
  const pts = data.map((d, i) => `${((i / (HISTORY - 1)) * 60).toFixed(1)},${(17 - (d / max) * 15).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 60 18" aria-hidden="true">
      <polyline points={pts} />
    </svg>
  );
}

export const PlayIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4.5 2.8v10.4L13 8z" />
  </svg>
);
const PauseIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="3.5" y="2.8" width="3.2" height="10.4" rx="1" />
    <rect x="9.3" y="2.8" width="3.2" height="10.4" rx="1" />
  </svg>
);
const StepIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 2.8v10.4L10 8z" />
    <rect x="11" y="2.8" width="2.4" height="10.4" rx="1" />
  </svg>
);
const RestartIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="stroke">
    <path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5M3.2 2.6v2.6h2.6" />
  </svg>
);
export const BoltIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M9.2 1.5 3.5 9h3.8l-.8 5.5L12.5 7H8.6z" />
  </svg>
);
export const ArrowIcon = ({ dir = "right" }: { dir?: "left" | "right" }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="stroke">
    <path d={dir === "right" ? "M3 8h10M9 4l4 4-4 4" : "M13 8H3M7 4 3 8l4 4"} />
  </svg>
);
