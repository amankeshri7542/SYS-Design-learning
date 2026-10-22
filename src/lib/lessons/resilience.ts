import type { Sim } from "../sim/engine";
import type { NodeSpec } from "../sim/types";
import { M, balancer, knob, lane, ms, perSecond, range, scene, server, users, wave } from "./kit";
import type { Lesson, Values } from "./types";

const people = () => users("u", [6, 26], { rate: 14, keys: 50, tag: "user" }, "svc", { label: "Users" });
const bot = () => users("bot", [6, 76], { rate: 40, keys: 50, tag: "bot" }, "svc", { label: "Scraper bot", glyph: "bot" });

const unlimited = () =>
  scene([people(), bot(), server("svc", [84, 50], { slots: 4, serviceMs: 100, queueMax: 30, label: "API server" })], { wideH: 440 });

const limiting: Lesson = {
  slug: "rate-limiting",
  code: "R1",
  line: "resilience",
  title: "Rate limiting",
  why: "One misbehaving client can eat all of your capacity. A rate limiter caps each client so that everyone else stays fast.",
  figures: [
    {
      tone: "problem",
      short: "No limit",
      title: "A scraper floods the API",
      caption:
        "The bot sends three times as much as all the real users combined. The server is buried, and real users wait or fail along with the bot.",
      metrics: [M.p95({ tag: "user", label: "Users' response time" }), M.errors({ tag: "user", label: "Users failed" }), M.busy(["svc"])],
      build: unlimited,
    },
    {
      tone: "fix",
      short: "Rate limit",
      title: "A token bucket per client",
      caption:
        "Each client gets a steady allowance of requests plus a small burst. The bot's excess is turned away instantly (grey squares) and never reaches the server.",
      knobs: [knob("rps", "Limit per client", 5, 50, 1, 16, perSecond)],
      metrics: [
        M.p95({ tag: "user", label: "Users' response time" }),
        M.errors({ tag: "user", label: "Users failed" }),
        { id: "rejected", label: "Bot turned away", tag: "bot", better: "high", hint: "Share of the bot's requests rejected by the limiter." },
      ],
      build: (v: Values) =>
        scene(
          [
            { ...people(), to: ["lim"] },
            { ...bot(), to: ["lim"] },
            { id: "lim", kind: "limiter", label: "Rate limiter", at: [42, 50], limit: { rps: v.rps, burst: 6 }, to: ["svc"] } satisfies NodeSpec,
            server("svc", [84, 50], { slots: 4, serviceMs: 100, queueMax: 30, label: "API server" }),
          ],
          { wideH: 440 },
        ),
    },
  ],
  takeaways: {
    use: "Put limits on public APIs, logins and expensive endpoints, set per user, per key or per IP.",
    catch: "Limits that are too tight hurt real users. Spread across many servers, the counters need shared state.",
    seen: "API gateways, Nginx limit_req, Stripe's and GitHub's per-key API limits.",
  },
};

const shop = (breaker: { threshold: number; cooldownMs: number } | undefined) =>
  scene(
    [
      users("u", [6, 50], { rate: 30, keys: 50, writes: 0.35 }, "shop", { label: "Shoppers" }),
      server("shop", [42, 50], {
        label: "Shop server",
        slots: 8,
        serviceMs: 30,
        queueMax: 40,
        calls: { read: [], write: ["pay"] },
        blocking: true,
        callTimeoutMs: 900,
        breaker,
      }),
      server("pay", [86, 50], { slots: 4, serviceMs: 60, downMode: "hang", label: "Payments" }),
    ],
    {
      timeoutMs: 2000,
      script: {
        loopMs: 5400,
        events: [
          { at: 1200, label: "Payments starts hanging", run: (s: Sim) => s.setUp("pay", false) },
          { at: 3600, label: "Payments recovers", run: (s: Sim) => s.setUp("pay", true) },
        ],
      },
    },
  );

const browse = M.p95({ op: "read", label: "Browsing response time" });

