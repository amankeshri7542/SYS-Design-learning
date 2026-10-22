"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { CAPSTONE } from "@/lib/lessons";
import { CAP_METRICS, START, STAGES, TARGET, capstoneScene, monthlyCost, type Arch } from "@/lib/lessons/capstone";
import type { Sim } from "@/lib/sim/engine";
import { formatMetric, measure } from "@/lib/sim/metrics";
import { Key } from "./legend";
import { ArrowIcon, Clock, MetricList, Transport, freshNote, useLiveSims } from "./live";
import { Shell, usePlayerKeys } from "./player";
import { MarkVisited } from "./route-map";
import { Stage } from "./stage";

const P95 = CAP_METRICS[0];
const ERR = CAP_METRICS[1];

/** Four stages of growth on one screen. Change the architecture until the target holds, then move on. */
export function CapstonePlayer() {
  const [stage, setStage] = useState(0);
  const [arch, setArch] = useState<Arch>(START);
  const [cleared, setCleared] = useState<boolean[]>(() => STAGES.map(() => false));
  const [held, setHeld] = useState(0);
  const holdRef = useRef(0);
  const S = STAGES[stage];
  const specs = useMemo(() => [capstoneScene(arch, S)], [arch, S]);

  const onFrame = useCallback(
    ([sim]: Sim[], dt: number) => {
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

  const live = useLiveSims(specs, { onFrame });
  usePlayerKeys(live);
  const sim = live.sims[0];
  const note = freshNote(sim);

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
    <Shell
      className="line-capstone capstone"
      simTime={sim.t}
      rootRef={live.rootRef as React.Ref<HTMLDivElement>}
      bar={
        <>
          <MarkVisited slug={CAPSTONE.slug} />
          <nav className="bar-line" aria-label="Capstone">
            <Link href="/#route" className="roundel-sm" aria-label="Route map" title="Route map">
              ★
            </Link>
          </nav>
          <h1 className="bar-title">
            <span className="bar-code">Capstone</span>
            <span className="bar-name">{CAPSTONE.title}</span>
          </h1>
          <span className="bar-arrows">
            <Link href="/learn/autoscaling" className="icon-link" aria-label="Previous lesson: Autoscaling" title="R3 Autoscaling">
              <ArrowIcon dir="left" />
            </Link>
          </span>
        </>
      }
      stage={
        <>
          <Stage sim={sim} spec={specs[0]} mode={live.mode} reduced={live.reduced} label={`URL shortener, stage ${stage + 1}: ${S.name}`} drawRef={live.drawRef} />
          <p className={`note${note ? " on" : ""}`} aria-live="polite">
            {note}
          </p>
          <span key={stage} className="stage-tag tone-explore">
            Stage {stage + 1} · {S.users + S.bot} req/s
          </span>
          <Key />
        </>
      }
      panel={
        <>
          <p className="why">{CAPSTONE.why}</p>
          <ol className="tabs cap-stages" aria-label="Stages">
            {STAGES.map((s, i) => {
              const locked = i > 0 && !cleared[i - 1];
              return (
                <li key={s.name}>
                  <button
                    type="button"
                    className={`tab${i === stage ? " current" : ""}${cleared[i] ? " cleared" : ""}`}
                    aria-current={i === stage ? "step" : undefined}
                    disabled={locked}
                    title={locked ? "Clear the previous stage first" : s.name}
                    onClick={() => go(i)}
                  >
                    <span className="tab-n" aria-hidden="true">
                      {cleared[i] ? "✓" : i + 1}
                    </span>
                    {s.name}
                  </button>
                </li>
              );
            })}
          </ol>
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
          <div className="step" key={stage}>
            <p className="step-tag tone-explore">
              Stage {stage + 1} of {STAGES.length} · {S.users + S.bot} requests a second
            </p>
            <p className="step-text">{S.brief}</p>
            <details className="cap-hint">
              <summary>Hint</summary>
              <p>{S.hint}</p>
            </details>
          </div>
          <div className={`cap-status${done ? " done" : ""}`}>
            <p className="cap-target">
              Target: p95 ≤ {TARGET.p95} ms, ≤ {Math.round(TARGET.errors * 100)}% failing, held {S.hold} s
            </p>
            <div className="chips">
              <span className={`chip ${p95ok ? "pass" : "fail"}`}>
                p95 {formatMetric(P95, p95)} {p95ok ? "✓" : "✗"}
              </span>
              <span className={`chip ${errOk ? "pass" : "fail"}`}>
                failed {formatMetric(ERR, err)} {errOk ? "✓" : "✗"}
              </span>
            </div>
            <div className="hold" aria-hidden="true">
              <span className="hold-bar" style={{ transform: `scaleX(${done ? 1 : pct})` }} />
            </div>
            <p className="hold-text">{done ? "Stage cleared" : `Holding ${held.toFixed(1)} of ${S.hold} s`}</p>
            <p className="sr-only" role="status">
              {done ? `Stage ${stage + 1} cleared.` : ""}
            </p>
          </div>
          {allDone && (
            <p className="cap-win">
              You kept it alive through all four stages for ${monthlyCost(arch)} a month. Can you find a cheaper design that still holds
              stage 4?
            </p>
          )}
          <MetricList metrics={CAP_METRICS} sim={sim} />
        </>
      }
      dock={
        <>
          <Transport live={live} name="capstone" compact />
          <Clock live={live} />
          <span className="dock-fill" />
          {done && stage < STAGES.length - 1 ? (
            <button type="button" className="btn-primary btn-next" onClick={() => go(stage + 1)}>
              <span className="btn-next-label">
                <span className="when-wide">Next: </span>
                {STAGES[stage + 1].name}
              </span>
              <ArrowIcon />
            </button>
          ) : (
            <span className={`dock-hold${done ? " done" : ""}`}>{done ? "All clear" : `${held.toFixed(1)} / ${S.hold} s`}</span>
          )}
        </>
      }
    />
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const id = `st-${label.replace(/\W+/g, "-")}`;
  return (
    <div className="stepper">
      <span className="stepper-label" id={id}>
        {label}
      </span>
      <div className="stepper-ctl" role="group" aria-labelledby={id}>
        <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`Fewer ${label.toLowerCase()}`}>
          −
        </button>
        <output>{value}</output>
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
