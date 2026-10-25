import { M, balancer, knob, lane, range, scene, server, users, wave } from "../kit";
import type { LessonScene, Values } from "../types";

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

const autoscaling: LessonScene = {
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

export default autoscaling;
