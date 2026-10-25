import type { Sim } from "../../sim/engine";
import type { MetricSpec } from "../../sim/metrics";
import type { NodeSpec, SceneSpec } from "../../sim/types";
import { M, balancer, database, scene, server, users } from "../kit";
import type { StoryDef, StoryStage } from "../story";
import type { Values } from "../types";

// S5: drivers ping their position into a location store; riders look for nearby cars (reads) and ask for a ride (a
// booking: read the driver, write it if free). The target: riders answered within 0.4 s, and no driver sent to two
// riders. Stages grow the pings until they swamp the store (batch them), send a stadium's riders after the same few
// drivers (a lock per driver), and take the matcher's region dark (a second region, picked by the nearest healthy one).

const PRICE = { base: 140, batch: 5, lock: 15, region: 120 };
const START: Values = { batch: 0, lock: 0, region: 0 };
const BATCH = 5;

function city(a: Values, s: StoryStage): SceneSpec {
  const { pings, riders, drivers, skew, rides, trips, dark } = s.params;
  const matchers = a.region ? ["m1", "m2"] : ["m1"];
  const entry = a.lock ? "lk" : a.region ? "lb" : "m1";
  const matcher = (id: string, at: [number, number], label: string): NodeSpec =>
    server(id, at, { label, slots: 32, serviceMs: 4, blocking: true, calls: { read: ["loc"] }, reserve: { db: "trips" }, callTimeoutMs: 800, downMode: "hang" });
  const nodes: NodeSpec[] = [
    users("drv", [6, 18], { rate: a.batch ? pings / BATCH : pings, keys: 500, writes: 1, tag: "ping" }, "loc", { label: "Drivers" }),
    users("rid", [6, 56], { rate: riders, keys: drivers, skew, writes: rides, tag: "ride" }, entry, { label: "Riders" }),
    matcher("m1", [62, 56], a.region ? "East" : "Matcher"),
    database("loc", [90, 18], { label: "Locations", slots: 4, serviceMs: 10 }),
    database("trips", [90, 56], { label: "Trips", slots: 8, serviceMs: 8 }),
  ];
  if (a.lock) nodes.push({ id: "lk", kind: "server", label: "Locks", at: [22, 56], lock: { leaseMs: 600 }, to: [a.region ? "lb" : "m1"] });
  if (a.region) {
    nodes.push(balancer("lb", [40, 56], matchers, { label: "Nearest", algo: "nearest", health: { everyMs: 20, failAfter: 1, passAfter: 2, timeoutMs: 50 } }));
    nodes.push(matcher("m2", [62, 88], "West"));
  }
  const events = [];
  // Drivers finish their trips together, free for the next riders.
  if (trips) events.push({ at: 0, label: "Drivers finish their trips", run: (sim: Sim) => sim.nodes.get("trips")!.data.clear() });
  if (dark) {
    events.push({ at: 300, label: "East goes dark", run: (sim: Sim) => sim.setUp("m1", false) });
    events.push({ at: 2300, label: "East is back", run: (sim: Sim) => sim.setUp("m1", true) });
  }
  return scene(nodes, {
    timeoutMs: 1000,
    links: { "lb>m1": 4, "lb>m2": 20, "lk>m1": 4, "lk>lb": 4, "m1>loc": 8, "m1>trips": 12, "m2>loc": 30, "m2>trips": 30 },
    windowMs: 3000,
    wideH: 440,
    script: events.length ? { loopMs: dark ? 4000 : 2000, events } : undefined,
  });
}

const within = M.p95({ tag: "ride", label: "Riders' response time", hint: "95% of riders' requests are answered faster than this (the p95)." });
const twice: MetricSpec = { id: "doubleBookings", label: "Drivers sent twice", hint: "Drivers given to a second rider after someone already had them, in the window." };

