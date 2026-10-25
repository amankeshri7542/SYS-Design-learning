import type { MetricSpec } from "../../sim/metrics";
import type { NodeSpec, SceneSpec } from "../../sim/types";
import { M, scene, server, users } from "../kit";
import type { StoryDef, StoryStage } from "../story";
import type { Values } from "../types";

// S7: an order is three steps: charge the card, reserve the stock, book the shipping. A shopper who hears nothing in
// 0.6 s pays again. The target: no card charged twice, and no order left half-done. Stages lose replies from the card
// network (shoppers pay again: idempotency keys), fail shipping halfway (a saga refunds and releases), and slow the
// card network until a shopper's second try arrives while the first charge is still running (the keyed note is only
// written when a charge ends, so hold each payment's key while it is charged: a lock).

const PRICE = { base: 120, keys: 5, saga: 20, lock: 15 };
const START: Values = { keys: 0, saga: 0, lock: 0 };

function shop(a: Values, s: StoryStage): SceneSpec {
  const { loss, fails, slow } = s.params;
  const pay = a.lock ? "lk" : "prov";
  const nodes: NodeSpec[] = [
    users("u", [6, 50], { rate: 20, keys: 5000, writes: 1, timeoutMs: 600, retry: { mode: "now", max: 2 } }, "orders", { label: "Shoppers" }),
    server("orders", [32, 50], {
      label: "Orders",
      slots: 64,
      serviceMs: 2,
      blocking: true,
      calls: { write: [pay, "stock", "ship"] },
      saga: a.saga ? { undo: [pay, "stock", "ship"] } : undefined,
      callTimeoutMs: 1500,
    }),
    server("prov", [88, 18], { label: "Card network", slots: 32, serviceMs: slow ? 700 : 40, idempotent: !!a.keys }),
    server("stock", [88, 50], { label: "Stock", slots: 16, serviceMs: 10 }),
    server("ship", [88, 82], { label: "Shipping", slots: 16, serviceMs: 10, failRate: fails || undefined }),
  ];
  if (a.lock) nodes.push({ id: "lk", kind: "server", label: "Payment locks", at: [58, 18], lock: { leaseMs: 2000 }, to: ["prov"] });
  // The card network is far away, over a link that loses replies.
  const far = { ms: 10, loss };
  return scene(nodes, {
    links: { "orders>prov": far, "lk>prov": far, "orders>lk": 2, "orders>stock": 5, "orders>ship": 5 },
    windowMs: 3000,
    wideH: 440,
  });
}

const twice: MetricSpec = { id: "duplicates", label: "Charged twice", nodes: ["prov"], hint: "Cards charged a second time for the same payment, in the window." };
const halfDone: MetricSpec = { id: "inconsistent", label: "Half-done orders", hint: "Orders that charged a card or took stock and then failed, with nothing put back, in the window." };

/** Charge exactly once: four stages, from a quiet shop to a slow card network over a lossy link. */
const payments: StoryDef = {
  controls: [
    { kind: "switch", id: "keys", label: "Idempotency keys" },
    { kind: "switch", id: "saga", label: "Undo on failure" },
    { kind: "switch", id: "lock", label: "Lock each payment" },
  ],
  start: START,
  cost: (a) => PRICE.base + a.keys * PRICE.keys + a.saga * PRICE.saga + a.lock * PRICE.lock,
  scene: shop,
  targets: [
    { metric: twice, label: "Charged twice", max: 0 },
    { metric: halfDone, label: "Half-done orders", max: 0 },
  ],
  metrics: [M.p95({ label: "Order time" }), M.errors({ id: "rejected", label: "Cancelled", hint: "Share of orders that failed and were undone cleanly." })],
  win: (cost) => `Your shop charged every card exactly once through all four stages for $${cost} a month. Can a cheaper design hold the last one?`,
  lead: () => "20 a second",
  stages: [
    {
      name: "A quiet shop",
      beats: [
        { id: "steps", when: { step: "enter" }, text: "Each order charges the card, then reserves stock, then books shipping.", focus: { nodes: ["orders"] } },
        { id: "far", when: { wait: 0 }, text: "Watch the Card network: far away, 40 ms a charge.", focus: { nodes: ["prov"] } },
      ],
      brief: "A quiet day. Check that every order is charged once and finished.",
      hint: "Nothing to change yet.",
      params: { loss: 0, fails: 0, slow: 0 },
      hold: 6,
      solution: START,
    },
    {
      name: "Lost replies",
      beats: [
        { id: "lost", when: { step: "enter" }, text: "Now the link loses one message in ten, replies included.", focus: { link: ["orders", "prov"] } },
        { id: "again", when: { wait: 0 }, text: "Watch a shopper who hears nothing pay again, and get charged again.", focus: { nodes: ["prov"] } },
      ],
      brief: "The card network's link drops replies now and then. The card was charged; the shopper never heard, and pays again.",
      hint: "Give each payment an identity that its retries keep, and let the card network remember it.",
      params: { loss: 0.1, fails: 0, slow: 0 },
      hold: 8,
      solution: { ...START, keys: 1 },
    },
    {
      name: "Shipping fails",
      beats: [
        { id: "fail", when: { step: "enter" }, text: "Now shipping fails one order in ten, after the card is charged.", focus: { nodes: ["ship"] } },
        { id: "half", when: { wait: 0 }, text: "Watch Half-done orders: paid and reserved, never shipped.", focus: { nodes: ["orders"] } },
      ],
      brief: "Shipping fails now and then, after the card was charged and the stock reserved. Nothing gives them back.",
      hint: "When a step fails, undo the steps already done, in reverse.",
      params: { loss: 0.1, fails: 0.1, slow: 0 },
      hold: 8,
      solution: { ...START, keys: 1, saga: 1 },
    },
    {
      name: "A slow card network",
      beats: [
        { id: "slow", when: { step: "enter" }, text: "Now each charge takes 0.7 s, longer than a shopper waits.", focus: { nodes: ["prov"] } },
        { id: "overlap", when: { wait: 0 }, text: "Watch the second try arrive while the first is still charging.", focus: { nodes: ["prov"] } },
      ],
      brief: "The card network slows down. A shopper pays again before the first charge has finished, so it has no note yet.",
      hint: "Hold each payment's key while it is being charged; a repeat waits, then gets the first one's answer.",
      params: { loss: 0.1, fails: 0.1, slow: 1 },
      hold: 10,
      solution: { ...START, keys: 1, saga: 1, lock: 1 },
    },
  ],
};

export default payments;
