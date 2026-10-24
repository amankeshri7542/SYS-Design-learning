import type { NodeSpec } from "../../sim/types";
import { M, armedCrash, balancer, fault, knob, lane, range, scene, server, users } from "../kit";
import type { LessonScene } from "../types";

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

const scaling: LessonScene = {
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

export default scaling;
