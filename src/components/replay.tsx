"use client";

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Sim } from "@/lib/sim/engine/core";
import { PEOPLE, compile, type Compiled } from "@/lib/system/compile";
import type { TraceSession, TraceView } from "@/lib/system/trace/open";
import type { Grouping } from "@/lib/system/trace/reduce";
import type { Hop, Sample, SampleKind } from "@/lib/system/trace/replay";
import type { FlightView } from "./follow";
import { KeyPopover } from "./key";
import { ArrowIcon, Transport, useLiveSims } from "./live";
import { Shell, usePlayerKeys } from "./shell";
import { Stage } from "./stage";
import { BeatStrip } from "./strip";

// Loaded when a trace is opened: the gallery and a shared system carry none of it.

const FlightStrip = lazy(() => import("./flight").then((m) => ({ default: m.FlightStrip })));

const KIND: Record<SampleKind, string> = { typical: "Typical", slowest: "Slowest", failed: "Failed" };
const GROUPS: { by: Grouping; name: string }[] = [
  { by: "service", name: "Service" },
  { by: "prefix", name: "Prefix" },
  { by: "kind", name: "Kind" },
];
/** Screen ms for a wire, however short it was, so each hop can be followed. */
const GLIDE = 220;
/** About how long a sample's own times take on screen at 1× (its wires add to it). */
const PLAY = 4500;
/** The finished request stays on screen this long before the replay stops. */
const HOLD = 1200;

