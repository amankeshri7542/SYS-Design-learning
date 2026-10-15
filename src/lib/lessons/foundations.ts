import type { Sim } from "../sim/engine";
import type { NodeSpec } from "../sim/types";
import { M, balancer, choice, crash, knob, lane, perSecond, range, scene, server, users, wave } from "./kit";
import type { Lesson, Values } from "./types";

export const outage = (id: string, name: string, at: number, back: number, loop: number) => ({
  loopMs: loop,
  events: [
    { at, label: `${name} crashed`, run: (s: Sim) => s.setUp(id, false) },
    { at: back, label: `${name} is back`, run: (s: Sim) => s.setUp(id, true) },
  ],
});

const latency: Lesson = {
  slug: "latency-and-throughput",
  code: "F1",
  line: "foundations",
  title: "Latency & throughput",
  why: "A server can only work on a few requests at once. Past that, new ones wait in line, and waiting is most of what “slow” means.",
  figures: [
    {
      tone: "problem",
      title: "One server, rising traffic",
      caption:
        "Traffic swells and fades. The line in front of the server stays short until the server is nearly full, then it grows much faster than the traffic does.",
      metrics: [M.p95(), M.busy(["app"]), M.throughput()],
      build: () =>
        scene([
          users("u", [14, 50], { rate: wave(6, 42, 3600), keys: 50 }, "app"),
          server("app", [86, 50], { slots: 4, serviceMs: 120, label: "Server" }),
        ]),
    },
    {
      tone: "explore",
      title: "Capacity is workers ÷ time per request",
      caption:
        "Four workers, each taking about 120 ms, can finish roughly 33 requests a second. Push traffic toward that number, then give the server more workers.",
      knobs: [
        knob("rate", "Traffic", 5, 60, 1, 26, perSecond),
        knob("slots", "Workers", 1, 8, 1, 4),
      ],
      metrics: [M.p95(), M.busy(["app"]), M.throughput()],
      build: (v: Values) =>
        scene([
          users("u", [14, 50], { rate: v.rate, keys: 50 }, "app"),
          server("app", [86, 50], { slots: v.slots, serviceMs: 120, label: "Server" }),
        ]),
    },
  ],
  takeaways: {
    use: "Every design starts here. Know each part's capacity and keep it comfortably below 100% busy.",
    catch: "Waiting time grows faster than load does. At 90% busy, a request typically waits several times longer than at 50%.",
    seen: "Every web server, database and API has a fixed number of workers, threads or connections.",
  },
};

const scaleOutServers = (n: number): NodeSpec[] =>
  range(n).map((i) => server(`s${i + 1}`, [84, lane(n, i)], { slots: 2, serviceMs: 120, label: `Server ${i + 1}` }));

const bigServer = () =>
  scene(
    [
      users("u", [10, 50], { rate: 40, keys: 50 }, "big"),
      server("big", [80, 50], { slots: 8, serviceMs: 120, label: "One big server" }),
    ],
    { script: outage("big", "The big server", 1300, 2400, 3600) },
  );

const scaling: Lesson = {
  slug: "scaling-up-vs-out",
  code: "F2",
  line: "foundations",
  title: "Scaling up vs scaling out",
  why: "When one server isn't enough you can buy a bigger one or add more of them. Only one of those options survives a crash.",
  figures: [
    {
      tone: "problem",
      title: "Scale up: one bigger machine",
      caption:
        "A single server with eight workers handles the load easily, until it crashes. Then every request fails until it comes back.",
      actions: [crash("big", "the server")],
      metrics: [M.errors(), M.p95(), M.throughput()],
      build: bigServer,
    },
    {
      tone: "fix",
      title: "Scale out: several smaller machines",
      caption:
        "The same eight workers are spread over four servers behind a load balancer. When one crashes, only its share of requests fails.",
      knobs: [knob("n", "Servers", 2, 5, 1, 4)],
      actions: [crash("s1", "server 1")],
      metrics: [M.errors(), M.p95(), M.throughput()],
      build: (v) => {
        const n = v.n;
        return scene(
          [
            users("u", [10, 50], { rate: 40, keys: 50 }, "lb"),
            balancer("lb", [42, 50], scaleOutServers(n).map((s) => s.id)),
            ...scaleOutServers(n),
          ],
          { script: outage("s1", "Server 1", 1300, 2400, 3600), wideH: 460 },
        );
      },
      compare: { label: "one big server", build: bigServer },
    },
  ],
  takeaways: {
    use: "Scale out once a single machine is a real risk to uptime or can't grow any further.",
    catch: "Many servers need a load balancer, and they can't keep state in memory that another server needs.",
    seen: "Web tiers, stateless APIs and worker fleets all scale out. Big databases often scale up first.",
  },
};

