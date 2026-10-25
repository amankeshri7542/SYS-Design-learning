"use client";

import { useRef } from "react";
import type { Sim } from "@/lib/sim/engine";
import type { Track } from "./follow-track";

export type { Hop } from "./follow-track";

// What follows a request loads the first time one is followed.
let track: typeof import("./follow-track") | null = null;
const load = () => import("./follow-track").then((m) => void (track = m));

/**
 * Follow one request: pick the next request a client sends (at a tick of the grid, by lowest id, so the same request is
 * picked at every speed), then note each stretch of its life until it is answered, fails or is given up on.
 */
export function useFollow() {
  const t = useRef<Track>({ after: null, client: "", sim: null, req: null, last: "", hops: [], end: null, endedAt: 0 });
  /** Reduced motion keeps the finished trace on screen until it is closed. */
  const reducedHold = useRef(false);

  /** Resolves once the tracker has loaded (at once after the first time). */
  const begin = (sim: Sim, client: string) => {
    t.current = { after: sim.t, client, sim, req: null, last: "", hops: [], end: null, endedAt: 0 };
    return track ? Promise.resolve() : load();
  };
  const stop = () => {
    t.current = { ...t.current, after: null, sim: null, req: null, end: null };
  };

  return {
    begin,
    stop,
    /** Look at the followed world once (on the grid). True when the request has just finished. */
    look: (sim: Sim) => !!track?.look(t.current, sim),
    /** What the flight strip shows now, or null when nothing is being followed. */
    view: () => (track && t.current.after !== null && t.current.sim ? track.view(t.current, reducedHold.current) : null),
    get active() {
      return t.current.after !== null;
    },
    get sim() {
      return t.current.sim;
    },
    holdResult: (on: boolean) => {
      reducedHold.current = on;
    },
  };
}

export type Follow = ReturnType<typeof useFollow>;
export type FlightView = NonNullable<ReturnType<Follow["view"]>>;
