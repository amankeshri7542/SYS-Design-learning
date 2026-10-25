"use client";

import { useRef } from "react";
import type { Req, Sim } from "@/lib/sim/engine";

/** One stretch of a followed request's life: on a rail, waiting in a line, or being worked on. */
export interface Hop {
  kind: "travel" | "wait" | "work";
  /** The station (or, for travel, the station it is heading to). */
  node: string;
  t0: number;
  t1: number;
}

interface Track {
  /** Pick the first request a client sends from this simulated time on. */
  after: number | null;
  client: string;
  sim: Sim | null;
  req: Req | null;
  last: string;
  hops: Hop[];
  /** How it ended, once it has. */
  end: { t: number; total: number; text: string } | null;
  /** Real time the ending was reached: the result stays up for a moment after. */
  endedAt: number;
}

/** How long the finished trace stays on screen, in real ms. */
const HOLD = 2000;

/**
 * Follow one request: pick the next request a client sends (at a tick of the grid, by lowest id, so the same request is
 * picked at every speed), then note each stretch of its life until it is answered, fails or is given up on.
 */
export function useFollow() {
  const t = useRef<Track>({ after: null, client: "", sim: null, req: null, last: "", hops: [], end: null, endedAt: 0 });
  /** Reduced motion keeps the finished trace on screen until it is closed. */
  const reducedHold = useRef(false);

  const begin = (sim: Sim, client: string) => {
    t.current = { after: sim.t, client, sim, req: null, last: "", hops: [], end: null, endedAt: 0 };
  };
  const stop = () => {
    t.current = { ...t.current, after: null, sim: null, req: null, end: null };
  };

  /** Look at the followed world once (on the grid). True when the request has just finished. */
  const look = (sim: Sim): boolean => {
    const f = t.current;
    if (f.after === null || f.sim !== sim || f.end) return false;
    const label = (id: string) => sim.nodes.get(id)?.spec.label ?? id;
    if (!f.req) {
      f.req = sim.reqs.find((r) => r.client === f.client && r.attempt === 0 && !r.detached && r.born >= f.after! && (r.op === "read" || r.op === "write")) ?? null;
      if (!f.req) return false;
    }
    const r = f.req;
    const key = `${r.phase}|${r.at}|${r.from}|${r.to}|${r.dir}`;
    if (key !== f.last) {
      f.last = key;
      const prev = f.hops[f.hops.length - 1];
      const open = (h: Hop) => {
        if (prev) prev.t1 = h.t0;
        f.hops.push(h);
      };
      if (r.phase === "travel") open({ kind: "travel", node: r.to, t0: r.t0, t1: r.t1 });
      else if (r.phase === "wait" || r.phase === "parked") open({ kind: "wait", node: r.at, t0: prev?.kind === "travel" ? prev.t1 : sim.t, t1: sim.t });
      else if (r.phase === "work") {
        if (prev?.kind === "travel") open({ kind: "wait", node: r.at, t0: prev.t1, t1: r.started });
        open({ kind: "work", node: r.at, t0: r.started, t1: r.doneAt });
      }
    }
    const now = f.hops[f.hops.length - 1];
    if (now && now.kind !== "travel") now.t1 = now.kind === "work" ? r.doneAt : sim.t;
    if (r.abandoned) {
      f.end = { t: sim.t, total: sim.t - r.first, text: `${label(r.client)} gave up waiting after ${Math.round(sim.t - r.first)} ms.` };
    } else if (r.phase === "gone") {
      const back = r.dir === -1 && r.to === r.client;
      const at = back ? r.t1 : sim.t;
      const total = Math.round(at - r.first);
      const late = total > sim.spec.sloMs;
      f.end = {
        t: at,
        total,
        text:
          r.result === "error"
            ? `It failed: ${total} ms in all.`
            : r.result === "rejected" || r.result === "fallback"
              ? `Turned away at once: ${total} ms in all.`
              : `Back at ${label(r.client)}: ${total} ms in all, ${late ? `late (target ${sim.spec.sloMs} ms)` : "on time"}.`,
      };
    }
    if (f.end) {
      f.endedAt = performance.now();
      return true;
    }
    return false;
  };

  /** What the flight strip shows now, or null when nothing is being followed. */
  const view = () => {
    const f = t.current;
    if (f.after === null || !f.sim) return null;
    if (f.end && performance.now() - f.endedAt > HOLD && !reducedHold.current) return null;
    const sim = f.sim;
    const r = f.req;
    const label = (id: string) => sim.nodes.get(id)?.spec.label ?? id;
    let text = "Waiting for the next request to leave…";
    if (f.end) text = f.end.text;
    else if (r) {
      const kind = sim.nodes.get(r.at)?.spec.kind;
      if (r.phase === "travel") text = r.dir === 1 ? (r.from === r.client ? `Leaves ${label(r.client)}.` : `On to ${label(r.to)}.`) : r.hit && kind === "cache" ? `${label(r.from)} had a copy: straight back.` : `The answer heads back to ${label(r.to)}.`;
      else if (r.phase === "wait") {
        const ahead = sim.nodes.get(r.at)?.queue.indexOf(r) ?? -1;
        text = `Waits in line at ${label(r.at)}${ahead > 0 ? `: ${ahead} ahead of it` : ""}.`;
      } else if (r.phase === "parked") text = `Waits at ${label(r.at)}.`;
      else if (r.phase === "work") text = `${label(r.at)} works on it: ${Math.round(r.doneAt - r.started)} ms.`;
    }
    const sum = { travel: 0, wait: 0, work: 0 };
    for (const h of f.hops) sum[h.kind] += Math.max(0, Math.min(h.t1, f.end?.t ?? sim.t) - h.t0);
    return { id: r?.id ?? null, text, hops: f.hops, sum, end: f.end, from: r?.first ?? sim.t, to: f.end?.t ?? sim.t, label };
  };

  return {
    begin,
    stop,
    look,
    view,
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