const REGIONS = [
  { id: "eu", label: "Europe", rate: 30 },
  { id: "as", label: "Asia", rate: 8 },
  { id: "am", label: "Americas", rate: 4 },
];
const regionUsers = (to: (i: number) => string) =>
  REGIONS.map((r, i) =>
    users(r.id, [8, lane(3, i)], { rate: r.rate, keys: 50, heavy: { share: 0.15, cost: 3 } }, to(i), {
      label: r.label,
    }),
  );
const lbServers = () => range(3).map((i) => server(`s${i + 1}`, [86, lane(3, i)], { slots: 3, serviceMs: 120, label: `Server ${i + 1}` }));

const sticky = () => scene([...regionUsers((i) => `s${i + 1}`), ...lbServers()], { wideH: 460 });

const balancing: Lesson = {
  slug: "load-balancing",
  code: "F3",
  line: "foundations",
  title: "Load balancing",
  why: "A load balancer spreads requests across servers so no single machine drowns while the others sit idle.",
  figures: [
    {
      tone: "problem",
      title: "Each region is stuck with one server",
      caption:
        "Europe sends seven times the traffic of the Americas. Server 1 builds a queue while server 3 sits mostly idle. Some requests are heavier (bigger dots take longer).",
      metrics: [M.p95(), M.peak(["s1", "s2", "s3"]), M.errors()],
      build: sticky,
    },
    {
      tone: "fix",
      title: "One balancer in front of all three",
      caption:
        "Every request goes to the balancer, which picks a server. Try each strategy: “least busy” copes best when some requests are heavier than others.",
      knobs: [choice("algo", "Strategy", ["Round robin", "Random", "Least busy"], 0)],
      metrics: [M.p95(), M.peak(["s1", "s2", "s3"]), M.errors()],
      build: (v) =>
        scene(
          [
            ...regionUsers(() => "lb"),
            balancer("lb", [46, 50], ["s1", "s2", "s3"], {
              algo: (["round-robin", "random", "least"] as const)[v.algo],
            }),
            ...lbServers(),
          ],
          { wideH: 460 },
        ),
      compare: { label: "fixed regions", build: sticky },
    },
  ],
  takeaways: {
    use: "Use one whenever you run more than one copy of a service, which is almost always.",
    catch: "The balancer is now on every request path. Run at least two, and pick an algorithm that suits your request costs.",
    seen: "Nginx, HAProxy, AWS ALB, Envoy, and Kubernetes Services.",
  },
};

const healthScene = (checkEvery: number | null) =>
  scene(
    [
      users("u", [8, 50], { rate: 36, keys: 50 }, "lb"),
      balancer("lb", [42, 50], ["s1", "s2", "s3"], {
        health: checkEvery ? { everyMs: checkEvery, failAfter: 2, passAfter: 2, timeoutMs: 150 } : undefined,
      }),
      ...range(3).map((i) => server(`s${i + 1}`, [86, lane(3, i)], { slots: 4, serviceMs: 100, label: `Server ${i + 1}` })),
    ],
    { script: outage("s2", "Server 2", 1000, 2800, 3800), wideH: 460 },
  );

const health: Lesson = {
  slug: "health-checks",
  code: "F4",
  line: "foundations",
  title: "Health checks & failover",
  why: "Servers crash. A load balancer that keeps sending traffic to a dead one turns one failure into errors for everyone.",
  figures: [
    {
      tone: "problem",
      title: "The balancer can't tell server 2 is dead",
      caption: "When server 2 crashes, a third of all requests still go to it and fail (red diamonds).",
      actions: [crash("s2", "server 2")],
      metrics: [M.errors(), M.p95(), { id: "inRotation", label: "Servers in use", nodes: ["lb"], hint: "Servers the balancer is sending traffic to." }],
      build: () => healthScene(null),
    },
    {
      tone: "fix",
      title: "The balancer pings each server",
      caption:
        "Small hollow dots are health checks. After two missed checks, server 2 is taken out of rotation. When it answers again, it's put back.",
      knobs: [knob("every", "Check every", 40, 400, 20, 100, (v) => `${v} ms`)],
      actions: [crash("s2", "server 2")],
      metrics: [M.errors(), M.p95(), { id: "inRotation", label: "Servers in use", nodes: ["lb"], hint: "Servers the balancer is sending traffic to." }],
      build: (v) => healthScene(v.every),
      compare: { label: "no checks", build: () => healthScene(null) },
    },
  ],
  takeaways: {
    use: "Use them on anything behind a load balancer, or anything a scheduler restarts.",
    catch: "Checks that are too eager flap healthy servers in and out. Checks that are too lazy leave dead ones in for longer.",
    seen: "Load balancer target health, Kubernetes liveness and readiness probes, Consul checks.",
  },
};

export const foundations = [latency, scaling, balancing, health];