const ms = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(2)} s` : v >= 10 || v === 0 ? `${Math.round(v)} ms` : `${+v.toFixed(1)} ms`);
const pct = (v: number) => (v > 0 && v < 0.01 ? "under 1%" : `${+(v * 100).toFixed(1)}%`);

interface Shown extends Hop {
  /** When it starts and ends on screen, in ms. */
  p0: number;
  p1: number;
}

/** A sample on screen: its trace times stretched to be watched, each wire given a moment of its own. */
function timeline(s: Sample) {
  const k = Math.max(2, Math.min(400, PLAY / Math.max(1, s.ms)));
  let p = 0;
  const hops: Shown[] = s.hops.map((h) => {
    const d = h.kind === "travel" ? Math.max(GLIDE, (h.t1 - h.t0) * k) : (h.t1 - h.t0) * k;
    const x = { ...h, p0: p, p1: p + d };
    p += d;
    return x;
  });
  return { hops, k, end: p };
}
type Line = ReturnType<typeof timeline>;

/** The trace's own time at a moment on screen. */
function traceAt(line: Line, p: number) {
  const h = line.hops.find((x) => p < x.p1) ?? line.hops[line.hops.length - 1];
  if (!h) return 0;
  return h.p1 > h.p0 ? h.t0 + ((Math.max(h.p0, p) - h.p0) / (h.p1 - h.p0)) * (h.t1 - h.t0) : h.t1;
}

/** A still worth looking at: where a failed request broke, or else where it spent longest. */
function settled(line: Line, s: Sample) {
  const at = s.broke ? line.hops.find((h) => h.kind === "work" && h.t1 >= s.broke!.at && h.t0 <= s.broke!.at) : null;
  const h = at ?? [...line.hops].filter((x) => x.kind === "work").sort((a, b) => b.t1 - b.t0 - (a.t1 - a.t0))[0];
  return h ? (h.p0 + h.p1) / 2 : 0;
}

/**
 * One sample request walking the stations as the trace has it: a copy of the system with nobody sending, and one
 * request placed where the trace says it was at each moment, on a clock of its own (play, pause, a hop at a time).
 */
function usePlayback(compiled: Compiled, sample: Sample | null, reduced: boolean, on: boolean, late: number) {
  const idle = useMemo(
    () => new Sim({ ...compiled.spec, sloMs: 1e12, nodes: compiled.spec.nodes.map((n) => (n.client ? { ...n, client: { ...n.client, rate: 0 } } : n)) }),
    [compiled],
  );
  // A new request for each sample, so the stage draws a fresh trail behind it. It joins the copy when placed.
  const dot = useMemo(() => {
    const r = idle.make(compiled.spec.nodes.find((n) => n.kind === "client")?.id ?? "", "read", 0, PEOPLE);
    r.phase = "gone";
    return r;
  }, [idle, compiled, sample]);
  const line = useMemo(() => (sample ? timeline(sample) : null), [sample]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [, setTick] = useState(0);
  const at = useRef(0);

  const place = useCallback(
    (p: number) => {
      idle.t = p;
      if (idle.reqs.length !== 1 || idle.reqs[0] !== dot) idle.reqs = [dot];
      // Nobody else works here: the only request at a station is the one replayed.
      for (const n of idle.list) if (n.work.length) n.work = [];
      if (!line || !sample || p >= line.end) return void (dot.phase = "gone");
      const h = line.hops.find((x) => p < x.p1) ?? line.hops[line.hops.length - 1];
      const t = traceAt(line, p);
      // Red on its way back once it has broken; amber past the target; cobalt out, green back.
      dot.result = h.back ? (sample.broke && t >= sample.broke.at ? "error" : "ok") : null;
      dot.first = t > late ? -Infinity : p;
      if (h.kind === "travel") Object.assign(dot, { phase: "travel", from: h.from, to: h.node, at: h.from, t0: h.p0, t1: h.p1, dir: h.back ? -1 : 1 });
      else {
        Object.assign(dot, { phase: "work", from: h.node, to: h.node, at: h.node, started: h.p0, doneAt: h.p1, dir: 1 });
        idle.nodes.get(h.node)?.work.push(dot);
      }
    },
    [idle, dot, line, sample, late],
  );

  // A new sample starts from the beginning (reduced motion: a still where it matters), and plays when shown.
  useEffect(() => {
    at.current = line && sample && reduced ? settled(line, sample) : 0;
    place(at.current);
    setPlaying(!!line && on && !reduced);
    setTick((t) => t + 1);
  }, [line, sample, reduced, on, place]);

  useEffect(() => {
    if (!playing || !line) return;
    let raf = 0;
    let last = performance.now();
    let shown = 0;
    const frame = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      at.current = Math.min(line.end + HOLD, at.current + dt * speed);
      place(at.current);
      if (now - shown > 90) {
        shown = now;
        setTick((t) => t + 1);
      }
      if (at.current >= line.end + HOLD) {
        setPlaying(false);
        setTick((t) => t + 1);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, line, speed, place]);

  const jump = (p: number) => {
    at.current = p;
    place(p);
    setTick((t) => t + 1);
  };
  const controls = {
    playing,
    speed,
    setSpeed,
    toggle: () => {
      if (line && at.current >= line.end) jump(0);
      setPlaying((x) => !x);
    },
    // A hop at a time: on to where the next one starts.
    step: () => {
      setPlaying(false);
      if (!line) return;
      const next = line.hops.find((h) => h.p0 > at.current + 0.5);
      jump(next ? next.p0 + 0.01 : line.end);
    },
    restart: () => {
      jump(0);
      setPlaying(!reduced);
    },
    clock: line ? `1 s on screen = ${ms(1000 / line.k / speed)} of the trace` : "",
  };
  const cursor = line ? (at.current >= line.end ? (sample?.ms ?? 0) : traceAt(line, at.current)) : 0;
  return { sim: idle, dot, line, cursor, done: !!line && at.current >= line.end, controls };
}

/** What the strip says about a sample at this moment of it. */
function narrate(s: Sample, line: Line, cursor: number, done: boolean, name: (station: string) => string) {
  const what = s.name ? ` (${s.name})` : "";
  if (done) return s.broke ? `It failed: ${ms(s.ms)} in all, broken in ${s.broke.part} ${ms(s.broke.at)} in.` : `Back with its answer: ${ms(s.ms)} in all.`;
  if (cursor <= 0) return `Replaying the ${KIND[s.kind].toLowerCase()} request${what}: ${ms(s.ms)}.`;
  const h = line.hops.find((x) => cursor < x.t1 || (x.t1 === x.t0 && cursor === x.t0)) ?? line.hops[line.hops.length - 1];
  if (s.broke && h.kind === "work" && h.t0 <= s.broke.at && s.broke.at <= h.t1 && cursor >= s.broke.at) return `It breaks in ${name(h.node)}, ${ms(s.broke.at)} in.`;
  if (h.kind === "work") return `${name(h.node)} works on it: ${ms(h.t1 - h.t0)}.`;
  const wire = h.t1 - h.t0 >= 0.05 ? `: ${ms(h.t1 - h.t0)} on the wire` : "";
  if (h.also?.length) return `${name(h.from!)} calls ${[...h.also, name(h.node)].join(" and ")} at once; following ${name(h.node)}, the one it waits for${wire}.`;
  return h.back ? `Back to ${name(h.node)}${wire}.` : `On to ${name(h.node)}${wire}.`;
}

/** The sample's spans, each where and how long it ran, from when the request began: the trace's own numbers. */
function Waterfall({ s, cursor }: { s: Sample; cursor: number }) {
  const span = Math.max(s.ms, ...s.spans.map((x) => x.t1));
  return (
    <figure className="rp-fall">
      <figcaption className="rp-fall-h">
        Its {s.spans.length + s.more} spans, as the trace timed them{s.more ? ` (the first ${s.spans.length})` : ""}
      </figcaption>
      <ol>
        {s.spans.map((x, i) => (
          <li
            key={i}
            className={`rp-row${x.error ? " err" : ""}${cursor >= x.t0 ? " on" : ""}`}
            style={{ "--depth": Math.min(x.depth, 6) } as CSSProperties}
            data-t0={x.t0}
            data-t1={x.t1}
          >
            <span className="rp-what">
              {x.error && (
                <svg viewBox="0 0 10 10" className="rp-failed" role="img" aria-label="failed">
                  <path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" />
                </svg>
              )}
              <strong>{x.part}</strong> {x.name}
            </span>
            <span className="rp-track" aria-hidden="true">
              <i style={{ left: `${(100 * x.t0) / span}%`, width: `${Math.max(0.8, (100 * (x.t1 - x.t0)) / span)}%` }} />
            </span>
            <span className="rp-ms">
              <span className="sr-only">from </span>
              {ms(x.t0)}
              <span aria-hidden="true"> · </span>
              <span className="sr-only">, for </span>
              {ms(x.t1 - x.t0)}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/**
 * A trace, replayed on the system it ran through: a typical request, the slowest and one that failed, each walking the
 * stations with the trace's own times while the strip shows its waterfall; and "the second", the system running as
 * the trace's requests did, each its own way. The grouping changes in one tap. Nothing here is saved or sent.
 */
export function ReplayPlayer({
  session,
  first,
  name,
  onLeave,
  onChange,
}: {
  session: TraceSession;
  first: TraceView;
  name: string;
  onLeave: () => void;
  /** Open the system, grouped as it is now, in the builder to change it. */
  onChange: (view: TraceView) => void;
}) {
  const [view, setView] = useState(first);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const samples = view.replay.samples;
  const [pick, setPick] = useState<SampleKind | "second">(() => (samples.some((s) => s.kind === "slowest") ? "slowest" : "typical"));
  const [readNotes, setReadNotes] = useState(true);
  const compiled = useMemo(() => compile(view.doc) as Compiled, [view.doc]);
  const second = view.replay.second;
  const specs = useMemo(() => [second.spec], [second.spec]);
  const live = useLiveSims(specs);
  const sample = pick === "second" ? null : (samples.find((s) => s.kind === pick) ?? null);
  const play = usePlayback(compiled, sample, live.reduced, pick !== "second", view.doc.targets.p95Ms);
  const controls = pick === "second" ? live : play.controls;
  usePlayerKeys(controls);

  // The second runs only while it is shown; a sample has the stage to itself.
  useEffect(() => {
    if (pick !== "second" && live.playing) live.pause();
  }, [pick, live.playing]);
  const choose = (k: SampleKind | "second") => {
    setPick(k);
    if (k === "second") live.play();
  };

  const regroup = async (by: Grouping) => {
    if (busy || by === view.by) return;
    setBusy(true);
    setProblem("");
    try {
      const v = await session.view(by);
      if ("errors" in v) setProblem(v.errors[0]?.text ?? "That grouping doesn't run.");
      else setView(v);
    } finally {
      setBusy(false);
    }
  };

  const label = useCallback((id: string) => compiled.spec.nodes.find((n) => n.id === id)?.label ?? id, [compiled]);
  const flight: FlightView | null =
    sample && play.line
      ? {
          id: play.dot.id,
          text: narrate(sample, play.line, play.cursor, play.done, label),
          hops: sample.hops.filter((h) => h.t1 > h.t0 && h.t0 <= play.cursor).map((h) => ({ kind: h.kind, node: h.node, t0: h.t0, t1: Math.min(h.t1, play.cursor) })),
          sum: sample.hops.reduce((sum, h) => ((sum[h.kind] += Math.max(0, Math.min(h.t1, play.cursor) - h.t0)), sum), { travel: 0, wait: 0, work: 0 }),
          end: play.done ? { t: sample.ms, total: sample.ms, text: "" } : null,
          from: 0,
          to: Math.max(0.001, play.done ? sample.ms : play.cursor),
          label,
        }
      : null;
  const model = second.model;
  const off = model ? Math.abs(model.p95 - second.trace.p95) / Math.max(1, second.trace.p95) : null;
  const sim = pick === "second" ? live.sims[0] : play.sim;
  const clock = pick === "second" ? live.clock : play.controls.clock;

  return (
    <Shell
      className="line-stories system replay"
      simTime={sim.t}
      rootRef={live.rootRef as React.Ref<HTMLDivElement>}
      bar={
        <>
          <nav className="bar-line" aria-label="Trace">
            <button type="button" className="roundel-sm sys-back" onClick={onLeave} aria-label="Back to the systems" title="Back to the systems">
              <ArrowIcon dir="left" />
            </button>
          </nav>
          <h1 className="bar-title">
            <span className="bar-code">Trace</span>
            <span className="bar-name">{name}</span>
          </h1>
          <span className="bar-actions">
            <button type="button" className="btn key-btn" onClick={() => onChange(view)}>
              Change it
            </button>
            <KeyPopover />
          </span>
        </>
      }
      beat={
        <BeatStrip
          sim={sim}
          beat={{
            id: pick,
            text:
              pick === "second"
                ? `Every request at once, each the way its trace went, with the work it measured.`
                : sample
                  ? `Replaying the ${KIND[sample.kind].toLowerCase()} request: ${ms(sample.ms)}.`
                  : "",
            focus: null,
            n: 1,
            total: 1,
            waiting: false,
            part: false,
            follow: false,
          }}
          lead={<span className="beat-tone tone-explore">{pick === "second" ? "The second" : "Replay"}</span>}
          clock={<span className="slowmo">{clock}</span>}
        />
      }
      stage={
        <Stage
          sim={sim}
          spec={compiled.spec}
          frameSpecs={[compiled.spec]}
          mode={live.mode}
          reduced={live.reduced}
          label={`${name}: ${view.doc.parts.map((p) => p.name).join(", ")}`}
          drawRef={live.drawRef}
          focus={sample ? { nodes: sample.path } : null}
          follow={sample ? play.dot.id : null}
          explain={{ lesson: "" }}
          adapt
        />
      }
      flight={
        flight && (
          <Suspense fallback={null}>
            <FlightStrip v={flight} tag="Replaying" waits={false} onClose={() => choose("second")} closeLabel="Stop replaying it" />
          </Suspense>
        )
      }
      panel={
        <div className="step rp-panel">
          <h2 className="step-title">Replay a request</h2>
          <p className="step-text">Each walks your map with the trace&rsquo;s own times, slowed down; the strip and the list below are its spans.</p>
          <div className="rp-group">
            <span className="rp-group-h" id="rp-group-h">
              Group by
            </span>
            <div className="seg" role="radiogroup" aria-labelledby="rp-group-h" aria-busy={busy || undefined}>
              {GROUPS.map((g) => (
                <label key={g.by}>
                  <input type="radio" name="rp-group" checked={view.by === g.by} disabled={busy} onChange={() => regroup(g.by)} />
                  <span>{g.name}</span>
                </label>
              ))}
            </div>
          </div>
          <fieldset className="rp-picks">
            <legend className="sr-only">Which request</legend>
            {samples.map((s) => (
              <label key={s.kind} className={`rp-pick${s.broke ? " broke" : ""}`}>
                <input type="radio" name="rp-pick" checked={pick === s.kind} onChange={() => choose(s.kind)} />
                <span className="rp-pick-k">{KIND[s.kind]}</span>
                <span className="rp-pick-n">{s.name || "A request"}</span>
                <span className="rp-pick-ms">
                  {ms(s.ms)}
                  {s.broke ? ` · broke in ${s.broke.part}` : ""}
                </span>
              </label>
            ))}
          </fieldset>
          {!samples.some((s) => s.kind === "failed") && <p className="step-text">No request failed in this trace.</p>}
          {sample && <Waterfall s={sample} cursor={play.cursor} />}
          <div className="rp-second">
            <button type="button" className={pick === "second" ? "btn" : "btn-primary"} aria-pressed={pick === "second"} onClick={() => choose(pick === "second" ? (samples[0]?.kind ?? "typical") : "second")}>
              {pick === "second" ? "Back to one request" : "Replay the second"}
            </button>
            <p className="step-text">
              A model of your system: every request at once, each the way its trace went ({second.routes === 1 ? "one way" : `${second.routes} ways`}), with the
              work, wires and failures it measured.{" "}
              {model && off !== null
                ? `Checked against the trace: 95 in 100 answered within ${ms(model.p95)}, against ${ms(second.trace.p95)} (${off < 0.01 ? "under 1" : Math.round(off * 100)}% off).`
                : "Too few requests to check it against the trace."}
            </p>
          </div>
          {problem && <p className="my-bad">{problem}</p>}
          {readNotes ? (
            <div className="sys-read" role="status">
              <p className="sys-read-h">How System Lab read it</p>
              <ul>
                {view.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              <button type="button" className="btn" onClick={() => setReadNotes(false)}>
                Got it
              </button>
            </div>
          ) : (
            <button type="button" className="cta-alt" onClick={() => setReadNotes(true)}>
              How System Lab read it
            </button>
          )}
        </div>
      }
      pinned={
        <table className="compare rp-times">
          <caption className="sr-only">The trace&rsquo;s times against the replay&rsquo;s</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Measure</span>
              </th>
              <th scope="col">Trace</th>
              <th scope="col" className="on">
                Replay
              </th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Half answered within", ms(second.trace.p50), model ? ms(model.p50) : "—"],
                ["95 in 100 within", ms(second.trace.p95), model ? ms(model.p95) : "—"],
                ["Failed", pct(second.trace.failed), model ? pct(model.failed) : "—"],
              ] as const
            ).map(([what, a, b]) => (
              <tr key={what}>
                <th scope="row">{what}</th>
                <td className="num">{a}</td>
                <td className="num on">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
      dock={
        <>
          <Transport live={controls} />
          <span className="slowmo">{clock}</span>
          <span className="dock-fill" />
        </>
      }
    />
  );
}
