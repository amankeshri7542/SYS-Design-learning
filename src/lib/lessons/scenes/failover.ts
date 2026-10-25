import { M, armedCrash, balancer, choice, database, fault, knob, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { SceneSpec } from "../../sim/types";

// D6: an app writes to a primary database and reads from its replica, which copies each write a quarter of a second
// later. The primary crashes for 4 s. Without failover every write fails for the whole outage. With it, the writer
// endpoint's health checks notice, and the replica is promoted: writes resume within a few checks. Writes the primary had
// confirmed but not yet copied are lost, unless replication is synchronous, which makes every write wait for its copy.

const CRASH = "The primary crashes";
const BACK = "The old primary is back";
const crashPrimary = fault("crash-p", "Crash the primary", "Bring it back", CRASH, BACK, (s) => s.nodes.get("p")?.up === false);

/** `failover`: the writer endpoint promotes the replica after `checks` failed health checks. `sync`: writes wait for their copy. */
const db = (failover: boolean, checks: number, sync: boolean): SceneSpec =>
  scene(
    [
      users("u", [8, 50], { rate: 60, keys: 300, writes: 0.5 }, "app", { label: "Users" }),
      server("app", [32, 50], { label: "App server", slots: 16, serviceMs: 5, blocking: true, calls: { write: ["w"], read: ["r1"] }, callTimeoutMs: 1000 }),
      balancer(
        "w",
        [58, 22],
        failover ? ["p", "r1"] : ["p"],
        failover ? { label: "Writer endpoint", promote: true, health: { everyMs: 100, failAfter: checks, passAfter: 2, timeoutMs: 150 } } : { label: "Writer endpoint" },
      ),
      database("p", [86, 22], { label: "Primary", slots: 8, serviceMs: 10, replication: sync ? "sync" : "async" }),
      database("r1", [86, 78], { label: "Replica", slots: 8, serviceMs: 10, replicaOf: "p", lagMs: 250 }),
    ],
    {
      links: { "w>p": 5, "w>r1": 5, "app>r1": 8 },
      windowMs: 3000,
      seed: 47,
      script: armedCrash("p", 1500, 4000, CRASH, BACK),
    },
  );

const failed = M.errors({ op: "write", label: "Failed writes", hint: "Share of writes that failed or gave up." });
const lost: MetricSpec = { id: "lostAcked", label: "Confirmed writes lost", hint: "Writes the primary confirmed to users that were never copied, so were lost when the replica took over." };
const writeTime = M.p95({ op: "write", label: "Write time", hint: "95% of writes are confirmed faster than this (the p95)." });
const metrics = [failed, lost, writeTime];

const failover: LessonScene = {
  hook: "The primary database just died. Who takes the writes now?",
  dots: ["req", "late", "ok", "failed", "copy"],
  figures: [
    {
      tone: "problem",
      short: "No failover",
      title: "One primary, and nobody to replace it",
      caption: "The app writes to a primary database and reads from a replica, which copies each write 250 ms later.",
      actions: [crashPrimary],
      metrics,
      parts: [
        { node: "u", text: "Users: 60 requests a second, half of them writes." },
        { node: "app", text: "App server: writes to Primary, reads Replica." },
        { node: "w", text: "Writer endpoint: where every write goes." },
        { node: "p", text: "Primary: takes every write." },
        { node: "r1", text: "Replica: copies each write 250 ms later." },
      ],
      beats: [
        { id: "copy", when: { at: 600 }, text: "Watch each write reach Primary, then a copy cross to Replica.", focus: { link: ["p", "r1"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Crash the primary.", focus: { action: "crash-p" }, pause: true },
        { id: "fail", when: { metric: failed, is: ">", value: 0.3 }, text: "Read Failed writes: {errors}. Reads still work; every write fails.", focus: { metric: "Failed writes" } },
        { id: "wait", when: { wait: 0 }, text: "Replica has the data, but no one makes it the primary.", focus: { nodes: ["r1"] } },
      ],
      predict: {
        prompt: "The primary is about to crash for 4 seconds. Writes will fail…",
        options: ["For a moment", "For the whole 4 seconds"],
        answer: 1,
        before: "press",
        reveal: { beat: "fail", text: "Failed writes: {before} before the crash, {after} after." },
        track: { metric: failed },
        holds: (_, after) => after !== null && after > 0.3,
      },
      break: { action: "crash-p", beat: "press" },
      build: () => db(false, 3, false),
    },
    {
      tone: "fix",
      short: "Failover",
      title: "Promote the replica",
      caption: "The same app. The writer endpoint checks the primary's health, and after three failed checks it promotes the replica.",
      actions: [crashPrimary],
      knobs: [knob("checks", "Checks before failover", 1, 6, 1, 3), choice("sync", "Replication", ["Async", "Sync"], 0)],
      metrics,
      beats: [
        { id: "press-fo", when: { step: "enter" }, text: "Press ⚡ Crash the primary.", focus: { action: "crash-p" }, pause: true },
        {
          id: "promoted",
          // The crash in step 1 already hit this world too, so the promotion may have come before this step did.
          when: { note: "Replica promoted to primary", since: "lesson" },
          text: "Three checks fail, and Replica becomes the primary: [[failover]]. Writes go there now.",
          focus: { nodes: ["r1"] },
          term: "failover",
        },
        { id: "lost", when: { metric: lost, is: ">", value: 0 }, text: "But {lostAcked} writes Primary confirmed never reached Replica. They're gone.", focus: { metric: "Confirmed writes lost" } },
        { id: "sync", when: { wait: 600 }, text: "Switch Replication to Sync: nothing is lost, but every write waits for its copy.", focus: { knob: "sync" } },
      ],
      break: { action: "crash-p", beat: "press-fo" },
      headline: { metric: "Failed writes", sentence: "Primary down 4 s: {errors:problem} of writes failed without failover, {errors:fix} with it." },
      build: (v: Values) => db(true, v.checks, v.sync === 1),
    },
  ],
  checks: [
    {
      prompt: "With asynchronous replication, why are some confirmed writes lost in a failover?",
      options: ["They hadn't been copied when the primary died", "The replica rejected them"],
      answer: 0,
      why: "The primary confirms a write before copying it. Whatever was still on its way when it died never reached the new primary.",
      focus: { link: ["p", "r1"] },
    },
    {
      prompt: "Why not fail over after a single failed check?",
      options: ["A blip would promote a replica for nothing", "It would be too slow"],
      answer: 0,
      why: "One missed check can be a hiccup. Promoting means a new primary and a demoted old one, so wait for a few.",
      focus: { knob: "checks" },
    },
  ],
  takeaways: {
    use: "Every database that takes writes: automate promotion, and decide how much confirmed data you can afford to lose.",
    catch: "Async loses the last moments of confirmed writes; sync loses none but makes every write wait, and stalls if the replica does.",
    seen: "Amazon RDS Multi-AZ, Aurora failover, Patroni for PostgreSQL, MySQL semi-sync replication, Redis Sentinel.",
    rule: "Promote fast, and know what you lose.",
    interview: "Say: “Health checks trigger promotion; async replication risks losing recent writes (RPO), sync costs write latency.”",
  },
};

export default failover;
