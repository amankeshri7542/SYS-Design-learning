"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BeatRunner, fillIn, placeholdersIn, plainText, termsIn, type Beat, type Check, type Fired, type Focus, type Prediction } from "@/lib/lessons/beats";
import { beatsOf, holdsTraffic, type Lesson } from "@/lib/lessons/types";
import type { Sim } from "@/lib/sim/engine";
import type { Pt, Rect, Size } from "@/lib/sim/layout";
import { formatMetric, measure } from "@/lib/sim/metrics";
import { freshNote, type Live } from "./live";
import { Rich } from "./term";

interface State {
  sims: Sim[] | null;
  runners: BeatRunner[];
  /** Every beat fired, in order across the lesson's steps: how the live region knows a beat is new. */
  seq: number;
  seqOf: WeakMap<Fired, number>;
  /** The prediction: its noted numbers, the answer (null when skipped), and the line its reveal adds. */
  marks: Record<string, string>;
  raw: { before: number | null; after: number | null };
  answer: number | null | undefined;
  line: string | null;
  /** The claim's sentence, read at its beat. */
  claim: string | null;
}

/** What the strip and the callout show: the current beat. */
export interface BeatView {
  id: string;
  text: string;
  focus: Focus | null;
  /** 1-based position in the step, and how many the step has. */
  n: number;
  total: number;
  /** Paused on it: the learner moves on with Next. */
  waiting: boolean;
  part: boolean;
  /** This beat starts following one request. */
  follow: boolean;
}

export interface PredictView {
  def: Prediction;
  /** The question is open now (the scene waits for it). */
  open: boolean;
  /** The answer: undefined before, null when skipped. */
  answer: number | null | undefined;
  /** The reveal's line, once the reveal beat has fired. */
  line: string | null;
  /** The steps the question is asked in and settled in: the card shows in those. */
  step: number;
  revealStep: number;
}

/**
 * A lesson's beats, one runner per step, fired on the simulation's grid (`onGrid`, given to `useLiveSims`). Only the
 * step on screen runs its beats; the other worlds keep running in lockstep. Restarting the scene starts them again.
 */
