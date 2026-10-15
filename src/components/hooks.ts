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

/** "tall" on phones, "wide" elsewhere, null during server render (both layouts are emitted). */
export function useMode(): Mode | null {
  return useSyncExternalStore(
    narrow.subscribe,
    () => (narrow.get() ? "tall" : "wide"),
    () => null,
  );
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(reducedMotion.subscribe, reducedMotion.get, () => false);
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
