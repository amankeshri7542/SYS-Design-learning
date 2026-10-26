"use client";

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Beat } from "@/lib/lessons/beats";
import type { MetricSpec } from "@/lib/sim/metrics";
import type { Sim } from "@/lib/sim/engine/core";
import type { BlastReport } from "@/lib/system/blast";
import { PEOPLE, compile, type Compiled } from "@/lib/system/compile";
import { outage } from "@/lib/system/outage";
import type { SystemDoc } from "@/lib/system/doc";
import { encodeDoc, saveSystem } from "@/lib/system/share";
import { BeatStrip } from "./strip";
import { KeyPopover } from "./key";
import { ArrowIcon, BoltIcon, Clock, Compare, Transport, useLiveSims } from "./live";
import type { Explain } from "./part-card";
import { useSceneBeats } from "./scene-beats";
import { Shell, usePlayerKeys } from "./shell";
import { Stage } from "./stage";
import { SystemEditor } from "./system-editor";

// What breaks and Compare load with their tabs, as What breaks's measuring does.
const Breaks = lazy(() => import("./system-tabs").then((m) => ({ default: m.Breaks })));
const CompareTab = lazy(() => import("./system-tabs").then((m) => ({ default: m.CompareTab })));

type Tab = "design" | "breaks" | "compare";
const TABS: { id: Tab; name: string }[] = [
  { id: "design", name: "Your system" },
  { id: "breaks", name: "What breaks" },
  { id: "compare", name: "Compare" },
];

/** The table's rows for a system: people's response time and failures, the busiest part, and caches or queues. */
function metricsOf(doc: SystemDoc, worlds: Compiled[]): MetricSpec[] {
  const people = doc.parts.some((p) => p.kind === "users") ? PEOPLE : undefined;
  const ids = (pred: (n: Compiled["spec"]["nodes"][number]) => boolean) => [...new Set(worlds.flatMap((c) => c.spec.nodes.filter(pred).map((n) => n.id)))];
  const working = ids((n) => !!n.slots);
  const caches = ids((n) => n.kind === "cache");
  const queues = ids((n) => n.kind === "queue");
  const out: MetricSpec[] = [
    { id: "p95", label: "Response time", tag: people, hint: "95% of people's requests are answered faster than this." },
    { id: "errors", label: "Failed", tag: people, target: doc.targets.failed, hint: "The share of people's requests that failed or gave up waiting." },
  ];
  if (working.length) out.push({ id: "peak", label: "Busiest part", nodes: working, hint: "How busy the busiest part is: past about 80%, lines start to form." });
  if (caches.length) out.push({ id: "hit", label: "Cache hits", nodes: caches, hint: "The share of reads answered straight from a cache." });
  else if (queues.length) out.push({ id: "queue", label: "Jobs waiting", nodes: queues, hint: "Jobs waiting in queues for a worker, right now." });
  return out;
}

/**
 * A system someone describes, running: the stage is the hero, the panel edits it, says what breaks if each part dies,
 * and compares a change side by side on the same traffic. It is saved in this browser as it changes.
 */
