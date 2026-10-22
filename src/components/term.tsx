"use client";

import Link from "next/link";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { TERM, type Focus } from "@/lib/lessons/beats";
import { termOf, type Term as TermDef } from "@/lib/glossary";
import { useTouch } from "./hooks";

interface Terms {
  open: (key: string, from: HTMLElement) => void;
  /** Terms are buttons in the text. On touch layouts they are words, and `TermChips` carries the buttons. */
  inline: boolean;
}

const TermsContext = createContext<Terms | null>(null);

/**
 * Text that may mark glossary terms as `[[key|plain words]]` (or `[[key]]`, which reads as the key): the plain words
 * show with a dotted underline, and a tap opens the term's short definition. Outside a `TermProvider` (or for an
 * unknown key) they are plain words.
 */
export function Rich({ text }: { text: string }) {
  const terms = useContext(TermsContext);
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(TERM)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const def = termOf(m[1]);
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
  if (!terms || terms.inline || !keys.length) return null;
  return (
    <div className="term-chips" role="group" aria-label="Words in this step">
      {keys.map((k) => (
        <button key={k} type="button" className="btn term-chip" aria-haspopup="dialog" onClick={(e) => terms.open(k, e.currentTarget)}>
          {termOf(k)?.name ?? k}
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

  const open = (key: string, from: HTMLElement) => {
    const def = termOf(key);
    const el = pop.current;
    if (!def || !el) return;
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
          <>
            <div className="term-head">
              <h2 id="term-name">{term.name}</h2>
              <button ref={close} type="button" className="btn btn-icon key-close" popoverTarget="term-pop" popoverTargetAction="hide" aria-label="Close">
                <svg viewBox="0 0 16 16" aria-hidden="true" className="stroke">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
            {term.alias && <p className="term-alias">Also called {term.alias}</p>}
            <p className="term-short">{term.short}</p>
            <div className="term-actions">
              {show && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    pop.current?.hidePopover();
                    onShow(show);
                  }}
                >
                  Show me
                </button>
              )}
              <Link href="/glossary" className="term-all">
                Every term
              </Link>
            </div>
          </>
        )}
      </div>
    </TermsContext.Provider>
  );
}
