"use client";

import { createContext, useMemo, type ReactNode } from "react";
import type { Term } from "@/lib/glossary";

/**
 * The definitions of the terms a page's text marks. The glossary itself stays on the server: the page sends these. On
 * its own, so the page carries only this provider until the player (and `term.tsx`) arrive.
 */
export const DefsContext = createContext<ReadonlyMap<string, Term>>(new Map());

export function TermDefs({ terms, children }: { terms: Term[]; children: ReactNode }) {
  const defs = useMemo(() => new Map(terms.map((t) => [t.key, t])), [terms]);
  return <DefsContext.Provider value={defs}>{children}</DefsContext.Provider>;
}
