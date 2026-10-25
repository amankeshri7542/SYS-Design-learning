"use client";

// Beats for scenes that run on their own: the home page's hero, a journey's stages, and My System's tour. Lessons have
// their own runner (`useBeats` in `beats.tsx`), which pauses, predicts and waits for the learner.

import { useCallback, useRef } from "react";
import { BeatRunner, type Beat } from "@/lib/lessons/beats";
import type { Sim } from "@/lib/sim/engine";
import type { BeatView } from "./strip";

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
