import type { Sim } from "../sim/engine";
import type { MetricSpec } from "../sim/metrics";
import type { Call, NodeSpec, SceneSpec } from "../sim/types";
import { M, balancer, cache, database, lane, range, scene, server, users } from "./kit";

export interface Arch {
  servers: number;
  cache: boolean;
  replicas: number;
  limiter: boolean;
}

export interface CapStage {
  name: string;
  brief: string;
  hint: string;
  users: number;
  hot: number;
  bot: number;
  crash: boolean;
  /** Seconds (real time at 1×) the target must hold continuously. */
  hold: number;
}

export const TARGET = { p95: 300, errors: 0.02 };

export const STAGES: CapStage[] = [
  {
    name: "Launch day",
    brief: "A few hundred people are shortening links. Check that one server and one database hold the target.",
    hint: "Nothing to change yet. Watch the target hold and get used to the scene.",
    users: 12,
    hot: 0,
    bot: 0,
    crash: false,
    hold: 6,
  },
  {
    name: "Featured on a blog",
    brief: "Traffic triples overnight. Nearly every request is a redirect: a read of the same popular links, again and again.",
    hint: "The database is the box at 100%. What lets repeated reads skip it entirely?",
    users: 40,
    hot: 0,
    bot: 0,
    crash: false,
    hold: 8,
  },
  {
    name: "A link goes viral",
    brief: "One link is everywhere, more than a third of all traffic, and total traffic doubles again.",
    hint: "Watch which box fills first. However good the cache is, one server only has so many workers.",
    users: 85,
    hot: 0.35,
    bot: 0,
    crash: false,
    hold: 8,
  },
  {
    name: "Under attack",
    brief: "A bot hammers the API at 90 requests a second, and server 1 keeps crashing. Real users must not notice.",
    hint: "Shed the bot's traffic before it reaches the servers, and make sure losing one server still leaves enough.",
    users: 85,
    hot: 0.2,
    bot: 90,
    crash: true,
    hold: 12,
  },
];

export const PRICE = { base: 100, server: 40, cache: 25, replica: 60, limiter: 10 };

export function monthlyCost(a: Arch) {
  return PRICE.base + a.servers * PRICE.server + (a.cache ? PRICE.cache : 0) + a.replicas * PRICE.replica + (a.limiter ? PRICE.limiter : 0);
}

export const START: Arch = { servers: 1, cache: false, replicas: 0, limiter: false };

export function capstoneScene(a: Arch, s: CapStage): SceneSpec {
  const servers = range(a.servers).map((i) => `s${i + 1}`);
  const replicas = range(a.replicas).map((i) => `r${i + 1}`);
  const readOrigin: Call = replicas.length ? replicas : "db";
  const entry = a.limiter ? "lim" : "lb";
  const nodes: NodeSpec[] = [
    users("u", [4, s.bot ? 28 : 50], { rate: s.users, keys: 200, skew: 1.1, hot: s.hot, writes: 0.05, tag: "user" }, entry, { label: "Users" }),
  ];
  if (s.bot) nodes.push(users("bot", [4, 78], { rate: s.bot, keys: 200, tag: "bot" }, entry, { label: "Bot", glyph: "bot" }));
  if (a.limiter)
    nodes.push({ id: "lim", kind: "limiter", label: "Rate limiter", at: [19, 50], limit: { rps: 20, burst: 10, tags: ["bot"] }, to: ["lb"] });
  nodes.push(balancer("lb", [33, 50], servers, { health: { everyMs: 120, failAfter: 2, passAfter: 2, timeoutMs: 150 } }));
  nodes.push(
    ...servers.map((id, i) =>
      server(id, [53, lane(a.servers, i)], {
        slots: 3,
        serviceMs: 40,
        queueMax: 60,
        label: `Server ${i + 1}`,
        calls: { read: [a.cache ? "cache" : readOrigin], write: ["db"] },
      }),
    ),
  );
  if (a.cache) nodes.push(cache("cache", [73, 50], readOrigin, { capacity: 100, ttlMs: 20000 }));
  nodes.push(database("db", [94, replicas.length ? 14 : 50], { slots: 4, serviceMs: 90, queueMax: 60, label: "Primary DB" }));
  nodes.push(
    ...replicas.map((id, i) =>
      database(id, [94, a.replicas === 1 ? 66 : 50 + 36 * i], {
        slots: 4,
        serviceMs: 90,
        queueMax: 60,
        replicaOf: "db",
        lagMs: 120,
        label: `Replica ${i + 1}`,
      }),
    ),
  );
  return scene(nodes, {
    sloMs: TARGET.p95,
    msPerUnit: 0.45,
    wideH: 440,
    script: s.crash
      ? {
          loopMs: 3200,
          events: [
            { at: 300, label: "Server 1 crashed", run: (sim: Sim) => sim.setUp("s1", false) },
            { at: 2000, label: "Server 1 is back", run: (sim: Sim) => sim.setUp("s1", true) },
          ],
        }
      : undefined,
  });
}

export const CAP_METRICS: MetricSpec[] = [
  M.p95({ tag: "user", label: "Users' response time" }),
  M.errors({ tag: "user", label: "Users failed" }),
  M.busy(["s1", "s2", "s3", "s4"], "Servers busy"),
  M.busy(["db", "r1", "r2"], "Databases busy"),
];
