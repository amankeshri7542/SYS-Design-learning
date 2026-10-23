"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { CAPSTONE } from "@/lib/lessons";
import { CAP_METRICS, START, STAGES, TARGET, capstoneScene, monthlyCost, type Arch } from "@/lib/lessons/capstone";
import type { Sim } from "@/lib/sim/engine";
import { formatMetric, measure } from "@/lib/sim/metrics";
import { KeyPopover } from "./legend";
import { ArrowIcon, Clock, MetricList, Transport, freshNote, useLiveSims } from "./live";
import { MarkVisited } from "./route-map";
import { BeatStrip, useSceneBeats } from "./beats";
import { Shell, usePlayerKeys } from "./shell";
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

  // Each stage opens with two beats: what changed, and the box to watch.
  const beats = useSceneBeats(S.beats, () => stage);
  const live = useLiveSims(specs, { onFrame, onGrid: beats.onGrid });
  usePlayerKeys(live);
  const sim = live.sims[0];
  // A scripted event (server 1 crashing) newer than the beat takes the strip.
  const last = sim.notes[sim.notes.length - 1];
  const eventLater = !!freshNote(sim) && !!last && (beats.at === null || last.t > beats.at);

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
  const done = cleared[stage];
  const allDone = cleared.every(Boolean);
  const pct = Math.min(1, held / S.hold);
  const rate = S.users + S.bot;

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
          <h1 className="bar-title" title={CAPSTONE.why}>
            <span className="bar-code">Capstone</span>
            <span className="bar-name">{CAPSTONE.title}</span>
          </h1>
          <KeyPopover />
          <span className="bar-arrows">
            <Link href="/learn/autoscaling" className="icon-link" aria-label="Previous lesson: Autoscaling" title="R3 Autoscaling">
              <ArrowIcon dir="left" />
            </Link>
          </span>
        </>
      }
      beat={
        <BeatStrip
          sim={sim}
          beat={eventLater ? undefined : (beats.beat ?? undefined)}
          announce={eventLater ? undefined : (beats.beat?.text.replace(/\[\[[\w-]+\|?([^\]]*)\]\]/g, "$1") ?? "")}
          lead={
            <span key={stage} className="beat-tone tone-explore">
              Stage {stage + 1} · {rate} a second
            </span>
          }
          clock={<Clock live={live} />}
        />
      }
      stage={
        <Stage
          sim={sim}
          spec={specs[0]}
          mode={live.mode}
          reduced={live.reduced}
          label={`URL shortener, stage ${stage + 1}: ${S.name}`}
          drawRef={live.drawRef}
          focus={eventLater ? null : beats.beat?.focus}
          callout={!eventLater && beats.beat ? { id: beats.beat.id, text: beats.beat.text, waiting: false } : null}
        />
      }
      panel={
        <>
          <div className="panel-head">
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
                      <span className="tab-name">{s.name}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="step" key={stage}>
            <h2 className="step-title">{S.name}</h2>
            {stage === 0 && <p className="step-text">{CAPSTONE.why}</p>}
            <p className="step-text">{S.brief}</p>
            <details className="cap-hint">
              <summary>Hint</summary>
              <p>{S.hint}</p>
            </details>
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
          <MetricList metrics={CAP_METRICS.slice(2)} sim={sim} />
          {allDone && (
            <p className="cap-win">
              You kept it alive through all four stages for ${monthlyCost(arch)} a month. Can you find a cheaper design that still holds
              stage 4?
            </p>
          )}
        </>
      }
      pinned={
        <div className={`cap-status${done ? " done" : ""}`}>
          <div className="cap-target" role="group" aria-label={`Target, held for ${S.hold} s`}>
            <TargetCell label="Response time" value={p95} shown={formatMetric(P95, p95)} target={`target ≤ ${TARGET.p95} ms`} ok={p95 !== null && p95 <= TARGET.p95} />
            <TargetCell label="Failed" value={err} shown={formatMetric(ERR, err)} target={`target ≤ ${Math.round(TARGET.errors * 100)}%`} ok={err !== null && err <= TARGET.errors} />
          </div>
          <div className="hold-row">
            <div className="hold" aria-hidden="true">
              <span className="hold-bar" style={{ transform: `scaleX(${done ? 1 : pct})` }} />
            </div>
            <p className="hold-text">{done ? "Stage cleared" : `Holding ${held.toFixed(1)} of ${S.hold} s`}</p>
          </div>
          <p className="sr-only" role="status">
            {done ? `Stage ${stage + 1} cleared.` : ""}
          </p>
        </div>
      }
      dock={
        <>
          <Transport live={live} />
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

/** One half of the target: the live value beside what it must stay under. Neutral until there is data. */
function TargetCell({ label, value, shown, target, ok }: { label: string; value: number | null; shown: string; target: string; ok: boolean }) {
  const state = value === null ? "wait" : ok ? "pass" : "fail";
  return (
    <div className={`cap-cell ${state}`}>
      <span className="cap-cell-label">{label}</span>
      <strong className="num">{shown}</strong>
      <small className="target">{target}</small>
      <span className="sr-only">{state === "wait" ? "no data yet" : ok ? "on target" : "off target"}</span>
    </div>
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