export function SystemPlayer({
  initial,
  savedId,
  notes = [],
  template = false,
  back = "Back to the systems",
  onLeave,
}: {
  initial: SystemDoc;
  savedId?: string;
  notes?: string[];
  /** A template as it comes: kept only once it is changed. */
  template?: boolean;
  /** Where the back button goes, in words. */
  back?: string;
  onLeave: () => void;
}) {
  const [doc, setDoc] = useState(initial);
  const [variant, setVariant] = useState<SystemDoc | null>(null);
  const [view, setView] = useState(0);
  const [tab, setTab] = useState<Tab>("design");
  const [open, setOpen] = useState<string | null>(null);
  const [down, setDown] = useState<string[]>([]);
  const [slow, setSlow] = useState<string[]>([]);
  const [surge, setSurge] = useState(false);
  const [explaining, setExplaining] = useState(0);
  const [shared, setShared] = useState(false);
  const [readNotes, setReadNotes] = useState(notes);

  // Each world compiled; a doc with errors keeps the last design that compiled on the stage.
  const faults = useMemo(() => ({ slow, surge }), [slow, surge]);
  const goodYours = useRef<Compiled | null>(null);
  const goodVariant = useRef<Compiled | null>(null);
  const yoursOut = useMemo(() => compile(doc, faults), [doc, faults]);
  const variantOut = useMemo(() => (variant ? compile(variant, faults) : null), [variant, faults]);
  if (yoursOut.spec) goodYours.current = yoursOut as Compiled;
  if (variantOut?.spec) goodVariant.current = variantOut as Compiled;
  const yours = goodYours.current!;
  const changed = variant ? goodVariant.current : null;
  const worlds = useMemo(() => (changed ? [yours, changed] : [yours]), [yours, changed]);
  const specs = useMemo(() => worlds.map((c) => c.spec), [worlds]);
  const editing = variant ?? doc;
  const issues = (variant ? variantOut! : yoursOut).issues;
  const setEditing = (d: SystemDoc) => (variant ? setVariant(d) : setDoc(d));

  // "Explain like I'm new": the tour, from the start each time it is asked for. Its words load the first time.
  const [tour, setTour] = useState<Beat[]>([]);
  useEffect(() => {
    if (!explaining) return setTour([]);
    let live = true;
    import("@/lib/system/explain").then((m) => live && setTour(m.explainBeats(doc, yours)));
    return () => {
      live = false;
    };
  }, [explaining, doc, yours]);
  // The tour restarts once its words have loaded (a key of 0 runs nothing), and each time it is asked for again.
  const runKey = useRef(0);
  runKey.current = tour.length ? explaining : 0;
  const beats = useSceneBeats(tour, () => runKey.current);
  const live = useLiveSims(specs, { onGrid: beats.onGrid });
  usePlayerKeys(live);
  const shown = Math.min(view, worlds.length - 1);
  const sim = live.sims[shown];
  const compiled = worlds[shown];

  // Crashed parts: each world's stations go down and come back as the set changes (and again in fresh worlds).
  const applied = useRef<{ sims: Sim[]; down: string[] }>({ sims: [], down: [] });
  useEffect(() => {
    const was = applied.current.sims === live.sims ? applied.current.down : [];
    live.sims.forEach((s, w) => {
      const c = worlds[w];
      const d = w === 0 ? doc : (variant ?? doc);
      for (const part of new Set([...was, ...down])) {
        const isDown = down.includes(part);
        if (was.includes(part) === isDown) continue;
        const p = d.parts.find((x) => x.id === part);
        // The same stations "What breaks" takes down: a database's main copy, one of several copies, or the part.
        const ids = p && c ? (outage(p, c, d).down.length ? outage(p, c, d).down : (c.stations.get(part) ?? [])) : [];
        for (const id of ids) if (s.nodes.has(id)) s.setUp(id, !isDown);
      }
    });
    applied.current = { sims: live.sims, down };
    live.refresh();
  }, [down, live.sims, worlds, doc, variant]);
  const crash = (part: string) => setDown((d) => (d.includes(part) ? d.filter((x) => x !== part) : [...d, part]));
  // A part taken away takes its faults with it.
  useEffect(() => {
    const has = (id: string) => doc.parts.some((p) => p.id === id);
    setDown((d) => (d.every(has) ? d : d.filter(has)));
    setSlow((d) => (d.every(has) ? d : d.filter(has)));
  }, [doc]);

  // Saved in this browser as it changes (the doc, not the change being tried); a template, once it is changed.
  const id = useRef(savedId);
  useEffect(() => {
    if (template && doc === initial) return;
    const t = setTimeout(() => (id.current = saveSystem(doc, id.current)), 600);
    return () => clearTimeout(t);
  }, [doc]);

  // What breaks: measured for the design as it is, whenever the tab is open.
  const [report, setReport] = useState<{ key: string; r: BlastReport | null } | null>(null);
  const reportKey = JSON.stringify(doc);
  useEffect(() => {
    if (tab !== "breaks" || report?.key === reportKey) return;
    // Measured on copies, after the tab has drawn; the measuring code loads the first time.
    let live = true;
    const t = setTimeout(() => import("@/lib/system/blast").then((m) => live && setReport({ key: reportKey, r: m.blastRadius(doc) })), 30);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [tab, reportKey, report?.key, doc]);

  const share = async () => {
    const url = `${location.origin}/my-system#s=${await encodeDoc(doc)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // No clipboard (an insecure page, or refused): the address bar carries it instead.
    }
    history.replaceState(null, "", url);
    setShared(true);
    setTimeout(() => setShared(false), 2400);
  };

  const tryChange = (next: SystemDoc) => {
    setVariant(next);
    setView(1);
    setTab("compare");
  };
  const keep = () => {
    if (variant) setDoc(variant);
    setVariant(null);
    setView(0);
  };
  const drop = () => {
    setVariant(null);
    setView(0);
  };

  // Part cards on the stage can open a part's settings.
  const edit = useCallback(
    (station: string) => {
      const part = compiled.partOf.get(station);
      if (!part) return;
      setTab("design");
      setOpen(part);
    },
    [compiled],
  );
  const explain = useMemo<Explain>(() => ({ lesson: "", edit }), [edit]);

  const metrics = useMemo(() => metricsOf(editing, worlds), [editing, worlds]);
  const columns = worlds.map((_, i) => ({ label: i === 0 ? "Yours" : "Changed", sim: live.sims[i], active: i === shown }));
  const crashable = doc.parts.filter((p) => p.kind !== "users" && p.kind !== "bots");

  const onTabKey = (e: KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: TABS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = TABS[(to + TABS.length) % TABS.length];
    setTab(next.id);
    document.getElementById(`sys-tab-${next.id}`)?.focus();
  };

  return (
    <Shell
      className="line-stories system"
      simTime={sim.t}
      rootRef={live.rootRef as React.Ref<HTMLDivElement>}
      bar={
        <>
          <nav className="bar-line" aria-label="My system">
            <button type="button" className="roundel-sm sys-back" onClick={onLeave} aria-label={back} title={back}>
              <ArrowIcon dir="left" />
            </button>
          </nav>
          <h1 className="bar-title">
            <span className="bar-code">Yours</span>
            <span className="bar-name">{doc.name}</span>
          </h1>
          <span className="bar-actions">
            <button type="button" className={`btn key-btn${explaining ? " on" : ""}`} aria-pressed={!!explaining} onClick={() => setExplaining((n) => (n ? 0 : Date.now()))}>
              Explain<span className="when-wide"> like I&rsquo;m new</span>
            </button>
            <button type="button" className="btn key-btn" onClick={share}>
              {shared ? "Link copied" : "Share"}
            </button>
            <KeyPopover />
          </span>
        </>
      }
      beat={
        <BeatStrip
          sim={sim}
          beat={beats.beat ?? (explaining ? null : undefined)}
          announce={beats.beat?.text ?? ""}
          lead={
            <span className={`beat-tone ${shown ? "tone-fix" : "tone-explore"}`}>
              {worlds.length > 1 ? (shown ? "With the change" : "Yours") : surge ? "Surge ×3" : "Live"}
            </span>
          }
          clock={<Clock live={live} />}
        />
      }
      stage={
        <Stage
          sim={sim}
          spec={compiled.spec}
          frameSpecs={specs}
          mode={live.mode}
          reduced={live.reduced}
          label={`${doc.name}: ${editing.parts.map((p) => p.name).join(", ")}`}
          drawRef={live.drawRef}
          focus={beats.beat?.focus}
          callout={beats.beat ? { id: beats.beat.id, text: beats.beat.text, waiting: false } : null}
          explain={explain}
          adapt
        />
      }
      panel={
        <>
          <div className="panel-head">
            <div className="tabs" role="tablist" aria-label="My system" onKeyDown={onTabKey}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  id={`sys-tab-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  aria-controls="sys-panel"
                  tabIndex={tab === t.id ? 0 : -1}
                  className="tab"
                  onClick={() => setTab(t.id)}
                >
                  <span className="tab-name">{t.name}</span>
                </button>
              ))}
            </div>
          </div>
          {/* Faults sit in the panel, as a lesson's do: under the tabs, whatever the tab. */}
          <div className="sys-faults" role="group" aria-label="Break something">
            <label className="sys-crash">
              <BoltIcon />
              <select
                aria-label="Break something: crash a part, or slow one down"
                value=""
                onChange={(e) => {
                  const [what, part] = e.target.value.split(":");
                  if (what === "crash") crash(part);
                  if (what === "slow") setSlow((s) => (s.includes(part) ? s.filter((x) => x !== part) : [...s, part]));
                }}
              >
                <option value="">{down.length + slow.length ? `${down.length + slow.length} ${down.length + slow.length === 1 ? "fault" : "faults"} on` : "Break something"}</option>
                <optgroup label="Crash">
                  {crashable.map((p) => {
                    const what = outage(p, yours, doc).what;
                    return (
                      <option key={p.id} value={`crash:${p.id}`}>
                        {down.includes(p.id) ? `Bring back ${what}` : `Crash ${what}`}
                      </option>
                    );
                  })}
                </optgroup>
                <optgroup label="Slow down (5× the work)">
                  {crashable
                    .filter((p) => p.kind === "service" || p.kind === "worker" || p.kind === "external" || p.kind === "database")
                    .map((p) => (
                      <option key={p.id} value={`slow:${p.id}`}>
                        {slow.includes(p.id) ? `Speed ${p.name} back up` : `Slow ${p.name} down`}
                      </option>
                    ))}
                </optgroup>
              </select>
            </label>
            <button type="button" className={`btn btn-fault${surge ? " on" : ""}`} aria-pressed={surge} onClick={() => setSurge((s) => !s)}>
              <BoltIcon />
              {surge ? "End the surge" : "Surge ×3"}
            </button>
          </div>
          <div id="sys-panel" role="tabpanel" aria-labelledby={`sys-tab-${tab}`} className="step">
            {variant && (
              <div className="sys-trying" role="status">
                <p>
                  <strong>Trying a change.</strong> Edits go to the copy; the table compares it with yours, on the same traffic.
                </p>
                <div className="sys-trying-go">
                  <button type="button" className="btn-primary" onClick={keep}>
                    Keep the change
                  </button>
                  <button type="button" className="btn" onClick={drop}>
                    Drop it
                  </button>
                </div>
              </div>
            )}
            {tab === "design" && readNotes.length > 0 && (
              <div className="sys-read" role="status">
                <p className="sys-read-h">How System Lab read it</p>
                <ul>
                  {readNotes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
                <button type="button" className="btn" onClick={() => setReadNotes([])}>
                  Got it
                </button>
              </div>
            )}
            {tab === "design" && (
              <>
                <label className="sys-title">
                  <span className="sr-only">The system's name</span>
                  <input type="text" value={doc.name} maxLength={60} onChange={(e) => setDoc({ ...doc, name: e.target.value })} />
                </label>
                <SystemEditor doc={editing} onChange={setEditing} open={open} setOpen={setOpen} issues={issues} />
              </>
            )}
            {tab === "breaks" && (
              <Suspense fallback={<p className="step-text">Crashing each part in turn, on a copy…</p>}>
                <Breaks report={report?.key === reportKey ? report.r : undefined} down={down} onCrash={crash} onTry={tryChange} />
              </Suspense>
            )}
            {tab === "compare" && (
              <Suspense fallback={null}>
                <CompareTab trying={!!variant} shown={shown} onView={setView} onCopy={() => tryChange(structuredClone(doc))} />
              </Suspense>
            )}
          </div>
        </>
      }
      pinned={<Compare metrics={metrics} columns={columns} verdict={worlds.length > 1} />}
      dock={
        <>
          <Transport live={live} />
          <Clock live={live} />
          <span className="dock-fill" />
        </>
      }
    />
  );
}
