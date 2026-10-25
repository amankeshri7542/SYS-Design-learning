"use client";

import { Suspense, createContext, lazy, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Focus } from "@/lib/lessons/beats";
import { TERM } from "@/lib/lessons/term-mark";
import type { Term as TermDef } from "@/lib/glossary";
import { useTouch } from "./hooks";
import { record } from "@/lib/record";
import { DefsContext } from "./term-defs";

interface Terms {
  open: (key: string, from: HTMLElement) => void;
  /** Terms are buttons in the text. On touch layouts they are words, and `TermChips` carries the buttons. */
  inline: boolean;
}

const TermsContext = createContext<Terms | null>(null);

// A term's definition loads the first time one opens: the page carries only the popover's frame until then.
const TermCard = lazy(() => import("./term-card"));

/**
 * Text that may mark glossary terms as `[[key|plain words]]` (or `[[key]]`, which reads as the key): the plain words
 * show with a dotted underline, and a tap opens the term's short definition. Outside a `TermProvider` (or for an
 * unknown key) they are plain words.
 */
export function Rich({ text }: { text: string }) {
  const terms = useContext(TermsContext);
  const defs = useContext(DefsContext);
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TERM)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const def = defs.get(m[1]);
    const words = m[2] ?? m[1].replace(/-/g, " ");
    out.push(
      terms && def && terms.inline ? (
        <button key={m.index} type="button" className="term" aria-haspopup="dialog" onClick={(e) => terms.open(def.key, e.currentTarget)}>
          {words}
        </button>
      ) : terms && def ? (
        <span key={m.index} className="term-word">
          {words}
        </span>
      ) : (
        words
      ),
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

/**
 * Touch layouts: the terms the step has named so far, as buttons big enough to tap (in the text they are plain words,
 * since a 40px target can't sit inside a sentence).
 */
export function TermChips({ keys }: { keys: string[] }) {
  const terms = useContext(TermsContext);
  const defs = useContext(DefsContext);
  if (!terms || terms.inline || !keys.length) return null;
  return (
    <div className="term-chips" role="group" aria-label="Words in this step">
      {keys.map((k) => (
        <button key={k} type="button" className="btn term-chip" aria-haspopup="dialog" onClick={(e) => terms.open(k, e.currentTarget)}>
          {defs.get(k)?.name ?? k}
        </button>
      ))}
    </div>
  );
}

/**
 * Gives `Rich` text its definitions: one popover for the page, opened beside the term that was tapped. "Show me" points
 * the stage at the term (`onShow`) when the term is shown best in this lesson.
 */
export function TermProvider({ lesson, onShow, children }: { lesson: string; onShow: (f: Focus) => void; children: ReactNode }) {
  const pop = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [term, setTerm] = useState<TermDef | null>(null);
  const [at, setAt] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const touch = useTouch();
  const defs = useContext(DefsContext);

  const open = (key: string, from: HTMLElement) => {
    const def = defs.get(key);
    const el = pop.current;
    if (!def || !el) return;
    record("term", { key });
    opener.current = from;
    const r = from.getBoundingClientRect();
    // Under the term when there is room, otherwise above it; clamped to the window.
    const below = r.bottom + 220 < innerHeight;
    setAt({ x: Math.max(12, Math.min(r.left, innerWidth - 300)), y: below ? r.bottom + 8 : r.top - 8, below });
    setTerm(def);
    if (!el.matches(":popover-open")) el.showPopover();
  };

  useEffect(() => {
    const el = pop.current;
    if (!el) return;
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState === "open") close.current?.focus();
      else opener.current?.focus({ preventScroll: true });
    };
    el.addEventListener("toggle", onToggle);
    return () => el.removeEventListener("toggle", onToggle);
  }, []);

  const show = term?.show?.lesson === lesson ? term.show.focus : null;
  return (
    <TermsContext.Provider value={{ open, inline: !touch }}>
      {children}
      <div
        ref={pop}
        id="term-pop"
        className={`term-pop${at?.below === false ? " above" : ""}`}
        popover="auto"
        role="dialog"
        aria-labelledby="term-name"
        style={at ? { left: at.x, top: at.y } : undefined}
      >
        {term && (
          <Suspense fallback={null}>
            <TermCard term={term} show={show} onShow={onShow} close={close} pop={pop} />
          </Suspense>
        )}
      </div>
    </TermsContext.Provider>
  );
}