/** Match riders to drivers: four stages, from a quiet town to a stadium and a region gone dark. */
const rideMatching: StoryDef = {
  controls: [
    { kind: "switch", id: "batch", label: "Batch the pings" },
    { kind: "switch", id: "lock", label: "Lock each driver" },
    { kind: "switch", id: "region", label: "Second region" },
  ],
  start: START,
  cost: (a) => PRICE.base + a.batch * PRICE.batch + a.lock * PRICE.lock + a.region * PRICE.region,
  scene: city,
  targets: [
    { metric: within, label: "Response time", max: 400 },
    { metric: twice, label: "Drivers sent twice", max: 0 },
  ],
  metrics: [M.busy(["loc"], "Locations busy"), M.errors({ id: "rejected", tag: "ride", label: "No driver", hint: "Share of riders' requests told no driver was free." })],
  win: (cost) => `Your dispatch matched every rider once through all four stages for $${cost} a month. Can a cheaper design hold the last one?`,
  lead: (s) => `${s.params.pings + s.params.riders} a second`,
  stages: [
    {
      name: "A quiet town",
      beats: [
        { id: "ping", when: { step: "enter" }, text: "Drivers ping their position into Locations, 100 times a second.", focus: { nodes: ["drv"] } },
        { id: "ride", when: { wait: 0 }, text: "Watch riders look for nearby cars, and now and then ask for one.", focus: { nodes: ["m1"] } },
      ],
      brief: "A small town on a weekday. Check that one matcher and its two databases keep up.",
      hint: "Nothing to change yet.",
      params: { pings: 100, riders: 20, drivers: 300, skew: 0, rides: 0.3, trips: 0, dark: 0 },
      hold: 6,
      solution: START,
    },
    {
      name: "Rush hour",
      beats: [
        { id: "pings", when: { step: "enter" }, text: "Now 600 pings a second, each its own write to Locations.", focus: { nodes: ["drv"] } },
        { id: "full", when: { wait: 0 }, text: "Watch Locations: riders' lookups wait behind the pings.", focus: { nodes: ["loc"], sockets: true } },
      ],
      brief: "Every driver is out. Their pings arrive one write at a time, and riders' lookups wait behind them.",
      hint: "Each ping is a round trip of its own. Send several in one.",
      params: { pings: 600, riders: 40, drivers: 300, skew: 0, rides: 0.3, trips: 0, dark: 0 },
      hold: 8,
      solution: { ...START, batch: 1 },
    },
    {
      name: "The stadium empties",
      beats: [
        { id: "crowd", when: { step: "enter" }, text: "Now 100 riders a second want the same 30 nearby drivers.", focus: { nodes: ["rid"] } },
        { id: "twice", when: { wait: 0 }, text: "Watch Drivers sent twice: two riders read one driver as free.", focus: { nodes: ["trips"] } },
      ],
      brief: "The match ends and the crowd wants the few drivers nearby. No driver may go to two riders.",
      hint: "Let only one booking at a time check and take a driver.",
      params: { pings: 600, riders: 100, drivers: 30, skew: 1, rides: 0.6, trips: 1, dark: 0 },
      hold: 8,
      solution: { ...START, batch: 1, lock: 1 },
    },
    {
      name: "East goes dark",
      beats: [
        { id: "dark", when: { step: "enter" }, text: "Now the matcher's region stops answering for two seconds in four.", focus: { nodes: ["m1"] } },
        { id: "hang", when: { wait: 0 }, text: "Watch riders' requests hang there until they give up.", focus: { nodes: ["m1"] } },
      ],
      brief: "A power cut takes the matcher's region dark, again and again. Riders must still be matched.",
      hint: "Keep a second region, and send riders to the nearest one that answers.",
      params: { pings: 600, riders: 60, drivers: 300, skew: 0, rides: 0.3, trips: 0, dark: 1 },
      hold: 10,
      solution: { ...START, batch: 1, lock: 1, region: 1 },
    },
  ],
};

export default rideMatching;
