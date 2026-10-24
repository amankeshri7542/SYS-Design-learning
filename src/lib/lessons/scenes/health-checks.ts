import { M, armedCrash, balancer, fault, knob, lane, range, scene, server, users } from "../kit";
import type { LessonScene } from "../types";

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

const health: LessonScene = {
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

export default health;
