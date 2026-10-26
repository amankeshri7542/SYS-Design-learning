"use client";

import { useEffect, useRef, useState } from "react";
import { KINDS } from "@/lib/system/doc";
import { readSession, type TraceSession, type TraceView } from "@/lib/system/trace/open";
import { MOST_TRACE } from "./system-import";
import type { Grouping } from "@/lib/system/trace/reduce";

// Loaded when a trace is dropped, pasted or picked: the gallery carries none of the readers.

const GROUPS: { by: Grouping; name: string; says: string }[] = [
  { by: "service", name: "Service", says: "each service apart, as far as the stage allows" },
  { by: "prefix", name: "Prefix", says: "services sharing a name's first word as one (a team, a namespace)" },
  { by: "kind", name: "Kind", says: "behind the way in, one part for each kind" },
];

/**
 * A trace, read: what it holds, the parts it makes grouped one way or another (with what each was taken for and how
 * many it stands for), and Open it. The text is read once, scrubbed and let go (`onRead`); nothing is uploaded.
 */
export function TraceOpen({
  text,
  name,
  onRead,
  onOpen,
  onCancel,
}: {
  text: string;
  name: string;
  /** The text has been read: whoever holds it lets it go. */
  onRead: () => void;
  onOpen: (o: { session: TraceSession; view: TraceView; name: string }) => void;
  onCancel: () => void;
}) {
  const [read, setRead] = useState<ReturnType<typeof readSession> | null>(null);
  const [by, setBy] = useState<Grouping>("service");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  // Read once: the text is let go as soon as its spans are in.
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    setRead(
      text.length > MOST_TRACE
        ? { session: null, errors: [{ text: `That's ${Math.round(text.length / 1e6)} MB of trace; System Lab reads traces up to ${MOST_TRACE / 1e6} MB. Export fewer requests.` }] }
        : readSession(text, name),
    );
    onRead();
  }, [text, name, onRead]);
  if (!read) return <p className="my-import-label">Reading it…</p>;
  const { session } = read;
  if (!session)
    return (
      <div className="my-trace-read">
        <ul className="my-import-errors" role="alert">
          {read.errors.map((e, i) => (
            <li key={i}>{e.text}</li>
          ))}
        </ul>
        <button type="button" className="btn" onClick={onCancel}>
          Try another file
        </button>
      </div>
    );
  const preview = session.preview(by);
  const open = async () => {
    if (busy) return;
    setBusy(true);
    setErrors([]);
    try {
      // Sized, replayed and checked against the trace on headless runs: a moment.
      const v = await session.view(by);
      if ("errors" in v) setErrors(v.errors.map((e) => e.text));
      else onOpen({ session, view: v, name });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="my-trace-read">
      <p className="my-trace-sum">
        Reads as {session.format === "OpenTelemetry" ? "an" : "a"} {session.format} file: {session.requests === 1 ? "one request" : `${session.requests.toLocaleString("en")} requests`},{" "}
        {session.spans.toLocaleString("en")} spans. {preview.parts.length} parts:
      </p>
      <div className="rp-group">
        <span className="rp-group-h" id="trace-group-h">
          Group by
        </span>
        <div className="seg" role="radiogroup" aria-labelledby="trace-group-h">
          {GROUPS.map((g) => (
            <label key={g.by} title={g.says}>
              <input type="radio" name="trace-group" checked={by === g.by} onChange={() => setBy(g.by)} />
              <span>{g.name}</span>
            </label>
          ))}
        </div>
      </div>
      <ul className="my-trace-parts">
        {preview.parts.map((p) => (
          <li key={p.name}>
            <strong>{p.name}</strong>
            <span>
              {KINDS[p.kind].name}
              {p.merged ? ` · ${p.merged} merged` : ""}
            </span>
          </li>
        ))}
      </ul>
      {preview.notes.length > 0 && (
        <ul className="my-trace-notes">
          {preview.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div className="my-import-go">
        <button type="button" className="btn-primary" disabled={busy} aria-busy={busy || undefined} onClick={open}>
          {busy ? "Opening…" : "Replay it"}
        </button>
        <button type="button" className="cta-alt" onClick={onCancel}>
          Another file
        </button>
      </div>
      {errors.length > 0 && (
        <ul className="my-import-errors" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
