// What each station on the stage is, in plain words: the card its name opens (`part-card.tsx`). Apart from the stage,
// so a page loads them the first time someone opens one. The server page also reads `conceptOf`, to send the page the
// lessons its cards point to (`PageNav.learn`), so the catalog never reaches the page.

import { defaultsOf, type FigureDef } from "../lessons/types";
import type { View } from "./describe";
import type { NodeRt, Sim } from "./engine/core";
import type { NodeSpec, SceneSpec } from "./types";

export interface Concept {
  /** The name people use. */
  name: string;
  /** What it is: ≤20 plain words. */
  text: string;
  /** The lesson that teaches it. */
  learn?: string;
}

const C = {
  users: { name: "Users", text: "Where the traffic starts: people, or apps acting for them. Each one waits for its answers.", learn: "request-and-response" },
  sender: { name: "Sender", text: "A program sending messages to another, and hearing back as each one arrives.", learn: "acknowledgements" },
  bot: { name: "Bot", text: "A program sending requests far faster than any person. Left unchecked, it crowds out real users.", learn: "rate-limiting" },
  browser: { name: "Browser", text: "The user's side. It opens connections to servers and sends its requests over them.", learn: "handshakes-and-keep-alive" },
  limiter: { name: "Rate limiter", text: "Lets each client send only so many requests a second, and turns the rest away at once.", learn: "rate-limiting" },
  waitingRoom: { name: "Waiting room", text: "Lets people in at a steady rate, so the system behind it is never flooded.", learn: "rate-limiting" },
  topic: { name: "Topic", text: "Hands a copy of every message to each subscriber. Senders never need to know who listens.", learn: "publish-subscribe" },
  queue: { name: "Queue", text: "Holds jobs in line until a worker is free, so whoever sent them doesn't have to wait.", learn: "message-queues" },
  dlq: { name: "Dead-letter queue", text: "Where jobs go after failing too many times: set aside, so they stop blocking the rest.", learn: "dead-letter-queues" },
  partition: { name: "Partition", text: "One ordered lane of a log. One consumer reads it, so its messages stay in order.", learn: "partitioned-logs" },
  log: { name: "Log", text: "Keeps messages in the order they came, for readers to take at their own pace.", learn: "partitioned-logs" },
  broker: { name: "Message broker", text: "Takes in events and holds them until the services that want them have them.", learn: "outbox" },
  frontier: { name: "Crawl frontier", text: "The list of pages still to fetch. Fetchers take from it, and add the links they find.", learn: "message-queues" },
  lb: { name: "Load balancer", text: "Spreads incoming requests across several servers, so no single one takes all the traffic.", learn: "load-balancing" },
  sticky: { name: "Sticky balancer", text: "Sends each user to the same server every time, by hashing who they are.", learn: "stateless-vs-stateful" },
  writer: { name: "Writer endpoint", text: "The one address every write goes to. It passes each one on to the primary database.", learn: "failover" },
  autoscaler: { name: "Autoscaler", text: "Watches how busy the servers are, and adds or removes servers to match.", learn: "autoscaling" },
  canary: { name: "Canary balancer", text: "Sends a small share of traffic to a new version, and pulls it back if it fails.", learn: "canary-rollouts" },
  l4: { name: "Layer 4 balancer", text: "Picks a server once per connection, without ever reading the requests inside it.", learn: "l4-vs-l7" },
  gateway: { name: "API gateway", text: "Reads each request and sends it to the service that handles its path or type.", learn: "l4-vs-l7" },
  partitioner: { name: "Partitioner", text: "Sends every message with the same key to the same place, so they stay in order.", learn: "partitioned-logs" },
  geo: { name: "Geo routing", text: "Sends each user to the nearest region that is healthy, and to another when it isn't.", learn: "nearest-region-and-failover" },
  ring: { name: "Hash ring", text: "Places servers and keys on a circle: each key goes to the next server along it.", learn: "consistent-hashing" },
  shardRouter: { name: "Shard router", text: "Works out which shard holds a key, and sends the request there.", learn: "sharding" },
  router: { name: "Router", text: "Passes traffic along the network toward where it is going. Everything through it shares its links.", learn: "congestion-control" },
  cache: { name: "Cache", text: "Keeps copies of recent answers in fast memory, so repeat reads skip the slow trip.", learn: "caching" },
  edge: { name: "CDN edge", text: "A cache in the users' own region, so answers don't have to cross the world.", learn: "cdn" },
  resolver: { name: "DNS resolver", text: "Looks names up for you, asking DNS servers in turn, and remembers the answers a while.", learn: "dns" },
  member: { name: "Cluster member", text: "One copy in a group that elects a leader. Only the leader takes writes.", learn: "leader-election" },
  follower: { name: "Follower copy", text: "A copy that passes writes to its leader, and refuses them when it can't reach it.", learn: "consistency-vs-availability" },
  leaderDb: { name: "Leader copy", text: "The one copy that takes writes. The other copies pass theirs to it.", learn: "leader-election" },
  region: { name: "Regional database", text: "A database in one region that copies its writes to a database in another.", learn: "consistency-vs-availability" },
  replica: { name: "Read replica", text: "A copy of the database that answers reads. Each write reaches it a moment late.", learn: "read-replicas" },
  sessionStore: { name: "Session store", text: "One shared store of every user's session, so any server can serve any user.", learn: "stateless-vs-stateful" },
  shard: { name: "Shard", text: "One slice of the data. Each key lives on exactly one shard.", learn: "sharding" },
  primary: { name: "Primary database", text: "The copy that takes every write, and passes each one on to the replicas.", learn: "read-replicas" },
  casDb: { name: "Compare-and-set database", text: "Refuses a write if the value changed since it was read, so two bookings can't both win.", learn: "locks-and-double-booking" },
  outboxDb: { name: "Database with an outbox", text: "Saves each change and the event announcing it together, then sends the event on.", learn: "outbox" },
  ledger: { name: "Ledger", text: "The record of every charge. A charge done twice shows up here twice.", learn: "idempotency" },
  db: { name: "Database", text: "Stores the data that must last. Slower than a cache, and the source of truth.", learn: "indexes" },
  worker: { name: "Worker", text: "Takes jobs and does them in the background. Nobody waits for its answer.", learn: "message-queues" },
  dnsServer: { name: "DNS server", text: "Answers one step of a name lookup: the next server to ask, or the address itself.", learn: "dns" },
  stream: { name: "Stream processor", text: "Counts events as they arrive, in windows of time, and writes each window's totals once it closes.", learn: "stream-windows" },
  lock: { name: "Lock service", text: "Lets one request at a time change a key. The rest wait their turn.", learn: "locks-and-double-booking" },
  coordinator: { name: "Quorum coordinator", text: "Writes to several copies and reads from several, so every read overlaps the latest write.", learn: "quorums" },
  saga: { name: "Saga orchestrator", text: "Runs a many-step order one step at a time, and undoes the done steps if one fails.", learn: "sagas" },
  booking: { name: "Booking service", text: "Checks a seat or a driver is still free, then books it. Two at once can both see it free.", learn: "locks-and-double-booking" },
  aggregator: { name: "Scatter-gather server", text: "Asks many shards at once and combines their answers. It is only as fast as the slowest.", learn: "hedged-requests" },
  push: { name: "Push server", text: "Keeps a connection open to each user, and sends news down it the moment it arrives.", learn: "push-vs-poll" },
  feed: { name: "Polled server", text: "Answers each user's regular “anything new?” with the latest news, even when nothing changed.", learn: "push-vs-poll" },
  flowReceiver: { name: "Receiver", text: "Takes in data, and tells the sender how much more room it has.", learn: "windows-and-flow-control" },
  receiver: { name: "Receiver", text: "Takes each message and sends back a small note, an ack, to say it arrived.", learn: "acknowledgements" },
  payments: { name: "Payment provider", text: "Charges the card. A repeated request could charge it twice, unless the provider remembers it.", learn: "idempotency" },
  stateful: { name: "Stateful server", text: "Keeps each user's session in its own memory, so that user is tied to it.", learn: "stateless-vs-stateful" },
  canaryServer: { name: "Canary server", text: "Runs the new version first, on a small share of traffic, so a bad release hurts few users.", learn: "canary-rollouts" },
  origin: { name: "Origin server", text: "Where the real content lives. Caches near the users ask it only for what they lack.", learn: "cdn" },
  regionServer: { name: "Region", text: "A whole copy of the service in one part of the world. Users near it get quick answers.", learn: "nearest-region-and-failover" },
  web: { name: "Other people's servers", text: "The sites being fetched: servers you don't run, each slow or quick in its own way.", learn: "timeouts-and-deadlines" },
  shardServer: { name: "Shard", text: "One server holding one slice of the data. A request may need every shard's answer.", learn: "hedged-requests" },
  server: { name: "Server", text: "A machine running the app's code. Each of its workers handles one request at a time.", learn: "latency-and-throughput" },
} satisfies Record<string, Concept>;

