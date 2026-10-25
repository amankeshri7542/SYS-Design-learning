import { M, armed, database, fault, knob, ms, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { SceneSpec } from "../../sim/types";

// A4: shoppers pay through a payments service that records each charge in a ledger; a shopper who hears nothing within
// 0.4 s pays again. When the ledger slows to 0.6 s a charge, the first attempt is still charged after the shopper has
// retried, so the retry is charged too. With an idempotency key (a retry keeps its payment's identity), the ledger
// records each payment once and replays its result for a repeat.

const SLOW = "The ledger slows down";
const FAST = "The ledger is fast again";
const slowLedger = fault("slow-ledger", "Slow the ledger", "Speed it up again", SLOW, FAST, (s) => (s.nodes.get("ledger")?.spec.serviceMs ?? 0) > 200);

/** `keyed`: the ledger keeps each payment's result by key. `retryMs`: when a shopper pays again. */
const payments = (keyed: boolean, retryMs: number, slow = false): SceneSpec =>
  scene(
    [
      users("u", [8, 50], { rate: 20, keys: 50, writes: 1, timeoutMs: retryMs, retry: { mode: "now", max: 2 } }, "pay", { label: "Shoppers" }),
      server("pay", [46, 50], { label: "Payments", slots: 16, serviceMs: 10, to: ["ledger"] }),
      database("ledger", [86, 50], { label: "Ledger", slots: 16, serviceMs: slow ? 600 : 50, idempotent: keyed }),
    ],
    {
      windowMs: 2000,
      seed: 24,
      script: armed(
        { node: "ledger", at: 1200, lastsMs: 3000, start: SLOW, end: FAST },
        { start: (s) => s.reconfigure(payments(keyed, retryMs, true)), end: (s) => s.reconfigure(payments(keyed, retryMs)) },
      ),
    },
  );

const charged: MetricSpec = { id: "duplicates", label: "Charged twice", nodes: ["ledger"], hint: "Payments the ledger recorded a second time, in the window." };
const metrics = [charged, M.errors(), M.p95()];

const idempotency: LessonScene = {
  hook: "A payment times out, so the shopper pays again. Were they charged twice?",
  dots: ["req", "late", "ok", "gaveup", "failed"],
  figures: [
    {
      tone: "problem",
      short: "No key",
      title: "Pay, wait, pay again",
      caption: "Shoppers pay again if they hear nothing within 0.4 s. The ledger records every charge it's sent.",
      actions: [slowLedger],
      metrics,
      parts: [
        { node: "u", text: "Shoppers: 20 payments a second, retry after 0.4 s." },
        { node: "pay", text: "Payments: passes each charge to the ledger." },
        { node: "ledger", text: "Ledger: records each charge in 50 ms.", sockets: true },
      ],
      beats: [
        { id: "calm", when: { at: 300 }, text: "Watch a payment go through: charged once, and answered well inside 0.4 s.", focus: { nodes: ["ledger"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Slow the ledger.", focus: { action: "slow-ledger" }, pause: true },
        { id: "retry", when: { fx: "timeout", node: "u" }, text: "A shopper gives up waiting and pays again. The first charge is still going through.", focus: { dots: "gaveup" } },
        { id: "twice", when: { metric: charged, is: ">", value: 0 }, text: "Count Charged twice: {duplicates:ledger}. One purchase, two charges.", focus: { metric: "Charged twice" } },
      ],
      predict: {
        prompt: "The ledger slows to 0.6 s a charge; shoppers pay again after 0.4 s. Some will…",
        options: ["Get an error and pay nothing", "Be charged twice"],
        answer: 1,
        before: "press",
        reveal: { beat: "twice", text: "Charged twice: {before} before, {after} once the ledger slowed." },
        track: { metric: charged },
        holds: (_, after) => after !== null && after >= 1,
      },
      break: { action: "slow-ledger", beat: "press" },
      build: () => payments(false, 400),
    },
    {
      tone: "fix",
      short: "With a key",
      title: "Remember the key",
      caption: "Each payment carries a key that its retries keep. The ledger stores the result per key, and replays it for a repeat.",
      actions: [slowLedger],
      knobs: [knob("retry", "Pay again after", 200, 1000, 50, 400, ms)],
      metrics,
      beats: [
        {
          id: "key",
          when: { step: "enter" },
          text: "Now each payment carries an [[idempotency-key|idempotency key]], and a retry reuses it.",
          focus: { nodes: ["u"] },
          term: "idempotency-key",
        },
        { id: "replay", when: { wait: 0 }, text: "A key the ledger has seen gets the first result back, and no second charge.", focus: { nodes: ["ledger"] } },
        { id: "compare", when: { wait: 0 }, text: "Compare Charged twice: {duplicates:ledger:fix} here, {duplicates:ledger:problem} without keys.", focus: { metric: "Charged twice" } },
        { id: "sooner", when: { wait: 600 }, text: "Drag Pay again after to 0.2 s: more retries, and still one charge each.", focus: { knob: "retry" } },
      ],
      headline: { metric: "Charged twice", sentence: "Ledger slowed: {duplicates:ledger:problem} payments charged twice without keys, {duplicates:ledger:fix} with idempotency keys.", at: "twice" },
      build: (v: Values) => payments(true, v.retry),
    },
  ],
  checks: [
    {
      prompt: "When is a retry safe?",
      options: ["When doing it twice has the same effect as once", "When the first attempt failed"],
      answer: 0,
      why: "The client can't tell a failure from a slow success. Only an idempotent operation makes retrying harmless.",
      focus: { nodes: ["ledger"] },
    },
    {
      prompt: "Who makes up the idempotency key?",
      options: ["The client, once per purchase", "The server, once per request"],
      answer: 0,
      why: "The key must stay the same across retries, so the client chooses it before the first attempt.",
      focus: { nodes: ["u"] },
    },
  ],
  takeaways: {
    use: "Any write a client may retry, payments above all: send a key per operation, and store the result per key.",
    catch: "The key store must be checked and written atomically with the effect, and keys must live longer than any retry.",
    seen: "Stripe's Idempotency-Key header, PayPal request ids, AWS client tokens.",
    rule: "Same key, same result.",
  },
};

export default idempotency;
