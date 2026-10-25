// Changes to a system, as pure functions from one doc to the next: the builder's buttons call these, and the tests
// check each leaves a doc that still compiles. Adding a part puts it where it usually goes, wired in, so one tap gives a
// working system; the arrows can be changed afterwards.

import { KINDS, canSend, idFor, type PartDoc, type PartKind, type Settings, type SystemDoc } from "./doc";

const withParts = (doc: SystemDoc, parts: PartDoc[]): SystemDoc => ({ ...doc, parts });
const senders = (doc: SystemDoc) => doc.parts.filter((p) => p.kind === "users" || p.kind === "bots");

/** A name not yet used: "Cache", then "Cache 2". */
function nameFor(doc: SystemDoc, base: string): string {
  const names = new Set(doc.parts.map((p) => p.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

/** Point every arrow into `from` at `to` instead (for parts of kinds that may send to `to`). */
function reroute(parts: PartDoc[], from: string, to: PartDoc, except: string[] = []): PartDoc[] {
  return parts.map((p) =>
    except.includes(p.id) || !p.to?.includes(from) || !canSend(p.kind, to.kind) ? p : { ...p, to: [...new Set(p.to.map((t) => (t === from ? to.id : t)))] },
  );
}

/**
 * Whether a part of this kind has somewhere to go in this system: a balancer, limiter, DNS or CDN needs something in
 * front of which it can stand; a worker needs a queue or topic to take from. The menu offers only these.
 */
export function canAdd(doc: SystemDoc, kind: PartKind): boolean {
  if (kind === "worker") return doc.parts.some((p) => p.kind === "queue" || p.kind === "topic");
  if (kind === "balancer" || kind === "limiter" || kind === "dns" || kind === "cdn") {
    let target = doc.parts.find((p) => p.id === senders(doc)[0]?.to?.[0]);
    for (let hops = 0; target && !canSend(kind, target.kind) && hops < doc.parts.length; hops++) target = doc.parts.find((p) => p.id === target!.to?.[0]);
    return !!target;
  }
  return true;
}

/**
 * Add a part of this kind where it usually goes, wired in:
 * - a cache in front of the first database (its callers ask the cache; the cache asks the database);
 * - a load balancer, rate limiter, DNS or CDN in front of whatever the users talk to first;
 * - a queue after the first service, with a worker taking its jobs; a topic likewise, with a listener;
 * - a database, an outside service or another service called by the first service (or worker);
 * - users or bots sending to wherever the first users do.
 * Returns the new doc and the id of the part to show.
 */
export function addPart(doc: SystemDoc, kind: PartKind): { doc: SystemDoc; id: string } {
  const ids = () => doc.parts.map((p) => p.id);
  const make = (k: PartKind, extra: Partial<PartDoc> = {}): PartDoc => {
    const name = nameFor(doc, KINDS[k].name);
    return { id: idFor(name, ids()), kind: k, name, ...extra };
  };
  const firstOf = (...kinds: PartKind[]) => doc.parts.find((p) => kinds.includes(p.kind));
  const entry = senders(doc)[0]?.to?.[0];
  const caller = firstOf("service", "worker");

  switch (kind) {
    case "cache": {
      const db = firstOf("database");
      const part = make("cache", { to: db ? [db.id] : [] });
      let parts = [...doc.parts, part];
      if (db) parts = reroute(parts, db.id, part, [part.id]);
      else if (caller) parts = parts.map((p) => (p === caller ? { ...p, to: [...(p.to ?? []), part.id] } : p));
      if (!db) {
        // A cache needs somewhere to fetch from: give it a database.
        const store = { id: idFor("Database", parts.map((p) => p.id)), kind: "database" as const, name: nameFor({ ...doc, parts }, "Database") };
        parts = [...parts.map((p) => (p.id === part.id ? { ...p, to: [store.id] } : p)), store];
      }
      return { doc: withParts(doc, parts), id: part.id };
    }
    case "balancer":
    case "limiter":
    case "dns":
    case "cdn": {
      // In front of what the users talk to, or the first part along from it that this kind can send to.
      let target = doc.parts.find((p) => p.id === entry);
      for (let hops = 0; target && !canSend(kind, target.kind) && hops < doc.parts.length; hops++) target = doc.parts.find((p) => p.id === target!.to?.[0]);
      const part = make(kind, { to: target ? [target.id] : [] });
      if (!target) return { doc: withParts(doc, [...doc.parts, part]), id: part.id };
      const parts = [...doc.parts.map((p) => ((p.kind === "users" || p.kind === "bots") && p.to?.[0] === entry ? { ...p, to: [part.id] } : p)), part];
      return { doc: withParts(doc, parts), id: part.id };
    }
    case "queue":
    case "topic": {
      const part = make(kind);
      const worker = make("worker");
      part.to = [worker.id];
      const parts = [...doc.parts.map((p) => (p === caller ? { ...p, to: [...(p.to ?? []), part.id] } : p)), part, worker];
      return { doc: withParts(doc, parts), id: part.id };
    }
    case "worker": {
      const feed = firstOf("queue", "topic");
      const part = make("worker");
      const parts = [...doc.parts.map((p) => (p === feed ? { ...p, to: [...(p.to ?? []), part.id] } : p)), part];
      return { doc: withParts(doc, parts), id: part.id };
    }
    case "users":
    case "bots": {
      const part = make(kind, { to: entry ? [entry] : [] });
      return { doc: withParts(doc, [...doc.parts, part]), id: part.id };
    }
    default: {
      // A database, an outside service or another service: called by the first service (or worker); a first service
      // is what the users talk to.
      const part = make(kind);
      let parts = [...doc.parts, part];
      if (caller) parts = parts.map((p) => (p === caller ? { ...p, to: [...(p.to ?? []), part.id] } : p));
      else if (kind === "service") parts = parts.map((p) => ((p.kind === "users" || p.kind === "bots") && !p.to?.length ? { ...p, to: [part.id] } : p));
      return { doc: withParts(doc, parts), id: part.id };
    }
  }
}

/**
 * Remove a part. Whatever sent to it sends on to what it sent to, where that is allowed (taking a balancer away leaves
 * the users talking to the servers), so the system keeps working where it can.
 */
export function removePart(doc: SystemDoc, id: string): SystemDoc {
  const gone = doc.parts.find((p) => p.id === id);
  if (!gone) return doc;
  const parts = doc.parts
    .filter((p) => p.id !== id)
    .map((p) => {
      if (!p.to?.includes(id)) return p;
      const onward = (gone.to ?? []).filter((t) => t !== p.id && canSend(p.kind, doc.parts.find((q) => q.id === t)?.kind ?? "users"));
      const single = p.kind === "users" || p.kind === "bots" || p.kind === "limiter" || p.kind === "cache" || p.kind === "cdn";
      const to = [...new Set(p.to.flatMap((t) => (t === id ? onward : [t])))];
      return { ...p, to: single ? to.slice(0, 1) : to };
    });
  return withParts(doc, parts);
}

/** Change one part: its name, its count, or its settings (merged). A new name keeps the id, so arrows stay. */
export function updatePart(doc: SystemDoc, id: string, change: { name?: string; count?: number; set?: Partial<Settings> }): SystemDoc {
  return withParts(
    doc,
    doc.parts.map((p) => {
      if (p.id !== id) return p;
      const next: PartDoc = { ...p };
      if (change.name !== undefined) next.name = change.name.slice(0, 40);
      if (change.count !== undefined) next.count = Math.max(1, Math.round(change.count));
      if (change.set) next.set = { ...p.set, ...change.set };
      return next;
    }),
  );
}

/** Add or remove one arrow. Senders that talk to one part only (users, limiters, caches) swap theirs. */
export function toggleLink(doc: SystemDoc, from: string, to: string): SystemDoc {
  return withParts(
    doc,
    doc.parts.map((p) => {
      if (p.id !== from) return p;
      const has = p.to?.includes(to);
      if (has) return { ...p, to: p.to!.filter((t) => t !== to) };
      const single = p.kind === "users" || p.kind === "bots" || p.kind === "limiter" || p.kind === "cache" || p.kind === "cdn";
      return { ...p, to: single ? [to] : [...(p.to ?? []), to] };
    }),
  );
}

/** The parts a part may send to: every other part of a kind it can send to. */
export function targetsFor(doc: SystemDoc, id: string): PartDoc[] {
  const p = doc.parts.find((x) => x.id === id);
  return p ? doc.parts.filter((q) => q.id !== id && canSend(p.kind, q.kind)) : [];
}

/** The parts in the order a request meets them: breadth first from the senders, then any nothing reaches. */
export function flowOrder(doc: SystemDoc): PartDoc[] {
  const seen = new Set<string>();
  const out: PartDoc[] = [];
  const queue = [...senders(doc)];
  while (queue.length) {
    const p = queue.shift()!;
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
    for (const t of p.to ?? []) {
      const q = doc.parts.find((x) => x.id === t);
      if (q && !seen.has(q.id)) queue.push(q);
    }
  }
  return [...out, ...doc.parts.filter((p) => !seen.has(p.id))];
}
