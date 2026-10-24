import { Sim } from "./engine";
import type { SceneSpec } from "./types";

// Checks on a running simulation, for the tests only (nothing in the app imports this file): every logical request
// accounted for, nothing held by a request that has ended, and the traffic a scene sends.

/**
 * Logical requests sent, against those recorded plus those still on their way: a request in flight, one waiting to be
 * retried, or the answer a server sent in place of a call it gave up on (the ghost it left behind is not counted).
 * Needs a window that forgets nothing (`windowMs: 1e9`), or old answers fall out of `done`.
 */
export function accounted(sim: Sim) {
  const live = sim.reqs.filter((r) => r.phase !== "gone" && !r.abandoned && !r.detached && !r.orphanAt && r.op !== "probe").length;
  return { sent: sim.logical.count(sim.t), done: sim.done.length, live: live + sim.retrying.length };
}

/**
 * What is wrong with the books right now, as sentences; empty when nothing is. A request sits only in a container that
 * fits its phase, no worker is held by a request that has ended, no node uses more workers than it has, each node's
 * count of requests on their way to it matches the requests travelling there, and no balancer's count is negative.
 */
export function leakedHolds(sim: Sim): string[] {
  const out: string[] = [];
  const coming = new Map<string, number>();
  for (const r of sim.reqs) if (r.phase === "travel" && r.dir === 1) coming.set(r.to, (coming.get(r.to) ?? 0) + 1);
  for (const n of sim.list) {
    const at = `${sim.t} ms, ${n.spec.id}`;
    if (sim.holds(n).some((r) => r.phase === "gone")) out.push(`${at}: holds a request that has ended`);
    if (n.queue.some((r) => r.phase !== "wait")) out.push(`${at}: a request in line that isn't waiting`);
    if (n.work.some((r) => r.phase !== "work")) out.push(`${at}: a request being served that isn't working`);
    if (n.spec.slots && n.work.length + n.held.length > n.spec.slots) out.push(`${at}: ${n.work.length + n.held.length} workers busy of ${n.spec.slots}`);
    if (n.incoming !== (coming.get(n.spec.id) ?? 0)) out.push(`${at}: expects ${n.incoming} on their way, ${coming.get(n.spec.id) ?? 0} are`);
    for (const [id, k] of n.out) if (k < 0) out.push(`${at}: ${k} outstanding to ${id}`);
  }
  return out;
}

/** The first attempts a scene's clients send in its first `ms`: when, from which client, for which key, which op, at what cost. */
export function arrivalTrace(spec: SceneSpec, ms = 5000) {
  const sim = new Sim(spec, { trace: true });
  sim.step(ms);
  return sim.trace;
}
