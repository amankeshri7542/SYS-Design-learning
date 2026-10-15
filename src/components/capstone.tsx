"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { CAP_METRICS, START, STAGES, TARGET, capstoneScene, monthlyCost, type Arch } from "@/lib/lessons/capstone";
import type { Sim } from "@/lib/sim/engine";
import { formatMetric, measure } from "@/lib/sim/metrics";
import { Metrics, Transport, useLiveSim } from "./live";
import { Stage } from "./stage";

const P95 = CAP_METRICS[0];
const ERR = CAP_METRICS[1];

/** Four stages of growth. Change the architecture until the target holds, then move on. */
export function Capstone() {
  const [stage, setStage] = useState(0);
  const [arch, setArch] = useState<Arch>(START);
  const [cleared, setCleared] = useState<boolean[]>(() => STAGES.map(() => false));
  const [held, setHeld] = useState(0);
  const holdRef = useRef(0);
  const S = STAGES[stage];
  const spec = useMemo(() => capstoneScene(arch, S), [arch, S]);

  const onFrame = useCallback(
    (sim: Sim, dt: number) => {
      const p = measure(sim, P95);
      const e = measure(sim, ERR);
      const ok = sim.t > 400 && p !== null && p <= TARGET.p95 && (e ?? 0) <= TARGET.errors;
      holdRef.current = ok ? holdRef.current + dt : 0;
      const sec = holdRef.current / 1000;
      if (sec >= S.hold) {
        holdRef.current = S.hold * 1000;
        setCleared((c) => (c[stage] ? c : c.map((x, i) => (i === stage ? true : x))));
      }
      setHeld((h) => (Math.abs(h - sec) > 0.1 || (sec === 0 && h !== 0) ? sec : h));
    },
    [S, stage],
  );

  const live = useLiveSim(spec, undefined, { onFrame });
  const { sim } = live;

  const change = (next: Partial<Arch>) => {
    setArch((a) => ({ ...a, ...next }));
    holdRef.current = 0;
    setHeld(0);
  };
  const go = (i: number) => {
    setStage(i);
    holdRef.current = 0;
    setHeld(0);
  };

  const p95 = measure(sim, P95);
  const err = measure(sim, ERR);
  const p95ok = p95 !== null && p95 <= TARGET.p95;
  const errOk = err === null || err <= TARGET.errors;
  const done = cleared[stage];
  const allDone = cleared.every(Boolean);
  const pct = Math.min(1, held / S.hold);

  return (
    <div className="capstone">
      <ol className="cap-stages" aria-label="Stages">
        {STAGES.map((s, i) => {
          const locked = i > 0 && !cleared[i - 1];
          return (
            <li key={s.name}>
              <button
                type="button"
                className={`cap-stage${i === stage ? " current" : ""}${cleared[i] ? " cleared" : ""}`}
                aria-current={i === stage ? "step" : undefined}
                disabled={locked}
                onClick={() => go(i)}
              >
                <span className="cap-stage-n">{cleared[i] ? "✓" : i + 1}</span>
                <span className="cap-stage-name">{s.name}</span>
                <span className="cap-stage-load">
                  {s.users + s.bot} req/s{locked ? " · locked" : ""}
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <div className="cap-brief">
        <p>
          <strong>
            Stage {stage + 1}: {S.name}.
          </strong>{" "}
          {S.brief}
        </p>
        <p className="cap-target">
          Target: 95% of users answered within {TARGET.p95} ms, and no more than {Math.round(TARGET.errors * 100)}% failing, held
          for {S.hold} seconds.
        </p>
        <details className="cap-hint">
          <summary>Hint</summary>
          <p>{S.hint}</p>
        </details>
      </div>

      <figure ref={live.rootRef} className="fig fig-capstone" data-sim-time={Math.round(sim.t)} tabIndex={0} aria-label="Capstone simulation. Press space to play or pause." onKeyDown={live.onKey}>
        <div className="fig-stage">
          <Stage sim={sim} spec={spec} mode={live.mode} reduced={live.reduced} label={`URL shortener, stage ${stage + 1}: ${S.name}`} drawRef={live.drawRef} />
          <p className={`note${live.note ? " on" : ""}`} aria-live="polite">
            {live.note}
          </p>
        </div>
        <div className="fig-bar">
          <Transport live={live} name="capstone" />
        </div>

        <div className="cap-build" role="group" aria-label="Architecture">
          <Stepper label="App servers" value={arch.servers} min={1} max={4} onChange={(v) => change({ servers: v })} />
          <Toggle label="Cache" on={arch.cache} onChange={(v) => change({ cache: v })} />
          <Stepper label="Read replicas" value={arch.replicas} min={0} max={2} onChange={(v) => change({ replicas: v })} />
          <Toggle label="Rate limiter" on={arch.limiter} onChange={(v) => change({ limiter: v })} />
          <p className="cap-cost">
            <span>Running cost</span>
            <strong>${monthlyCost(arch)}/mo</strong>
          </p>
        </div>

        <div className={`cap-status${done ? " done" : ""}`} aria-live="polite">
          <span className={`chip ${p95ok ? "pass" : "fail"}`}>
            p95 {formatMetric(P95, p95)} {p95ok ? "✓" : "✗"}
          </span>
          <span className={`chip ${errOk ? "pass" : "fail"}`}>
            failed {formatMetric(ERR, err)} {errOk ? "✓" : "✗"}
          </span>
          <span className="hold">
            <span className="hold-bar" style={{ transform: `scaleX(${done ? 1 : pct})` }} />
          </span>
          <span className="hold-text">{done ? "Stage cleared" : `Holding ${held.toFixed(1)} / ${S.hold} s`}</span>
          {done && stage < STAGES.length - 1 && (
            <button type="button" className="btn-primary btn-sm" onClick={() => go(stage + 1)}>
              Next: {STAGES[stage + 1].name} →
            </button>
          )}
        </div>
        {allDone && (
          <p className="cap-win">
            You kept it alive through all four stages. Your design runs at ${monthlyCost(arch)} a month. Can you find a cheaper one that
            still holds stage 4?
          </p>
        )}
        <Metrics key={live.epoch} metrics={CAP_METRICS} sim={sim} base={null} />
      </figure>
    </div>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <span className="stepper-label" id={`st-${label}`}>
        {label}
      </span>
      <div className="stepper-ctl" role="group" aria-labelledby={`st-${label}`}>
        <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`Fewer ${label.toLowerCase()}`}>
          −
        </button>
        <output aria-live="polite">{value}</output>
        <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`More ${label.toLowerCase()}`}>
          +
        </button>
      </div>
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span className="stepper-label">{label}</span>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-ui" aria-hidden="true" />
    </label>
  );
}
