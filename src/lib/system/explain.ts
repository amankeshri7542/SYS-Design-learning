// "Explain like I'm new": a system's tour as beats, one part at a time along the way a request travels, each pointing
// at its station. Written from the doc, so it describes the system someone built, in the course's own plain words.

import type { Beat } from "../lessons/beats";
import type { Compiled } from "./compile";
import { settingsOf, type PartDoc, type SystemDoc } from "./doc";

const list = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);
const msText = (v: number) => (v < 1000 ? `${Math.round(v)} ms` : `${+(v / 1000).toFixed(1)} s`);

/** One sentence for a part, as it is set up in this system. */
function lineOf(p: PartDoc, doc: SystemDoc): string {
  const s = settingsOf(p);
  const to = (p.to ?? []).map((t) => doc.parts.find((q) => q.id === t)).filter((q): q is PartDoc => !!q);
  const names = to.map((q) => q.name);
  const copies = p.count ?? 1;
  switch (p.kind) {
    case "users":
      return `${p.name} send about ${s.rate} requests a second. Each moving dot is one.`;
    case "bots":
      return `${p.name}: a program sending ${s.rate} a second. Watch where its requests stop.`;
    case "balancer": {
      const n = to.reduce((sum, q) => sum + (q.count ?? 1), 0);
      return n > 1 ? `${p.name} spreads requests over ${n} copies of ${list(names)}.` : `${p.name} picks where each request goes.`;
    }
    case "dns":
      return `${p.name} sends each user to the nearest place that's up.`;
    case "limiter":
      return `${p.name} lets each sender through at ${s.rps} a second and turns the rest away.`;
    case "cdn":
      return `${p.name} keeps copies near its users; only what it lacks goes on to ${list(names)}.`;
    case "service":
      return `${p.name}${copies > 1 ? ` (${copies} copies)` : ""}: ${s.workers} workers, about ${msText(s.ms)} a request${names.length ? `, asking ${list(names)}` : ""}.`;
    case "worker":
      return `${p.name} does jobs in the background${names.length ? `, calling ${list(names)}` : ""}. Nobody waits for it.`;
    case "external":
      return `${p.name} is someone else's service, about ${msText(s.ms)} a call. You can't make it faster.`;
    case "cache":
      return `${p.name} answers repeats from memory; only misses go on to ${list(names)}.`;
    case "database":
      return `${p.name} keeps the data${s.shards > 1 ? `, split across ${s.shards} shards` : s.replicas ? `, with ${s.replicas} read ${s.replicas === 1 ? "copy" : "copies"}` : ""}. Often the slowest step.`;
    case "queue":
      return `${p.name} holds jobs until a worker is free, so whoever sent them needn't wait.`;
    case "topic":
      return `${p.name} copies each message to ${list(names)}.`;
  }
}

/**
 * The tour: each part once, in the order a request meets them (breadth first from the senders, along each part's
 * arrows), then where to look and what to try. At most nine beats.
 */
export function explainBeats(doc: SystemDoc, c: Compiled): Beat[] {
  const seen = new Set<string>();
  const order: PartDoc[] = [];
  const queue = doc.parts.filter((p) => p.kind === "users" || p.kind === "bots");
  while (queue.length) {
    const p = queue.shift()!;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    order.push(p);
    for (const t of p.to ?? []) {
      const q = doc.parts.find((x) => x.id === t);
      if (q && !seen.has(q.id)) queue.push(q);
    }
  }
  const beats: Beat[] = order.slice(0, 8).map((p, i) => ({
    id: `part-${p.id}`,
    when: i === 0 ? { at: 200 } : { wait: 0 },
    text: lineOf(p, doc),
    focus: { nodes: c.stations.get(p.id) ?? [p.id] },
  }));
  beats.push({ id: "try", when: { wait: 0 }, text: "Tap any part's name for more. Then crash one: what breaks?" });
  return beats;
}
