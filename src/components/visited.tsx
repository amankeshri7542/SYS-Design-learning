"use client";

import { useEffect, useState } from "react";
import { markVisited, readVisited } from "@/lib/progress";
import { record, recordingFor } from "@/lib/record";

/** Records a visit to this page, and starts its learning record: what happens here is noted against it. */
export function MarkVisited({ slug }: { slug: string }) {
  useEffect(() => {
    markVisited(slug);
    if (recordingFor(slug)) record("open");
  }, [slug]);
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
