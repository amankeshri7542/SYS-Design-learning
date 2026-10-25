const KEY = "system-lab:visited:v1";

/** Lessons this browser has opened. A convenience only; missing or blocked storage just means nothing is ticked. */
export function readVisited(): Set<string> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function markVisited(slug: string) {
  try {
    const s = readVisited();
    if (s.has(slug)) return;
    s.add(slug);
    window.localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {
    // Storage unavailable (private mode, blocked): progress simply isn't remembered.
  }
}

/** Forget which lessons this browser has opened. */
export function clearVisited() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
