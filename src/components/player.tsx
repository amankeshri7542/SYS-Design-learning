"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { getLesson, lessonsOn, lineOf, neighbours } from "@/lib/lessons";
import { buildSteps, defaultsOf, headlineOf, isChoice, type FigureDef, type Knob, type RangeKnob, type Values } from "@/lib/lessons/types";
import type { MetricSpec } from "@/lib/sim/metrics";
import { KeyPopover } from "./legend";
import { ArrowIcon, BoltIcon, Clock, Compare, MetricSummary, Transport, useLiveSims } from "./live";
import { MarkVisited } from "./route-map";
import { BeatStrip, Shell, usePlayerKeys } from "./shell";
import { Stage } from "./stage";

const TONE: Record<FigureDef["tone"], string> = {
  problem: "The problem",
  fix: "The fix",
  tradeoff: "Trade-off",
  explore: "Explore",
};

/**
 * A lesson on one screen. The scene stays in view while you read, switch between the problem and the fix,
 * turn knobs and compare numbers. Only the reading part of the panel scrolls, and only if it must.
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
  const warm = Math.max(400, ...specs.map((s) => s.warmMs ?? 0));
  const live = useLiveSims(specs, { warm });
  const shown = Math.min(step, figs.length - 1);
  const fig = figs[shown];
  const sim = live.sims[shown];
  const go = (s: number) => setStep(Math.max(0, Math.min(last, s)));
  usePlayerKeys(live, (d) => setStep((s) => Math.max(0, Math.min(last, s + d))));
  const [tabsRef, tight] = useTightTabs();
  // The tabs pattern: arrow keys (wrapping), Home and End move between steps; Tab leaves the row.
  const onTabKey = (e: KeyboardEvent) => {
    const to = { ArrowRight: step + 1, ArrowLeft: step - 1, Home: 0, End: last }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const i = (to + last + 1) % (last + 1);
    go(i);
    document.getElementById(`tab-${i}`)?.focus();
  };

  const metrics = useMemo(() => {
    const seen = new Map<string, MetricSpec>();
    for (const f of figs) for (const m of f.metrics) if (!seen.has(m.label)) seen.set(m.label, m);
    return [...seen.values()].slice(0, 5);
  }, [figs]);
  const headline = useMemo(() => {
    const label = headlineOf(figs);
    return figs.flatMap((f) => f.metrics).find((m) => m.label === label)!;
  }, [figs]);

  const setKnob = (k: Knob, v: number) => setValues((all) => all.map((vals, i) => (i === shown ? { ...vals, [k.id]: v } : vals)));
  const nextLabel = step < last - 1 ? figs[step + 1].short : "Recap";
  // Only a problem and its fix earn a better/worse verdict; explore and trade-off steps just differ.
  const verdict = figs.map((f) => f.tone).join(",") === "problem,fix";
  const columns = figs.map((f, i) => ({ label: f.short, sim: live.sims[i], active: i === shown }));
  const showTable = () => {
    const table = document.getElementById("compare");
    table?.scrollIntoView({ block: "nearest", behavior: live.reduced ? "auto" : "smooth" });
    table?.focus({ preventScroll: true });
  };

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
          <h1 className="bar-title" title={lesson.why}>
            <span className="bar-code">{lesson.code}</span>
            <span className="bar-name">{lesson.title}</span>
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
          lead={
            <span key={fig.short} className={`beat-tone tone-${fig.tone}`}>
              {TONE[fig.tone]}
            </span>
          }
          clock={<Clock live={live} />}
        />
      }
      stage={<Stage sim={sim} spec={specs[shown]} frameSpecs={specs} mode={live.mode} reduced={live.reduced} label={`${fig.title}. ${fig.caption}`} drawRef={live.drawRef} />}
      summary={<MetricSummary metric={headline} columns={columns} verdict={verdict} onOpen={showTable} />}
      panel={
        <>
          <div className="panel-head">
            <div ref={tabsRef} className={`tabs${tight ? " tight" : ""}`} role="tablist" aria-label="Steps" onKeyDown={onTabKey}>
              {[...figs.map((f) => f.short), "Recap"].map((name, i) => (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  id={`tab-${i}`}
                  aria-selected={step === i}
                  aria-controls="step-panel"
                  tabIndex={step === i ? 0 : -1}
                  className={`tab${i < last ? ` tone-${figs[i].tone}` : ""}`}
                  onClick={() => go(i)}
                >
                  {/* The number is the visible label of a squeezed tab, so it is part of the tab's name; the tick is not. */}
                  <span className="tab-n" aria-hidden={i < last ? undefined : true}>
                    {i < last ? i + 1 : "✓"}
                  </span>
                  <span className="tab-name">{name}</span>
                </button>
              ))}
            </div>
          </div>
          <div id="step-panel" role="tabpanel" aria-labelledby={`tab-${step}`} className="step" key={step}>
            {step < last ? (
              <>
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
              <Recap why={lesson.why} takeaways={lesson.takeaways} />
            )}
          </div>
        </>
      }
      pinned={<Compare metrics={metrics} verdict={verdict} columns={columns} />}
      dock={
        <>
          <Transport live={live} />
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

/**
 * True when the step tabs can't all show their names on one row; the other tabs then shrink to their numbers.
 * A squeezed tab's name wraps out of sight inside it but keeps its natural width, so the row can always be re-measured.
 */
function useTightTabs() {
  const ref = useRef<HTMLDivElement>(null);
  const [tight, setTight] = useState(false);
  useEffect(() => {
    const row = ref.current;
    if (!row) return;
    const check = () => {
      // Padding and gap come from the selected tab, which never shrinks.
      const on = getComputedStyle(row.querySelector('[aria-selected="true"]') ?? row.querySelector(".tab")!);
      const pad = parseFloat(on.paddingLeft) + parseFloat(on.paddingRight) + parseFloat(on.columnGap);
      const names = [...row.querySelectorAll(".tab-name")].map((n) => n.getBoundingClientRect().width);
      const numbers = [...row.querySelectorAll(".tab-n")].map((n) => n.getBoundingClientRect().width);
      const rs = getComputedStyle(row);
      const need = names.reduce((sum, w, i) => sum + w + numbers[i] + pad, (names.length - 1) * parseFloat(rs.columnGap));
      setTight(need > row.clientWidth - parseFloat(rs.paddingLeft) - parseFloat(rs.paddingRight) + 0.05);
    };
    // The row's width, and each name's (the web font arriving widens them without resizing the row).
    const ro = new ResizeObserver(check);
    ro.observe(row);
    row.querySelectorAll(".tab-name").forEach((n) => ro.observe(n));
    return () => ro.disconnect();
  }, []);
  return [ref, tight] as const;
}

function Recap({ why, takeaways }: { why: string; takeaways: { use: string; catch: string; seen: string } }) {
  return (
    <>
      <h2 className="step-title">What to remember</h2>
      <p className="step-text recap-why">{why}</p>
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
    </>
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
  return <Slider k={k} value={value} name={name} onChange={onChange} />;
}

/**
 * A slider that follows the pointer at once but rebuilds the scene at most once a frame: dragging fires input events
 * faster than the screen refreshes, and each one would rebuild every step's scene.
 */
function Slider({ k, value, name, onChange }: { k: RangeKnob; value: number; name: string; onChange: (v: number) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const frame = useRef(0);
  const latest = useRef(value);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const change = (v: number) => {
    latest.current = v;
    setDrag(v);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      onChange(latest.current);
      setDrag(null);
    });
  };
  const shown = drag ?? value;
  const id = `${name}-${k.id}`;
  return (
    <div className="knob knob-range">
      <label className="knob-label" htmlFor={id}>
        {k.label}
      </label>
      <output className="knob-value" htmlFor={id}>
        {k.format ? k.format(shown) : shown}
      </output>
      <input id={id} type="range" min={k.min} max={k.max} step={k.step} value={shown} onChange={(e) => change(Number(e.target.value))} />
    </div>
  );
}
