"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getLesson, lessonsOn, lineOf, neighbours } from "@/lib/lessons";
import { buildSteps, defaultsOf, isChoice, type FigureDef, type Knob, type Values } from "@/lib/lessons/types";
import type { MetricSpec } from "@/lib/sim/metrics";
import type { NodeSpec, SceneSpec } from "@/lib/sim/types";
import { Brand } from "./brand";
import { Key } from "./legend";
import { ArrowIcon, BoltIcon, Clock, Compare, Transport, freshNote, useLiveSims, type Live } from "./live";
import { MarkVisited } from "./route-map";
import { Stage } from "./stage";

const TONE: Record<FigureDef["tone"], string> = {
  problem: "The problem",
  fix: "The fix",
  tradeoff: "Trade-off",
  explore: "Explore",
};

/** One frame big enough for every step, so switching steps never rescales the scene. */
export function combinedFrame(specs: SceneSpec[]): SceneSpec {
  // Keep every distinct position: a node that moves between steps must fit in the frame in both places.
  const nodes = new Map<string, NodeSpec>();
  for (const s of specs) for (const n of s.nodes) nodes.set(`${n.id}@${n.at.join(",")}`, n);
  const heights = specs.map((s) => s.wideH).filter((h): h is number => !!h);
  return { ...specs[0], nodes: [...nodes.values()], wideH: heights.length ? Math.max(...heights) : undefined };
}

/** Space toggles playback; arrow keys move between steps. Ignored while a control has focus. */
export function usePlayerKeys(live: Live, onStep?: (delta: number) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && t.closest("input, select, textarea, button, summary, a, [contenteditable]")) return;
      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        live.toggle();
      } else if (onStep && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault();
        onStep(e.key === "ArrowRight" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [live, onStep]);
}

/** The shared shell: bar on top, the live stage, a reading panel, and a dock with playback and the way forward. */
export function Shell({
  className,
  rootRef,
  bar,
  stage,
  panel,
  dock,
  simTime,
}: {
  className: string;
  simTime: number;
  rootRef: React.Ref<HTMLDivElement>;
  bar: ReactNode;
  stage: ReactNode;
  panel: ReactNode;
  dock: ReactNode;
}) {
  return (
    <div className={`shell ${className}`} ref={rootRef}>
      <header className="bar">
        <Brand compact />
        {bar}
      </header>
      <section className="theatre" aria-label="Simulation" data-sim-time={Math.round(simTime)}>
        {stage}
      </section>
      <aside className="panel" aria-label="Lesson">
        {panel}
      </aside>
      <footer className="dock">{dock}</footer>
    </div>
  );
}

/**
 * A lesson on one screen. The scene stays in view while you read, switch between the problem and the fix,
 * turn knobs and compare numbers. Only the panel scrolls, and only if it must.
 */
