"use client";

import { useState } from "react";
import type { SystemDoc } from "@/lib/system/doc";
import { FORMATS, detect } from "@/lib/system/import/detect";

/** The most text read: a big compose file is a few hundred KB; anything near this is not a system description. */
const MOST = 1_000_000;
/** A trace file is read up to this: a few thousand requests' spans. */
const MOST_TRACE = 20_000_000;

const EXAMPLE = "Users -> Load balancer -> API x3 -> Redis -> Postgres\nAPI -> Stripe\nAPI -> Jobs [queue] -> Mailer -> SendGrid";

/**
 * Describe a system you have: a few lines of arrows, a docker-compose file, a CSV of calls, a System Lab file, or a
 * trace (Jaeger, Zipkin or OpenTelemetry JSON). It is read here, in the browser, and opens running; what couldn't be
 * read is listed by line. The readers and the engine that sizes it load when it is opened. A trace file's text is
 * never shown: only what is left once personal data is taken out.
 */
export function SystemImport({ onOpen }: { onOpen: (doc: SystemDoc, notes: string[]) => void }) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<{ line?: number; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const format = text.trim() ? detect(text) : null;
  const open = async (source = text, name?: string) => {
    if (busy) return;
    const trace = detect(source) === "trace";
    if (source.length > (trace ? MOST_TRACE : MOST)) return setErrors([{ text: `That's ${Math.round(source.length / 1000)} KB of text; System Lab reads up to ${MOST / 1000} KB. Paste the part that names your services.` }]);
    setBusy(true);
    try {
      // Read, then sized on a headless run so it opens healthy; a trace is scrubbed of personal data as it is read.
      const r = trace ? await (await import("@/lib/system/trace/open")).openTrace(source, name) : await (await import("@/lib/system/import/open")).openSystem(source, name);
      setErrors(r.errors);
      if (r.doc && !r.errors.length) onOpen(r.doc, r.notes);
    } catch {
      // The readers are fetched the first time: offline, or a page left open across a new version.
      setErrors([{ text: "System Lab couldn't load what reads it. Check your connection, then try again." }]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="my-import">
      <label className="my-import-label" htmlFor="my-import-text">
        Arrows, one chain a line, with copies (<code>x3</code>), kinds (<code>[queue]</code>) and rates (<code>(120/s)</code>) if you like. Or paste a
        docker-compose file, a CSV of calls (<code>from,to,rps,latency_ms</code>) or a System Lab file, or open a trace: Jaeger, Zipkin or
        OpenTelemetry JSON.
      </label>
      <textarea
        id="my-import-text"
        rows={5}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        value={text}
        placeholder={EXAMPLE}
        aria-describedby={errors.length ? "my-import-errors" : undefined}
        onChange={(e) => {
          setText(e.target.value);
          setErrors([]);
        }}
      />
      <div className="my-import-go">
        <button type="button" className="btn-primary" disabled={!text.trim() || busy} aria-busy={busy || undefined} onClick={() => open()}>
          {busy ? "Opening…" : "Open it"}
        </button>
        <button type="button" className="cta-alt" onClick={() => setText(EXAMPLE)}>
          Try the example
        </button>
        <label className="btn my-import-file">
          Open a file
          <input
            type="file"
            accept=".json,.jsonl,.yml,.yaml,.csv,.txt"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              e.target.value = "";
              const big = `${file.name} is ${Math.round(file.size / 1000)} KB; System Lab reads files up to ${MOST / 1000} KB`;
              if (file.size > MOST_TRACE) return setErrors([{ text: `${big}, and traces up to ${MOST_TRACE / 1e6} MB.` }]);
              const body = await file.text();
              // A trace's text isn't shown: what it holds is read, scrubbed, and let go.
              if (detect(body) !== "trace") {
                if (file.size > MOST) return setErrors([{ text: `${big}.` }]);
                setText(body);
              }
              open(body, file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") || "My system");
            }}
          />
        </label>
        {format && <span className="my-import-format">Reads as {FORMATS[format]}</span>}
      </div>
      {errors.length > 0 && (
        <ul id="my-import-errors" className="my-import-errors" role="alert">
          {errors.map((e, i) => (
            <li key={i}>{e.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