export function useBeats(lesson: Lesson, step: number) {
  const figs = lesson.figures;
  const recap = step >= figs.length;
  const shown = Math.min(step, figs.length - 1);
  const seqs = useMemo(() => figs.map(beatsOf), [figs]);
  const ask = figs.findIndex((f) => f.predict);
  const prediction = ask >= 0 ? figs[ask].predict! : null;
  const revealStep = prediction ? figs.findIndex((f) => beatsOf(f).some((b) => b.id === prediction.reveal.beat)) : -1;
  const ctx = useMemo(() => ({ tones: figs.map((f) => f.tone), metrics: figs.flatMap((f) => f.metrics) }), [figs]);
  const state = useRef<State>({ sims: null, runners: [], seq: 0, seqOf: new WeakMap(), marks: {}, raw: { before: null, after: null }, answer: undefined, line: null, claim: null });
  const claim = (figs[1] ?? figs[0]).headline;
  const shownRef = useRef(recap ? -1 : shown);
  shownRef.current = recap ? -1 : shown;
  const startRef = useRef<() => void>(() => {});
  /** Whether a fault is on: a break beat whose fault the learner already caused lets itself go. */
  const isOnRef = useRef<(id: string) => boolean>(() => false);
  // Beats fired before the step was (re)entered are not announced again.
  const entered = useRef({ step, seq: 0 });
  if (entered.current.step !== step) entered.current = { step, seq: state.current.seq };
  const [replay, setReplay] = useState<{ step: number; index: number } | null>(null);
  const [focusOverride, setFocusOverride] = useState<{ focus: Focus; until: number } | null>(null);

  const runnersFor = useCallback(
    (sims: Sim[]) => {
      const s = state.current;
      if (s.sims !== sims) {
        Object.assign(s, { sims, marks: {}, raw: { before: null, after: null }, answer: undefined, line: null, claim: null });
        s.runners = figs.map(
          (f, i) =>
            new BeatRunner(seqs[i], {
              timeScale: sims[i].spec.timeScale ?? 0.1,
              fill: (text) => fillIn(text, { sims, ...ctx, current: i, marks: s.marks }),
              askBefore: f.predict?.before,
              onStart: () => startRef.current(),
            }),
        );
      }
      return s.runners;
    },
    [figs, seqs, ctx],
  );

  /** Look at the shown step's world once. `stop` asks every world to hold still (a pause, or the question). */
  const tick = useCallback(
    (sims: Sim[], rushed: boolean): { fired: Fired | null; stop: boolean } => {
      const i = shownRef.current;
      const runners = runnersFor(sims);
      if (i < 0) {
        // The Recap runs no beats, but its world still needs its traffic.
        if (!sims[0].started) startRef.current();
        return { fired: null, stop: false };
      }
      const r = runners[i];
      const was = r.waiting;
      const fired = r.tick(sims[i], rushed, sims);
      const s = state.current;
      const track = prediction?.track;
      if (fired) {
        s.seqOf.set(fired, ++s.seq);
        if (claim?.at === fired.beat.id) s.claim = fillIn(claim.sentence, { sims, ...ctx, current: i });
        if (prediction && fired.beat.id === prediction.reveal.beat) {
          if (track) {
            if (track.same) {
              s.raw.before = measure(sims[track.world ?? ask], track.metric);
              s.marks.before = formatMetric(track.metric, s.raw.before);
            }
            s.raw.after = measure(sims[track.afterWorld ?? track.world ?? ask], track.metric);
            s.marks.after = formatMetric(track.metric, s.raw.after);
          }
          s.line = fillIn(prediction.reveal.text, { sims, ...ctx, current: i, marks: s.marks });
        }
      }
      const brk = figs[i].break;
      if (fired && brk && fired.beat.id === brk.beat && isOnRef.current(brk.action)) r.release();
      const asked = r.waiting === "ask" && was !== "ask";
      if (asked && track) {
        s.raw.before = measure(sims[track.world ?? ask], track.metric);
        s.marks.before = formatMetric(track.metric, s.raw.before);
      }
      return { fired, stop: (!!fired?.beat.pause && r.waiting === "beat") || asked };
    },
    [runnersFor, prediction, ask, ctx, claim],
  );

  const onGrid = useCallback((sims: Sim[]) => tick(sims, false).stop, [tick]);

  /** The beats bound to the running scene: what to show now, and what Next, the faults and the question do. */
  const bind = (live: Live, faults: { run: (id: string, on: boolean) => void; isOn: (id: string) => boolean }) => {
    startRef.current = live.start;
    isOnRef.current = faults.isOn;
    const runners = runnersFor(live.sims);
    const s = state.current;
    const r = recap ? null : runners[shown];
    const brk = recap ? undefined : figs[shown].break;

    const at = r ? (replay?.step === step ? replay.index : r.fired.length - 1) : -1;
    const cur = r?.fired[at];
    const beat: BeatView | null =
      r && cur
        ? {
            id: cur.beat.id,
            text: cur.text,
            focus: cur.beat.focus ?? null,
            n: cur.index + 1,
            total: r.beats.length,
            waiting: r.waiting === "beat" && at === r.fired.length - 1,
            part: !!cur.beat.part,
            follow: !!cur.beat.follow,
          }
        : null;
    const last = r?.current;
    const fresh = last && (s.seqOf.get(last) ?? 0) > entered.current.seq ? plainText(last.text) : "";
    const override = focusOverride && focusOverride.until > performance.now() ? focusOverride.focus : null;

    /** Move on: release a paused beat (firing the break's fault), skip the question, or bring on the next beat. */
    const next = (): "beat" | "step" => {
      if (!r) return "step";
      setReplay(null);
      if (r.waiting === "beat") {
        if (brk && r.current?.beat.id === brk.beat && !faults.isOn(brk.action)) faults.run(brk.action, true);
        r.release();
        live.play();
        live.refresh();
        return "beat";
      }
      if (r.waiting === "ask") {
        answer(null);
        return "beat";
      }
      if (r.done) return "step";
      let stop = false;
      const found = live.advance((sims) => {
        const t = tick(sims, true);
        stop = t.stop;
        return !!t.fired || r.waiting !== null;
      });
      // Its moment never came (a knob changed the scene, or a step was skipped): show it anyway rather than stick.
      if (!found) {
        const f = r.skip(live.sims[shown]);
        if (f) state.current.seqOf.set(f, ++state.current.seq);
        stop = !!f?.beat.pause;
      }
      if (stop) live.pause();
      return "beat";
    };

    const answer = (i: number | null) => {
      s.answer = i;
      runners[ask]?.answer();
      live.play();
      live.refresh();
    };

    // What made a row move, for its explainer: the last beat that pointed at it, or the lesson's claim for its headline.
    const why: Record<string, string> = {};
    const said = claim ? (s.claim ?? (claim.at ? null : fillIn(claim.sentence, { sims: live.sims, ...ctx, current: shown }))) : null;
    if (claim && said) why[claim.metric] = plainText(said);
    for (const runner of runners) for (const f of runner.fired) if (f.beat.focus?.metric) why[f.beat.focus.metric] = plainText(f.text);

    return {
      beat,
      why,
      /** The claim's sentence: read at its beat, or live; null when its beat hasn't fired yet. */
      claim: said,
      /** Plain text of a beat that fired on this visit to the step, for the live region (once each). */
      announce: fresh,
      focus: override ?? beat?.focus ?? null,
      /** The step's narration, for the reduced-motion "What to watch" list. */
      list: r
        ? r.beats
            .map((b, i) => ({
              id: b.id,
              text: i < r.fired.length ? r.fired[i].text : placeholdersIn(b.text).reduce((t, p) => t.replace(p.raw, "…"), b.text),
              seen: i < r.fired.length,
              now: i === at,
              part: !!b.part,
            }))
            // Build lines and invitations come on with Next too, but the list is what to watch: the beats.
            .filter((it) => !it.part && !figs[shown].invite?.some((b) => b.id === it.id))
        : [],
      /** Glossary terms the step's beats have marked so far, in order. */
      terms: r ? [...new Set(r.fired.flatMap((f) => termsIn(f.text)))] : [],
      waiting: r?.waiting ?? null,
      done: r ? r.done : true,
      remaining: r ? r.beats.length - r.fired.length : 0,
      /** The break's beat is waiting for its fault. */
      breakDue: !!brk && r?.waiting === "beat" && r.current?.beat.id === brk.beat ? brk.action : null,
      predict: prediction ? ({ def: prediction, open: !recap && shown === ask && r?.waiting === "ask", answer: s.answer, line: s.line, step: ask, revealStep } satisfies PredictView) : null,
      next,
      /** Show the previous beat again (the scene is not rewound). */
      back: () => {
        if (!r || at <= 0) return;
        setReplay({ step, index: at - 1 });
      },
      answer,
      /** A fault button was pressed: if the break was waiting for it, the beats carry on. */
      pressed: (id: string) => {
        if (r?.waiting === "beat" && brk?.action === id && r.current?.beat.id === brk.beat) {
          r.release();
          live.play();
        }
      },
      /** Play pressed while a beat holds the scene: that beat is done with (the break still waits for its fault). */
      played: () => {
        if (r?.waiting === "beat" && !(brk && r.current?.beat.id === brk.beat)) r.release();
      },
      /** Point the stage at something for a few seconds (a glossary term's "Show me", a check's answer). */
      show: (focus: Focus, ms = 4000) => setFocusOverride({ focus, until: performance.now() + ms }),
    };
  };

  return { onGrid, hold: holdsTraffic(figs), bind };
}

