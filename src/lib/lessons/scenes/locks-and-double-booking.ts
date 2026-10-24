import { M, armed, choice, database, fault, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { NodeSpec, SceneSpec } from "../../sim/types";

// D10: a booking reads its seat, and writes it only if it was free. Most of the time shoppers spread over 2,000 seats
// and rarely meet. When the sale opens, 300 bookings a second go for the best 40 seats: two shoppers read the same seat as
// free, both write it, and the seat is sold twice. A compare-and-set write is refused if the seat changed since it was
// read, so the second shopper is told it's gone; a lock per seat makes the second wait, then read it as sold.

const SALE = "The sale opens";
const CALM = "The rush is over";
const sale = fault("sale", "Open the sale", "End the rush", SALE, CALM, (s) => {
  const rate = s.nodes.get("u")?.spec.client?.rate;
  return typeof rate === "number" && rate > 100;
});

/** `guard`: 0 none, 1 compare-and-set, 2 a lock per seat. `rush`: the sale's first moments. */
const box = (guard: number, rush = false): SceneSpec => {
  const entry = guard === 2 ? "lk" : "book";
  const nodes: NodeSpec[] = [
    users("u", [8, 50], rush ? { rate: 300, keys: 40, writes: 1 } : { rate: 30, keys: 2000, writes: 1 }, entry, { label: "Shoppers" }),
    server("book", [52, 50], { label: "Booking", slots: 32, serviceMs: 5, blocking: true, reserve: { db: "seats" }, callTimeoutMs: 1500 }),
    database("seats", [88, 50], { label: "Seats", slots: 8, serviceMs: 15, cas: guard === 1 }),
  ];
  if (guard === 2) nodes.push({ id: "lk", kind: "server", label: "Seat locks", at: [30, 50], lock: { leaseMs: 1000 }, to: ["book"] });
  return scene(nodes, {
    links: { "book>seats": 10 },
    windowMs: 2000,
    seed: 61,
    script: armed({ node: "u", at: 1500, lastsMs: 1200, start: SALE, end: CALM }, { start: (s) => s.reconfigure(box(guard, true)), end: (s) => s.reconfigure(box(guard)) }),
  });
};

const doubles: MetricSpec = { id: "doubleBookings", label: "Double bookings", hint: "Seats booked by a second shopper after someone else already had them, in the window." };
const turned = M.errors({ id: "rejected", label: "Told it's gone", hint: "Share of bookings turned away because the seat was taken." });
const metrics = [doubles, turned, M.p95({ label: "Booking time", hint: "95% of bookings are answered faster than this (the p95)." })];

const doubleBooking: LessonScene = {
  hook: "Two people click “buy” on the same seat at once. Who gets it?",
  dots: ["req", "ok", "turned"],
  figures: [
    {
      tone: "problem",
      short: "Read, write",
      title: "Read the seat, then book it",
      caption: "A booking reads its seat and writes it only if it was free. Shoppers spread over 2,000 seats, until the sale opens.",
      actions: [sale],
      metrics,
      parts: [
        { node: "u", text: "Shoppers: 30 bookings a second, any seat." },
        { node: "book", text: "Booking: reads the seat, writes it if free." },
        { node: "seats", text: "Seats: 15 ms a read or a write.", sockets: true },
      ],
      beats: [
        { id: "two", when: { at: 300 }, text: "Watch each booking cross twice: a read, then a write if the seat was free.", focus: { link: ["book", "seats"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Open the sale.", focus: { action: "sale" }, pause: true },
        {
          id: "double",
          when: { metric: doubles, is: ">", value: 0 },
          text: "Two shoppers read one seat as free, and both wrote it: a [[double-booking|double booking]].",
          focus: { nodes: ["seats"] },
          term: "double-booking",
        },
        { id: "count", when: { wait: 0 }, text: "Read Double bookings: {doubleBookings} seats sold twice in the rush.", focus: { metric: "Double bookings" } },
      ],
      predict: {
        prompt: "The sale is about to open: 300 bookings a second for the best 40 seats. Seats sold twice will be…",
        options: ["None: each booking checks first", "Several"],
        answer: 1,
        before: "press",
        reveal: { beat: "count", text: "Double bookings: {before} before the sale, {after} in its first second." },
        track: { metric: doubles },
        holds: (_, after) => after !== null && after > 2,
      },
      break: { action: "sale", beat: "press" },
      build: () => box(0),
    },
    {
      tone: "fix",
      short: "A guard",
      title: "Write only if nothing changed",
      caption: "The same shoppers and sale. The database refuses a write if the seat changed since that booking read it.",
      actions: [sale],
      knobs: [choice("guard", "Guard", ["Compare-and-set", "A lock per seat"], 0)],
      metrics,
      beats: [
        {
          id: "cas",
          when: { step: "enter" },
          text: "Now Seats refuses a write if the seat changed since it was read: [[compare-and-set]].",
          focus: { nodes: ["seats"] },
          term: "compare-and-set",
        },
        { id: "press-guard", when: { wait: 0 }, text: "Press ⚡ Open the sale.", focus: { action: "sale" }, pause: true },
        { id: "refused", when: { metric: turned, is: ">", value: 0.1 }, text: "The second write on each seat is refused, and that shopper is told it's gone.", focus: { metric: "Told it's gone" } },
        { id: "compare", when: { wait: 0 }, text: "Compare Double bookings: {doubleBookings:fix} here, {doubleBookings:problem} reading then writing.", focus: { metric: "Double bookings" } },
        { id: "lock", when: { wait: 800 }, text: "Switch Guard to A lock per seat: shoppers for one seat wait in line instead.", focus: { knob: "guard" } },
      ],
      break: { action: "sale", beat: "press-guard" },
      headline: { metric: "Double bookings", sentence: "The sale's rush for 40 seats: {doubleBookings:problem} sold twice reading then writing, {doubleBookings:fix} with a guard." },
      build: (v: Values) => box(v.guard + 1),
    },
  ],
  checks: [
    {
      prompt: "Why did checking before writing still sell seats twice?",
      options: ["Both read “free” before either wrote", "The database lost a write"],
      answer: 0,
      why: "Between a read and its write there is a gap. Another booking can read the same seat in it.",
      focus: { link: ["book", "seats"] },
    },
    {
      prompt: "Compare-and-set or a lock: which makes the second shopper wait?",
      options: ["The lock: it queues for the seat", "Compare-and-set"],
      answer: 0,
      why: "Compare-and-set refuses the loser at once; a lock makes it wait its turn, then find the seat sold.",
      focus: { knob: "guard" },
    },
  ],
  takeaways: {
    use: "Anything sold once (seats, stock, usernames): make the check and the write one step, with a conditional write or a lock.",
    catch: "Compare-and-set retries pile up when everyone wants the same row; a lock that's never released freezes it, so give it a lease.",
    seen: "SQL UPDATE … WHERE version = ?, DynamoDB conditional writes, Redis SET NX with an expiry, SELECT … FOR UPDATE.",
    rule: "Check and write in one step.",
    interview: "Say: “Make the read-check-write atomic: a conditional write on a version, or a lock with a lease.”",
  },
};

export default doubleBooking;
