import type { Sim } from "../../sim/engine";
import type { MetricSpec } from "../../sim/metrics";
import type { NodeSpec, SceneSpec } from "../../sim/types";
import { M, cache, database, scene, server, users } from "../kit";
import type { StoryDef, StoryStage } from "../story";
import type { Values } from "../types";

// S4: a box office sells seats. Browsers read the seat map; buyers book a seat (read it, write it if free). The target:
// pages answered within 0.4 s, and no seat sold twice. Stages open the doors (seat-map reads swamp the database: a
// cache), sell the last seats in blocks of 40 every two seconds (buyers race for the same few: compare-and-set), and let
// everyone in at once (bookings swamp the database: a waiting room that lets buyers in at the rate it can take).

const PRICE = { base: 120, cache: 40, cas: 5, room: 30 };
const START: Values = { cache: 0, cas: 0, room: 0 };

function sale(a: Values, s: StoryStage): SceneSpec {
  const { reads, buys, seats, skew, blocks } = s.params;
  const nodes: NodeSpec[] = [
    users("map", [6, 22], { rate: reads, keys: 200, skew: 1, tag: "map" }, "app", { label: "Browsers" }),
    users("buy", [6, 78], { rate: buys, keys: seats, skew, writes: 1, tag: "buy" }, a.room ? "room" : "app", { label: "Buyers" }),
    server("app", [44, 50], { label: "Box office", slots: 64, serviceMs: 4, blocking: true, calls: { read: [a.cache ? "map-c" : "db"] }, reserve: { db: "db" }, callTimeoutMs: 1500 }),
    database("db", [88, 50], { label: "Seats", slots: 6, serviceMs: 12, cas: !!a.cas }),
  ];
  if (a.cache) nodes.push(cache("map-c", [70, 18], "db", { label: "Seat map cache", capacity: 200, ttlMs: 2000 }));
  if (a.room) nodes.push({ id: "room", kind: "limiter", label: "Waiting room", at: [24, 78], to: ["app"], limit: { rps: 60, burst: 20, shared: true } });
  return scene(nodes, {
    links: { "app>db": 8, "app>map-c": 4, "map-c>db": 8, "room>app": 4 },
    windowMs: 2000,
    wideH: 440,
    // Each block of seats goes on sale at once: the sold ones are free again.
    script: blocks ? { loopMs: 2000, events: [{ at: 0, label: "40 more seats on sale", run: (sim: Sim) => sim.nodes.get("db")!.data.clear() }] } : undefined,
  });
}

const doubles: MetricSpec = { id: "doubleBookings", label: "Seats sold twice", hint: "Seats booked by a second buyer after someone already had them, in the window." };

/** Sell 1,000 seats to 100,000 people: four stages, from a quiet start to everyone at once. */
const flashSale: StoryDef = {
  controls: [
    { kind: "switch", id: "cache", label: "Seat map cache" },
    { kind: "switch", id: "cas", label: "Compare-and-set" },
    { kind: "switch", id: "room", label: "Waiting room" },
  ],
  start: START,
  cost: (a) => PRICE.base + a.cache * PRICE.cache + a.cas * PRICE.cas + a.room * PRICE.room,
  scene: sale,
  targets: [
    { metric: M.p95(), label: "Response time", max: 400 },
    { metric: doubles, label: "Seats sold twice", max: 0 },
  ],
  metrics: [M.busy(["db"], "Seats busy"), { id: "rejected", label: "Turned away", hint: "Share of requests turned away: sold out, or asked to wait by the waiting room." }],
  win: (cost) => `Your box office sold every seat once through all four stages for $${cost} a month. Can a cheaper design hold the last one?`,
  lead: (s) => `${s.params.reads + s.params.buys} a second`,
  stages: [
    {
      name: "On sale, quietly",
      beats: [
        { id: "quiet", when: { step: "enter" }, text: "A few browsers read the seat map; a few buyers book seats.", focus: { nodes: ["app"] } },
        { id: "two", when: { wait: 0 }, text: "Watch a booking cross to Seats twice: a read, then a write.", focus: { nodes: ["db"] } },
      ],
      brief: "Tickets are on sale and the hall is quiet. Check that one box office and its database keep up.",
      hint: "Nothing to change yet.",
      params: { reads: 30, buys: 5, seats: 5000, skew: 0, blocks: 0 },
      hold: 6,
      solution: START,
    },
    {
      name: "Doors open",
      beats: [
        { id: "reads", when: { step: "enter" }, text: "Now 700 browsers a second read the seat map, all from Seats.", focus: { nodes: ["map"] } },
        { id: "busy", when: { wait: 0 }, text: "Watch Seats: reads of the same map fill its line.", focus: { nodes: ["db"], sockets: true } },
      ],
      brief: "The doors open: everyone looks at the seat map, the same 200 sections again and again.",
      hint: "Everyone reads the same map. Keep a copy closer than the database.",
      params: { reads: 700, buys: 10, seats: 5000, skew: 0, blocks: 0 },
      hold: 8,
      solution: { ...START, cache: 1 },
    },
    {
      name: "The last seats",
      beats: [
        { id: "race", when: { step: "enter" }, text: "Now 60 buyers a second race for each block of 40 seats.", focus: { nodes: ["buy"] } },
        { id: "twice", when: { wait: 0 }, text: "Watch Seats sold twice: two buyers read a seat as free.", focus: { nodes: ["db"] } },
      ],
      brief: "The best seats go on sale 40 at a time, and buyers race for them. No seat may be sold twice.",
      hint: "A booking checks, then writes. Make the write fail if the seat changed since the check.",
      params: { reads: 700, buys: 60, seats: 40, skew: 1, blocks: 1 },
      hold: 8,
      solution: { ...START, cache: 1, cas: 1 },
    },
    {
      name: "Everyone at once",
      beats: [
        { id: "flood", when: { step: "enter" }, text: "Now 600 buyers a second try at once.", focus: { nodes: ["buy"] } },
        { id: "swamp", when: { wait: 0 }, text: "Watch Seats drown in bookings it can't sell.", focus: { nodes: ["app", "db"] } },
      ],
      brief: "Everyone arrives at the same second. Let buyers in only as fast as the seats database can take them.",
      hint: "Ask the rest to wait, fast, rather than letting everyone in and answering no one.",
      params: { reads: 700, buys: 600, seats: 40, skew: 1, blocks: 1 },
      hold: 10,
      solution: { ...START, cache: 1, cas: 1, room: 1 },
    },
  ],
};

export default flashSale;
