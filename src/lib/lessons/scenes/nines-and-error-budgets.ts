import { M, armedCrash, balancer, choice, fault, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";

// F6: availability is the share of requests answered well and on time, measured over a long window (20 s here, in
// place of a month), against a target. The error budget is what the target still allows. One server that crashes for
// 0.4 s spends a 99% budget in one go; two servers with health checks lose only the requests sent before the balancer
// notices, and keep most of it. The table draws the budget left as a gauge.

const CRASH = "Server 1 crashes";
const BACK = "Server 1 is back";
const crash1 = fault("crash-1", "Crash server 1", "Restore server 1", CRASH, BACK, (s) => s.nodes.get("s1")?.up === false);
const TARGETS = [0.99, 0.999, 0.9999];

const service = (two: boolean, target: number) =>
  scene(
    two
      ? [
          users("u", [8, 50], { rate: 60, keys: 50 }, "lb"),
          balancer("lb", [40, 50], ["s1", "s2"], { label: "Balancer", health: { everyMs: 25, failAfter: 2, passAfter: 2, timeoutMs: 150 } }),
          server("s1", [80, 28], { label: "Server 1", slots: 8, serviceMs: 40 }),
          server("s2", [80, 72], { label: "Server 2", slots: 8, serviceMs: 40 }),
        ]
      : [users("u", [8, 50], { rate: 60, keys: 50 }, "s1"), server("s1", [80, 28], { label: "Server 1", slots: 8, serviceMs: 40 })],
    // Twelve seconds of traffic before the scene is shown, so the long window already holds about 720 answers.
    { sloWindowMs: 20_000, sloTarget: target, windowMs: 1500, seed: 14, warmMs: 12_000, script: armedCrash("s1", 13_200, 400, CRASH, BACK) },
  );

const available: MetricSpec = { id: "availability", label: "Answered on time", hint: "Share of requests answered well within the 400 ms target, over the last 20 s." };
const budget: MetricSpec = { id: "budget", label: "Error budget left", hint: "How much of the failures the target allows are still unspent." };
const metrics = [available, budget, M.errors()];

const nines: LessonScene = {
  hook: "What does “99.9% up” actually promise, and what spends it?",
  dots: ["req", "late", "ok", "failed"],
  figures: [
    {
      tone: "problem",
      short: "One server",
      title: "One server, one crash",
      caption: "Every request goes to one server. The promise: 99 of every 100 answered within 400 ms.",
      actions: [crash1],
      metrics,
      parts: [
        { node: "u", text: "Users: 60 requests a second." },
        { node: "s1", text: "Server 1: the only one, 8 workers.", sockets: true },
      ],
      beats: [
        {
          id: "avail",
          when: { at: 500 },
          text: "Read Answered on time: {availability}. That share is the [[availability]].",
          focus: { metric: "Answered on time" },
          term: "availability",
        },
        {
          id: "budget",
          when: { wait: 0 },
          text: "The promise allows 1 in 100 to fail or run late: the [[error-budget|error budget]].",
          focus: { metric: "Error budget left" },
          term: "error-budget",
        },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Crash server 1.", focus: { action: "crash-1" }, pause: true },
        { id: "down", when: { note: CRASH }, text: "Every request fails while it's down: there's no other server to go to.", focus: { dots: "failed" } },
        { id: "spent", when: { metric: budget, is: "<", value: 0.05 }, text: "Read Error budget left: {budget}. A 0.4 s crash spent all of it.", focus: { metric: "Error budget left" } },
      ],
      predict: {
        prompt: "Server 1 will be down for 0.4 s. How much of the error budget will that spend?",
        options: ["A little of it", "All of it"],
        answer: 1,
        before: "press",
        reveal: { beat: "spent", text: "Error budget left: {before} before the crash, {after} after it." },
        track: { metric: budget },
        holds: (before, after) => before !== null && after !== null && before > 0.9 && after < 0.05,
      },
      break: { action: "crash-1", beat: "press" },
      build: () => service(false, 0.99),
    },
    {
      tone: "fix",
      short: "Two servers",
      title: "Two servers and health checks",
      caption: "Two servers behind a balancer that checks each one every 25 ms. The same crash, and a target you choose.",
      actions: [crash1],
      knobs: [choice("target", "Target", ["99%", "99.9%", "99.99%"], 0)],
      metrics,
      beats: [
        { id: "two", when: { step: "enter" }, text: "Now a crash takes half the servers, and the balancer stops using it within 0.1 s.", focus: { nodes: ["lb"] } },
        { id: "compare", when: { wait: 0 }, text: "Compare Error budget left: {budget:fix} here, {budget:problem} with one server.", focus: { metric: "Error budget left" } },
        { id: "nines", when: { wait: 0 }, text: "Read Answered on time: {availability:fix}. Each extra nine allows ten times fewer failures.", focus: { metric: "Answered on time" } },
        { id: "stricter", when: { wait: 600 }, text: "Switch Target to 99.9%: the same short crash spends the whole budget.", focus: { knob: "target" } },
      ],
      headline: {
        metric: "Error budget left",
        sentence: "One 0.4 s crash: {budget:problem} of the budget left with one server, {budget:fix} with two and health checks.",
        at: "spent",
      },
      build: (v: Values) => service(true, TARGETS[v.target]),
    },
  ],
  checks: [
    {
      prompt: "A service promises 99.9% a month. About how long may it be down?",
      options: ["About 43 minutes", "About 7 hours"],
      answer: 0,
      why: "0.1% of a 30-day month is about 43 minutes. 99% would allow about 7 hours.",
      focus: { metric: "Error budget left" },
    },
    {
      prompt: "The budget is nearly spent with a week to go. What do teams usually do?",
      options: ["Ship faster to catch up", "Slow risky changes until it recovers"],
      answer: 1,
      why: "The budget is permission to take risks. Once it's spent, changes wait and reliability work comes first.",
      focus: { metric: "Error budget left" },
    },
  ],
  takeaways: {
    use: "Set a target on what users feel (answered well, on time), then spend the budget it allows on change.",
    catch: "Each nine costs far more than the last: 99.99% leaves about 4 minutes a month for every failure.",
    seen: "Google's SRE practice, cloud provider SLAs, status pages that count minutes of downtime.",
    rule: "Up is a number with a budget.",
  },
};

export default nines;
