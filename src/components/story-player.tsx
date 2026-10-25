"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { holds, type Control, type StoryDef, type Target } from "@/lib/lessons/story";
import type { LessonMeta, PageNav, Values } from "@/lib/lessons/types";
import type { Sim } from "@/lib/sim/engine";
import { formatMetric, formatTarget, measure } from "@/lib/sim/metrics";
import { record } from "@/lib/record";
import { BeatStrip, useSceneBeats } from "./beats";
import { KeyPopover } from "./key";
import { ArrowIcon, Clock, MetricList, Transport, freshNote, useLiveSims } from "./live";
import { Shell, usePlayerKeys } from "./shell";
import { Stage } from "./stage";

/**
 * A story on one screen: stage after stage of growth. Change the architecture until the target holds for the stage's
 * hold time, then move on. The cheapest design that holds wins.
 */
export function StoryPlayer({ meta, nav, why, def }: { meta: LessonMeta; nav: PageNav; why: string; def: StoryDef }) {
  const { stages, targets } = def;
  const [stage, setStage] = useState(0);
  const [arch, setArch] = useState<Values>(def.start);
  const [cleared, setCleared] = useState<boolean[]>(() => stages.map(() => false));
  const [held, setHeld] = useState(0);
  const holdRef = useRef(0);
  const S = stages[stage];
  const specs = useMemo(() => [def.scene(arch, S)], [def, arch, S]);
  const { prev, next } = nav;

  const onFrame = useCallback(
    ([sim]: Sim[], dt: number) => {
      const ok = sim.t > 400 && holds(targets, (m) => measure(sim, m));
      holdRef.current = ok ? holdRef.current + dt : 0;
      const sec = holdRef.current / 1000;
      if (sec >= S.hold) {
        holdRef.current = S.hold * 1000;
        setCleared((c) => (c[stage] ? c : c.map((x, i) => (i === stage ? true : x))));
      }
      setHeld((h) => (Math.abs(h - sec) > 0.1 || (sec === 0 && h !== 0) ? sec : h));
    },
    [S, stage, targets],
  );

  // Each stage opens with two beats: what changed, and the box to watch.
  const beats = useSceneBeats(S.beats, () => stage);
  const live = useLiveSims(specs, { onFrame, onGrid: beats.onGrid });
  usePlayerKeys(live);
  const sim = live.sims[0];
  // A scripted event (a server crashing) newer than the beat takes the strip.
  const last = sim.notes[sim.notes.length - 1];
  const eventLater = !!freshNote(sim) && !!last && (beats.at === null || last.t > beats.at);

  const change = (id: string, v: number) => {
    setArch((a) => ({ ...a, [id]: v }));
    holdRef.current = 0;
    setHeld(0);
  };
  const go = (i: number) => {
    setStage(i);
    holdRef.current = 0;
    setHeld(0);
  };

  const done = cleared[stage];
  const allDone = cleared.every(Boolean);
  const pct = Math.min(1, held / S.hold);
  const cost = def.cost(arch);
  // The learning record: each stage cleared, once, with the design's price.
  const noted = useRef(new Set<number>());
  useEffect(() => {
    if (!cleared[stage] || noted.current.has(stage)) return;
    noted.current.add(stage);
    record("stage", { stage, cost });
  }, [cleared, stage, cost]);

  return (
    <Shell
      className="line-stories story"
      simTime={sim.t}
      rootRef={live.rootRef as React.Ref<HTMLDivElement>}
      bar={
        <>
          <nav className="bar-line" aria-label="Journeys">
            <Link href="/#journeys" className="roundel-sm" aria-label="Journeys" title="Journeys">
              ★
            </Link>
          </nav>
          <h1 className="bar-title" title={why}>
            <span className="bar-code">{meta.code}</span>
            <span className="bar-name">{meta.title}</span>
          </h1>
          <KeyPopover />
          <span className="bar-arrows">
            {prev ? (
              <Link href={`/learn/${prev.slug}`} className="icon-link" aria-label={`Previous lesson: ${prev.title}`} title={`${prev.code} ${prev.title}`}>
                <ArrowIcon dir="left" />
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link href={`/learn/${next.slug}`} className="icon-link" aria-label={`Next lesson: ${next.title}`} title={`${next.code} ${next.title}`}>
                <ArrowIcon />
              </Link>
            )}
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
              Stage {stage + 1}
              {def.lead && ` · ${def.lead(S)}`}
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
          label={`${meta.title}, stage ${stage + 1}: ${S.name}`}
          drawRef={live.drawRef}
          focus={eventLater ? null : beats.beat?.focus}
          callout={!eventLater && beats.beat ? { id: beats.beat.id, text: beats.beat.text, waiting: false } : null}
        />
      }
      panel={
        <>
          <div className="panel-head">
            <ol className="tabs story-stages" aria-label="Stages">
              {stages.map((s, i) => {
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
            {stage === 0 && <p className="step-text">{why}</p>}
            <p className="step-text">{S.brief}</p>
            <details className="story-hint">
              <summary>Hint</summary>
              <p>{S.hint}</p>
            </details>
          </div>
          <div className="story-build" role="group" aria-label="Architecture">
            {def.controls.map((c) => (
              <ControlView key={c.id} c={c} value={arch[c.id]} onChange={(v) => change(c.id, v)} />
            ))}
            <p className="story-cost">
              <span>Running cost</span>
              <strong>${cost}/mo</strong>
            </p>
          </div>
          <MetricList metrics={def.metrics} sim={sim} />
          {allDone && <p className="story-win">{def.win(cost)}</p>}
        </>
      }
      pinned={
        <div className={`story-status${done ? " done" : ""}`}>
          <div className="story-target" role="group" aria-label={`Target, held for ${S.hold} s`}>
            {targets.map((t) => (
              <TargetCell key={t.label} t={t} sim={sim} />
            ))}
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
          {done && stage < stages.length - 1 ? (
            <button type="button" className="btn-primary btn-next" onClick={() => go(stage + 1)}>
              <span className="btn-next-label">
                <span className="when-wide">Next: </span>
                {stages[stage + 1].name}
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

/** One half of the target: the live value beside the line it must stay under. Neutral until there is data. */
function TargetCell({ t, sim }: { t: Target; sim: Sim }) {
  const value = measure(sim, t.metric);
  const ok = value !== null && value <= t.max;
  const state = value === null ? "wait" : ok ? "pass" : "fail";
  return (
    <div className={`story-cell ${state}`}>
      <span className="story-cell-label">{t.label}</span>
      <strong className="num">{formatMetric(t.metric, value)}</strong>
      <small className="target">{formatTarget({ ...t.metric, target: t.max }, sim.spec.sloMs)}</small>
      <span className="sr-only">{state === "wait" ? "no data yet" : ok ? "on target" : "off target"}</span>
    </div>
  );
}

function ControlView({ c, value, onChange }: { c: Control; value: number; onChange: (v: number) => void }) {
  if (c.kind === "switch") return <Toggle label={c.label} on={value > 0} onChange={(on) => onChange(on ? 1 : 0)} />;
  return <Stepper label={c.label} value={value} min={c.min} max={c.max} onChange={onChange} />;
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
