import { M, armedCrash, fault, scene, server, users } from "../kit";
import type { LessonScene } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { SceneSpec } from "../../sim/types";

// A9: an order is three steps in three services: take the payment, reserve the stock, book the shipping. When shipping
// fails, the money is taken and the stock held for an order that will never ship. A saga undoes the steps already done,
// in reverse: release the stock, refund the payment, and the order ends cancelled, cleanly. Nothing is isolated while it
// runs, though: others can see the stock taken until it is released.

const CRASH = "Shipping goes down";
const BACK = "Shipping is back";
const crashShip = fault("crash-ship", "Crash shipping", "Restore shipping", CRASH, BACK, (s) => s.nodes.get("ship")?.up === false);

/** `saga`: a failed step undoes the steps before it. */
const shop = (saga: boolean): SceneSpec =>
  scene(
    [
      users("u", [8, 50], { rate: 30, keys: 200, writes: 1 }, "orders", { label: "Shop" }),
      server("orders", [34, 50], {
        label: "Orders",
        slots: 32,
        serviceMs: 2,
        blocking: true,
        calls: { write: ["pay", "stock", "ship"] },
        saga: saga ? { undo: ["pay", "stock", "ship"] } : undefined,
        callTimeoutMs: 1500,
      }),
      server("pay", [76, 16], { label: "Payment", slots: 8, serviceMs: 15 }),
      server("stock", [76, 50], { label: "Stock", slots: 8, serviceMs: 10 }),
      server("ship", [76, 84], { label: "Shipping", slots: 8, serviceMs: 10, failRate: 0.05 }),
    ],
    { windowMs: 2000, seed: 73, script: armedCrash("ship", 1800, 1500, CRASH, BACK) },
  );

const halfDone: MetricSpec = { id: "inconsistent", label: "Half-done orders", hint: "Orders that took money or stock and then failed, with nothing put back, in the window." };
const cancelled = M.errors({ id: "rejected", label: "Cancelled", hint: "Share of orders that failed and were undone cleanly." });
const metrics = [halfDone, cancelled, M.errors({ label: "Failed" }), M.p95({ label: "Order time" })];

const sagas: LessonScene = {
  hook: "Payment went through, then shipping failed. Who gives the money back?",
  dots: ["req", "ok", "turned", "failed"],
  figures: [
    {
      tone: "problem",
      short: "No undo",
      title: "Three steps, nothing put back",
      caption: "Each order takes the payment, then reserves the stock, then books the shipping, in three services. Shipping fails now and then.",
      actions: [crashShip],
      metrics,
      parts: [
        { node: "u", text: "Shop: 30 orders a second." },
        { node: "orders", text: "Orders: pay, then stock, then shipping." },
        { node: ["pay", "stock", "ship"], text: "Payment, Stock, Shipping: one step each." },
      ],
      beats: [
        { id: "steps", when: { at: 300 }, text: "Watch an order visit Payment, then Stock, then Shipping, one after another.", focus: { nodes: ["orders"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Crash shipping.", focus: { action: "crash-ship" }, pause: true },
        { id: "half", when: { metric: halfDone, is: ">", value: 3 }, text: "Paid and reserved, never shipped: {inconsistent} orders left half-done.", focus: { metric: "Half-done orders" } },
      ],
      predict: {
        prompt: "Shipping is about to go down. Orders that already paid and reserved stock will…",
        options: ["Be undone by themselves", "Stay paid and reserved"],
        answer: 1,
        before: "press",
        reveal: { beat: "half", text: "Half-done orders: {before} before shipping went down, {after} after." },
        track: { metric: halfDone },
        holds: (_, after) => after !== null && after > 3,
      },
      break: { action: "crash-ship", beat: "press" },
      build: () => shop(false),
    },
    {
      tone: "fix",
      short: "A saga",
      title: "Undo what was done",
      caption: "The same steps. When one fails, the steps already done are undone in reverse: release the stock, then refund the payment.",
      actions: [crashShip],
      metrics,
      beats: [
        {
          id: "saga",
          when: { step: "enter" },
          text: "Now a failed step undoes the ones before it, in reverse: a [[saga]].",
          focus: { nodes: ["orders"] },
          term: "saga",
        },
        { id: "press-saga", when: { wait: 0 }, text: "Press ⚡ Crash shipping.", focus: { action: "crash-ship" }, pause: true },
        { id: "undo", when: { metric: cancelled, is: ">", value: 0.1 }, text: "Watch failed orders go back to Stock, then Payment: release, then refund.", focus: { nodes: ["stock", "pay"] } },
        { id: "compare", when: { wait: 0 }, text: "Compare Half-done orders: {inconsistent:fix} here, {inconsistent:problem} with no undo.", focus: { metric: "Half-done orders" } },
        { id: "catch", when: { wait: 600 }, text: "The catch: until each undo lands, others can see the stock taken.", focus: { nodes: ["stock"] } },
      ],
      break: { action: "crash-ship", beat: "press-saga" },
      headline: { metric: "Half-done orders", sentence: "Shipping down 1.5 s: {inconsistent:problem} orders left half-done with no undo, {inconsistent:fix} with a saga." },
      build: () => shop(true),
    },
  ],
  checks: [
    {
      prompt: "Why not one database transaction across all three services?",
      options: ["Each service has its own database: there is no one transaction to span them", "Transactions are too slow"],
      answer: 0,
      why: "Separate services own separate data. A saga gives each step an undo instead of one big all-or-nothing.",
      focus: { nodes: ["pay", "stock", "ship"] },
    },
    {
      prompt: "A saga undoes failed orders. What can others still see while one runs?",
      options: ["Its done steps, until they're undone", "Nothing until it finishes"],
      answer: 0,
      why: "Sagas aren't isolated: stock reserved by an order that will fail looks taken until it is released.",
      focus: { nodes: ["stock"] },
    },
  ],
  takeaways: {
    use: "Work that spans services each owning its data: orders, bookings, signups. Give every step an undo.",
    catch: "No isolation while it runs, and every undo must itself be safe to retry, since it can fail too.",
    seen: "AWS Step Functions, Temporal, Camunda, Axon, orchestrated sagas in microservice checkouts.",
    rule: "Every step needs its undo.",
    interview: "Say: “Use a saga: local transactions with compensations, orchestrated, each step idempotent.”",
  },
};

export default sagas;
