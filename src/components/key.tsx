"use client";

import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type { DotKind } from "@/lib/lessons/beats";

// The rows load the first time the Key opens: a page carries only its button and frame until then.
const KeyRows = lazy(() => import("./legend").then((m) => ({ default: m.KeyRows })));

/**
 * The dot vocabulary, opened from a button in the bar. It is a native popover: opening it moves focus to its close
 * button, and Esc, a click outside or the close button shuts it and gives focus back to the Key button.
 */
export function KeyPopover({ dots }: { dots?: DotKind[] }) {
  const pop = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    const el = pop.current;
    if (!el) return;
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState !== "open") return;
      setOpened(true);
      close.current?.focus();
    };
    el.addEventListener("toggle", onToggle);
    return () => el.removeEventListener("toggle", onToggle);
  }, []);
  return (
    <>
      <button type="button" className="btn key-btn" popoverTarget="key-pop">
        Key
      </button>
      <div id="key-pop" ref={pop} className="key-pop" popover="auto" role="dialog" aria-labelledby="key-title">
        <div className="key-head">
          <h2 id="key-title">What the dots mean</h2>
          <button ref={close} type="button" className="btn btn-icon key-close" popoverTarget="key-pop" popoverTargetAction="hide" aria-label="Close the key">
            <svg viewBox="0 0 16 16" aria-hidden="true" className="stroke">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        {opened && (
          <Suspense fallback={null}>
            <KeyRows dots={dots} />
          </Suspense>
        )}
      </div>
    </>
  );
}
