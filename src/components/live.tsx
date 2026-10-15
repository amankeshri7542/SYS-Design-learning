"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Sim } from "@/lib/sim/engine";
import { betterIs, formatMetric, measure, toneOf, type MetricSpec } from "@/lib/sim/metrics";
import type { SceneSpec } from "@/lib/sim/types";
import { useMode, useReducedMotion, useVisible } from "./hooks";
import type { DrawFn } from "./stage";

const HISTORY = 48;

/**
 * Owns a running simulation (plus an optional hidden baseline), its animation loop and playback state.
 * The loop only advances while the figure is on screen; React re-renders about 11 times a second.
 */
export function useLiveSim(spec: SceneSpec, baseSpec?: SceneSpec, opts: { onFrame?: (sim: Sim, realDt: number) => void; warm?: number } = {}) {
  const { onFrame } = opts;
  const warm = opts.warm ?? spec.warmMs ?? 0;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [epoch, setEpoch] = useState(0);
  const [, setTick] = useState(0);
  const mode = useMode();
  const reduced = useReducedMotion();
  const [rootRef, visible] = useVisible<HTMLElement>();

  const sims = useRef<{ sim: Sim; base: Sim | null; epoch: number } | null>(null);
  if (!sims.current || sims.current.epoch !== epoch) {
    const sim = new Sim(spec);
    const base = baseSpec ? new Sim(baseSpec) : null;
    if (warm) {
      sim.step(warm);
      base?.step(warm);
    }
    sims.current = { sim, base, epoch };
  }
  const { sim, base } = sims.current;

  const applied = useRef(spec);
  useEffect(() => {
    if (applied.current === spec) return;
    applied.current = spec;
    sim.reconfigure(spec);
    if (base && baseSpec) base.reconfigure(baseSpec);
    setTick((t) => t + 1);
  }, [spec, baseSpec, sim, base]);

  const started = useRef(false);
  useEffect(() => {
    if (!visible || started.current) return;
    started.current = true;
    if (reduced) {
      sim.step(2600);
      base?.step(2600);
      setTick((t) => t + 1);
    } else setPlaying(true);
  }, [visible, reduced, sim, base]);

  const drawRef = useRef<DrawFn | null>(null);
  const loop = useRef({ playing, speed, visible, stepUntil: 0, sim, base, onFrame });
  loop.current = { ...loop.current, playing, speed, visible, sim, base, onFrame };
  const timeScale = spec.timeScale ?? 0.1;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastTick = 0;
    const frame = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const L = loop.current;
      if (L.visible) {
        const running = L.playing || now < L.stepUntil;
        if (running) {
          const ms = dt * timeScale * L.speed;
          L.sim.step(ms);
          L.base?.step(ms);
          L.onFrame?.(L.sim, dt * L.speed);
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
  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === " " || e.key === "k") {
      e.preventDefault();
      toggle();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      step();
    }
  };
  const refresh = () => setTick((t) => t + 1);

  const recent = sim.notes[sim.notes.length - 1];
  const note = recent && sim.t - recent.t < 3200 * timeScale ? recent.text : null;

  return {
    sim,
    base,
    epoch,
    mode,
    reduced,
    playing,
    speed,
    setSpeed,
    toggle,
    step,
    restart,
    refresh,
    onKey,
    rootRef,
    drawRef,
    note,
    slowdown: Math.round(1 / (timeScale * speed)),
  };
}

const SPEEDS = [0.5, 1, 2];

export function Transport({ live, name }: { live: ReturnType<typeof useLiveSim>; name: string }) {
  return (
    <div className="transport">
      <button type="button" className="btn btn-play" onClick={live.toggle} aria-pressed={live.playing}>
        {live.playing ? <PauseIcon /> : <PlayIcon />}
        <span>{live.playing ? "Pause" : "Play"}</span>
      </button>
      <button type="button" className="btn btn-icon" onClick={live.step} title="Step forward a moment" aria-label="Step forward a moment">
        <StepIcon />
      </button>
      <button type="button" className="btn btn-icon" onClick={live.restart} title="Restart from the beginning" aria-label="Restart from the beginning">
        <RestartIcon />
      </button>
      <fieldset className="seg seg-speed">
        <legend className="sr-only">Playback speed</legend>
        {SPEEDS.map((s) => (
          <label key={s}>
            <input type="radio" name={`speed-${name}`} checked={live.speed === s} onChange={() => live.setSpeed(s)} />
            <span>{s}×</span>
          </label>
        ))}
      </fieldset>
      <span className="slowmo" title="Simulated time runs slower than real time so you can follow each request.">
        {live.slowdown}× slow motion
      </span>
    </div>
  );
}

export function Metrics({ metrics, sim, base, baseLabel }: { metrics: MetricSpec[]; sim: Sim; base: Sim | null; baseLabel?: string }) {
  const history = useRef<Record<string, number[]>>({});
  const lastPush = useRef(-1);
  const values = metrics.map((m) => measure(sim, m));
  const baseValues = base ? metrics.map((m) => measure(base, m)) : [];
  useEffect(() => {
    if (sim.t - lastPush.current < 60) return;
    lastPush.current = sim.t;
    metrics.forEach((m, i) => {
      const h = (history.current[m.label] ??= []);
      h.push(values[i] ?? 0);
      if (h.length > HISTORY) h.shift();
    });
  });
  return (
    <dl className="metrics">
      {metrics.map((m, i) => {
        const v = values[i];
        const tone = toneOf(m, v, sim.spec.sloMs);
        const b = baseValues[i];
        const better = v !== null && b !== null && b !== undefined && v !== b && (betterIs(m) === "low" ? v < b : v > b);
        return (
          <div key={m.label} className={`metric tone-${tone}`}>
            <dt title={m.hint}>{m.label}</dt>
            <dd className="metric-value">
              <span className="num">{formatMetric(m, v)}</span>
              <Spark data={history.current[m.label] ?? []} />
            </dd>
            {base && baseLabel && (
              <dd className={`metric-was${better ? " better" : ""}`}>
                <span>{baseLabel}</span> {formatMetric(m, b ?? null)}
              </dd>
            )}
            {m.hint && <dd className="sr-only">{m.hint}</dd>}
          </div>
        );
      })}
    </dl>
  );
}

function Spark({ data }: { data: number[] }) {
  if (data.length < 2) return <svg className="spark" viewBox="0 0 80 22" aria-hidden="true" />;
  const max = Math.max(...data, 1e-9) * 1.1;
  const pts = data.map((d, i) => `${((i / (HISTORY - 1)) * 80).toFixed(1)},${(21 - (d / max) * 19).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 80 22" aria-hidden="true">
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
