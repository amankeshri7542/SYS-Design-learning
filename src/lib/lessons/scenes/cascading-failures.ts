import { armedCrash, balancer, choice, fault, knob, lane, range, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";

// R6: 270 requests a second over servers that each handle 80 (4 workers, 50 ms). Each crashes if more than 16 wait for
// 0.4 s, and comes back 0.7 s later with its workers returning over 1.2 s. Four servers run at 84%; crash one and the
// other three need 112% each, so they fall one by one, and restarts come back cold and fall again. Five servers (68%
// each) can lose one; shedding past 8 waiting keeps any server from being swamped long enough to crash.

const CRASH = "Server 1 crashes";
const BACK = "Server 1 is restored";
const crash1 = fault("crash-1", "Crash server 1", "Restore server 1", CRASH, BACK, (s) => s.nodes.get("s1")?.up === false);

const fleet = (count: number, shed: boolean) => {
  const ids = range(count).map((i) => `s${i + 1}`);
  return scene(
    [
      users("u", [8, 50], { rate: 270, keys: 50 }, "lb"),
      balancer("lb", [36, 50], ids, { label: "Balancer", health: { everyMs: 60, failAfter: 2, passAfter: 2, timeoutMs: 200 } }),
      ...ids.map((id, i) =>
        server(id, [74, lane(count, i)], {
          label: `Server ${i + 1}`,
          slots: 4,
          serviceMs: 50,
          queueMax: 60,
          overload: { queueAbove: 16, forMs: 400, restartMs: 700, warmMs: 1200 },
          shed: shed ? { queueAbove: 8 } : undefined,
        }),
      ),
    ],
    { windowMs: 1500, seed: 18, script: armedCrash("s1", 1200, 3000, CRASH, BACK) },
  );
};

const answered: MetricSpec = { id: "answered", label: "Answered", hint: "Share of requests that got an answer (not an error, not turned away)." };
const inRotation: MetricSpec = { id: "inRotation", label: "Servers in rotation", nodes: ["lb"], hint: "Servers the balancer is sending traffic to right now." };
const turned: MetricSpec = { id: "rejected", label: "Turned away", hint: "Requests a server refused at once rather than queue." };
const metrics = [answered, inRotation, turned];

const cascading: LessonScene = {
  hook: "How does one crashed server take down all the others?",
  dots: ["req", "late", "ok", "gaveup", "turned", "failed"],
  figures: [
    {
      tone: "problem",
      short: "Dominoes",
      title: "No room to spare",
      caption: "Four servers, each 84% busy. A server swamped for 0.4 s crashes, then restarts cold.",
      actions: [crash1],
      metrics,
      parts: [
        { node: "u", text: "Users: 270 requests a second." },
        { node: "lb", text: "Balancer: skips servers that fail its checks." },
        { node: ["s1", "s2", "s3", "s4"], text: "Servers: 4 of them, each 84% busy.", sockets: true },
      ],
      beats: [
        { id: "busy", when: { at: 300 }, text: "Each server is 84% busy: fine, as long as all four stay up.", focus: { nodes: ["s1", "s2", "s3", "s4"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Crash server 1.", focus: { action: "crash-1" }, pause: true },
        { id: "spill", when: { note: CRASH }, text: "Its users spill onto the other three: each now needs 112% of itself.", focus: { nodes: ["s2", "s3", "s4"], dots: "waiting" } },
        {
          id: "domino",
          when: { fx: "crash" },
          text: "Another server crashes under the load, then the next: a [[cascade|cascading failure]].",
          focus: { nodes: ["s2", "s3", "s4"] },
          term: "cascade",
        },
        { id: "cold", when: { fx: "recover" }, text: "Restarted servers come back cold, with fewer workers, into the same flood.", focus: { metric: "Servers in rotation" } },
      ],
      predict: {
        prompt: "Server 1 crashes. The other three are 84% busy. They will…",
        options: ["Absorb its share", "Fall over one by one"],
        answer: 1,
        before: "press",
        reveal: { beat: "cold", text: "Answered: {before} before the crash, {after} as the servers fell." },
        track: { metric: answered },
        holds: (before, after) => before !== null && after !== null && before > 0.9 && after < 0.7,
      },
      break: { action: "crash-1", beat: "press" },
      build: () => fleet(4, false),
    },
    {
      tone: "fix",
      short: "Headroom",
      title: "Room to lose one",
      caption: "Five servers, so each is 68% busy. Each turns new work away once 8 are waiting.",
      actions: [crash1],
      knobs: [knob("count", "Servers", 4, 6, 1, 5), choice("shed", "Shedding", ["Off", "On"], 1)],
      metrics,
      beats: [
        {
          id: "room",
          when: { step: "enter" },
          text: "Now there's [[headroom]]: lose one server, and four still carry everyone.",
          focus: { nodes: ["s2", "s3", "s4", "s5"] },
          term: "headroom",
        },
        { id: "compare", when: { wait: 0 }, text: "Compare Answered: {answered:fix} here, {answered:problem} as the dominoes fell.", focus: { metric: "Answered" } },
        { id: "four", when: { wait: 600 }, text: "Drag Servers to 4 with Shedding on: some are turned away, but none crash.", focus: { knob: "count" } },
      ],
      headline: { metric: "Answered", sentence: "Server 1 crashed: {answered:problem} answered with no room to spare, {answered:fix} with headroom and shedding.", at: "cold" },
      build: (v: Values) => fleet(v.count, v.shed === 1),
    },
  ],
  checks: [
    {
      prompt: "Four servers run at 80%. One dies. How busy are the other three?",
      options: ["80%", "About 107%"],
      answer: 1,
      why: "Its share lands on the others: 4 × 80% of work over 3 servers is about 107% each. More than they have.",
      focus: { nodes: ["s2", "s3", "s4"] },
    },
    {
      prompt: "A crashed server restarts into the same overload. What happens?",
      options: ["It recovers", "It crashes again, and again"],
      answer: 1,
      why: "It comes back cold, with less capacity, into more work than before. Without shedding it falls again.",
      focus: { metric: "Servers in rotation" },
    },
  ],
  takeaways: {
    use: "Run with room to lose a server (N+1), shed load before servers fall over, and bring restarts back slowly.",
    catch: "Headroom costs money every day for the day you need it. Shedding alone keeps you up, but turns users away.",
    seen: "Region failovers that overload the survivor, retry storms, the 2017 S3 outage and many postmortems like it.",
    rule: "Leave room to lose one.",
    interview: "Say: “I'd keep N+1 capacity, shed load past a queue limit, and ramp restarts so they don't fall again.”",
  },
};

export default cascading;
