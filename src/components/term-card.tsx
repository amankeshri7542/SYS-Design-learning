"use client";

import Link from "next/link";
import { useEffect, type RefObject } from "react";
import type { Focus } from "@/lib/lessons/beats";
import type { Term } from "@/lib/glossary";

/** A term's definition in its popover (`TermProvider`): its name, other names, a short definition and "Show me". */
export default function TermCard({
  term,
  show,
  onShow,
  close,
  pop,
}: {
  term: Term;
  show: Focus | null;
  onShow: (f: Focus) => void;
  close: RefObject<HTMLButtonElement | null>;
  pop: RefObject<HTMLDivElement | null>;
}) {
  // The first time, the popover opened before this card had loaded: focus moves into it now.
  useEffect(() => {
    if (pop.current?.matches(":popover-open")) close.current?.focus();
  }, [pop, close]);
  return (
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
  );
}
