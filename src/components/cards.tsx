"use client";

import Link from "next/link";
import { useState } from "react";
import type { Check, Focus } from "@/lib/lessons/beats";
import type { Lesson } from "@/lib/lessons/types";
import { record } from "@/lib/record";
import { Mark } from "./beats";
import { Rich } from "./term";

// The Recap (its checks and how the lesson felt) and the reduced-motion list of beats: each page loads them the first
// time one shows. (The prediction stays with the player: it must be there the moment its beat fires.)

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
              record("check", { n, chosen: i, correct: i === c.answer });
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

const SNAGS = [
  { id: "numbers", label: "The numbers" },
  { id: "dots", label: "The dots" },
  { id: "words", label: "The words" },
];

/**
 * How the lesson landed, at the end of the Recap: noted in this browser's learning record only. "Not quite" asks what got
 * in the way, so the lesson can be tuned where it lost the reader.
 */
export function FeelCard() {
  const [feel, setFeel] = useState<"clear" | "unsure" | null>(null);
  const [snags, setSnags] = useState<string[]>([]);
  const choose = (f: "clear" | "unsure") => {
    setFeel(f);
    record("feel", { feel: f });
  };
  const snag = (id: string) => {
    const next = snags.includes(id) ? snags.filter((x) => x !== id) : [...snags, id];
    setSnags(next);
    record("feel", { feel: "unsure", snags: next.join(",") });
  };
  return (
    <section className="card feel" aria-labelledby="feel-h">
      <h3 id="feel-h" className="card-eyebrow">
        Did this one land?
      </h3>
      <div className="card-options">
        <button type="button" className="opt" aria-pressed={feel === "clear"} onClick={() => choose("clear")}>
          Yes, it&rsquo;s clear
        </button>
        <button type="button" className="opt" aria-pressed={feel === "unsure"} onClick={() => choose("unsure")}>
          Not quite
        </button>
      </div>
      {feel === "unsure" && (
        <div className="feel-snags" role="group" aria-label="What got in the way">
          <p className="card-why">What got in the way?</p>
          <div className="card-options">
            {SNAGS.map((s) => (
              <button key={s.id} type="button" className="opt" aria-pressed={snags.includes(s.id)} onClick={() => snag(s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {feel && (
        <p className="feel-note">
          Noted in this browser only. See it on your <Link href="/progress">progress</Link> page.
        </p>
      )}
    </section>
  );
}

/** The last tab: the rule, the why, the claim in numbers, the checks, the takeaways, and how the lesson felt. */
export function Recap({ lesson, claim, onWrong }: { lesson: Lesson; claim: string | null; onWrong: (f: Focus) => void }) {
  // Read once, as the Recap opens: a sentence whose numbers flicker is hard to read.
  const [sentence] = useState(claim);
  const t = lesson.takeaways;
  return (
    <>
      <h2 className="step-title">What to remember</h2>
      {t.rule && <p className="rule">{t.rule}</p>}
      <p className="step-text recap-why">{lesson.why}</p>
      {sentence && (
        <p className="step-text in-numbers">
          <span className="card-eyebrow">In numbers</span> <Rich text={sentence} />
        </p>
      )}
      {lesson.checks?.map((c, i) => (
        <CheckCard key={c.prompt} c={c} n={i + 1} onWrong={onWrong} />
      ))}
      <dl className="takeaways">
        <div>
          <dt>Use it when</dt>
          <dd>{t.use}</dd>
        </div>
        <div>
          <dt>The catch</dt>
          <dd>{t.catch}</dd>
        </div>
        <div>
          <dt>Seen in</dt>
          <dd>{t.seen}</dd>
        </div>
        {t.interview && (
          <div>
            <dt>In an interview</dt>
            <dd>{t.interview}</dd>
          </div>
        )}
      </dl>
      <FeelCard />
    </>
  );
}
