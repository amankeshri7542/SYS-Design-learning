"use client";

import { useEffect, useState } from "react";
import { markVisited, readVisited } from "@/lib/progress";

/** Records a visit to this page: the only progress the site keeps. */
export function MarkVisited({ slug }: { slug: string }) {
  useEffect(() => markVisited(slug), [slug]);
  return null;
}

/**
 * The lessons this browser has opened, in the order it first opened them. Empty on the server and in the first render,
 * so the page hydrates cleanly; `ready` turns true once storage has been read.
 */
export function useVisited() {
  const [state, setState] = useState<{ visited: Set<string>; ready: boolean }>(() => ({ visited: new Set(), ready: false }));
  useEffect(() => setState({ visited: readVisited(), ready: true }), []);
  return state;
}
