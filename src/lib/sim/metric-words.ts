// What each metric's number means, in plain sentences: the metric popover's words. Apart from `metrics.ts`, so a page
// loads them the first time someone opens a metric, not with the table.

import type { Sim } from "./engine/core";
import { betterIs, formatMetric, targetOf, type MetricId, type MetricSpec } from "./metrics";

const SAYS: Record<MetricId, (v: string) => string> = {
  p50: (v) => `Half of all requests are answered within ${v}.`,
  p95: (v) => `The slowest 1 in 20 requests takes ${v} or longer; the rest are faster.`,
  errors: (v) => `${v} of requests failed or gave up waiting.`,
  rejected: (v) => `${v} of requests were turned away on purpose.`,
  stale: (v) => `${v} of answers were out of date.`,
  fallback: (v) => `${v} were answered at once with a fallback instead of waiting.`,
  throughput: (v) => `${v}: answers coming back each second.`,
  hit: (v) => `${v} of reads were answered by the cache, without asking further.`,
  util: (v) => `${v} of the workers are busy. Past about 70%, a line starts to form.`,
  peak: (v) => `The busiest machine is ${v} busy.`,
  load: (v) => `${v} arriving each second.`,
  inRotation: (v) => `${v} servers are getting traffic.`,
  queue: (v) => `${v} waiting in line right now.`,
  servers: (v) => `${v} servers are running, and costing money.`,
  moved: (v) => `${v} of keys changed owner at the last change of members.`,
  amplify: (v) => `${v} attempts for every real request. ×1.0 means retries add no load.`,
  conflicts: (v) => `${v} keys were written on both sides while the link was down.`,
  answered: (v) => `${v} of requests got a real answer in the end.`,
  jobWait: (v) => `The slowest 1 in 20 jobs takes ${v} or longer to finish.`,
  unsynced: (v) => `${v} writes are waiting to be copied across.`,
  p99: (v) => `The slowest 1 in 100 requests takes ${v} or longer; the rest are faster.`,
  wasted: (v) => `${v} of the workers' time went to requests whose caller had already given up.`,
  lost: (v) => `${v} of the messages sent were lost on the way.`,
  availability: (v) => `${v} of requests were answered, and on time, over the long window.`,
  budget: (v) => `${v} of the error budget is left: the misses the target allows before it is broken.`,
  wire: (v) => `${v} on average spent travelling over links.`,
  wait: (v) => `${v} on average spent waiting in line.`,
  work: (v) => `${v} on average spent being worked on.`,
  filtered: (v) => `${v} of lookups were for keys that don't exist, answered by the existence check.`,
  duplicates: (v) => `${v} messages were done a second time in the window.`,
  redelivered: (v) => `${v} jobs were handed out again because no ack came back in time.`,
  deadLettered: (v) => `${v} jobs were given up on and moved to the dead-letter queue.`,
  lostJobs: (v) => `${v} jobs were accepted and then lost, never done.`,
  lostEvents: (v) => `${v} of saved orders never reached the service that needed to hear about them.`,
  reordered: (v) => `${v} jobs finished before an earlier job for the same key.`,
  consumed: (v) => `${v}: jobs finished each second.`,
  connections: (v) => `${v} connections are open right now.`,
  handshakes: (v) => `${v}: new connections opened each second, each a handshake first.`,
  sendWait: (v) => `The slowest 1 in 20 requests waited ${v} or longer at the sender before going out.`,
  window: (v) => `${v} requests may be in flight at once now.`,
  pageMs: (v) => `The slowest 1 in 20 pages takes ${v} or longer to load completely.`,
  pushLag: (v) => `The slowest 1 in 20 news items reaches a user ${v} or more after it was published.`,
  reach: (v) => `${v} of users had each news item a second after it was published.`,
  empty: (v) => `${v} of polls came back with nothing new.`,
  detectMs: (v) => `A dead connection went unnoticed for ${v} or longer (the slowest 1 in 20).`,
  falseAlarms: (v) => `${v} healthy connections were given up on as dead in the window.`,
  lostAcked: (v) => `${v} writes were confirmed to the user and then lost when a replica took over.`,
  missed: (v) => `${v} of users hadn't had each news item a second after it was published.`,
  hedged: (v) => `${v} of the parts sent out were slow enough to be sent again to another copy.`,
  doubleBookings: (v) => `${v} bookings took something someone else had already booked, in the window.`,
  inconsistent: (v) => `${v} orders were left half-done, with earlier steps never undone, in the window.`,
  leaderless: (v) => `${v} of the time, the group had no leader to take writes.`,
  term: (v) => `Term ${v}: the number of elections the group has held.`,
  lateDropped: (v) => `${v} of events arrived after their window had closed, and were never counted.`,
  windowLag: (v) => `A window's counts were written ${v} after it opened: its length, plus the wait for late events.`,
  lostWrites: (v) => `${v} writes were confirmed and then lost in a crash, in the window.`,
  unsaved: (v) => `${v} writes are confirmed but not yet saved to the database: a crash now would lose them.`,
  uncounted: (v) => `${v} of events were answered but never counted: too late for their window, or lost in a crash.`,
};

/**
 * The number read as plain sentences: what it says right now, what it is judged against, and over how much time it is
 * measured (which is why it lags the scene a little).
 */
export function explainMetric(m: MetricSpec, v: number | null, sim: Sim): string[] {
  const now = v === null ? "Nothing has been measured yet." : (m.explain?.(v, sim) ?? SAYS[m.id](formatMetric(m, v)));
  const target = targetOf(m, sim.spec.sloMs);
  const onScreen = sim.windowMs / (sim.spec.timeScale ?? 0.1) / 1000;
  return [
    now,
    ...(target === null ? [] : [`The target is ${formatMetric(m, target)} or ${betterIs(m) === "high" ? "more" : "less"}.`]),
    `Averaged over the last ${sim.windowMs} ms, which is ${Number.isInteger(onScreen) ? onScreen : onScreen.toFixed(1)} s on screen at 1×.`,
  ];
}
