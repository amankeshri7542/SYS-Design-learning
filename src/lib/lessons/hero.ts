import { M, balancer, cache, database, lane, outage, range, scene, server, users } from "./kit";
import type { FigureDef } from "./types";

/**
 * The home page thesis: a small but complete system, with a server that fails now and then. Phones get its front half
 * (`compact: 1`): the same users, balancer, servers and crash, short enough to read as a ticker.
 */
export const HERO: FigureDef = {
  tone: "explore",
  short: "Live",
  title: "A small web system under load",
  caption: "Users send requests through a load balancer to three servers, which read through a cache to a database. Now and then a server crashes.",
  // Three beats that come round with the loop.
  beats: [
    { id: "flow", when: { at: 300 }, text: "Requests flow from Users through the balancer to three servers.", focus: { nodes: ["lb"] } },
    { id: "crash", when: { note: "Server 2 crashed" }, text: "Server 2 crashed. Watch the balancer stop sending it work.", focus: { nodes: ["s2", "lb"] } },
    { id: "back", when: { note: "Server 2 is back" }, text: "Server 2 is back, and gets its share of requests again.", focus: { nodes: ["s2"] } },
  ],
  metrics: [M.p95(), M.hit(["cache"]), M.errors()],
  build: (v) => {
    const compact = !!v.compact;
    const at = (full: number, short: number) => (compact ? short : full);
    return scene(
      [
        users("u", [at(4, 8), 50], { rate: 34, keys: 60, skew: 1.1 }, "lb"),
        balancer("lb", [at(26, 46), 50], ["s1", "s2", "s3"], { health: { everyMs: 140, failAfter: 2, passAfter: 2, timeoutMs: 150 } }),
        ...range(3).map((i) =>
          server(`s${i + 1}`, [at(52, 88), lane(3, i)], { slots: 4, serviceMs: 70, label: `Server ${i + 1}`, to: compact ? undefined : ["cache"] }),
        ),
        ...(compact ? [] : [cache("cache", [76, 50], "db", { capacity: 18, ttlMs: 5000 }), database("db", [96, 50], { slots: 4, serviceMs: 110, queueMax: 40 })]),
      ],
      { script: outage("s2", "Server 2", 1600, 3000, 4400), wideH: 460 },
    );
  },
};
