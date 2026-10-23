"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Mode } from "@/lib/sim/layout";

function media(query: string) {
  return {
    subscribe(cb: () => void) {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    get: () => window.matchMedia(query).matches,
  };
}

const narrow = media("(max-width: 640px)");
const reducedMotion = media("(prefers-reduced-motion: reduce)");
/** The touch layouts of globals.css (phones, and anything with a coarse pointer): every control there is 40px or more. */
const touch = media("(pointer: coarse), (max-width: 760px), (orientation: landscape) and (max-height: 520px)");

/** A first guess before the stage measures its box: "compact" on phones, "wide" elsewhere, null on the server. */
export function useMode(): Mode | null {
  return useSyncExternalStore(
    narrow.subscribe,
    () => (narrow.get() ? "compact" : "wide"),
    () => null,
  );
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(reducedMotion.subscribe, reducedMotion.get, () => false);
}

/** True on touch layouts, where small inline targets give way to 40px ones. */
export function useTouch(): boolean {
  return useSyncExternalStore(touch.subscribe, touch.get, () => false);
}

/** True while the element is (nearly) on screen. */
export function useVisible<T extends Element>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "120px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, visible] as const;
}
