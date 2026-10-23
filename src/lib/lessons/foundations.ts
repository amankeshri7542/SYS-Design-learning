import type { Sim } from "../sim/engine";
import type { NodeSpec } from "../sim/types";
import { M, armedCrash, balancer, choice, fault, knob, lane, perSecond, range, rush, scene, server, users } from "./kit";
import type { Lesson, Values } from "./types";

export const outage = (id: string, name: string, at: number, back: number, loop: number) => ({
  loopMs: loop,
  events: [
    { at, label: `${name} crashed`, run: (s: Sim) => s.setUp(id, false) },
    { at: back, label: `${name} is back`, run: (s: Sim) => s.setUp(id, true) },
  ],
});

// F1's traffic: a calm 20 a second, then a rush to 44 that peaks 2.5 s into the scene, once the parts have been
// introduced, a short line has been named and the prediction made. The line it builds is counted 21 s in on screen.
// Seed 24 keeps the calm calm (`npm run tune -- latency-and-throughput --beats` shows the timeline).
const f1Traffic = { rate: rush(20, 44, 1900, 1200, 3400), keys: 50 };
const f1Queue = M.queue(["app"], "Waiting at Server");
const f1Busy = M.busy(["app"]);

const latency: Lesson = {
  slug: "latency-and-throughput",
  code: "F1",
  line: "foundations",
  title: "Latency & throughput",
  why: "A server can only work on a few requests at once. Past that, new ones wait in line, and waiting is most of what “slow” means.",
  level: "beginner",
  minutes: 6,
  hook: "Why does a website get slow before it breaks?",
  dots: ["req", "late", "ok"],
  figures: [
    {
      tone: "problem",
      short: "Rising traffic",
      title: "See it slow down",
      caption: "Traffic rises to about 40 a second and falls back. Nothing is broken.",
      metrics: [M.p95(), f1Busy, M.throughput()],
      parts: [
        { node: "u", text: "Users: 20 requests a second, rising to 44." },
        { node: "app", text: "Server: works on 4 at once, 120 ms each.", sockets: true },
      ],
      beats: [
        { id: "watch", when: { at: 30 }, text: "Watch one blue dot leave Users and reach Server.", focus: { link: ["u", "app"] } },
        {
          id: "worker",
          when: { metric: f1Busy, is: ">", value: 0.05 },
          text: "Each socket in Server is a [[worker]]. A dot fills one for 120 ms.",
          focus: { nodes: ["app"], sockets: true },
          pause: true,
          term: "worker",
        },
        {
          id: "queue",
          when: { metric: f1Queue, is: ">", value: 0 },
          text: "A dot waits in front of Server: every worker is busy. That's the [[queue]].",
          focus: { nodes: ["app"], dots: "waiting" },
          pause: true,
          term: "queue",
        },
        {
          id: "count",
          when: { metric: f1Queue, is: ">", value: 9 },
          text: "Count the line in front of Server: {queue:app} waiting.",
          focus: { nodes: ["app"], dots: "waiting" },
        },
        {
          id: "late",
          when: { metric: M.p95(), is: ">", value: 400 },
          text: "An amber dot waited past 400 ms, the [[latency-target|target]]. It's late, not lost.",
          focus: { dots: "late" },
          term: "latency-target",
        },
      ],
      predict: {
        prompt: "Traffic is about to double, from 20 to 40 a second. The line in front of Server will…",
        options: ["Double", "More than double", "Stay about the same"],
        answer: 1,
        before: "count",
        reveal: { beat: "count", text: "The line went from {before} to {after}. Traffic only doubled." },
        track: { metric: f1Queue },
        holds: (before, after) => after !== null && after > 2 * Math.max(2, before ?? 0),
      },
      build: () =>
        scene([users("u", [14, 50], f1Traffic, "app"), server("app", [86, 50], { slots: 4, serviceMs: 120, label: "Server" })], {
          seed: 24,
          stillMs: 3800,
        }),
    },
    {
      tone: "explore",
      short: "More workers",
      title: "Find the limit",
      caption: "Same server. You set the traffic and the number of workers.",
      knobs: [
        knob("rate", "Traffic", 5, 60, 1, 26, perSecond),
        knob("slots", "Workers", 1, 8, 1, 4),
      ],
      metrics: [M.p95(), f1Busy, M.throughput()],
      beats: [
        {
          id: "capacity",
          when: { step: "enter" },
          text: "[[capacity|Capacity]] is workers ÷ time per request: 4 ÷ 0.12 s ≈ 33 a second.",
          focus: { nodes: ["app"], sockets: true },
          term: "capacity",
        },
        { id: "push", when: { wait: 0 }, text: "Drag Traffic to 30. Server busy reaches 90%. Watch the line form.", focus: { knob: "rate" } },
        { id: "more", when: { wait: 600 }, text: "Now give it 6 workers: capacity 50 a second. The line disappears.", focus: { knob: "slots" } },
      ],
      headline: {
        metric: "Response time",
        sentence: "In your scene: {load:app:2} arriving each second, Server {util:app:2} busy, and the slowest 1 in 20 waits {p95:2}.",
      },
      build: (v: Values) =>
        scene([users("u", [14, 50], { rate: v.rate, keys: 50 }, "app"), server("app", [86, 50], { slots: v.slots, serviceMs: 120, label: "Server" })], { seed: 24 }),
    },
  ],
  checks: [
    {
      prompt: "2 workers, 200 ms each. About how many requests a second can they finish?",
      options: ["4", "10", "100"],
      answer: 1,
      why: "2 ÷ 0.2 s = 10 a second. Capacity is workers divided by time per request.",
      focus: { nodes: ["app"], sockets: true },
    },
    {
      prompt: "A server is 90% busy. A new request most likely…",
      options: ["is served at once", "waits behind others", "is rejected"],
      answer: 1,
      why: "At 90% busy the line is already there most of the time; waiting, not failing, is what you see first.",
      focus: { nodes: ["app"], dots: "waiting" },
    },
  ],
  takeaways: {
    use: "Every design. Know each part's capacity and keep it well under 100% busy.",
    catch: "Waiting grows faster than load. At 90% busy a request waits several times longer than at 50%.",
    seen: "Every web server, database and API has a fixed number of workers or connections.",
    rule: "Queues grow faster than traffic.",
  },
};

