import { outage } from "./foundations";
import { M, balancer, cache, database, lane, range, scene, server, users } from "./kit";
import type { FigureDef } from "./types";

/** The home page thesis: a small but complete system, with a server that fails now and then. */
export const HERO: FigureDef = {
  tone: "explore",
  title: "A small web system under load",
  caption:
    "Users send requests through a load balancer to three servers. The servers read through a cache to a database. Every so often a server crashes and the balancer routes around it.",
  metrics: [M.p95(), M.hit(["cache"]), M.errors()],
  build: () =>
    scene(
      [
        users("u", [4, 50], { rate: 34, keys: 60, skew: 1.1 }, "lb"),
        balancer("lb", [26, 50], ["s1", "s2", "s3"], { health: { everyMs: 140, failAfter: 2, passAfter: 2, timeoutMs: 150 } }),
        ...range(3).map((i) =>
          server(`s${i + 1}`, [52, lane(3, i)], { slots: 4, serviceMs: 70, label: `Server ${i + 1}`, to: ["cache"] }),
        ),
        cache("cache", [76, 50], "db", { capacity: 18, ttlMs: 5000 }),
        database("db", [96, 50], { slots: 4, serviceMs: 110, queueMax: 40 }),
      ],
      { script: outage("s2", "Server 2", 1600, 3000, 4400), wideH: 460 },
    ),
};