export type ConceptKey = keyof typeof C;
export const CONCEPTS: Readonly<Record<ConceptKey, Concept>> = C;

/** Whether `n` sends only to stations of these kinds (a balancer in front of servers, say). */
const sendsTo = (n: NodeSpec, spec: SceneSpec, kinds: string[]) => {
  const to = (n.to ?? []).flat();
  return to.length > 0 && to.every((id) => kinds.includes(spec.nodes.find((x) => x.id === id)?.kind ?? ""));
};

/** Which concept a station is: its features first, then the words of its name, then its kind. */
export function conceptKey(n: NodeSpec, spec: SceneSpec): ConceptKey {
  const l = n.label.toLowerCase();
  switch (n.kind) {
    case "client":
      if (n.glyph === "bot") return "bot";
      if (n.connect || l.includes("browser")) return "browser";
      return /\b(sender|senders|producer)\b/.test(l) ? "sender" : "users";
    case "limiter":
      return n.limit?.shared ? "waitingRoom" : "limiter";
    case "topic":
      return "topic";
    case "queue":
      if (l.includes("dead") || spec.nodes.some((q) => q.ack?.deadLetter === n.id)) return "dlq";
      if (n.consumers || l.includes("partition")) return "partition";
      if (l.includes("broker")) return "broker";
      if (/\blog\b/.test(l)) return "log";
      return l.includes("frontier") ? "frontier" : "queue";
    case "lb":
      if (n.promote || l.includes("writer")) return "writer";
      if (n.autoscale) return "autoscaler";
      if (n.rollback || n.weights) return "canary";
      if (n.layer === 4) return "l4";
      if (n.byTag || l.includes("gateway")) return "gateway";
      if (l.startsWith("by ")) return "partitioner";
      if (n.algo === "nearest" || /dns|anycast|nearest/.test(l)) return "geo";
      if (n.algo === "ring" || l.includes("ring")) return "ring";
      // A hash in front of servers keeps each user on one server; in front of data, it picks the key's shard.
      if (n.algo === "hash" && sendsTo(n, spec, ["server"]) && !/shard|hash/.test(l)) return "sticky";
      if (n.algo === "hash" || /shard|hash/.test(l)) return "shardRouter";
      return n.glyph === "router" ? "router" : "lb";
    case "cache":
      if (l.includes("resolver")) return "resolver";
      return n.glyph === "edge" || l.includes("edge") ? "edge" : "cache";
    case "db":
      if (n.cluster) return "member";
      if (n.leader) return "follower";
      if (n.peer) return "region";
      if (spec.nodes.some((x) => x.leader === n.id)) return "leaderDb";
      if (n.replicaOf || l.includes("replica")) return "replica";
      if (l.includes("session")) return "sessionStore";
      if (l.includes("shard")) return "shard";
      if (n.replication || l.includes("primary")) return "primary";
      if (n.cas) return "casDb";
      if (n.outbox) return "outboxDb";
      return l.includes("ledger") ? "ledger" : "db";
    default:
      if (n.glyph === "worker" || n.sink) return "worker";
      if (l === "root" || l.includes(".com")) return "dnsServer";
      if (l.includes("browser")) return "browser";
      if (n.window) return "stream";
      if (n.lock) return "lock";
      if (n.quorum) return "coordinator";
      if (n.saga) return "saga";
      if (n.reserve) return "booking";
      if (n.fanout) return "aggregator";
      if (n.hold) return "push";
      if (n.feed) return "feed";
      if (n.advertise) return "flowReceiver";
      if (n.replies === "ack" || l.includes("receiver")) return "receiver";
      if (/card|payment/.test(l)) return "payments";
      if (n.sessions) return "stateful";
      if (l.includes("canary")) return "canaryServer";
      if (l.includes("origin")) return "origin";
      if (/\bregion\b/.test(l)) return "regionServer";
      if (l === "the web") return "web";
      if (/^shard\b/.test(l)) return "shardServer";
      return "server";
  }
}