export function LessonPlayer({ slug }: { slug: string }) {
  const lesson = getLesson(slug)!;
  const figs = lesson.figures;
  const line = lineOf(lesson.line);
  const { prev, next } = neighbours(slug);
  const last = figs.length;
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Values[]>(() => figs.map(defaultsOf));
  const specs = useMemo(() => buildSteps(figs, values), [figs, values]);
  const frame = useMemo(() => combinedFrame(specs), [specs]);
  const warm = Math.max(400, ...specs.map((s) => s.warmMs ?? 0));
  const live = useLiveSims(specs, { warm });
  const shown = Math.min(step, figs.length - 1);
  const fig = figs[shown];
  const sim = live.sims[shown];
  const note = freshNote(sim);
  const go = (s: number) => setStep(Math.max(0, Math.min(last, s)));
  usePlayerKeys(live, (d) => setStep((s) => Math.max(0, Math.min(last, s + d))));

  const metrics = useMemo(() => {
    const seen = new Map<string, MetricSpec>();
    for (const f of figs) for (const m of f.metrics) if (!seen.has(m.label)) seen.set(m.label, m);
    return [...seen.values()].slice(0, 5);
  }, [figs]);

  const setKnob = (k: Knob, v: number) => setValues((all) => all.map((vals, i) => (i === shown ? { ...vals, [k.id]: v } : vals)));
  const nextLabel = step < last - 1 ? figs[step + 1].short : "Recap";
  // Only a problem and its fix earn a better/worse verdict; explore and trade-off steps just differ.
  const verdict = figs.map((f) => f.tone).join(",") === "problem,fix";

  return (
    <Shell
      className={`line-${line.id}`}
      simTime={sim.t}
      rootRef={live.rootRef as React.Ref<HTMLDivElement>}
      bar={
        <>
          <MarkVisited slug={slug} />
          <nav className="bar-line" aria-label={`${line.name} line`}>
            <Link href="/#route" className="roundel-sm" aria-label="Route map" title={`${line.name} line · route map`}>
              {line.letter}
            </Link>
            <ol className="bar-stops">
              {lessonsOn(lesson.line).map((s) => (
                <li key={s.slug}>
                  <Link href={`/learn/${s.slug}`} aria-current={s.slug === slug ? "page" : undefined} title={s.title}>
                    {s.code}
                  </Link>
                </li>
              ))}
            </ol>
          </nav>
          <h1 className="bar-title">
            <span className="bar-code">{lesson.code}</span>
            <span className="bar-name">{lesson.title}</span>
          </h1>
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
      stage={
        <>
          <Stage sim={sim} spec={specs[shown]} frameSpec={frame} mode={live.mode} reduced={live.reduced} label={`${fig.title}. ${fig.caption}`} drawRef={live.drawRef} />
          <p className={`note${note ? " on" : ""}`} aria-live="polite">
            {note}
          </p>
          <span key={fig.short} className={`stage-tag tone-${fig.tone}`}>
            {fig.short}
          </span>
          <Key />
        </>
      }
      panel={
        <>
          <p className="why">{lesson.why}</p>
          <div className="tabs" role="tablist" aria-label="Steps">
            {[...figs.map((f) => f.short), "Recap"].map((name, i) => (
              <button
                key={name}
                type="button"
                role="tab"
                id={`tab-${i}`}
                aria-selected={step === i}
                aria-controls="step-panel"
                className={`tab${i < last ? ` tone-${figs[i].tone}` : ""}`}
                onClick={() => go(i)}
              >
                <span className="tab-n" aria-hidden="true">
                  {i < last ? i + 1 : "✓"}
                </span>
                {name}
              </button>
            ))}
          </div>
          <div id="step-panel" role="tabpanel" aria-labelledby={`tab-${step}`} className="step" key={step}>
            {step < last ? (
              <>
                <p className={`step-tag tone-${fig.tone}`}>{TONE[fig.tone]}</p>
                <h2 className="step-title">{fig.title}</h2>
                <p className="step-text">{fig.caption}</p>
                {!!(fig.knobs?.length || fig.actions?.length) && (
                  <div className="controls">
                    {fig.knobs?.map((k) => <KnobControl key={k.id} k={k} value={values[shown][k.id]} name={`${slug}-${shown}`} onChange={(v) => setKnob(k, v)} />)}
                    {fig.actions && (
                      <div className="faults">
                        {fig.actions.map((a) => {
                          const on = a.isOn(sim);
                          return (
                            <button
                              key={a.id}
                              type="button"
                              className={`btn btn-fault${on ? " on" : ""}`}
                              aria-pressed={on}
                              onClick={() => {
                                // The same fault (matched by id) hits every step's world, so the comparison stays fair.
                                figs.forEach((f, j) => f.actions?.find((x) => x.id === a.id)?.run(live.sims[j], !on));
                                live.refresh();
                              }}
                            >
                              <BoltIcon />
                              {on ? a.undo : a.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <Takeaways takeaways={lesson.takeaways} />
            )}
          </div>
          <Compare metrics={metrics} verdict={verdict} columns={figs.map((f, i) => ({ label: f.short, sim: live.sims[i], active: i === shown }))} />
        </>
      }
      dock={
        <>
          <Transport live={live} name={slug} compact />
          <Clock live={live} />
          <span className="dock-fill" />
          <span className="dock-progress" aria-hidden="true">
            {[...figs, null].map((_, i) => (
              <i key={i} className={i === step ? "on" : i < step ? "past" : undefined} />
            ))}
          </span>
          {step > 0 && (
            <button type="button" className="btn btn-back" onClick={() => go(step - 1)}>
              <ArrowIcon dir="left" />
              <span>Back</span>
            </button>
          )}
          {step < last ? (
            <button type="button" className="btn-primary btn-next" onClick={() => go(step + 1)}>
              <span className="btn-next-label">
                <span className="when-wide">Next: </span>
                {nextLabel}
              </span>
              <ArrowIcon />
            </button>
          ) : next ? (
            <Link href={`/learn/${next.slug}`} className="btn-primary btn-next">
              <span className="btn-next-label">
                <span className="when-wide">Next stop: </span>
                {next.code} {next.title}
              </span>
              <ArrowIcon />
            </Link>
          ) : (
            <Link href="/#route" className="btn-primary btn-next">
              <span className="btn-next-label">Route map</span>
              <ArrowIcon />
            </Link>
          )}
        </>
      }
    />
  );
}

function Takeaways({ takeaways }: { takeaways: { use: string; catch: string; seen: string } }) {
  return (
    <dl className="takeaways">
      <div>
        <dt>Use it when</dt>
        <dd>{takeaways.use}</dd>
      </div>
      <div>
        <dt>The catch</dt>
        <dd>{takeaways.catch}</dd>
      </div>
      <div>
        <dt>Seen in</dt>
        <dd>{takeaways.seen}</dd>
      </div>
    </dl>
  );
}

export function KnobControl({ k, value, name, onChange }: { k: Knob; value: number; name: string; onChange: (v: number) => void }) {
  if (isChoice(k)) {
    return (
      <fieldset className="knob knob-choice">
        <legend>{k.label}</legend>
        <div className="seg seg-wrap">
          {k.options.map((o) => (
            <label key={o.value}>
              <input type="radio" name={`${name}-${k.id}`} checked={value === o.value} onChange={() => onChange(o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  const id = `${name}-${k.id}`;
  return (
    <div className="knob knob-range">
      <label className="knob-label" htmlFor={id}>
        {k.label}
      </label>
      <output className="knob-value" htmlFor={id}>
        {k.format ? k.format(value) : value}
      </output>
      <input id={id} type="range" min={k.min} max={k.max} step={k.step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}
