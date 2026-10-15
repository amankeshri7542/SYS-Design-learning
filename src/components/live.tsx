"use client";

import { useEffect, useRef, useState } from "react";
import { Sim } from "@/lib/sim/engine";
import { betterIs, formatMetric, measure, toneOf, type MetricSpec } from "@/lib/sim/metrics";
import type { SceneSpec } from "@/lib/sim/types";
import { useMode, useReducedMotion, useVisible } from "./hooks";
import type { DrawFn } from "./stage";

const HISTORY = 40;

/**
 * Runs one or more simulations in lockstep (a lesson's problem and fix see the same clock and traffic),
 * plus the animation loop and playback state. Nothing advances while the element is off screen.
 */
export function useLiveSims(specs: SceneSpec[], opts: { onFrame?: (sims: Sim[], realDt: number) => void; warm?: number } = {}) {
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
      for (const s of list) s.step(2600);
      setTick((t) => t + 1);
    } else setPlaying(true);
  }, [visible, reduced, list]);

  const drawRef = useRef<DrawFn | null>(null);
  const loop = useRef({ playing, speed, visible, stepUntil: 0, list, onFrame: opts.onFrame });
  loop.current = { ...loop.current, playing, speed, visible, list, onFrame: opts.onFrame };
  const timeScale = specs[0]?.timeScale ?? 0.1;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastTick = 0;
    const frame = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const L = loop.current;
      if (L.visible && !document.hidden) {
        const running = L.playing || now < L.stepUntil;
        if (running) {
          const ms = dt * timeScale * L.speed;
          for (const s of L.list) s.step(ms);
          L.onFrame?.(L.list, dt * L.speed);
        }
        drawRef.current?.(dt);
        if (running && now - lastTick > 90) {
          lastTick = now;
          setTick((t) => t + 1);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [timeScale]);

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
    rootRef,
    drawRef,
    slowdown: Math.round(1 / (timeScale * speed)),
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

export function Transport({ live, name, compact = false }: { live: Live; name: string; compact?: boolean }) {
  return (
    <div className={`transport${compact ? " compact" : ""}`}>
      <button type="button" className="btn btn-play" onClick={live.toggle} aria-pressed={live.playing} aria-label={live.playing ? "Pause" : "Play"}>
        {live.playing ? <PauseIcon /> : <PlayIcon />}
        {!compact && <span>{live.playing ? "Pause" : "Play"}</span>}
      </button>
      <button type="button" className="btn btn-icon" onClick={live.step} title="Step forward a moment" aria-label="Step forward a moment">
        <StepIcon />
      </button>
      <button type="button" className="btn btn-icon" onClick={live.restart} title="Restart from the beginning" aria-label="Restart from the beginning">
        <RestartIcon />
      </button>
      {compact && (
        <button
          type="button"
          className="btn btn-icon speed-cycle"
          onClick={() => live.setSpeed(SPEEDS[(SPEEDS.indexOf(live.speed) + 1) % SPEEDS.length])}
          aria-label={`Playback speed ${live.speed}×, tap to change`}
        >
          {live.speed}×
        </button>
      )}
      <fieldset className="seg seg-speed">
        <legend className="sr-only">Playback speed</legend>
        {SPEEDS.map((s) => (
          <label key={s}>
            <input type="radio" name={`speed-${name}`} checked={live.speed === s} onChange={() => live.setSpeed(s)} />
            <span>{s}×</span>
          </label>
        ))}
      </fieldset>
      {!compact && (
        <span className="slowmo" title="Simulated time runs slower than real time so you can follow each request.">
          {live.slowdown}× slow motion
        </span>
      )}
    </div>
  );
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
    const next = p === undefined ? v : p + (v - p) * 0.35;
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
          <dt title={m.hint}>{m.label}</dt>
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

/** The same metrics measured in every step's simulation, side by side: the lesson's argument in numbers. */
export function Compare({ metrics, columns }: { metrics: MetricSpec[]; columns: Column[] }) {
  const smooth = useSmoothed();
  const activeIndex = Math.max(0, columns.findIndex((c) => c.active));
  const cells = metrics.map((m) => columns.map((c, j) => smooth(`${j}:${m.label}`, measure(c.sim, m), m)));
  const history = useHistory(
    columns[activeIndex].sim,
    metrics,
    cells.map((row) => row[activeIndex]),
  );
  return (
    <table className="compare">
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
          {columns.length === 2 && (
            <th scope="col" className="delta-h">
              Change
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {metrics.map((m, i) => {
          const row = cells[i];
          const known = row.filter((v): v is number => v !== null);
          const differs = new Set(known.map((v) => formatMetric(m, v))).size > 1;
          const best = known.length > 1 && differs ? (betterIs(m) === "low" ? Math.min(...known) : Math.max(...known)) : null;
          return (
            <tr key={m.label}>
              <th scope="row" title={m.hint}>
                <span>{m.label}</span>
                <Spark data={history[m.label] ?? []} />
              </th>
              {row.map((v, j) => (
                <td
                  key={j}
                  className={`num tone-${toneOf(m, v, columns[j].sim.spec.sloMs)}${columns[j].active ? " on" : ""}${best !== null && v === best ? " best" : ""}`}
                >
                  {formatMetric(m, v)}
                </td>
              ))}
              {columns.length === 2 && <Delta m={m} from={row[0]} to={row[1]} />}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Relative change from the first step to the second, marked better or worse. */
function Delta({ m, from, to }: { m: MetricSpec; from: number | null; to: number | null }) {
  if (from === null || to === null || formatMetric(m, from) === formatMetric(m, to)) return <td className="delta">—</td>;
  const better = betterIs(m) === "low" ? to < from : to > from;
  const pct = from === 0 ? null : Math.abs((to - from) / from);
  const text = pct === null ? "new" : pct >= 9.95 ? `${Math.round(pct)}×` : `${Math.round(pct * 100)}%`;
  return (
    <td className={`delta ${better ? "up" : "down"}`}>
      <span aria-hidden="true">{to < from ? "▼" : "▲"}</span>
      <span className="sr-only">{better ? "better by" : "worse by"}</span> {text}
    </td>
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