export const conceptOf = (n: NodeSpec, spec: SceneSpec): Concept => C[conceptKey(n, spec)];

/** A duration as people say it: "250 ms", "1.5 s". */
const secs = (ms: number) => (ms < 1000 ? `${+ms.toFixed(ms < 10 ? 1 : 0)} ms` : `${+(ms / 1000).toFixed(1)} s`);

const same = (a: NodeSpec, b: NodeSpec) => JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 });
const plain = (t: string) => t.replace(/\[\[([\w-]+)(?:\|([^\]]+))?\]\]/g, (_, k: string, w?: string) => w ?? k.replace(/-/g, " "));
const sentence = (t: string) => t.replace(/^./, (c) => c.toUpperCase());

/**
 * The station's build lines: the latest step at or before the one shown whose parts name it, while the station is
 * still as those lines describe it (at that step's defaults); a knob or a later step that changed it leaves none. A line
 * about this station alone drops its name ("Server: 4 workers…" → "4 workers…"); a line about a group keeps it whole
 * ("Three regions: 30, 8 and 4 requests a second."), as its numbers belong to the group.
 */
export function hereOf(n: NodeSpec, figs: FigureDef[] | undefined, step: number): string | null {
  for (let j = Math.min(step, (figs?.length ?? 0) - 1); j >= 0; j--) {
    const f = figs![j];
    const parts = (f.parts ?? []).filter((p) => [p.node].flat().includes(n.id));
    if (!parts.length) continue;
    const then = f.build(defaultsOf(f)).nodes.find((x) => x.id === n.id);
    if (!then || !same(then, n)) return null;
    return parts.map((p) => sentence(Array.isArray(p.node) ? plain(p.text) : plain(p.text).replace(/^[^:]+:\s*/, ""))).join(" ");
  }
  return null;
}

