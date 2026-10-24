import { hashStr, mix } from "../rng";
import type { NodeSpec } from "../types";

/** How many keys a membership change is measured over (the share of keys that moved). */
export const SAMPLE_KEYS = 1000;

export function sameTargets(a: NodeSpec, b: NodeSpec) {
  return JSON.stringify(a.to) === JSON.stringify(b.to) && a.algo === b.algo;
}

const rings = new Map<string, { at: number; id: string }[]>();

/** Which target owns a key: plain modulo, or a consistent-hash ring with virtual nodes. */
export function ownerOf(key: number, targets: string[], algo: NodeSpec["algo"]): string {
  const h = mix(key + 1);
  if (algo !== "ring") return targets[h % targets.length];
  const sig = targets.join("|");
  let ring = rings.get(sig);
  if (!ring) {
    ring = [];
    for (const id of targets)
      for (let v = 0; v < 64; v++) ring.push({ at: mix(hashStr(id) ^ Math.imul(v + 1, 0x9e3779b1)), id });
    ring.sort((a, b) => a.at - b.at);
    rings.set(sig, ring);
  }
  let lo = 0;
  let hi = ring.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ring[mid].at < h) lo = mid + 1;
    else hi = mid;
  }
  return ring[lo % ring.length].id;
}
