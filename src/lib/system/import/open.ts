// Opening what someone described: read it (`read.ts`), size it to start healthy (`size.ts`), and say what was guessed.
// Loaded when "Open it" is pressed, so the gallery and a shared link carry none of it.

import type { SystemDoc } from "../doc";
import { guessNote, type ReadError } from "./graph";
import { readSystem } from "./read";
import { sized } from "./size";

export async function openSystem(text: string, name = "My system"): Promise<{ doc: SystemDoc | null; notes: string[]; errors: ReadError[] }> {
  const r = readSystem(text, undefined, name);
  if (!r.doc || r.errors.length) return { doc: null, notes: [], errors: r.errors };
  // Sized on a headless run, so it opens healthy.
  const s = await sized(r.doc);
  return { doc: s.doc, notes: [...guessNote(r.guesses), ...r.notes, ...s.notes], errors: [] };
}