const ALGO: Record<string, string> = {
  "round-robin": "takes the servers in turn",
  least: "picks the least busy server",
  random: "picks a server at random",
  hash: "sends each key to the same place",
  ring: "finds each key's server on a ring",
  nearest: "picks the nearest healthy region",
  weighted: "splits traffic by weight",
};

/** How the station is set up, in numbers: its card's "Here" line when no build line describes it as it is now. */
export function setupOf(n: NodeSpec): string {
  const out: string[] = [];
  const r = n.client?.rate;
  if (n.kind === "client") out.push(n.client?.poll ? `each user asks every ${secs(n.client.poll)}` : typeof r === "number" ? `${r} requests a second` : "traffic that rises and falls");
  if (n.slots) out.push(`${n.slots} workers`);
  if (n.serviceBy?.read !== undefined && n.serviceBy.write !== undefined) out.push(`reads take ${secs(n.serviceBy.read)}, writes ${secs(n.serviceBy.write)}`);
  else if (n.serviceMs && n.kind !== "lb") out.push(`${secs(n.serviceMs)} a request`);
  if (n.kind === "cache") out.push(`holds ${n.capacity ?? 0} items${n.ttlMs ? `, each for ${secs(n.ttlMs)}` : ""}`);
  if (n.kind === "lb" && n.algo && ALGO[n.algo]) out.push(ALGO[n.algo]);
  if (n.health) out.push(`checks each server every ${secs(n.health.everyMs)}`);
  if (n.promote) out.push("promotes a replica when the primary dies");
  if (n.limit) out.push(`${n.limit.rps} a second${n.limit.shared ? "" : " per client"}, bursts of ${n.limit.burst}`);
  if (n.autoscale) out.push(`${n.autoscale.min} to ${n.autoscale.max} servers`);
  if (n.breaker) out.push(`a breaker that opens after ${n.breaker.threshold} failures`);
  if (n.replicaOf || n.lagMs) out.push(`copies arrive ${secs(n.lagMs ?? 0)} late`);
  if (n.sessions) out.push("sessions kept in its own memory");
  if (n.idempotent) out.push("remembers each request it has done");
  if (n.shed) out.push("turns work away when overloaded");
  if (n.bulkheads) out.push("workers set aside per caller");
  if (n.deadlines === "honour") out.push("drops work past its deadline");
  if (n.kind === "queue") {
    if (n.backpressure) out.push(`holds ${n.backpressure.high} jobs at most, then ${n.backpressure.mode === "wait" ? "makes senders wait" : n.backpressure.mode === "reject" ? "turns new ones away" : "drops the oldest"}`);
    else out.push(n.queueMax ? `holds ${n.queueMax} jobs at most` : "holds every job, however many");
    if (n.ack) out.push(`keeps each job until a worker says it is done, ${n.ack.maxDeliveries ? `${n.ack.maxDeliveries} tries at most` : "however long"}`);
  }
  if (n.kind === "topic") out.push(`copies each message to ${(n.to ?? []).flat().length === 1 ? "one subscriber" : `${(n.to ?? []).flat().length} subscribers`}`);
  const s = out.slice(0, 3).join(", ");
  return s ? `${sentence(s)}.` : "";
}

