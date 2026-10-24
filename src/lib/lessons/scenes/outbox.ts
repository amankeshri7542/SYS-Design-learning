import { M, armedCrash, database, fault, knob, ms, queue, scene, server, users, worker } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";

// A6: each order is saved to the orders database, and an event about it goes through a broker to the email service,
// which sends a receipt. As a dual write (save, then publish), an order saved while the broker is down never has its
// event published: no receipt, ever. With an outbox, the event is saved with the order in one write and a relay sends
// it until the broker takes it, so it arrives late but arrives; the relay may send one twice, and the email service
// ignores repeats.

const CRASH = "The broker goes down";
const BACK = "The broker is back";
const crashBroker = fault("crash-broker", "Crash the broker", "Restore the broker", CRASH, BACK, (s) => s.nodes.get("broker")?.up === false);

const shop = (outbox: boolean, everyMs: number) =>
  scene(
    [
      users("u", [8, 50], { rate: 15, keys: 50, writes: 1 }, "app", { label: "Shop" }),
      server("app", [34, 50], { label: "App", slots: 16, serviceMs: 10, calls: { write: outbox ? ["db"] : ["db", "broker"], read: [] } }),
      database("db", [62, 22], { label: "Orders DB", slots: 8, serviceMs: 15, idempotent: false, outbox: outbox ? { to: "broker", everyMs } : undefined }),
      queue("broker", [62, 78], ["email"], { label: "Broker" }),
      worker("email", [90, 78], { label: "Email service", slots: 8, serviceMs: 20, idempotent: true }),
    ],
    // Reduced motion opens on a still 5 s in: lost events are only counted 3 s after their order was saved.
    { windowMs: 2000, seed: 26, stillMs: 5000, script: armedCrash("broker", 1200, 1500, CRASH, BACK) },
  );

const lost: MetricSpec = { id: "lostEvents", label: "Events lost", nodes: ["db", "email"], hint: "Share of saved orders whose event never reached the email service." };
const metrics = [lost, M.errors(), M.p95()];

const outbox: LessonScene = {
  hook: "The order saved, but the confirmation email never came. Where did it go?",
  dots: ["req", "ok", "job", "failed"],
  figures: [
    {
      tone: "problem",
      short: "Dual write",
      title: "Save, then publish",
      caption: "App saves each order to Orders DB, then publishes an event through Broker for the receipt email.",
      actions: [crashBroker],
      metrics,
      parts: [
        { node: "u", text: "Shop: 15 orders a second." },
        { node: "app", text: "App: saves the order, then publishes an event." },
        { node: "db", text: "Orders DB: stores each order." },
        { node: ["broker", "email"], text: "Broker, then Email service: a receipt per event." },
      ],
      beats: [
        {
          id: "two",
          when: { at: 300 },
          text: "Each order is two writes, to Orders DB then to Broker: a [[dual-write|dual write]].",
          focus: { nodes: ["app"] },
          term: "dual-write",
        },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Crash the broker.", focus: { action: "crash-broker" }, pause: true },
        { id: "saved", when: { note: CRASH }, text: "Orders still save, but their events have nowhere to go.", focus: { nodes: ["db", "broker"] } },
        { id: "lost", when: { metric: lost, is: ">", value: 0.05 }, text: "Read Events lost: {lostEvents}. Those customers will never get a receipt.", focus: { metric: "Events lost" } },
      ],
      predict: {
        prompt: "The broker is down for 1.5 s. Orders saved in that time will…",
        options: ["Get receipts once it's back", "Never get a receipt"],
        answer: 1,
        before: "press",
        reveal: { beat: "lost", text: "Events lost: {before} before, {after} after the broker went down." },
        track: { metric: lost },
        holds: (_, after) => after !== null && after > 0.05,
      },
      break: { action: "crash-broker", beat: "press" },
      build: () => shop(false, 100),
    },
    {
      tone: "fix",
      short: "Outbox",
      title: "Save the event with the order",
      caption: "App saves the order and its event in one write. A relay sends each event on until Broker takes it.",
      actions: [crashBroker],
      knobs: [knob("every", "Relay every", 50, 500, 50, 100, ms)],
      metrics,
      beats: [
        {
          id: "outbox",
          when: { step: "enter" },
          text: "Now the event is saved with the order, in an [[outbox]]; a relay sends it on.",
          focus: { nodes: ["db"] },
          term: "outbox",
        },
        { id: "compare", when: { wait: 0 }, text: "Compare Events lost: {lostEvents:fix} here, {lostEvents:problem} with a dual write.", focus: { metric: "Events lost" } },
        { id: "repeat", when: { wait: 0 }, text: "The relay may send an event twice, so Email service ignores repeats.", focus: { nodes: ["email"] } },
        { id: "slower", when: { wait: 600 }, text: "Drag Relay every to 500 ms: receipts arrive later, but they all arrive.", focus: { knob: "every" } },
      ],
      headline: { metric: "Events lost", sentence: "Broker down 1.5 s: {lostEvents:problem} of events lost with a dual write, {lostEvents:fix} with an outbox.", at: "lost" },
      build: (v: Values) => shop(true, v.every),
    },
  ],
  checks: [
    {
      prompt: "Why can a dual write lose events?",
      options: ["The second write can fail after the first succeeded", "Databases lose data"],
      answer: 0,
      why: "Two separate writes can't fail together. The order is saved; the publish isn't; nothing ever retries it.",
      focus: { nodes: ["app"] },
    },
    {
      prompt: "The outbox relay delivers at least once. What must the email service do?",
      options: ["Ignore events it has already handled", "Nothing special"],
      answer: 0,
      why: "A relay that resends after a failure can deliver an event twice. Idempotent consumers make repeats harmless.",
      focus: { nodes: ["email"] },
    },
  ],
  takeaways: {
    use: "Whenever a database change must be announced: write the event in the same transaction, and relay it from there.",
    catch: "Events arrive a little late and sometimes twice, so consumers must be idempotent.",
    seen: "Debezium change data capture, transactional outbox tables, Kafka Connect.",
    rule: "One write, then relay it.",
    interview: "Say: “I'd use a transactional outbox with a relay, and idempotent consumers, rather than a dual write.”",
  },
};

export default outbox;
