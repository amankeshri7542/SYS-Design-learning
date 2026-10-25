"use client";

import { useState } from "react";
import type { Check, Focus } from "@/lib/lessons/beats";
import { Mark } from "./beats";
import { Rich } from "./term";

// The Recap's checks and the reduced-motion list of beats: each page loads them the first time one shows. (The
// prediction stays with the player: it must be there the moment its beat fires.)

/** Reduced motion: the step's beats as a list. Next (or Step) brings each one on, on a still frame. */
export function WatchList({ items }: { items: { id: string; text: string; seen: boolean; now: boolean }[] }) {
  // One line each, so the list fits beside the knobs; the beat on screen reads in full.
  if (!items.length) return null;
  return (
    <section className="watch" aria-labelledby="watch-h">
      <h3 id="watch-h" className="card-eyebrow">
        What to watch
      </h3>
      <ol>
        {items.map((it) => (
          <li key={it.id} className={it.now ? "now" : it.seen ? "seen" : undefined} aria-current={it.now ? "step" : undefined}>
            <Rich text={it.text} />
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A question on the Recap. Any answer shows the same line of why; a wrong one also points the stage at the answer. */
export function CheckCard({ c, n, onWrong }: { c: Check; n: number; onWrong: (f: Focus) => void }) {
  const [chose, setChose] = useState<number | null>(null);
  const done = chose !== null;
  return (
    <section className="card check" aria-labelledby={`check-${n}`}>
      <h3 id={`check-${n}`} className="card-eyebrow">
        Check {n}
      </h3>
      <p className="card-prompt">
        <Rich text={c.prompt} />
      </p>
      <div className="card-options">
        {c.options.map((o, i) => (
          <button
            key={o}
            type="button"
            className={`opt${done && i === c.answer ? " right" : ""}${chose === i && i !== c.answer ? " wrong" : ""}`}
            aria-pressed={chose === i}
            disabled={done && chose !== i && i !== c.answer}
            onClick={() => {
              setChose(i);
              if (i !== c.answer && c.focus) onWrong(c.focus);
            }}
          >
            {done && (i === c.answer || chose === i) && <Mark right={i === c.answer} />}
            {o}
          </button>
        ))}
      </div>
      {done && (
        <p className="card-why" aria-live="polite">
          <Rich text={c.why} />
        </p>
      )}
    </section>
  );
}