const PILL_WORDS: Record<string, string> = {
  closed: "Its breaker is closed: calls go through.",
  open: "Its breaker is open: calls fail at once, without trying.",
  half: "Its breaker is testing: one call is let through to see if the other side is back.",
};

/** Requests arriving at the station per second, over the metric window. */
const rateAt = (sim: Sim, rt: NodeRt) => Math.round((rt.arrivals.count(sim.t) / Math.max(1, Math.min(sim.windowMs, sim.t))) * 1000);

/** What the station is doing right now, in words, from what its label and badges show (`view` is what the stage draws). */
export function nowOf(sim: Sim, rt: NodeRt, view: View): string {
  const s = rt.spec;
  const { cls, sub } = view;
  if (cls === "off") return "On standby: not in use in this design.";
  if (cls === "booting") return "Starting up: it can't take requests yet.";
  if (cls === "draining") return "Draining: finishing the requests it has, and taking no new ones.";
  if (cls === "down")
    return sub.startsWith("paused")
      ? "Paused: jobs wait in the queue until it is back."
      : sub.startsWith("restarting")
        ? "Crashed, and restarting."
        : sub === "not responding"
          ? "Not responding: requests sent to it hang until their sender gives up."
          : sub.includes("taken out")
            ? "Down, and taken out of rotation by the health checks."
            : "Down: requests sent to it fail.";
  if (sub === "rejoining…") return "Back up, but it must pass its health checks before it gets traffic again.";
  if (sub === "rolled back") return "Rolled back: the balancer stopped sending it traffic after too many errors.";
  const out: string[] = [];
  const slots = s.slots ?? 0;
  const busy = rt.work.length + rt.held.length;
  const q = rt.queue.length;
  if (s.kind === "client" && !s.client?.window && !s.client?.poll && !s.client?.subscribe) {
    out.push(`Sending ${sub.split(" ")[0]} requests a second${s.connect ? `, over ${rt.conns.length} open ${rt.conns.length === 1 ? "connection" : "connections"}` : ""}.`);
  } else if (s.kind === "cache") {
    out.push(`Holding ${rt.cache.size} of ${s.capacity ?? 0} items${rt.dirty.size ? `, ${rt.dirty.size} not yet saved` : ""}.`);
  } else if (s.kind === "queue") {
    out.push(`${q} ${q === 1 ? "job" : "jobs"} waiting${rt.inflight.size ? `, ${rt.inflight.size} out with workers` : ""}.`);
  } else if (s.kind === "lb" && s.health) {
    const to = sim.flat(s.to);
    const ok = to.filter((t) => rt.health.get(t)?.ok !== false).length;
    const benched = to.length - ok;
    out.push(benched ? `Sending to ${ok} of ${to.length}: ${benched} failed ${benched === 1 ? "its" : "their"} checks and ${benched === 1 ? "is" : "are"} left out.` : `Sending to all ${to.length}: each passed its last check.`);
  } else if (s.kind === "lb" || s.kind === "limiter" || s.kind === "topic") {
    const r = rateAt(sim, rt);
    out.push(r ? `About ${r} ${r === 1 ? "request" : "requests"} a second arriving.` : "Nothing arriving yet.");
  } else if (s.kind === "client" && s.client?.window) {
    out.push(`${rt.flying} sent and not yet answered, of ${sim.windowOf(rt)} allowed at once.`);
  } else if (s.kind === "client" && s.client?.poll) {
    out.push(`Each user asks every ${secs(s.client.poll)} whether there is news.`);
  } else if (s.kind === "client" && s.client?.subscribe) {
    out.push(`${rt.subOf.size} ${rt.subOf.size === 1 ? "user" : "users"} connected, waiting for news.`);
  } else if (s.cluster) {
    const { role, term } = rt.raft;
    out.push(role === "leader" ? `Leading, in term ${term}: it takes the writes.` : role === "candidate" ? `Asking the others for votes, for term ${term}.` : `Following the leader of term ${term}.`);
  } else if (s.lock) {
    const waiting = [...rt.waiters.values()].reduce((a, w) => a + w.length, 0);
    out.push(`${rt.locks.size} ${rt.locks.size === 1 ? "key" : "keys"} locked, ${waiting} ${waiting === 1 ? "request" : "requests"} waiting a turn.`);
  } else if (s.quorum) {
    out.push(`Each write waits for ${s.quorum.w} copies to store it; each read asks ${s.quorum.r}.`);
  } else if (s.window) {
    out.push(`Counting in ${secs(s.window.sizeMs)} windows${s.window.latenessMs ? `, waiting ${secs(s.window.latenessMs)} for late events` : ""}.`);
  } else if (s.hold) {
    out.push(`Holding ${rt.subs.length} of ${s.hold.max} connections open.`);
  } else if (s.maxConns !== undefined && !q) {
    out.push(`Holding ${rt.accepted} of ${s.maxConns} connections it accepts.`);
  } else if ((s.kind === "server" || s.kind === "db") && slots && /busy|waiting/.test(sub)) {
    const can = sim.slotsOf(rt);
    out.push(`${busy} of ${can} workers busy${q ? `, ${q} waiting in line` : ""}${can < slots ? ", still warming up after a restart" : ""}.`);
  } else if (sub) {
    out.push(`${sentence(sub)}.`);
  }
  if (cls === "hot") out.push("Running hot: work arrives faster than it finishes.");
  if (view.pill) out.push(PILL_WORDS[view.pill]);
  const badge = view.badge?.text;
  if (badge === "SHEDDING") out.push("Shedding: turning work away to stay quick for the rest.");
  if (badge === "WAIT") out.push("Told to wait: the receiver has no room.");
  if (badge === "CUT OFF") out.push("Cut off from its leader, so it refuses writes.");
  return out.join(" ");
}

