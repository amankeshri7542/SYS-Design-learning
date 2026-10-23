import type { NodeSpec } from "../sim/types";
import { M, armed, balancer, fault, knob, lane, ms, perSecond, range, scene, server, users, wave } from "./kit";
import type { Lesson, Values } from "./types";

const people = () => users("u", [6, 26], { rate: 14, keys: 50, tag: "user" }, "svc", { label: "Users" });
const bot = () => users("bot", [6, 76], { rate: 40, keys: 50, tag: "bot" }, "svc", { label: "Scraper bot", glyph: "bot" });

const unlimited = () =>
  scene([people(), bot(), server("svc", [84, 50], { slots: 4, serviceMs: 100, queueMax: 30, label: "API server" })], { wideH: 440 });

const usersP95 = M.p95({ tag: "user", label: "Users' response time" });

const limiting: Lesson = {
  slug: "rate-limiting",
  code: "R1",
  line: "resilience",
  title: "Rate limiting",
  why: "One misbehaving client can eat all of your capacity. A rate limiter caps each client so that everyone else stays fast.",
  level: "intermediate",
  minutes: 6,
  hook: "One scraper sends more than all your users combined. Why should your users pay for it?",
  dots: ["req", "late", "ok", "failed", "turned"],
  figures: [
    {
      tone: "problem",
      short: "No limit",
      title: "A scraper floods the API",
      caption: "The bot sends 40 a second, nearly three times all the real users combined.",
      metrics: [usersP95, M.errors({ tag: "user", label: "Users failed" }), M.busy(["svc"])],
      parts: [
        { node: "u", text: "Users: 14 requests a second." },
        { node: "bot", text: "Scraper bot: 40 a second." },
        { node: "svc", text: "API server: about 40 a second, 4 workers.", sockets: true },
      ],
      beats: [
        { id: "flood", when: { at: 200 }, text: "Watch the bot's requests crowd the line at API server.", focus: { nodes: ["svc"], dots: "waiting" } },
        { id: "share", when: { wait: 0 }, text: "Real users wait in the same line as the bot.", focus: { nodes: ["u"], link: ["u", "svc"] } },
        {
          id: "slow",
          when: { metric: usersP95, is: ">", value: 400 },
          text: "Users' slowest 1 in 20: {p95:user}, target 400 ms.",
          focus: { metric: "Users' response time" },
          pause: true,
        },
      ],
      predict: {
        prompt: "We cap each client at 16 requests a second. Real users' slowest 1 in 20 will…",
        options: ["stay slow", "get fast again", "be turned away"],
        answer: 1,
        before: "end",
        reveal: { beat: "users", text: "Users' slowest 1 in 20: {before} without a limit, {after} with one." },
        track: { metric: usersP95, world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < 0.5 * before,
      },
      build: unlimited,
    },
    {
      tone: "fix",
      short: "Rate limit",
      title: "A limit per client",
      caption: "Each client gets a steady allowance plus a small burst. Requests over it are turned away at once.",
      knobs: [knob("rps", "Limit per client", 5, 50, 1, 16, perSecond)],
      metrics: [
        usersP95,
        M.errors({ tag: "user", label: "Users failed" }),
        { id: "rejected", label: "Bot turned away", tag: "bot", better: "high", hint: "Share of the bot's requests rejected by the limiter." },
      ],
      parts: [{ node: "lim", text: "Rate limiter: 16 a second per client, plus bursts." }],
      beats: [
        {
          id: "bucket",
          when: { wait: 0 },
          text: "Each client earns 16 tokens a second to spend: a [[token-bucket|token bucket]].",
          focus: { nodes: ["lim"] },
          term: "token-bucket",
        },
        {
          id: "turned",
          when: { fx: "reject", node: "lim" },
          text: "Out of tokens: the bot's request is turned away at once, a grey square.",
          focus: { nodes: ["lim"], dots: "turned" },
          pause: true,
        },
        {
          id: "users",
          when: { metric: usersP95, is: "<", value: 400, forMs: 300 },
          text: "Users' slowest 1 in 20: {p95:user:fix}, down from {p95:user:problem}.",
          focus: { metric: "Users' response time" },
        },
      ],
      invite: [{ id: "invite", when: { wait: 0 }, text: "Drag Limit per client down to 5: real users start being turned away too.", focus: { knob: "rps" } }],
      headline: {
        metric: "Users' response time",
        sentence: "Same flood. Users' slowest 1 in 20 waited {p95:user:problem} without a limit, {p95:user:fix} with one.",
      },
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
  checks: [
    {
      prompt: "The bot is turned away. Where does that happen?",
      options: ["At the API server", "Before the server, at the limiter", "At the bot"],
      answer: 1,
      why: "Its excess never reaches the server, so it costs the server nothing.",
      focus: { nodes: ["lim"] },
    },
    {
      prompt: "A limit set too low…",
      options: ["turns real users away too", "makes the server faster", "has no effect"],
      answer: 0,
      why: "Real users have bursts too; a tight limit turns them away along with the bot.",
      focus: { nodes: ["lim"] },
    },
  ],
  takeaways: {
    use: "Put limits on public APIs, logins and expensive endpoints, set per user, per key or per IP.",
    catch: "Limits that are too tight hurt real users. Spread across many servers, the counters need shared state.",
    seen: "API gateways, Nginx limit_req, Stripe's and GitHub's per-key API limits.",
    rule: "Cap each client; protect everyone else.",
  },
};

const HANG = "Payments starts hanging";
const RECOVER = "Payments recovers";
const hang = fault("hang", "Make payments hang", "Restore payments", HANG, RECOVER, (s) => s.nodes.get("pay")?.up === false);

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
      // Armed: the learner makes payments hang; it recovers 2.4 s later.
      script: armed({ node: "pay", at: 1200, lastsMs: 2400, start: HANG, end: RECOVER }, { start: (s) => s.setUp("pay", false), end: (s) => s.setUp("pay", true) }),
    },
  );

const browse = M.p95({ op: "read", label: "Browsing response time" });

const breakers: Lesson = {
  slug: "circuit-breakers",
  code: "R2",
  line: "resilience",
  title: "Circuit breakers",
  why: "When a dependency hangs, every request waiting on it ties up one of your workers. A breaker notices and fails fast until the dependency recovers.",
  level: "intermediate",
  minutes: 7,
  hook: "Payments stops answering. Why can't customers even browse the shop?",
  dots: ["req", "late", "ok", "gaveup", "turned", "failed"],
  figures: [
    {
      tone: "problem",
      short: "No breaker",
      title: "Waiting on payments that hang",
      caption: "Checkouts call payments and wait up to 0.9 s for it. Browsing doesn't call it at all.",
      actions: [hang],
      metrics: [browse, M.errors({ op: "write", label: "Checkouts failed" }), M.busy(["shop"], "Shop server busy")],
      parts: [
        { node: "u", text: "Shoppers: 30 a second, a third checking out." },
        { node: "shop", text: "Shop server: 8 workers; checkouts wait on payments.", sockets: true },
        { node: "pay", text: "Payments: 4 workers, 60 ms each." },
      ],
      beats: [
        { id: "calm", when: { at: 300 }, text: "Checkouts call Payments; browsing is answered by the shop alone.", focus: { nodes: ["shop"], link: ["shop", "pay"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Make payments hang.", focus: { action: "hang" }, pause: true },
        {
          id: "stuck",
          when: { note: HANG },
          text: "Payments takes requests and never answers. Each checkout holds a worker, waiting.",
          focus: { nodes: ["shop"], sockets: true },
          pause: true,
        },
        {
          id: "full",
          when: { metric: M.busy(["shop"]), is: ">", value: 0.9 },
          text: "Every worker is stuck. Even browsing now waits in line.",
          focus: { nodes: ["shop"], dots: "waiting" },
        },
        {
          id: "browse",
          when: { metric: browse, is: ">", value: 400 },
          text: "Browsing's slowest 1 in 20: {p95:problem}, though browsing never calls Payments.",
          focus: { metric: "Browsing response time" },
        },
      ],
      predict: {
        prompt: "Payments is about to hang. Browsing never calls it. Browsing will…",
        options: ["carry on as normal", "slow down too", "fail outright"],
        answer: 1,
        before: "press",
        reveal: { beat: "browse", text: "Browsing's slowest 1 in 20 went from {before} to {after}." },
        track: { metric: browse },
        holds: (before, after) => before !== null && after !== null && after > 2 * before,
      },
      break: { action: "hang", beat: "press" },
      build: () => shop(undefined),
    },
    {
      tone: "fix",
      short: "Breaker",
      title: "Stop calling after repeated failures",
      caption: "After five failures in a row, the shop stops calling payments for a cool-down.",
      knobs: [knob("cool", "Cool-down", 200, 2000, 100, 600, ms)],
      actions: [hang],
      metrics: [browse, { id: "fallback", label: "Checkouts fast-failed", op: "write", hint: "Checkouts answered instantly by the open breaker." }, M.busy(["shop"], "Shop server busy")],
      beats: [
        { id: "press2", when: { wait: 0 }, text: "Press ⚡ Make payments hang: same fault, both worlds.", focus: { action: "hang" }, pause: true },
        {
          id: "hanging",
          when: { note: HANG },
          text: "Payments hangs here too. Checkouts wait up to 0.9 s, then fail. Watch Shop server's pill.",
          focus: { nodes: ["shop"] },
        },
        {
          id: "open",
          when: { fx: "open", node: "shop" },
          text: "Five failures in a row: the [[circuit-breaker|circuit breaker]] opens. Checkouts now fail fast: grey squares.",
          focus: { nodes: ["shop"], dots: "turned" },
          pause: true,
          term: "circuit-breaker",
        },
        {
          id: "browsing",
          when: { wait: 0 },
          text: "Browsing's slowest 1 in 20: {p95:fix} here, {p95:problem} without a breaker.",
          focus: { metric: "Browsing response time" },
        },
        { id: "close", when: { fx: "close", node: "shop" }, text: "Payments is back. One trial call works, so the breaker closes.", focus: { nodes: ["shop"] } },
      ],
      break: { action: "hang", beat: "press2" },
      headline: {
        metric: "Browsing response time",
        sentence: "Same hang. Browsing's slowest 1 in 20 took {p95:problem} without a breaker, {p95:fix} with one.",
        at: "browsing",
      },
      build: (v) => shop({ threshold: 5, cooldownMs: v.cool }),
    },
  ],
  checks: [
    {
      prompt: "Why did browsing slow down without a breaker?",
      options: ["Browsing calls payments", "Stuck checkouts held every worker", "The database was slow"],
      answer: 1,
      why: "Each hung checkout held a worker; with none free, browsing waited in line too.",
      focus: { nodes: ["shop"], sockets: true },
    },
    {
      prompt: "After the cool-down, the breaker…",
      options: ["closes for good", "lets one trial call through", "stays open"],
      answer: 1,
      why: "One trial tests payments: success closes the breaker, failure opens it again.",
      focus: { nodes: ["shop"] },
    },
  ],
  takeaways: {
    use: "Wrap every call to a remote dependency that can slow down or hang, especially non-critical ones.",
    catch: "Users still lose the feature while the breaker is open. Design what they see instead: a fallback, a cached value, or a clear message.",
    seen: "Resilience4j, Polly, Envoy outlier detection, Netflix Hystrix.",
    rule: "Fail fast when a dependency hangs.",
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
  level: "intermediate",
  minutes: 7,
  hook: "Traffic doubles every afternoon and drops at night. How many servers should you pay for?",
  dots: ["req", "late", "ok", "failed"],
  figures: [
    {
      tone: "problem",
      short: "Fixed fleet",
      title: "A fixed number of servers",
      caption: "Two servers cope at night and drown at the daily peak. Try more with the knob.",
      knobs: [knob("n", "Servers", 1, 6, 1, 2)],
      metrics: [M.p95(), servers, avgBusy],
      parts: [
        { node: "u", text: "Users: 6 to 66 a second over the day." },
        { node: "lb", text: "Load balancer: shares requests between the servers." },
        { node: ["s1", "s2"], text: "Servers: 3 workers each, 100 ms." },
      ],
      beats: [
        { id: "night", when: { at: 200 }, text: "Night: two servers handle the quiet traffic easily.", focus: { nodes: ["s1", "s2"] } },
        {
          id: "rise",
          when: { metric: M.load(["lb"], "Arriving"), is: ">", value: 35 },
          text: "Afternoon: traffic climbs past 35 a second. Watch the lines form.",
          focus: { nodes: ["s1", "s2"], dots: "waiting" },
        },
        {
          id: "peak",
          when: { metric: M.p95(), is: ">", value: 400 },
          text: "At the peak, two servers drown: the slowest 1 in 20 takes {p95:problem}.",
          focus: { nodes: ["s1"], dots: "waiting" },
          pause: true,
        },
        { id: "knob", when: { wait: 0 }, text: "Drag Servers to 6: the peak is fine, but most sit idle at night.", focus: { knob: "n" } },
      ],
      predict: {
        prompt: "A controller adds servers when they're busy and drains them when quiet. At the peak, the slowest 1 in 20 will…",
        options: ["stay near the target", "be just as slow", "be slower"],
        answer: 0,
        before: "end",
        reveal: { beat: "busiest", text: "At the peak: {before} with two fixed servers, {after} autoscaled." },
        track: { metric: M.p95(), world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < 0.6 * before,
      },
      build: fixedFleet,
    },
    {
      tone: "fix",
      short: "Autoscale",
      title: "Scale to a target utilisation",
      caption: "Every quarter-second the autoscaler compares how busy the servers are with its target, then starts or drains one.",
      knobs: [knob("target", "Target busy", 0.4, 0.9, 0.05, 0.6, (v) => `${Math.round(v * 100)}%`)],
      metrics: [M.p95(), servers, avgBusy],
      parts: [{ node: "lb", text: "Autoscaler: aims for 60% busy; starts or drains servers." }],
      beats: [
        {
          id: "boot",
          when: { fx: "boot" },
          text: "Busier than 60%: it starts a server, dashed while it boots for 0.5 s.",
          focus: { nodes: ["lb"] },
        },
        {
          id: "busiest",
          when: { metric: servers, is: ">", value: 3 },
          text: "Near the peak it runs {servers:fix} servers. The slowest 1 in 20: {p95:fix}.",
          focus: { metric: "Servers running" },
        },
        {
          id: "drain",
          when: { metric: servers, is: "<", value: 3 },
          text: "Traffic falls, so it drains the spares. You pay for what the hour needs.",
          focus: { metric: "Servers running" },
        },
      ],
      invite: [{ id: "invite", when: { wait: 0 }, text: "Drag Target busy to 90%: fewer servers, longer lines at the peak.", focus: { knob: "target" } }],
      headline: {
        metric: "Response time",
        sentence: "Same day of traffic. At the peak, two fixed servers: {p95:problem}. Autoscaled to {servers:fix} servers: {p95:fix}.",
        at: "busiest",
      },
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
  checks: [
    {
      prompt: "Why does a sudden spike still hurt with autoscaling?",
      options: ["The autoscaler is off", "New servers take time to boot", "The servers are too small"],
      answer: 1,
      why: "A server starts only once load has risen, and it needs its warm-up before it helps.",
      focus: { nodes: ["lb"] },
    },
    {
      prompt: "Average busy rises at night with autoscaling. Is that bad?",
      options: ["Yes, servers are overworked", "No: fewer servers are doing the same work", "It means traffic grew"],
      answer: 1,
      why: "It aims at a target; running fewer, busier servers at night is the saving.",
      focus: { nodes: ["lb"] },
    },
  ],
  takeaways: {
    use: "Use it for stateless services whose load varies by hour, by day or with marketing pushes.",
    catch: "New servers take time to boot, so sudden spikes still hurt. Keep some headroom, and scale on a signal that leads the load.",
    seen: "AWS Auto Scaling target tracking, the Kubernetes Horizontal Pod Autoscaler, Cloud Run.",
    rule: "Pay for the hour you're in.",
  },
};

export const resilienceLessons = [limiting, breakers, autoscaling];
