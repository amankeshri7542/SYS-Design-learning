"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { BeatRunner, fillIn, placeholdersIn, plainText, termsIn, type Fired, type Focus, type Prediction } from "@/lib/lessons/beats";
import { beatsOf, holdsTraffic, type Lesson } from "@/lib/lessons/types";
import type { Sim } from "@/lib/sim/engine";
import { formatMetric, measure } from "@/lib/sim/metrics";
import { record } from "@/lib/record";
import type { Live } from "./live";
import { Rich } from "./rich";
import type { BeatView } from "./strip";

export type { BeatView } from "./strip";

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
  /** When the question was asked (wall clock): the learning record notes how long the answer took. */
  askedAt?: number;
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
        record("beat", { at: `${i}:${fired.beat.id}` });
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
      if (asked) s.askedAt = Date.now();
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
      if (prediction) record("predict", i === null ? { skipped: true } : { chosen: i, correct: i === prediction.answer, ms: Date.now() - (s.askedAt ?? Date.now()) });
      runners[ask]?.answer();
      live.play();
      live.refresh();
    };

    // What made a row move, for its explainer: the last beat that pointed at it, or the lesson's claim for its headline.
    const why: Record<string, string> = {};
    const live1 = claim && !claim.at ? fillIn(claim.sentence, { sims: live.sims, ...ctx, current: shown }) : null;
    // Read live, a number the worlds haven't measured yet reads "—": no sentence until they have.
    const said = claim ? (s.claim ?? (live1?.includes("—") ? null : live1)) : null;
    if (claim && said) why[claim.metric] = plainText(said);
    for (const runner of runners) for (const f of runner.fired) if (f.beat.focus?.metric) why[f.beat.focus.metric] = plainText(f.text);

    return {
      beat,
      why,
      /** The claim's sentence: read at its beat, or live; null when its beat hasn't fired yet, or nothing is measured. */
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


// ------------------------------------------------------------------------------------------------ the prediction

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

export function Mark({ right }: { right: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className={`mark-${right ? "right" : "wrong"} stroke`} role="img" aria-label={right ? "Right." : "Not quite."}>
      <path d={right ? "M3.5 8.5l3 3 6-7" : "M4.5 4.5l7 7M11.5 4.5l-7 7"} />
    </svg>
  );
}
