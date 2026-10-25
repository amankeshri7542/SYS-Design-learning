"use client";

import Link from "next/link";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Focus } from "@/lib/lessons/beats";
import { beatsOf, buildSteps, defaultsOf, headlineOf, isChoice, type FigureDef, type Knob, type Lesson, type PageNav, type RangeKnob, type Values } from "@/lib/lessons/types";
import type { Sim } from "@/lib/sim/engine";
import type { MetricSpec } from "@/lib/sim/metrics";
import { PredictCard, useBeats } from "./beats";
import { BeatStrip } from "./strip";
import { record, secondsOpen } from "@/lib/record";
import { useFollow } from "./follow";
import { useTouch } from "./hooks";
import { KeyPopover } from "./key";
import { ArrowIcon, BoltIcon, Clock, Compare, MetricSummary, Transport, useLiveSims } from "./live";
import { Shell, usePlayerKeys } from "./shell";
import { Stage } from "./stage";
import { Rich, TermChips, TermProvider } from "./term";

// The Recap and the reduced-motion list load the first time one shows.
const cards = () => import("./cards");
const Recap = lazy(() => cards().then((m) => ({ default: m.Recap })));
const WatchList = lazy(() => cards().then((m) => ({ default: m.WatchList })));
// So does the strip that follows one request.
const FlightStrip = lazy(() => import("./flight").then((m) => ({ default: m.FlightStrip })));

const TONE: Record<FigureDef["tone"], string> = {
  problem: "The problem",
  fix: "The fix",
  tradeoff: "Trade-off",
  explore: "Explore",
};

/**
 * A lesson on one screen. The scene stays in view while you read, switch between the problem and the fix,
 * turn knobs and compare numbers. Only the reading part of the panel scrolls, and only if it must.
 *
 * Each step walks through its beats: the parts first, then what to watch, each pointed at on the stage. Next brings on
 * the next beat (or lets a paused one go), and moves to the next step once the beats are done.
 */
