// What "it dies" means for a part, shared by "What breaks" (`blast.ts`) and the builder's crash menu, so both take down
// the same stations.

import { DRAWN, type Compiled } from "./compile";
import { settingsOf, type PartDoc, type SystemDoc } from "./doc";

/**
 * What "it dies" means for a part: one of its copies, a database's main copy (its read copies and failover are the
 * point), one shard; otherwise the whole part. A part drawn as one station for many copies loses one copy's workers
 * (a changed doc, here; the builder's crash takes the station down, all copies at once).
 */
export function outage(p: PartDoc, c: Compiled, doc: SystemDoc): { what: string; down: string[]; doc?: SystemDoc } {
  const ids = c.stations.get(p.id) ?? [];
  const count = p.count ?? 1;
  const s = settingsOf(p);
  if (count > DRAWN) return { what: `one of ${count} ${p.name} copies`, down: [], doc: { ...doc, parts: doc.parts.map((q) => (q === p ? { ...q, count: count - 1 } : q)) } };
  if (count > 1) return { what: `one of ${count} ${p.name} copies`, down: [ids[0]] };
  if (p.kind === "database" && s.shards > 1) return { what: `one of ${p.name}'s ${s.shards} shards`, down: [`${p.id}-1`] };
  if (p.kind === "database" && s.replicas > 0) return { what: `${p.name}'s main copy`, down: [p.id] };
  return { what: p.name, down: ids };
}
