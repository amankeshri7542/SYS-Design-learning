import { M, knob, ms, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";

// N2: a sender and a receiver over a wire that loses 1 crossing in 10. The receiver answers each message with a small
// ack. Sending once, a message whose ack doesn't come is simply lost to the sender: about 1 in 5, counting lost acks.
// Resending after 0.3 s without an ack gets everything acked, but a lost ack means the receiver gets the message again
// and does it twice.

/** `resend`: the sender sends again when no ack comes within `timer`. `loss`: the share of crossings lost. */
const pair = (resend: boolean, loss: number, timer: number) =>
  scene(
    [
      users("u", [12, 50], { rate: 10, keys: 50, timeoutMs: timer, retry: resend ? { mode: "now", max: 8 } : undefined }, "r", { label: "Sender" }),
      server("r", [88, 50], { label: "Receiver", slots: 8, serviceMs: 10, replies: "ack", idempotent: false }),
    ],
    { links: { "u>r": { ms: 60, loss, label: `loses ${Math.round(loss * 100)} in 100` } }, windowMs: 3000, seed: 21 },
  );

const acked: MetricSpec = { id: "answered", label: "Acked", hint: "Share of messages whose ack came back in the end." };
const twice: MetricSpec = { id: "duplicates", label: "Done twice", nodes: ["r"], hint: "Messages Receiver did a second time, in the window." };
const sends: MetricSpec = { id: "amplify", label: "Sends per message", hint: "How many times each message was sent, on average." };
const metrics = [acked, twice, sends];

const acknowledgements: LessonScene = {
  hook: "How does a sender know its message arrived?",
  dots: ["req", "ack", "lost", "gaveup"],
  figures: [
    {
      tone: "problem",
      short: "Send once",
      title: "Send it and hope",
      caption: "The wire loses 1 crossing in 10. Receiver answers each message; the sender never sends one twice.",
      metrics,
      parts: [
        { node: "u", text: "Sender: 10 messages a second." },
        { node: "r", text: "Receiver: answers each with a small note." },
      ],
      beats: [
        {
          id: "ack",
          when: { at: 300 },
          text: "Watch a message cross, and a small green [[ack]] come back: “got it”.",
          focus: { link: ["u", "r"] },
          follow: true,
          pause: true,
          term: "ack",
        },
        { id: "lost", when: { fx: "lost" }, text: "A red cross: something vanished on the wire. 1 crossing in 10 does.", focus: { link: ["u", "r"] } },
        { id: "gone", when: { wait: 0 }, text: "No ack comes, and the sender just moves on. That message is gone.", focus: { nodes: ["u"] } },
        { id: "count", when: { metric: acked, is: "<", value: 0.9 }, text: "Read Acked: {answered}. Losses both ways leave about 1 in 5 unconfirmed.", focus: { metric: "Acked" } },
      ],
      predict: {
        prompt: "Next, the sender sends again whenever no ack arrives within 0.3 s. Acked will reach…",
        options: ["About 100%", "No better: the wire still loses 1 in 10"],
        answer: 0,
        before: "end",
        reveal: { beat: "compare", text: "Acked: {before} sending once, {after} resending." },
        track: { metric: acked, world: 0, afterWorld: 1, same: true },
        holds: (_, after) => after !== null && after > 0.97,
      },
      build: () => pair(false, 0.1, 300),
    },
    {
      tone: "fix",
      short: "Resend",
      title: "Ack, or send it again",
      caption: "The sender keeps each message until its ack arrives, and sends it again after 0.3 s without one.",
      knobs: [knob("loss", "Wire loses", 0, 30, 5, 10, (v) => `${v}%`), knob("timer", "Ack timer", 100, 800, 50, 300, ms)],
      metrics,
      beats: [
        {
          id: "resend",
          when: { step: "enter" },
          text: "Now no ack within 0.3 s means send it again: a [[retransmit|resend]].",
          focus: { nodes: ["u"] },
          term: "retransmit",
        },
        { id: "compare", when: { wait: 0 }, text: "Compare Acked: {answered:fix} here, {answered:problem} sending once.", focus: { metric: "Acked" } },
        { id: "dupes", when: { metric: twice, is: ">", value: 0 }, text: "But when only the ack is lost, the resend arrives twice: {duplicates:r} done twice.", focus: { metric: "Done twice" } },
        { id: "short", when: { wait: 600 }, text: "Drag Ack timer to 100 ms: resends leave before acks can come back.", focus: { knob: "timer" } },
      ],
      headline: { metric: "Acked", sentence: "On a wire that loses 1 in 10: {answered:problem} acked sending once, {answered:fix} with resends." },
      build: (v: Values) => pair(true, v.loss / 100, v.timer),
    },
  ],
  checks: [
    {
      prompt: "The sender gets no ack. What does it know for sure?",
      options: ["The message was lost", "Only that no ack arrived"],
      answer: 1,
      why: "The message, or just its ack, may have vanished. The sender can't tell which, so it sends again.",
      focus: { link: ["u", "r"] },
    },
    {
      prompt: "Why can resending make the receiver do the same work twice?",
      options: ["The ack was lost, not the message", "The receiver is slow"],
      answer: 0,
      why: "If only the ack vanished, the receiver already did the work. The resend makes it do it again.",
      focus: { metric: "Done twice" },
    },
  ],
  takeaways: {
    use: "Any message that must arrive: keep it until it's acknowledged, and send it again after a timeout.",
    catch: "A resend can repeat work already done. The receiver must cope with repeats (idempotency).",
    seen: "TCP, message brokers' acks, email delivery retries, webhook redelivery.",
    rule: "No ack, no proof.",
  },
};

export default acknowledgements;