export function LessonPlayer({ lesson, nav }: { lesson: Lesson; nav: PageNav }) {
  const slug = lesson.slug;
  const figs = lesson.figures;
  const { line, prev, next } = nav;
  const last = figs.length;
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Values[]>(() => figs.map(defaultsOf));
  const specs = useMemo(() => buildSteps(figs, values), [figs, values]);
  const warm = Math.max(400, ...specs.map((s) => s.warmMs ?? 0));
  const shown = Math.min(step, figs.length - 1);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  const beats = useBeats(lesson, step);
  const follow = useFollow();
  const followRef = useRef(follow);
  followRef.current = follow;
  const onGrid = useCallback(
    (sims: Sim[]) => {
      const stop = beats.onGrid(sims);
      if (followRef.current.active) for (const s of sims) followRef.current.look(s);
      return stop;
    },
    [beats],
  );
  const live = useLiveSims(specs, { warm, hold: beats.hold, onGrid });
  const fig = figs[shown];
  const explain = useMemo(() => ({ lesson: lesson.slug, learn: nav.learn, figs, step: shown }), [lesson.slug, nav.learn, figs, shown]);
  const sim = live.sims[shown];
  const go = (s: number) => setStep(Math.max(0, Math.min(last, s)));
  // The learning record: each step left for another, and the Recap reached.
  const was = useRef(step);
  useEffect(() => {
    if (was.current === step) return;
    record("tab", { from: was.current, to: step });
    if (step === last) record("recap", { s: secondsOpen() });
    was.current = step;
  }, [step, last]);

  const isOn = (id: string) => figs.some((f, j) => f.actions?.find((x) => x.id === id)?.isOn(live.sims[j]));
  // The same fault (matched by id) hits every step's world, so the comparison stays fair.
  const runFault = (id: string, on: boolean) => {
    record("fault", { id, on });
    figs.forEach((f, j) => f.actions?.find((x) => x.id === id)?.run(live.sims[j], on));
    live.refresh();
  };
  const b = beats.bind(live, { run: runFault, isOn });
  const narrated = useMemo(() => figs.some((f) => beatsOf(f).length), [figs]);

  const toggle = () => {
    if (!live.playing) b.played();
    live.toggle();
  };
  // Reduced motion: Step brings on the step's next beat, on a still frame (a moment's step once they're done).
  const step1 = () => (live.reduced && step < last && !b.done ? void b.next() : live.step());
  const onNext = () => {
    if (step >= last) return;
    if (b.next() === "step") go(step + 1);
  };
  const flight = follow.view();
  const toggleFollow = () => {
    if (follow.active) return follow.stop(), live.refresh();
    const client = fig.trace?.client ?? sim.list.find((n) => n.spec.client)?.spec.id;
    if (!client) return;
    const ready = follow.begin(sim, client);
    record("trace");
    follow.holdResult(live.reduced);
    // Reduced motion: run on to the end of the request's life and show it whole, on one still frame (once the tracker
    // has loaded, the first time).
    if (live.reduced) ready.then(() => follow.active && (live.advance(() => follow.look(sim), 20000), live.refresh()));
    else live.play();
    live.refresh();
  };
  // A beat that says "follow one" starts following, once, as it fires (not when it is shown again). Not on touch
  // layouts: there the flight strip would cover the strip that carries the beats, so the beat invites the tap instead.
  const touch = useTouch();
  const followCue = b.beat?.follow && b.announce && !touch ? `${step}:${b.beat.id}` : null;
  const toggleRef = useRef(toggleFollow);
  toggleRef.current = toggleFollow;
  useEffect(() => {
    if (followCue && !followRef.current.active) toggleRef.current();
  }, [followCue]);
  usePlayerKeys({ ...live, toggle }, (d) => setStep((s) => Math.max(0, Math.min(last, s + d))), {
    "[": b.back,
    "]": onNext,
    f: toggleFollow,
    ...Object.fromEntries([...figs, null].map((_, i) => [String(i + 1), () => go(i)])),
  });
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

  // A knob is noted where it comes to rest, not at every step of a drag.
  const knobAt = useRef<ReturnType<typeof setTimeout>>(undefined);
  // One still settling when the page goes would land on the next lesson: it is dropped.
  useEffect(() => () => clearTimeout(knobAt.current), []);
  const setKnob = (k: Knob, v: number) => {
    setValues((all) => all.map((vals, i) => (i === shown ? { ...vals, [k.id]: v } : vals)));
    clearTimeout(knobAt.current);
    knobAt.current = setTimeout(() => record("knob", { id: k.id, value: v }), 600);
  };
  const nextLabel = step < last - 1 ? figs[step + 1].short : "Recap";
  // Only a problem and its fix earn a better/worse verdict; explore and trade-off steps just differ.
  const verdict = figs.map((f) => f.tone).join(",") === "problem,fix";
  const columns = figs.map((f, i) => ({ label: f.short, sim: live.sims[i], active: i === shown }));
  const showTable = () => {
    const table = document.getElementById("compare");
    table?.scrollIntoView({ block: "nearest", behavior: live.reduced ? "auto" : "smooth" });
    table?.focus({ preventScroll: true });
  };
  const focus: Focus | null = b.focus;
  const asking = !!b.predict?.open;
  const breakLabel = b.breakDue ? fig.actions?.find((a) => a.id === b.breakDue)?.label : undefined;

  return (
    <TermProvider lesson={slug} onShow={(f) => b.show(f)}>
      <Shell
        className={`line-${line.id}`}
        simTime={sim.t}
        rootRef={live.rootRef as React.Ref<HTMLDivElement>}
        bar={
          <>
            <nav className="bar-line" aria-label={`${line.name} line`}>
              <Link href="/#route" className="roundel-sm" aria-label="Route map" title={`${line.name} line · route map`}>
                {line.letter}
              </Link>
              <ol className="bar-stops">
                {nav.stations.map((s) => (
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
            <KeyPopover dots={fig.key ?? lesson.dots} />
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
            beat={narrated ? (step < last ? b.beat : null) : undefined}
            announce={b.announce}
            clock={<Clock live={live} />}
          />
        }
        stage={
          <Stage
            sim={sim}
            spec={specs[shown]}
            frameSpecs={specs}
            mode={live.mode}
            reduced={live.reduced}
            label={`${fig.title}. ${fig.caption.replace(/\[\[[\w-]+\|([^\]]+)\]\]/g, "$1")}`}
            drawRef={live.drawRef}
            focus={focus}
            callout={step < last && b.beat ? { id: `${step}:${b.beat.id}`, text: b.beat.text, waiting: b.beat.waiting } : null}
            follow={flight?.id ?? null}
            explain={explain}
          />
        }
        flight={
          flight && (
            <Suspense fallback={null}>
              <FlightStrip v={flight} onClose={() => (follow.stop(), live.refresh())} />
            </Suspense>
          )
        }
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
                  {step === 0 && lesson.hook && (
                    <p className="hook">
                      <Rich text={lesson.hook} />
                    </p>
                  )}
                  <h2 className="step-title">{fig.title}</h2>
                  {b.predict && (asking || (b.predict.answer !== undefined && (step === b.predict.step || step === b.predict.revealStep))) && (
                    <PredictCard p={b.predict} onAnswer={(i) => b.answer(i)} />
                  )}
                  {!asking && (
                    <>
                      {/* Reduced motion: the beats to step through take the caption's place (the stage still carries it). */}
                      <TermChips keys={b.terms} />
                      {live.reduced && b.list.length ? (
                        <Suspense fallback={null}>
                          <WatchList items={b.list} />
                        </Suspense>
                      ) : (
                        <p className="step-text">
                          <Rich text={fig.caption} />
                        </p>
                      )}
                      {!!(fig.knobs?.length || fig.actions?.length) && (
                        <div className="controls">
                          {fig.knobs?.map((k) => (
                            <KnobControl key={k.id} k={k} value={values[shown][k.id]} name={`${slug}-${shown}`} onChange={(v) => setKnob(k, v)} spot={focus?.knob === k.id} />
                          ))}
                          {fig.actions && (
                            <div className="faults">
                              {fig.actions.map((a) => {
                                const on = a.isOn(sim);
                                return (
                                  <button
                                    key={a.id}
                                    type="button"
                                    className={`btn btn-fault${on ? " on" : ""}${focus?.action === a.id || b.breakDue === a.id ? " spot" : ""}`}
                                    aria-pressed={on}
                                    onClick={() => {
                                      runFault(a.id, !on);
                                      if (!on) b.pressed(a.id);
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
                  )}
                </>
              ) : (
                <Suspense fallback={null}>
                  <Recap lesson={lesson} claim={b.claim} rides={nav.rides} onWrong={(f) => b.show(f, 6000)} />
                </Suspense>
              )}
            </div>
          </>
        }
        pinned={<Compare metrics={metrics} verdict={verdict} columns={columns} spot={focus?.metric} why={b.why} />}
        dock={
          <>
            <Transport live={{ ...live, toggle, step: step1 }} />
            <Clock live={live} />
            <button
              type="button"
              className={`btn btn-follow${follow.active ? " on" : ""}`}
              aria-pressed={follow.active}
              onClick={toggleFollow}
              title="Follow one request (f)"
              aria-label="Follow one request"
            >
              <FollowIcon />
              <span className="when-wide">Follow one</span>
            </button>
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
              <button type="button" className="btn-primary btn-next" onClick={onNext} data-beats={b.done ? undefined : b.remaining}>
                <NextLabel b={b} breakLabel={breakLabel} next={nextLabel} />
              </button>
            ) : next ? (
              <Link href={`/learn/${next.slug}`} className="btn-primary btn-next" onClick={() => record("next", { to: next.slug })}>
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
    </TermProvider>
  );
}

/** What Next does now: let a paused beat go, cause the break, skip the guess, bring on a beat, or go to the next step. */
function NextLabel({ b, breakLabel, next }: { b: ReturnType<ReturnType<typeof useBeats>["bind"]>; breakLabel?: string; next: string }) {
  if (breakLabel)
    return (
      <>
        <BoltIcon />
        <span className="btn-next-label">{breakLabel}</span>
      </>
    );
  const text =
    b.waiting === "beat" ? (
      <>
        <span className="not-narrow">Continue</span>
        <span className="at-narrow">Next</span>
      </>
    ) : b.waiting === "ask" ? <>Skip<span className="when-wide"> the guess</span></> : !b.done ? "Next" : null;
  return (
    <>
      <span className="btn-next-label">
        {text ?? (
          <>
            <span className="when-wide">Next: </span>
            {next}
          </>
        )}
      </span>
      <ArrowIcon />
    </>
  );
}

const FollowIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="stroke">
    <circle cx="8" cy="8" r="2.4" />
    <circle cx="8" cy="8" r="5.6" />
  </svg>
);

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

/** The lesson in one rule, the why, the claim in numbers, a check or two, and where it is used. */
export function KnobControl({ k, value, name, onChange, spot }: { k: Knob; value: number; name: string; onChange: (v: number) => void; spot?: boolean }) {
  if (isChoice(k)) {
    return (
      <fieldset className={`knob knob-choice${spot ? " spot" : ""}`}>
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
  return <Slider k={k} value={value} name={name} onChange={onChange} spot={spot} />;
}

/**
 * A slider that follows the pointer at once but rebuilds the scene at most once a frame: dragging fires input events
 * faster than the screen refreshes, and each one would rebuild every step's scene.
 */
function Slider({ k, value, name, onChange, spot }: { k: RangeKnob; value: number; name: string; onChange: (v: number) => void; spot?: boolean }) {
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
    <div className={`knob knob-range${spot ? " spot" : ""}`}>
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

