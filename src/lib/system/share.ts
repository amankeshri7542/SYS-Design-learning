// Keeping and sharing a system without a server: the last few are saved in this browser, and a link carries one in its
// fragment (the part after #, which browsers never send anywhere), compressed when the browser can.

import { normalize, type SystemDoc } from "./doc";

const SAVED = "syslab.v1.systems";
/** The most systems kept: the oldest go first. */
export const MAX_SAVED = 12;

export interface Saved {
  id: string;
  /** When it was last saved, in whole seconds. */
  t: number;
  doc: SystemDoc;
}

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** A doc as the text after `#s=`: "1." and deflated JSON, or "0." and plain JSON where compression isn't available. */
export async function encodeDoc(doc: SystemDoc): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(doc));
  if (typeof CompressionStream === "function") return `1.${toBase64Url(await pipe(json, new CompressionStream("deflate-raw")))}`;
  return `0.${toBase64Url(json)}`;
}

/** The doc a link carries, made safe (`normalize`); null for anything that isn't one. */
export async function decodeDoc(text: string): Promise<SystemDoc | null> {
  try {
    const [v, body] = [text.slice(0, 2), text.slice(2)];
    const bytes = fromBase64Url(body);
    const json = v === "1." ? await pipe(bytes, new DecompressionStream("deflate-raw")) : v === "0." ? bytes : null;
    return json ? normalize(JSON.parse(new TextDecoder().decode(json))) : null;
  } catch {
    return null;
  }
}

/** The systems saved in this browser, newest first. */
export function savedSystems(): Saved[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SAVED) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((s: { id?: unknown; t?: unknown; doc?: unknown }) => ({ id: String(s.id), t: Number(s.t) || 0, doc: normalize(s.doc) }))
      .filter((s): s is Saved => !!s.doc)
      .sort((a, b) => b.t - a.t);
  } catch {
    return [];
  }
}

/** Save a system under its id (a new one gets an id): it becomes the newest. */
export function saveSystem(doc: SystemDoc, id?: string): string {
  const key = id ?? `s${Date.now().toString(36)}`;
  try {
    const rest = savedSystems().filter((s) => s.id !== key);
    const list = [{ id: key, t: Math.floor(Date.now() / 1000), doc }, ...rest].slice(0, MAX_SAVED);
    window.localStorage.setItem(SAVED, JSON.stringify(list));
  } catch {
    // Storage unavailable: the system still runs, it just isn't kept.
  }
  return key;
}

export function removeSystem(id: string) {
  try {
    window.localStorage.setItem(SAVED, JSON.stringify(savedSystems().filter((s) => s.id !== id)));
  } catch {
    // Nothing to remove.
  }
}