const breakers: Lesson = {
  slug: "circuit-breakers",
  code: "R2",
  line: "resilience",
  title: "Circuit breakers",
  why: "When a dependency hangs, every request waiting on it ties up one of your workers. A breaker notices and fails fast until the dependency recovers.",
  figures: [
    {
      tone: "problem",
      short: "No breaker",
      title: "Waiting on a payments service that hangs",
      caption:
        "Checkouts wait almost a second for payments before giving up. Hollow slots are workers stuck waiting. Soon there are none left, so even simple browsing queues up.",
      metrics: [browse, M.errors({ op: "write", label: "Checkouts failed" }), M.busy(["shop"], "Shop server busy")],
      build: () => shop(undefined),
    },
    {
      tone: "fix",
      short: "Breaker",
      title: "Trip a breaker after repeated failures",
      caption:
        "After five failures in a row, the breaker opens. Checkouts get an instant “try again shortly” (grey) instead of a stuck worker. After a cool-down, one trial request tests whether payments is back.",
      knobs: [knob("cool", "Cool-down", 200, 2000, 100, 600, ms)],
      metrics: [browse, { id: "fallback", label: "Checkouts fast-failed", op: "write", hint: "Checkouts answered instantly by the open breaker." }, M.busy(["shop"], "Shop server busy")],
      build: (v) => shop({ threshold: 5, cooldownMs: v.cool }),
    },
  ],
  takeaways: {
    use: "Wrap every call to a remote dependency that can slow down or hang, especially non-critical ones.",
    catch: "Users still lose the feature while the breaker is open. Design what they see instead: a fallback, a cached value, or a clear message.",
    seen: "Resilience4j, Polly, Envoy outlier detection, Netflix Hystrix.",
  },
};

const POOL = 6;
const pool = () =>
  range(POOL).map((i) =>
    server(`s${i + 1}`, [i < 3 ? 72 : 92, lane(3, i % 3)], { slots: 3, serviceMs: 100, queueMax: 60, label: `Server ${i + 1}` }),
  );
const daily = { rate: wave(6, 66, 6400), keys: 50 };

const fixedFleet = (v: Values) =>
  scene(
    [
      users("u", [6, 50], daily, "lb"),
      balancer("lb", [38, 50], range(v.n ?? 2).map((i) => `s${i + 1}`)),
      ...pool().slice(0, v.n ?? 2),
    ],
    { wideH: 480 },
  );

const servers = { id: "servers" as const, label: "Servers running", nodes: range(POOL).map((i) => `s${i + 1}`), hint: "Machines you're paying for right now." };
// The autoscaler aims at a target, so a busier fleet at night is the point, not a regression.
const avgBusy = M.busy(servers.nodes, "Average busy", { better: "neutral" });

const autoscaling: Lesson = {
  slug: "autoscaling",
  code: "R3",
  line: "resilience",
  title: "Autoscaling",
  why: "Traffic rises and falls through the day. Autoscaling adds servers when it's busy and removes them when it's quiet, so you're neither slow nor paying for idle machines.",
  figures: [
    {
      tone: "problem",
      short: "Fixed fleet",
      title: "A fixed number of servers",
      caption:
        "Two servers cope at night and drown at the daily peak. Add more with the knob and the peak is fine, but now they sit idle most of the day.",
      knobs: [knob("n", "Servers", 1, 6, 1, 2)],
      metrics: [M.p95(), servers, avgBusy],
      build: fixedFleet,
    },
    {
      tone: "fix",
      short: "Autoscale",
      title: "Scale to a target utilisation",
      caption:
        "Every quarter-second, the autoscaler compares how busy the servers are with the target. It starts more (dashed while booting) or drains spares.",
      knobs: [knob("target", "Target busy", 0.4, 0.9, 0.05, 0.6, (v) => `${Math.round(v * 100)}%`)],
      metrics: [M.p95(), servers, avgBusy],
      build: (v) =>
        scene(
          [
            users("u", [6, 50], daily, "lb"),
            balancer("lb", [38, 50], pool().map((s) => s.id), {
              autoscale: { min: 1, max: POOL, target: v.target, everyMs: 250, warmupMs: 500 },
              label: "Balancer + autoscaler",
            }),
            ...pool(),
          ],
          { wideH: 480 },
        ),
    },
  ],
  takeaways: {
    use: "Use it for stateless services whose load varies by hour, by day or with marketing pushes.",
    catch: "New servers take time to boot, so sudden spikes still hurt. Keep some headroom, and scale on a signal that leads the load.",
    seen: "AWS Auto Scaling target tracking, the Kubernetes Horizontal Pod Autoscaler, Cloud Run.",
  },
};

export const resilienceLessons = [limiting, breakers, autoscaling];