export type Beats = ReturnType<ReturnType<typeof useBeats>["bind"]>;

/**
 * Beats for a scene that loops on its own (the home page's hero) or has stages of its own (the capstone): one runner,
 * started afresh whenever `key(sim)` changes (each loop of the script, each stage). Nothing pauses; the strip shows
 * the latest beat, and a fresh one is announced.
 */
export function useSceneBeats(beats: Beat[], key: (sim: Sim) => string | number) {
  const r = useRef<{ key: string | number; runner: BeatRunner; sims: Sim[]; fired: number } | null>(null);
  const latest = useRef({ beats, key });
  latest.current = { beats, key };
  const onGrid = useCallback((sims: Sim[]) => {
    const { beats, key } = latest.current;
    const k = key(sims[0]);
    if (!r.current || r.current.key !== k || r.current.sims !== sims) {
      r.current = { key: k, runner: new BeatRunner(beats, { timeScale: sims[0].spec.timeScale ?? 0.1 }), sims, fired: 0 };
    }
    r.current.runner.tick(sims[0], false, sims);
    return false;
  }, []);
  const cur = r.current?.runner.current;
  const view: BeatView | null = cur
    ? { id: `${r.current!.key}:${cur.beat.id}`, text: cur.text, focus: cur.beat.focus ?? null, n: cur.index + 1, total: r.current!.runner.beats.length, waiting: false, part: false, follow: false }
    : null;
  return { onGrid, beat: view, at: cur?.t ?? null };
}

