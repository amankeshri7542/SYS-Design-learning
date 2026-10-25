// What every reader produces before it is a system: named parts and arrows between them, with whatever each format
// said about them. `toDoc` turns it into a `SystemDoc` the way a person would draw it: people in front, a cache in front
// of its database, consumers taking from their queue, copies counted, and it says what it changed.

import { KINDS, MAX_PARTS, article, canSend, idFor, type PartDoc, type PartKind, type Settings, type SystemDoc } from "../doc";
import { kindFromName } from "./infer";

export interface GraphNode {
  name: string;
  kind?: PartKind;
  count?: number;
  /** Requests a second it sends (senders) or receives. */
  rate?: number;
  /** Work per request, ms. */
  ms?: number;
  /** Something outside reaches it directly (a published port, say). */
  public?: boolean;
}

export interface Graph {
  nodes: GraphNode[];
  edges: [string, string][];
}

/** A problem with what was read, tied to its line when it has one. */
export interface ReadError {
  line?: number;
  text: string;
}

export interface Imported {
  doc: SystemDoc | null;
  /** What was read as what ("postgres → Database"), for the person to check. */
  guesses: { name: string; kind: PartKind }[];
  /** What was changed to make a working system, in plain words. */
  notes: string[];
  errors: ReadError[];
}

const joined = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** "api-1", "api_2", "api3" are copies of "api". */
const base = (name: string) => name.replace(/[-_ ]?\d+$/, "");

