"use client";

import type { BlastReport } from "@/lib/system/blast";
import type { SystemDoc } from "@/lib/system/doc";

// The builder's What breaks and Compare tabs, loaded the first time one is opened.

/** What breaks if each part dies, worst first, with the usual fix and a way to try it. */
export function Breaks({ report, down, onCrash, onTry }: { report: BlastReport | null | undefined; down: string[]; onCrash: (part: string) => void; onTry: (doc: SystemDoc) => void }) {
  if (report === undefined) return <p className="step-text">Crashing each part in turn, on a copy…</p>;
  if (report === null) return <p className="step-text">Fix the system first: it doesn't run yet.</p>;
  if (!report.parts.length) return <p className="step-text">Add a part after the users to see what breaks.</p>;
  const worst = report.parts.filter((b) => b.verdict === "spof").length;
  return (
    <div className="sys-breaks">
      <h2 className="step-title">What breaks if a part dies</h2>
      <p className="step-text">
        {worst ? `${worst} ${worst === 1 ? "part takes" : "parts take"} everything down with it.` : "No single part takes everything down."} Each was crashed for 3 s on a copy of your system.
      </p>
      <ol className="sys-blast">
        {report.parts.map((b) => (
          <li key={b.part} className={`v-${b.verdict}`}>
            <p className="sys-blast-h">
              <span className="sys-verdict">{b.verdict === "spof" ? "Takes it all down" : b.verdict === "hurts" ? "Hurts" : b.verdict === "slower" ? "Slower" : "Fine"}</span>
              If {b.what} dies
            </p>
            <p className="sys-blast-text">{b.text}</p>
            {b.fix && <p className="sys-blast-fix">{b.fix}</p>}
            <div className="sys-blast-go">
              <button type="button" className="btn" aria-pressed={down.includes(b.part)} onClick={() => onCrash(b.part)}>
                {down.includes(b.part) ? "Bring it back" : "Crash it"}
              </button>
              {b.fixed && (
                <button type="button" className="btn" onClick={() => onTry(b.fixed!)}>
                  Try the fix
                </button>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Compare: copy the design to try a change beside it, or (while trying one) pick which the stage shows. */
export function CompareTab({ trying, shown, onView, onCopy }: { trying: boolean; shown: number; onView: (i: number) => void; onCopy: () => void }) {
  return (
    <div className="sys-compare">
      <h2 className="step-title">Try a change, side by side</h2>
      {trying ? (
        <>
          <p className="step-text">Both run the same traffic. Change the copy in “Your system”, or crash a part: both lose it.</p>
          <div className="seg" role="group" aria-label="Show on the stage">
            {["Yours", "With the change"].map((name, i) => (
              <label key={name}>
                <input type="radio" name="sys-view" checked={shown === i} onChange={() => onView(i)} />
                <span>{name}</span>
              </label>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="step-text">Copy your design, change the copy, and watch both run on the same traffic. Nothing changes in yours until you keep it.</p>
          <button type="button" className="btn-primary" onClick={onCopy}>
            Copy it to try a change
          </button>
        </>
      )}
    </div>
  );
}