/**
 * The narration line on the stage's sheet: along its top edge, or its bottom edge on phones. It says what the scene
 * shows (`lead`), then the current beat (or, in a scene without beats, its events: a fresh one in ink, then the latest
 * one quietly). Wide stages show the beat beside the thing it names instead (the callout); the strip then keeps the
 * step's place in its beats. Phones also give it the slow-motion clock, which the dock has no room for.
 */
export function BeatStrip({
  lead,
  sim,
  clock,
  beat,
  announce,
}: {
  lead?: ReactNode;
  sim: Sim;
  clock?: ReactNode;
  beat?: BeatView | null;
  /** A beat that just fired, in plain words, for screen readers (each one once). */
  announce?: string;
}) {
  const scripted = beat === undefined;
  const fresh = scripted ? freshNote(sim) : null;
  const text = scripted ? (fresh ?? sim.notes[sim.notes.length - 1]?.text ?? "") : "";
  return (
    <div className={`beat${fresh || beat ? " fresh" : ""}${beat?.waiting ? " waiting" : ""}`}>
      {lead}
      <p className="beat-text">
        {beat ? (
          <span key={beat.id}>
            <Rich text={beat.text} />
          </span>
        ) : (
          text && <span key={text}>{text}</span>
        )}
      </p>
      {beat && beat.total > 1 && (
        <span className="beat-pips" role="img" aria-label={`${beat.n} of ${beat.total}`}>
          {Array.from({ length: beat.total }, (_, i) => (
            <i key={i} className={i + 1 === beat.n ? "on" : i + 1 < beat.n ? "past" : undefined} />
          ))}
        </span>
      )}
      {/* Only something new is announced: not the latest beat or event shown again after a step switch. */}
      <span className="sr-only" aria-live="polite">
        {scripted ? (fresh ?? "") : (announce ?? "")}
      </span>
      {clock}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ callout

/** Where a callout may go, in CSS px inside the stage. */
export interface CalloutSpot {
  /** The thing pointed at (a station's body, a waiting line, the middle of a rail). */
  anchor: Rect;
  /** The anchor's whole block (with its label), which the callout keeps clear of. */
  block: Rect;
  /** Every station and label on the stage. */
  obstacles: Rect[];
  /** Rails, as points along them: a callout prefers not to cover traffic. */
  rails: Pt[][];
  box: Size;
}

type Side = "above" | "below" | "right" | "left";

const GAP = 16;
const EDGE = 10;

const overlaps = (a: Rect, b: Rect, m: number) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The best clear place for a w×h callout: inside the stage, off every station and label, over as few rails as possible. */
export function placeCallout(s: CalloutSpot, w: number, h: number): { x: number; y: number; side: Side } | null {
  const { block: b, box } = s;
  const cx = s.anchor.x + s.anchor.w / 2;
  const cy = s.anchor.y + s.anchor.h / 2;
  const fitX = (x: number) => clamp(x, EDGE, box.w - EDGE - w);
  const fitY = (y: number) => clamp(y, EDGE, box.h - EDGE - h);
  const tries: { x: number; y: number; side: Side }[] = [
    { side: "above", x: fitX(cx - w / 2), y: b.y - GAP - h },
    { side: "right", x: b.x + b.w + GAP, y: fitY(cy - h / 2) },
    { side: "left", x: b.x - GAP - w, y: fitY(cy - h / 2) },
    { side: "below", x: fitX(cx - w / 2), y: b.y + b.h + GAP },
  ];
  let best: { x: number; y: number; side: Side } | null = null;
  let score = Infinity;
  tries.forEach((t, i) => {
    const r = { x: t.x, y: t.y, w, h };
    if (r.x < EDGE - 0.5 || r.y < EDGE - 0.5 || r.x + w > box.w - EDGE + 0.5 || r.y + h > box.h - EDGE + 0.5) return;
    if (overlaps(r, b, 4) || s.obstacles.some((o) => overlaps(r, o, 6))) return;
    const rails = s.rails.filter((pts) => pts.some((p) => p.x > r.x - 4 && p.x < r.x + w + 4 && p.y > r.y - 4 && p.y < r.y + h + 4)).length;
    const sc = rails * 10 + i;
    if (sc < score) {
      score = sc;
      best = t;
    }
  });
  return best;
}

/**
 * The beat's words beside the thing they name, with a short ink leader to it. It is placed in the stage's clear space;
 * when there is none, it isn't shown and the strip carries the words instead.
 */
export function Callout({ id, text, spot, waiting }: { id: string; text: string; spot: CalloutSpot; waiting: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ x: number; y: number; side: Side; w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const p = placeCallout(spot, w, h);
    setAt((was) => (p ? (was && was.x === p.x && was.y === p.y && was.w === w && was.h === h ? was : { ...p, w, h }) : null));
  }, [id, text, spot]);
  const a = spot.anchor;
  let leader: [Pt, Pt] | null = null;
  if (at) {
    const cx = clamp(a.x + a.w / 2, at.x + 14, at.x + at.w - 14);
    const cy = clamp(a.y + a.h / 2, at.y + 10, at.y + at.h - 10);
    const b = spot.block;
    leader =
      at.side === "above"
        ? [{ x: cx, y: at.y + at.h }, { x: a.x + a.w / 2, y: a.y - 3 }]
        : at.side === "below"
          ? [{ x: cx, y: at.y }, { x: a.x + a.w / 2, y: b.y + b.h + 3 }]
          : at.side === "right"
            ? [{ x: at.x, y: cy }, { x: a.x + a.w + 3, y: a.y + a.h / 2 }]
            : [{ x: at.x + at.w, y: cy }, { x: a.x - 3, y: a.y + a.h / 2 }];
  }
  return (
    <>
      {leader && (
        <svg className="callout-leader" key={`l-${id}`} aria-hidden="true">
          <line x1={leader[0].x} y1={leader[0].y} x2={leader[1].x} y2={leader[1].y} />
          <circle cx={leader[1].x} cy={leader[1].y} r="2.5" />
        </svg>
      )}
      <div
        ref={ref}
        key={id}
        className={`callout${waiting ? " waiting" : ""}`}
        data-placed={at ? "" : undefined}
        data-side={at?.side}
        style={at ? { left: at.x, top: at.y } : undefined}
        aria-hidden="true"
      >
        <Rich text={text} />
      </div>
    </>
  );
}

// ------------------------------------------------------------------------------------------------ panel cards

/** Reduced motion: the step's beats as a list. Next (or Step) brings each one on, on a still frame. */
export function WatchList({ items }: { items: { id: string; text: string; seen: boolean; now: boolean }[] }) {
  // One line each, so the list fits beside the knobs; the beat on screen reads in full.
  if (!items.length) return null;
  return (
    <section className="watch" aria-labelledby="watch-h">
      <h3 id="watch-h" className="card-eyebrow">
        What to watch
      </h3>
      <ol>
        {items.map((it) => (
          <li key={it.id} className={it.now ? "now" : it.seen ? "seen" : undefined} aria-current={it.now ? "step" : undefined}>
            <Rich text={it.text} />
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Commit to a guess before the break. While it is open the scene waits; afterwards it says what you chose, then how it went. */
export function PredictCard({ p, onAnswer }: { p: PredictView; onAnswer: (i: number) => void }) {
  const { def, answer, line } = p;
  if (p.open) {
    return (
      <section className="card predict" aria-labelledby="predict-h">
        <h3 id="predict-h" className="card-eyebrow">
          Predict
        </h3>
        <p className="card-prompt">
          <Rich text={def.prompt} />
        </p>
        <div className="card-options">
          {def.options.map((o, i) => (
            <button key={o} type="button" className="opt" onClick={() => onAnswer(i)}>
              {o}
            </button>
          ))}
        </div>
      </section>
    );
  }
  if (answer === undefined) return null;
  const right = answer === def.answer;
  return (
    <section className={`card predict done${line ? (right ? " right" : " wrong") : ""}`} aria-live="polite">
      <p className="card-result">
        {answer === null ? "No guess this time." : <>You said: <strong>{def.options[answer]}</strong>.</>}
        {line ? (
          <>
            {" "}
            {answer !== null && <Mark right={right} />} <Rich text={line} />
          </>
        ) : (
          <span className="card-wait"> Watch what happens.</span>
        )}
      </p>
    </section>
  );
}

/** A question on the Recap. Any answer shows the same line of why; a wrong one also points the stage at the answer. */
export function CheckCard({ c, n, onWrong }: { c: Check; n: number; onWrong: (f: Focus) => void }) {
  const [chose, setChose] = useState<number | null>(null);
  const done = chose !== null;
  return (
    <section className="card check" aria-labelledby={`check-${n}`}>
      <h3 id={`check-${n}`} className="card-eyebrow">
        Check {n}
      </h3>
      <p className="card-prompt">
        <Rich text={c.prompt} />
      </p>
      <div className="card-options">
        {c.options.map((o, i) => (
          <button
            key={o}
            type="button"
            className={`opt${done && i === c.answer ? " right" : ""}${chose === i && i !== c.answer ? " wrong" : ""}`}
            aria-pressed={chose === i}
            disabled={done && chose !== i && i !== c.answer}
            onClick={() => {
              setChose(i);
              if (i !== c.answer && c.focus) onWrong(c.focus);
            }}
          >
            {done && (i === c.answer || chose === i) && <Mark right={i === c.answer} />}
            {o}
          </button>
        ))}
      </div>
      {done && (
        <p className="card-why" aria-live="polite">
          <Rich text={c.why} />
        </p>
      )}
    </section>
  );
}

function Mark({ right }: { right: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={`mark-${right ? "right" : "wrong"} stroke`} role="img" aria-label={right ? "Right." : "Not quite."}>
      <path d={right ? "M3.5 8.5l3 3 6-7" : "M4.5 4.5l7 7M11.5 4.5l-7 7"} />
    </svg>
  );
}
