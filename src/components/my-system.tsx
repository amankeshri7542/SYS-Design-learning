"use client";

import { Suspense, lazy, useCallback, useEffect, useState } from "react";
import type { SystemDoc } from "@/lib/system/doc";
import { decodeDoc, removeSystem, savedSystems, type Saved } from "@/lib/system/share";
import type { TraceSession, TraceView } from "@/lib/system/trace/open";
import { TEMPLATES } from "@/lib/system/templates";
import { SiteFooter, SiteHeader } from "./site";
import { ArrowIcon } from "./live";
import { SystemImport } from "./system-import";

// The player loads when a system opens, and a trace's reader and replay when one is given: the gallery is a light page.
const SystemPlayer = lazy(() => import("./system-player").then((m) => ({ default: m.SystemPlayer })));
const ReplayPlayer = lazy(() => import("./replay").then((m) => ({ default: m.ReplayPlayer })));
const TraceOpen = lazy(() => import("./trace-open").then((m) => ({ default: m.TraceOpen })));

/**
 * My System: start from a system like yours (or one saved here, or one a link carries), and it opens running. Nothing
 * leaves the browser: systems are kept in its storage, and a shared link carries the whole system after its #.
 */
export function MySystem() {
  const [open, setOpen] = useState<{ doc: SystemDoc; id?: string; notes?: string[]; template?: boolean; trace?: boolean } | null>(null);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [badLink, setBadLink] = useState(false);
  // A trace being read (its text, until the reader has it), and one opened.
  const [pending, setPending] = useState<{ text: string; name: string } | null>(null);
  const [replay, setReplay] = useState<{ session: TraceSession; view: TraceView; name: string } | null>(null);
  const read = useCallback(() => setPending((p) => (p ? { ...p, text: "" } : p)), []);
  const trace = (text: string, name: string) => {
    setPending({ text, name });
    document.getElementById("replay-h")?.scrollIntoView({ block: "start" });
  };
  // A trace file, picked or dropped: handed to the trace reader (which refuses one too big), and not kept.
  const file = async (f?: File) => f && trace(await f.text(), f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") || "My system");
  useEffect(() => {
    setSaved(savedSystems());
    const m = location.hash.match(/^#s=(.+)$/);
    if (m) decodeDoc(m[1]).then((doc) => (doc ? setOpen({ doc }) : setBadLink(true)));
  }, []);
  if (open) {
    return (
      <Suspense fallback={<div className="shell shell-skeleton" aria-busy="true" />}>
        <SystemPlayer
          initial={open.doc}
          savedId={open.id}
          notes={open.notes}
          template={open.template}
          back={open.trace ? "Back to the trace" : undefined}
          onLeave={() => {
            setOpen(null);
            setSaved(savedSystems());
            history.replaceState(null, "", "/my-system");
          }}
        />
      </Suspense>
    );
  }
  if (replay) {
    return (
      <Suspense fallback={<div className="shell shell-skeleton" aria-busy="true" />}>
        <ReplayPlayer
          session={replay.session}
          first={replay.view}
          name={replay.name}
          onLeave={() => {
            // The trace's spans go with it.
            setReplay(null);
            setPending(null);
          }}
          onChange={(view) => {
            setReplay({ ...replay, view });
            setOpen({ doc: view.doc, notes: view.notes, trace: true });
          }}
        />
      </Suspense>
    );
  }
  return (
    <>
      <SiteHeader />
      <section className="wrap-wide my-head">
        <h1>Map your own system.</h1>
        <p className="lede">
          Describe yours in a few lines, or pick one like it and change it. Crash any part to see what breaks, and try the fix beside the
          original. It all runs here, in your browser; nothing is sent anywhere.
        </p>
        {badLink && <p className="my-bad">That link didn&rsquo;t carry a system System Lab can read. Start from one below.</p>}
      </section>
      {saved.length > 0 && (
        <section className="wrap-wide my-saved" aria-labelledby="saved-h">
          <h2 id="saved-h" className="section-h">
            Yours
          </h2>
          <ul>
            {saved.map((s) => (
              <li key={s.id}>
                <button type="button" className="my-saved-open" onClick={() => setOpen({ doc: s.doc, id: s.id })}>
                  <strong>{s.doc.name}</strong>
                  <span>{s.doc.parts.map((p) => p.name).join(" · ")}</span>
                </button>
                <button
                  type="button"
                  className="btn btn-icon"
                  aria-label={`Forget ${s.doc.name}`}
                  title="Forget it"
                  onClick={() => {
                    removeSystem(s.id);
                    setSaved(savedSystems());
                  }}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true" className="stroke">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="wrap-wide my-describe" aria-labelledby="describe-h">
        <h2 id="describe-h" className="section-h">
          Describe yours
        </h2>
        <SystemImport onOpen={(doc, notes) => setOpen({ doc, notes })} onTrace={trace} />
      </section>
      <section
        className="wrap-wide my-replay"
        aria-labelledby="replay-h"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          file(e.dataTransfer.files[0]);
        }}
      >
        <h2 id="replay-h" className="section-h">
          Replay a trace
        </h2>
        {pending ? (
          <Suspense fallback={<p className="my-import-label">Reading it…</p>}>
            <TraceOpen text={pending.text} name={pending.name} onRead={read} onOpen={setReplay} onCancel={() => setPending(null)} />
          </Suspense>
        ) : (
          <div className="my-import my-trace">
            <p className="my-import-label">
              Open (or drop, or paste above) a Jaeger, Zipkin or OpenTelemetry JSON export, and watch a typical request, the slowest and a failed one walk
              your map, span by span. It&rsquo;s read here; nothing is uploaded, and only service and operation names are kept.
            </p>
            <label className="btn-primary my-import-file">
              Open a trace file
              <input
                type="file"
                accept=".json,.jsonl,.txt"
                onChange={(e) => {
                  file(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        )}
      </section>
      <section className="wrap-wide my-start" aria-labelledby="start-h">
        <h2 id="start-h" className="section-h">
          Or start from one like it
        </h2>
        <ol className="tpl-list">
          {TEMPLATES.map((t) => (
            <li key={t.id}>
              <button type="button" className="tpl" onClick={() => setOpen({ doc: structuredClone(t.doc), template: true })}>
                <span className="tpl-name">{t.name}</span>
                <span className="tpl-shape">{t.shape}</span>
                <span className="tpl-line">{t.line}</span>
                <ArrowIcon />
              </button>
            </li>
          ))}
        </ol>
      </section>
      <SiteFooter />
    </>
  );
}