/** How to read the station's drawing: its sockets, its bar, the marks around it and the dots that leave it. */
export function readOf(rt: NodeRt, key: ConceptKey): string {
  const s = rt.spec;
  if (s.kind === "client") return "Each dot leaving it is a request. It comes back green when answered, amber when late, a red diamond when it failed.";
  if (s.kind === "lb") return `It does no work itself: it picks where each request goes.${s.health ? " The small grey rings are its health checks." : ""}`;
  if (s.kind === "limiter") return "It does no work itself. The requests it turns away go back as grey squares.";
  if (s.kind === "topic") return "Each message leaves it as one copy per subscriber.";
  if (s.kind === "queue") return "Jobs wait inside as blue squares until a worker takes one.";
  if (s.kind === "cache") return "The bar shows how full it is. A miss fetches a copy and fills it; a falling chip is an entry pushed out to make room.";
  const line = rt.queue.length ? " The amber wedge in front of it is its waiting line." : "";
  if (key === "worker") return `Each socket is a worker, lit while busy. Jobs arrive as squares, and nothing is sent back.${line}`;
  if (s.kind === "db")
    return `Each socket is a query it can run at once; the bar shows how busy it is.${s.replicaOf ? " A violet rule under it means a copy is on its way: reads there may be stale." : ""}${line}`;
  return `Each socket is a worker, lit while busy${s.blocking ? ", and a hollow ring while it waits on a call" : ""}. The bar shows how busy it is.${line}`;
}