/** Turn what was read into a system, saying what it changed. */
export function toDoc(g: Graph, name: string): Imported {
  const notes: string[] = [];
  if (!g.nodes.length && !g.edges.length) return { doc: null, guesses: [], notes, errors: [{ text: "Nothing to read: name at least one part." }] };

  // Copies: parts of a kind that can have copies (services, workers, caches, CDNs) whose names differ only by a
  // trailing number become one part with a count. Numbered databases or queues stay apart: they hold different data.
  const nodes = new Map<string, GraphNode>();
  const rename = new Map<string, string>();
  const countable = (n: GraphNode) => ["service", "worker", "cache", "cdn"].includes(n.kind ?? kindFromName(n.name));
  for (const n of g.nodes) {
    const b = base(n.name);
    const siblings = g.nodes.filter((m) => base(m.name) === b);
    if (b !== n.name && siblings.length > 1 && countable(n) && !g.nodes.some((m) => m.name === b)) {
      rename.set(n.name, b);
      const had = nodes.get(b);
      nodes.set(b, { ...n, name: b, count: (had?.count ?? 0) + (n.count ?? 1) });
      if (!had) notes.push(`${siblings.map((m) => m.name).join(", ")} are drawn as one part: ${b} ×${siblings.length}.`);
    } else nodes.set(n.name, { ...nodes.get(n.name), ...n });
  }
  const nameOf = (n: string) => rename.get(n) ?? n;
  /** Parts the reader added, which nobody named. */
  const added = new Set<string>();
  let edges = [...new Set(g.edges.map(([a, b]) => `${nameOf(a)}\u0000${nameOf(b)}`))].map((e) => e.split("\u0000") as [string, string]).filter(([a, b]) => a !== b);
  for (const [a, b] of edges) for (const x of [a, b]) if (!nodes.has(x)) nodes.set(x, { name: x });
  const kind = (n: GraphNode): PartKind => n.kind ?? kindFromName(n.name);
  for (const n of nodes.values()) n.kind = kind(n);
  const into = (x: string) => edges.filter(([, b]) => b === x).map(([a]) => a);
  const outOf = (x: string) => edges.filter(([a]) => a === x).map(([, b]) => b);

  // Consumers: a part nothing calls (and nobody outside reaches) that sends to a queue or topic, beside a sender that
  // is called, takes from it: in a compose file a worker "depends on" its queue the same way the producer does.
  for (const [a, b] of [...edges]) {
    const q = nodes.get(b)!;
    const n = nodes.get(a)!;
    if (q.kind !== "queue" && q.kind !== "topic") continue;
    if (n.public || into(a).length) continue;
    const producer = into(b).some((x) => x !== a && (nodes.get(x)!.public || into(x).length));
    if (!producer && n.kind !== "worker") continue;
    edges = edges.map(([x, y]) => (x === a && y === b ? [b, a] : [x, y]));
    if (n.kind === "service") n.kind = "worker";
    notes.push(`${a} takes jobs from ${b}.`);
  }
  // A service only a queue or topic hands work to is a worker: nobody waits on it for an answer.
  for (const n of nodes.values()) {
    if (n.kind !== "service" || n.public) continue;
    const from = into(n.name).map((x) => nodes.get(x)!.kind);
    if (!from.length || !from.every((k) => k === "queue" || k === "topic")) continue;
    n.kind = "worker";
    notes.push(`${n.name} is drawn as a worker: it takes its work from ${joined(into(n.name))}.`);
  }
  // A cache and a database called by the same part: the cache stands in front of the database.
  for (const n of nodes.values()) {
    const to = outOf(n.name);
    const cache = to.find((t) => nodes.get(t)!.kind === "cache" && !outOf(t).length);
    const db = to.find((t) => nodes.get(t)!.kind === "database");
    if (!cache || !db) continue;
    edges = edges.filter(([x, y]) => !(x === n.name && y === db));
    edges.push([cache, db]);
    notes.push(`${cache} is drawn in front of ${db}: reads ask it first.`);
  }
  // A cache that fetches from nothing gets the first database (or a new one).
  for (const n of nodes.values()) {
    if (n.kind !== "cache" || outOf(n.name).length) continue;
    const db = [...nodes.values()].find((m) => m.kind === "database");
    if (db) edges.push([n.name, db.name]);
  }

  // People: whatever is published, or nothing calls, is what users reach first.
  if (![...nodes.values()].some((n) => n.kind === "users")) {
    const entries = [...nodes.values()].filter((n) => n.kind !== "bots" && (n.public || !into(n.name).length));
    const firsts = entries.length ? entries : [...nodes.values()].slice(0, 1);
    for (const e of firsts) {
      const users = firsts.length === 1 ? "Users" : `${e.name} users`;
      nodes.set(users, { name: users, kind: "users" });
      added.add(users);
      edges.push([users, e.name]);
    }
    notes.push(`Added ${firsts.length === 1 ? "Users" : "users"} sending to ${firsts.map((e) => e.name).join(", ")}.`);
  }
  // A sender talks to one part: in front of several, a load balancer.
  for (const n of [...nodes.values()]) {
    if (n.kind !== "users" && n.kind !== "bots") continue;
    const to = outOf(n.name);
    if (to.length < 2) continue;
    const lb = `${n.name} balancer`;
    nodes.set(lb, { name: lb, kind: "balancer" });
    added.add(lb);
    edges = edges.filter(([x]) => x !== n.name);
    edges.push([n.name, lb], ...to.map((t) => [lb, t] as [string, string]));
    notes.push(`${n.name} send to ${to.join(" and ")}: a load balancer stands in front of them.`);
  }
  // Arrows the engine can't draw (a database calling out) are left out, and said so.
  const dropped = edges.filter(([a, b]) => !canSend(nodes.get(a)!.kind!, nodes.get(b)!.kind!));
  if (dropped.length) {
    edges = edges.filter((e) => !dropped.includes(e));
    for (const [a, b] of dropped) notes.push(`${a} → ${b} is left out: ${article(KINDS[nodes.get(a)!.kind!].name)} doesn't send to ${article(KINDS[nodes.get(b)!.kind!].name)} here.`);
  }

  // Too many parts for one stage: the last ones become one "Other services" part.
  let list = [...nodes.values()];
  if (list.length > MAX_PARTS) {
    const keep = list.slice(0, MAX_PARTS - 1);
    const rest = new Set(list.slice(MAX_PARTS - 1).map((n) => n.name));
    const other = "Other services";
    added.add(other);
    edges = [...new Set(edges.map(([a, b]) => `${rest.has(a) ? other : a}\u0000${rest.has(b) ? other : b}`))].map((e) => e.split("\u0000") as [string, string]).filter(([a, b]) => a !== b);
    list = [...keep, { name: other, kind: "service" }];
    notes.push(`${rest.size} parts are drawn as one, “${other}”: a stage reads best with up to ${MAX_PARTS}.`);
  }

  const ids = new Map<string, string>();
  for (const n of list) ids.set(n.name, idFor(n.name, ids.values()));
  const parts: PartDoc[] = list.map((n) => {
    const to = edges.filter(([a]) => a === n.name).map(([, b]) => ids.get(b)!).filter(Boolean);
    const set: Partial<Settings> = {};
    if (n.rate && (n.kind === "users" || n.kind === "bots")) set.rate = Math.min(400, Math.max(1, Math.round(n.rate)));
    if (n.ms) set.ms = Math.min(5000, Math.max(1, Math.round(n.ms)));
    const counted = n.kind === "service" || n.kind === "worker" || n.kind === "cache" || n.kind === "cdn";
    const part: PartDoc = { id: ids.get(n.name)!, kind: n.kind!, name: n.name.slice(0, 40) };
    if (counted && n.count && n.count > 1) part.count = Math.min(64, n.count);
    if (to.length) part.to = to;
    if (Object.keys(set).length) part.set = set;
    return part;
  });
  return {
    doc: { v: 1, name, parts, targets: { p95Ms: 400, failed: 0.01 } },
    guesses: list.filter((n) => !added.has(n.name) && !g.nodes.some((m) => m.name === n.name && m.kind)).map((n) => ({ name: n.name, kind: n.kind! })),
    notes,
    errors: [],
  };
}

/** What was taken from a name, unless the name already says it ("Load balancer"), as one note (or none). */
export function guessNote(guesses: Imported["guesses"]): string[] {
  const guessed = guesses.filter((g) => g.kind !== "service" && g.kind !== "users" && !g.name.toLowerCase().includes(KINDS[g.kind].name.toLowerCase()));
  return guessed.length
    ? [`Took ${guessed.slice(0, 6).map((g) => `${g.name} for ${article(KINDS[g.kind].name)}`).join(", ")}${guessed.length > 6 ? " and more" : ""}, from what they're called. Change any under “What it is”.`]
    : [];
}
