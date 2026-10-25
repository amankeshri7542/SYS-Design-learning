"use client";

import { useEffect } from "react";

/** Marks the document once React has taken over the page: the browser tests wait for it before they click. */
export function Hydrated() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "";
  }, []);
  return null;
}