const scaleOutServers = (n: number): NodeSpec[] =>
  range(n).map((i) => server(`s${i + 1}`, [84, lane(n, i)], { slots: 2, serviceMs: 120, label: `Server ${i + 1}` }));

// One fault, two worlds: the big server goes down in the first, server 1 in the second, under the same labels.
const DOWN = "A server crashed";
const BACK = "The server is back";
const crashA = (node: string) => fault("crash", "Crash a server", "Restore it", DOWN, BACK, (sim) => sim.nodes.get(node)?.up === false);
const errorsF2 = M.errors();

const bigServer = () =>
  scene(
    [
      users("u", [10, 50], { rate: 40, keys: 50 }, "big"),
      server("big", [80, 50], { slots: 8, serviceMs: 120, label: "One big server" }),
    ],
    { script: armedCrash("big", 1300, 1100, DOWN, BACK) },
  );

const scaling: Lesson = {
  slug: "scaling-up-vs-out",
  code: "F2",
  line: "foundations",
  title: "Scaling up vs scaling out",
  why: "When one server isn't enough you can buy a bigger one or add more of them. Only one of those options survives a crash.",
  level: "beginner",
  minutes: 6,
  hook: "Your one server is big enough. What happens the day it goes down?",
  dots: ["req", "late", "ok", "failed"],
  figures: [
    {
      tone: "problem",
      short: "Scale up",
      title: "One bigger machine",
      caption: "One server with eight workers handles 40 requests a second, with room to spare.",
      actions: [crashA("big")],
      metrics: [errorsF2, M.p95(), M.throughput()],
      parts: [
        { node: "u", text: "Users: 40 requests a second." },
        { node: "big", text: "One big server: 8 workers, 120 ms each.", sockets: true },
      ],
      beats: [
        { id: "calm", when: { at: 300 }, text: "Watch One big server keep up: 40 a second, no line.", focus: { nodes: ["big"], sockets: true } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Crash a server.", focus: { action: "crash" }, pause: true },
        { id: "down", when: { note: DOWN }, text: "One big server is down. Every request sent to it fails.", focus: { nodes: ["big"] }, pause: true },
        { id: "failed", when: { metric: errorsF2, is: ">", value: 0.9 }, text: "Red diamonds are failed requests: {errors:problem} of them now.", focus: { dots: "failed" } },
        { id: "back", when: { note: BACK }, text: "It's back. While it was down, nothing could answer.", focus: { nodes: ["big"] } },
      ],
      predict: {
        prompt: "The only server is about to crash for about a second. While it's down, how many requests fail?",
        options: ["About a quarter", "About half", "All of them"],
        answer: 2,
        before: "press",
        reveal: { beat: "failed", text: "{after} failed. One machine is one point of failure." },
        track: { metric: errorsF2 },
        holds: (_, after) => after !== null && after > 0.9,
      },
      break: { action: "crash", beat: "press" },
      build: bigServer,
    },
    {
      tone: "fix",
      short: "Scale out",
      title: "Several smaller machines",
      caption: "The same eight workers, spread over four servers behind a load balancer.",
      knobs: [knob("n", "Servers", 2, 5, 1, 4)],
      actions: [crashA("s1")],
      metrics: [errorsF2, M.p95(), M.throughput()],
      parts: [
        { node: "lb", text: "Load balancer: sends each request to the next server." },
        { node: ["s1", "s2", "s3", "s4"], text: "Servers: 2 workers each, the same 8 in all." },
      ],
      beats: [
        { id: "press2", when: { wait: 0 }, text: "Press ⚡ Crash a server: Server 1 goes down, in both worlds.", focus: { action: "crash" }, pause: true },
        { id: "down2", when: { note: DOWN }, text: "Server 1 is down. Only the requests sent its way fail.", focus: { nodes: ["s1"] }, pause: true },
        { id: "share", when: { metric: errorsF2, is: ">", value: 0.15, forMs: 400 }, text: "Failed: {errors:fix} here, {errors:problem} with one big server.", focus: { metric: "Failed" } },
        { id: "back2", when: { note: BACK }, text: "Server 1 is back. The others answered all along.", focus: { nodes: ["s1"] } },
      ],
      break: { action: "crash", beat: "press2" },
      invite: [{ id: "invite", when: { wait: 0 }, text: "Drag Servers to 2, then 5. Fewer servers, a bigger share lost.", focus: { knob: "n" } }],
      headline: {
        metric: "Failed",
        sentence: "Same crash. One big server: {errors:problem} of requests failed. Four smaller ones: {errors:fix}.",
        at: "share",
      },
      build: (v) => {
        const n = v.n;
        return scene(
          [
            users("u", [10, 50], { rate: 40, keys: 50 }, "lb"),
            balancer("lb", [42, 50], scaleOutServers(n).map((s) => s.id)),
            ...scaleOutServers(n),
          ],
          { script: armedCrash("s1", 1300, 1100, DOWN, BACK), wideH: 460 },
        );
      },
    },
  ],
  checks: [
    {
      prompt: "One server with 8 workers, or four with 2 each. Which survives a crash better?",
      options: ["The one big server", "The four small ones", "They're the same"],
      answer: 1,
      why: "When one of four goes down, three still answer. When the only one goes down, nothing does.",
      focus: { nodes: ["s1"] },
    },
    {
      prompt: "Scaling out needs something new in front of the servers. What?",
      options: ["A bigger database", "A load balancer", "A cache"],
      answer: 1,
      why: "Something has to spread the requests across the servers: that is the load balancer's job.",
      focus: { nodes: ["lb"] },
    },
  ],
  takeaways: {
    use: "Scale out once a single machine is a real risk to uptime or can't grow any further.",
    catch: "Many servers need a load balancer, and they can't keep state in memory that another server needs.",
    seen: "Web tiers, stateless APIs and worker fleets all scale out. Big databases often scale up first.",
    rule: "Many small servers beat one big one.",
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
const busiest = M.peak(["s1", "s2", "s3"]);

const balancing: Lesson = {
  slug: "load-balancing",
  code: "F3",
  line: "foundations",
  title: "Load balancing",
  why: "A load balancer spreads requests across servers so no single machine drowns while the others sit idle.",
  level: "beginner",
  minutes: 6,
  hook: "Three servers, and one is drowning while another sits idle. Why?",
  dots: ["req", "late", "ok"],
  figures: [
    {
      tone: "problem",
      short: "Fixed servers",
      title: "Each region is stuck with one server",
      caption: "Europe sends 30 a second, Asia 8, the Americas 4. Some requests are heavier: bigger dots take longer.",
      metrics: [M.p95(), busiest, M.errors()],
      parts: [
        { node: ["eu", "as", "am"], text: "Three regions: 30, 8 and 4 requests a second." },
        { node: ["s1", "s2", "s3"], text: "Servers: 3 workers each, 120 ms per request.", sockets: true },
      ],
      beats: [
        { id: "europe", when: { at: 300 }, text: "Watch Server 1: Europe's 30 a second all go to it.", focus: { nodes: ["s1"], link: ["eu", "s1"] } },
        {
          id: "line",
          when: { metric: M.queue(["s1"]), is: ">", value: 3 },
          text: "A line builds in front of Server 1.",
          focus: { nodes: ["s1"], dots: "waiting" },
          pause: true,
        },
        { id: "idle", when: { wait: 0 }, text: "Server 3 sits mostly idle: the Americas send only 4 a second.", focus: { nodes: ["s3"], sockets: true } },
        { id: "late", when: { metric: M.p95(), is: ">", value: 400 }, text: "The slowest 1 in 20 takes {p95:problem}, target 400 ms.", focus: { metric: "Response time" } },
      ],
      predict: {
        prompt: "One balancer will share all three servers, with the same traffic. The slowest 1 in 20 will…",
        options: ["get a little faster", "get much faster", "stay the same"],
        answer: 1,
        before: "end",
        reveal: { beat: "compare", text: "{before} without a balancer, {after} with one." },
        track: { metric: M.p95(), world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < 0.6 * before,
      },
      build: sticky,
    },
    {
      tone: "fix",
      short: "Balanced",
      title: "One balancer in front of all three",
      caption: "Every request goes to the balancer, which picks a server. Try each strategy.",
      knobs: [choice("algo", "Strategy", ["Round robin", "Random", "Least busy"], 0)],
      metrics: [M.p95(), busiest, M.errors()],
      parts: [{ node: "lb", text: "Load balancer: picks a server for each request." }],
      beats: [
        { id: "turns", when: { wait: 0 }, text: "The balancer takes the servers in turn: [[round-robin|round robin]].", focus: { nodes: ["lb"] }, term: "round-robin" },
        { id: "shared", when: { metric: M.busy(["s3"]), is: ">", value: 0.5 }, text: "Server 3 is busy now too: every server takes a share.", focus: { nodes: ["s3"], sockets: true } },
        { id: "compare", when: { metric: M.p95(), is: "<", value: 650, forMs: 400 }, text: "The slowest 1 in 20: {p95:fix} here, {p95:problem} without the balancer.", focus: { metric: "Response time" } },
      ],
      invite: [{ id: "invite", when: { wait: 0 }, text: "Try “Least busy”: it steers new work away from servers stuck on heavy requests.", focus: { knob: "algo" } }],
      headline: {
        metric: "Response time",
        sentence: "Same traffic. Stuck to one server each, the slowest 1 in 20 took {p95:problem}; balanced, {p95:fix}.",
      },
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
    },
  ],
  checks: [
    {
      prompt: "Some requests cost three times more. Which strategy copes best?",
      options: ["Round robin", "Random", "Least busy"],
      answer: 2,
      why: "Least busy sends new work to the server with the fewest requests in hand, so heavy ones don't pile up.",
      focus: { nodes: ["lb"] },
    },
    {
      prompt: "Why did Server 3 sit idle without a balancer?",
      options: ["It was slower", "Only the Americas' few requests could reach it", "It had crashed"],
      answer: 1,
      why: "Each region was stuck with one server, so spare capacity elsewhere couldn't help Europe.",
      focus: { nodes: ["s3"] },
    },
  ],
  takeaways: {
    use: "Use one whenever you run more than one copy of a service, which is almost always.",
    catch: "The balancer is now on every request path. Run at least two, and pick an algorithm that suits your request costs.",
    seen: "Nginx, HAProxy, AWS ALB, Envoy, and Kubernetes Services.",
    rule: "Share the work, not just the servers.",
  },
};

const S2_DOWN = "Server 2 crashed";
const S2_BACK = "Server 2 is back";
const crashS2 = fault("crash-s2", "Crash server 2", "Restore server 2", S2_DOWN, S2_BACK, (sim) => sim.nodes.get("s2")?.up === false);
const inRotation = { id: "inRotation" as const, label: "Servers in use", nodes: ["lb"], hint: "Servers the balancer is sending traffic to." };
const errorsF4 = M.errors();

const healthScene = (checkEvery: number | null) =>
  scene(
    [
      users("u", [8, 50], { rate: 36, keys: 50 }, "lb"),
      balancer("lb", [42, 50], ["s1", "s2", "s3"], {
        health: checkEvery ? { everyMs: checkEvery, failAfter: 2, passAfter: 2, timeoutMs: 150 } : undefined,
      }),
      ...range(3).map((i) => server(`s${i + 1}`, [86, lane(3, i)], { slots: 4, serviceMs: 100, label: `Server ${i + 1}` })),
    ],
    { script: armedCrash("s2", 1000, 1800, S2_DOWN, S2_BACK), wideH: 460 },
  );

const health: Lesson = {
  slug: "health-checks",
  code: "F4",
  line: "foundations",
  title: "Health checks & failover",
  why: "Servers crash. A load balancer that keeps sending traffic to a dead one turns one failure into errors for everyone.",
  level: "beginner",
  minutes: 6,
  hook: "A server dies. Why do a third of your users still see errors?",
  dots: ["req", "late", "ok", "failed", "probe"],
  figures: [
    {
      tone: "problem",
      short: "No checks",
      title: "The balancer can't tell server 2 is dead",
      caption: "Three servers behind a balancer that never checks on them. 36 requests a second.",
      actions: [crashS2],
      metrics: [errorsF4, M.p95(), inRotation],
      parts: [
        { node: "u", text: "Users: 36 requests a second." },
        { node: "lb", text: "Load balancer: takes the servers in turn." },
        { node: ["s1", "s2", "s3"], text: "Servers: 4 workers each, 100 ms." },
      ],
      beats: [
        { id: "spread", when: { at: 300 }, text: "Watch the balancer share 36 a second across three servers.", focus: { nodes: ["lb"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Crash server 2.", focus: { action: "crash-s2" }, pause: true },
        { id: "down", when: { note: S2_DOWN }, text: "Server 2 is down, but the balancer still sends it every third request.", focus: { nodes: ["s2", "lb"] }, pause: true },
        { id: "failing", when: { metric: errorsF4, is: ">", value: 0.25 }, text: "Those come back as red diamonds: {errors:problem} of all requests fail.", focus: { dots: "failed" } },
        { id: "back", when: { note: S2_BACK }, text: "Server 2 is back. Nobody told the balancer either way.", focus: { nodes: ["s2"] } },
      ],
      predict: {
        prompt: "Server 2 is about to crash, and the balancer won't know. What share of requests will fail?",
        options: ["None", "About a third", "All of them"],
        answer: 1,
        before: "press",
        reveal: { beat: "failing", text: "{after} failed: every request the balancer still sends to Server 2." },
        track: { metric: errorsF4 },
        holds: (_, after) => after !== null && after > 0.2 && after < 0.5,
      },
      break: { action: "crash-s2", beat: "press" },
      build: () => healthScene(null),
    },
    {
      tone: "fix",
      short: "Health checks",
      title: "The balancer pings each server",
      caption: "The balancer pings each server. Two missed pings and it stops sending work there.",
      knobs: [knob("every", "Check every", 40, 400, 20, 100, (v) => `${v} ms`)],
      actions: [crashS2],
      metrics: [errorsF4, M.p95(), inRotation],
      parts: [{ node: "lb", text: "Load balancer: now pings each server every 100 ms." }],
      beats: [
        { id: "pings", when: { wait: 0 }, text: "The small hollow rings are its pings: a [[health-check|health check]].", focus: { nodes: ["lb"] }, term: "health-check" },
        { id: "press2", when: { wait: 0 }, text: "Press ⚡ Crash server 2 again: same crash, both worlds.", focus: { action: "crash-s2" }, pause: true },
        { id: "out", when: { metric: inRotation, is: "<", value: 3 }, text: "Two missed pings: Server 2 is taken out. Its share goes elsewhere.", focus: { nodes: ["s2"] } },
        { id: "compare", when: { metric: errorsF4, is: "<", value: 0.05 }, text: "Failed here: {errors:fix}. Without checks: {errors:problem}.", focus: { metric: "Failed" } },
        { id: "rejoin", when: { metric: inRotation, is: ">", value: 2.5 }, text: "Server 2 answers its pings again and rejoins.", focus: { nodes: ["s2"] } },
      ],
      break: { action: "crash-s2", beat: "press2" },
      invite: [{ id: "invite", when: { wait: 0 }, text: "Drag Check every to 400 ms and crash it again: more requests fail first.", focus: { knob: "every" } }],
      headline: { metric: "Failed", sentence: "Same crash. Without checks, {errors:problem} of requests failed; with them, {errors:fix}.", at: "compare" },
      build: (v) => healthScene(v.every),
    },
  ],
  checks: [
    {
      prompt: "Why does every third request fail without health checks?",
      options: ["Server 2 is slow", "The balancer keeps giving Server 2 its turn", "The other servers are full"],
      answer: 1,
      why: "The balancer gives each server its turn, alive or not; only checks tell it otherwise.",
      focus: { nodes: ["lb"] },
    },
    {
      prompt: "Checks every 40 ms instead of every 100 ms. What changes?",
      options: ["A dead server is taken out sooner", "A dead server recovers faster", "Nothing"],
      answer: 0,
      why: "Two missed checks come sooner, so fewer requests go to a dead server. Checking more often costs traffic.",
      focus: { nodes: ["lb"] },
    },
  ],
  takeaways: {
    use: "Use them on anything behind a load balancer, or anything a scheduler restarts.",
    catch: "Checks that are too eager flap healthy servers in and out. Checks that are too lazy leave dead ones in for longer.",
    seen: "Load balancer target health, Kubernetes liveness and readiness probes, Consul checks.",
    rule: "Stop sending work to the dead.",
  },
};

export const foundations = [latency, scaling, balancing, health];
