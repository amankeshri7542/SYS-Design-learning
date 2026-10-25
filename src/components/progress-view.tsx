"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { LineId } from "@/lib/lessons/types";
import { clearVisited, readVisited } from "@/lib/progress";
import { clearRecord, readEvents, readTallies, type RecordEvent, type Tally } from "@/lib/record";

export interface ProgressEntry {
  slug: string;
  code: string;
  title: string;
  line: LineId;
  kind: "lesson" | "story";
  /** Its beats in all: seeing every one is watching it end to end. */
  beats: number;
  /** A story's stages. */
  stages: number;
}

/** What this browser keeps: the lessons opened, and the learning record. */
interface Kept {
  visited: Set<string>;
  tallies: { [slug: string]: Tally };
  events: RecordEvent[];
}

/** What an event says, in words, or null for the ones too small to list (a beat, a step, a knob's every turn). */
function said(e: RecordEvent, name: string): string | null {
  const d = e.data ?? {};
  switch (e.kind) {
    case "open":
      return `Opened ${name}`;
    case "predict":
      return d.skipped ? `Skipped the prediction in ${name}` : `Predicted ${d.correct ? "right" : "wrong"} in ${name}`;
    case "check":
      return `Answered check ${d.n} ${d.correct ? "right" : "wrong"} in ${name}`;
    case "recap":
      return `Reached the Recap of ${name}`;
    case "stage":
      return `Cleared stage ${Number(d.stage) + 1} of ${name}`;
    case "feel":
      return d.feel === "clear" ? `Found ${name} clear` : `Found ${name} not quite clear${d.snags ? ` (${String(d.snags).replaceAll(",", ", ")})` : ""}`;
    case "fault":
      return d.on ? `Caused a fault in ${name}` : null;
    case "trace":
      return `Followed a request in ${name}`;
    case "term":
      return `Looked up “${String(d.key).replaceAll("-", " ")}” in ${name}`;
    case "metric":
      return `Asked what “${d.label}” means in ${name}`;
    default:
      return null;
  }
}

