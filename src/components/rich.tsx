"use client";

import { createContext, useContext, type ReactNode } from "react";
import { TERM } from "@/lib/lessons/term-mark";
import { DefsContext } from "./term-defs";

// Text that may mark glossary terms, as every scene's narration does: apart from the definitions' popover
// (`TermProvider` in `term.tsx`), so a page whose text names no terms carries only this.

export interface Terms {
  open: (key: string, from: HTMLElement) => void;
  /** Terms are buttons in the text. On touch layouts they are words, and `TermChips` carries the buttons. */
  inline: boolean;
}

export const TermsContext = createContext<Terms | null>(null);

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

