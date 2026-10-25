"use client";

import { useState } from "react";
import { KINDS, article, type SystemDoc } from "@/lib/system/doc";
import { FORMATS, detect } from "@/lib/system/import/detect";

/** The most text read: a big compose file is a few hundred KB; anything near this is not a system description. */
const MOST = 1_000_000;

const EXAMPLE = "Users -> Load balancer -> API x3 -> Redis -> Postgres\nAPI -> Stripe\nAPI -> Jobs [queue] -> Mailer -> SendGrid";

/**
 * Describe a system you have: a few lines of arrows, a docker-compose file, a CSV of calls, or a System Lab file. It
 * is read here, in the browser, and opens running; what couldn't be read is listed by line. The readers and the
 * engine that sizes it load when it is opened.
 */
export function SystemImport({ onOpen }: { onOpen: (doc: SystemDoc, notes: string[]) => void }) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<{ line?: number; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const format = text.trim() ? detect(text) : null;
  const open = async (source = text, name?: string) => {
    if (busy) return;
    if (source.length > MOST) return setErrors([{ text: `That's ${Math.round(source.length / 1000)} KB of text; System Lab reads up to ${MOST / 1000} KB. Paste the part that names your services.` }]);
    setBusy(true);
    try {
      const { readSystem } = await import("@/lib/system/import/read");
      const r = readSystem(source, undefined, name ?? "My system");
      setErrors(r.errors);
      if (!r.doc || r.errors.length) return;
      // Sized on a headless run, so it opens healthy.
      const { sized } = await import("@/lib/system/import/size");
      const s = await sized(r.doc);
      // What was taken from a name, unless the name already says it ("Load balancer").
      const guessed = r.guesses.filter((g) => g.kind !== "service" && g.kind !== "users" && !g.name.toLowerCase().includes(KINDS[g.kind].name.toLowerCase()));
      const named = guessed.length
        ? [`Took ${guessed.slice(0, 6).map((g) => `${g.name} for ${article(KINDS[g.kind].name)}`).join(", ")}${guessed.length > 6 ? " and more" : ""}, from what they're called. Change any under “What it is”.`]
        : [];
      onOpen(s.doc, [...named, ...r.notes, ...s.notes]);
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
        docker-compose file, a CSV of calls (<code>from,to,rps,latency_ms</code>) or a System Lab file.
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
            accept=".json,.yml,.yaml,.csv,.txt"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              e.target.value = "";
              if (file.size > MOST) return setErrors([{ text: `${file.name} is ${Math.round(file.size / 1000)} KB; System Lab reads files up to ${MOST / 1000} KB.` }]);
              const body = await file.text();
              setText(body);
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