const day = (t: number) => {
  const d = new Date(t * 1000);
  const today = new Date();
  return d.toDateString() === today.toDateString() ? "today" : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

/**
 * The learner's own numbers, read from this browser's storage once the page is in it (so the server and the first
 * render agree): lessons and journeys, predictions and checks, line by line, and the latest things done. Download
 * keeps a copy; Clear forgets everything, after a second press.
 */
export function ProgressView({ entries, lines }: { entries: ProgressEntry[]; lines: { id: LineId; letter: string; name: string }[] }) {
  const [rec, setRec] = useState<Kept | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setRec({ visited: readVisited(), tallies: readTallies(), events: readEvents() }), []);

  if (!rec) return <section className="wrap progress" aria-busy="true" />;
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  const lessons = entries.filter((e) => e.kind === "lesson");
  const stories = entries.filter((e) => e.kind === "story");
  const tally = (slug: string) => rec.tallies[slug];
  const sum = (f: (t: Tally) => number) => Object.values(rec.tallies).reduce((n, t) => n + f(t), 0);
  const opened = (e: ProgressEntry) => rec.visited.has(e.slug) || !!tally(e.slug);
  const finished = (e: ProgressEntry) => !!tally(e.slug)?.recap || (e.kind === "story" && (tally(e.slug)?.stages.length ?? 0) >= e.stages);
  const watched = lessons.filter((e) => e.beats > 0 && (tally(e.slug)?.beats.length ?? 0) >= e.beats).length;
  const predicted = sum((t) => t.predicted);
  const checks = sum((t) => t.checks);
  const felt = Object.values(rec.tallies).filter((t) => t.feel);
  const nameOf = (slug: string) => {
    const e = bySlug.get(slug);
    return e ? `${e.code} ${e.title}` : slug;
  };
  const recent = rec.events
    .slice()
    .reverse()
    .map((e) => ({ e, text: said(e, nameOf(e.lesson)) }))
    .filter((x): x is { e: RecordEvent; text: string } => !!x.text)
    .slice(0, 12);
  const empty = !rec.visited.size && !rec.events.length;

  const download = () => {
    const today = new Date().toISOString().slice(0, 10);
    const data = { exportedOn: today, visited: [...rec.visited], tallies: rec.tallies, events: rec.events };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `system-lab-record-${today}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const clear = () => {
    if (!confirming) return setConfirming(true);
    clearRecord();
    clearVisited();
    setConfirming(false);
    setRec({ visited: new Set(), tallies: {}, events: [] });
  };

  return (
    <section className="wrap progress" aria-labelledby="progress-h">
      <p className="eyebrow">Progress</p>
      <h1 id="progress-h">What you&rsquo;ve done here.</h1>
      <p className="lede">Kept only in this browser: nothing is sent anywhere, and nothing names you. You can download a copy, or clear it.</p>

      {empty ? (
        <p className="progress-empty">
          Nothing yet. Open a lesson from the <Link href="/#route">route map</Link>, and what you do there shows up here.
        </p>
      ) : (
        <>
          <dl className="progress-stats">
            <div>
              <dt>Lessons opened</dt>
              <dd>
                {lessons.filter(opened).length} <span>of {lessons.length}</span>
              </dd>
            </div>
            <div>
              <dt>Watched to the end</dt>
              <dd>
                {watched} <span>every beat seen</span>
              </dd>
            </div>
            <div>
              <dt>Predictions right</dt>
              <dd>
                {sum((t) => t.predictedRight)} <span>of {predicted}</span>
              </dd>
            </div>
            <div>
              <dt>Checks right</dt>
              <dd>
                {sum((t) => t.checksRight)} <span>of {checks}</span>
              </dd>
            </div>
            <div>
              <dt>Journeys</dt>
              <dd>
                {stories.filter(finished).length} <span>of {stories.length} finished · {sum((t) => t.stages.length)} stages cleared</span>
              </dd>
            </div>
          </dl>

          <h2 className="progress-h2">Line by line</h2>
          <ul className="progress-lines">
            {lines.map((l) => {
              const on = entries.filter((e) => e.line === l.id);
              if (!on.length) return null;
              return (
                <li key={l.id} className={`line-${l.id}`}>
                  <span className="roundel-sm" aria-hidden="true">
                    {l.letter}
                  </span>
                  <span className="progress-line-name">{l.name}</span>
                  <span className="progress-line-nums">
                    {on.filter(opened).length} of {on.length} opened · {on.filter(finished).length} finished
                  </span>
                  <span className="progress-pips" aria-hidden="true">
                    {on.map((e) => (
                      <i key={e.slug} className={finished(e) ? "done" : opened(e) ? "on" : undefined} title={`${e.code} ${e.title}`} />
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>

          {felt.length > 0 && (
            <p className="progress-felt">
              Of the {felt.length === 1 ? "one lesson" : `${felt.length} lessons`} you rated, you found {felt.filter((t) => t.feel === "clear").length} clear.
            </p>
          )}

          {recent.length > 0 && (
            <>
              <h2 className="progress-h2">Latest</h2>
              <ol className="progress-recent">
                {recent.map(({ e, text }, i) => (
                  <li key={`${e.t}-${i}`}>
                    <span>{text}</span>
                    <time dateTime={new Date(e.t * 1000).toISOString()}>{day(e.t)}</time>
                  </li>
                ))}
              </ol>
            </>
          )}
        </>
      )}

      {!empty && (
        <div className="progress-actions">
          <button type="button" className="btn" onClick={download}>
            Download my record
          </button>
          <button type="button" className="btn" onClick={clear} aria-live="polite">
            {confirming ? "Press again to clear everything" : "Clear everything"}
          </button>
        </div>
      )}
    </section>
  );
}
