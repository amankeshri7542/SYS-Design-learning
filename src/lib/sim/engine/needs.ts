import type { SceneSpec } from "../types";

/**
 * The engine's optional modules: the core (clients, routing, caches, databases, work, transport, control) is always
 * there; these load only for the scenes that use them, so a page carries only what its lesson needs.
 */
export type ModuleName = "connections" | "realtime" | "gather" | "elections" | "bookings" | "storage";

/** The optional modules a scene uses: the features in its spec that call into each. */
export function needsOf(spec: SceneSpec): ModuleName[] {
  const out: ModuleName[] = [];
  const any = (f: (n: SceneSpec["nodes"][number]) => unknown) => spec.nodes.some((n) => !!f(n));
  if (any((n) => n.connect || n.maxConns !== undefined || n.client?.window || n.advertise)) out.push("connections");
  if (any((n) => n.client?.subscribe || n.client?.poll || n.client?.news || n.hold || n.feed)) out.push("realtime");
  // A cluster leader commits by gathering its followers' copies.
  // A traced scene's routes are picked there, and their calls made at the same time gathered back.
  if (any((n) => n.fanout || n.hedgeMs || n.quorum || n.cluster || n.paths || n.client?.routes)) out.push("gather");
  if (any((n) => n.cluster)) out.push("elections");
  if (any((n) => n.lock || n.reserve || n.saga)) out.push("bookings");
  if (any((n) => n.window || n.writeMode === "behind")) out.push("storage");
  return out;
}
