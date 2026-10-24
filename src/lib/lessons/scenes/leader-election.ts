import type { Sim } from "../../sim/engine";
import { M, database, scene, users } from "../kit";
import type { Action, LessonScene } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { NodeSpec, SceneSpec } from "../../sim/types";

// D9: three copies of a database, one in Europe and two in the Americas, take writes from both. With a fixed leader,
// its crash stops every write until someone steps in. If any member that hears nothing simply leads, a crash is covered,
// but cutting the ocean leaves a leader on each side, both taking writes to the same keys: conflicts when the link is
// back. With a majority vote, the side cut off alone can't elect, so nothing conflicts, and a crashed leader is still
// replaced in about half a second. (No pre-vote or log check: the copy cut off longest may win the next election.)

const CRASH = "The leader crashes";
const BACK = "It's back";
const CUT = "The ocean link is cut";
const HEAL = "The link is back";
const MEMBERS = ["a", "b", "c"];

/** The member leading now: an elected leader that is up, or the fixed one. */
const leaderNow = (s: Sim) => MEMBERS.find((id) => s.nodes.get(id)?.up && s.nodes.get(id)!.raft.role === "leader") ?? (s.nodes.get("b")?.spec.cluster ? undefined : "b");

/** An armed event's button: fires it in every world, and reads its state from this one. */
const button = (id: string, label: string, undo: string, start: string, end: string, isOn: (s: Sim) => boolean): Action => ({
  id,
  label,
  undo,
  run: (sim, on) => void sim.fire(on ? start : end),
  isOn,
});
const crash = button("crash-leader", "Crash the leader", "Bring it back", CRASH, BACK, (s) => MEMBERS.some((id) => s.nodes.get(id)?.up === false));
const cut = button("cut", "Cut the ocean link", "Mend it", CUT, HEAL, (s) => s.partitioned);

/** `mode`: "fixed" (b always leads), "naive" (whoever hears nothing leads), "majority" (Raft). */
const group = (mode: "fixed" | "naive" | "majority"): SceneSpec => {
  const member = (id: string, at: [number, number], region: string, label: string): NodeSpec =>
    database(id, at, {
      label,
      region,
      slots: 8,
      serviceMs: 6,
      ...(mode === "fixed" ? (id === "b" ? {} : { leader: "b" }) : { cluster: { group: MEMBERS, heartbeatMs: 100, electionMs: [300, 600], majority: mode === "majority" } }),
    });
  return scene(
    [
      users("eu", [8, 22], { rate: 20, keys: 40, writes: 1 }, "a", { label: "Europe" }),
      users("us", [8, 74], { rate: 20, keys: 40, writes: 1 }, "c", { label: "Americas" }),
      member("a", [46, 22], "eu", "Copy A"),
      member("c", [46, 74], "us", "Copy C"),
      member("b", [86, 48], "us", "Copy B"),
    ],
    {
      timeoutMs: 1000,
      links: { "eu>a": 6, "us>c": 6, "a>b": 40, "a>c": 40, "b>c": 8 },
      windowMs: 2000,
      seed: 67,
      // The first election happens before the scene is shown.
      warmMs: 1500,
      script: {
        loopMs: 60_000,
        events: [
          { at: 2000, label: CRASH, armed: true, run: (s) => { const id = leaderNow(s); if (id) s.setUp(id, false); } },
          { at: 4500, label: BACK, armed: true, ends: true, run: (s) => MEMBERS.forEach((id) => s.setUp(id, true)) },
          { at: 6000, label: CUT, armed: true, run: (s) => s.setPartition(true) },
          { at: 8500, label: HEAL, armed: true, ends: true, run: (s) => s.setPartition(false) },
        ],
      },
    },
  );
};

const failed = M.errors({ label: "Failed writes", hint: "Share of writes that failed or gave up." });
const conflicts: MetricSpec = { id: "conflicts", label: "Conflicting writes", hint: "Keys written on both sides while the link was cut: two versions of the truth." };
const noLeader: MetricSpec = { id: "leaderless", label: "No leader", hint: "Share of the time with no live leader to take writes." };
const term: MetricSpec = { id: "term", label: "Term", nodes: MEMBERS, hint: "How many elections the group has held." };
const metrics = [failed, conflicts, noLeader, term];

const leaderElection: LessonScene = {
  hook: "When the leader dies, how do the rest agree on one new leader, and only one?",
  dots: ["req", "ok", "failed", "copy", "probe"],
  figures: [
    {
      tone: "problem",
      short: "Fixed leader",
      title: "One leader, chosen once",
      caption: "Three copies of a database, one in Europe and two in the Americas. Copy B always leads; the others pass writes to it.",
      actions: [crash],
      metrics,
      parts: [
        { node: ["eu", "us"], text: "Europe and the Americas: 20 writes a second each." },
        { node: ["a", "c"], text: "Copies A and C: pass every write to B." },
        { node: "b", text: "Copy B: the leader, applying every write." },
      ],
      beats: [
        { id: "forward", when: { at: 300 }, text: "Watch Europe's writes reach Copy A, then cross the ocean to Copy B.", focus: { link: ["a", "b"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Crash the leader.", focus: { action: "crash-leader" }, pause: true },
        { id: "stop", when: { metric: failed, is: ">", value: 0.3 }, text: "Read Failed writes: {errors}. No one else may lead, so every write fails.", focus: { metric: "Failed writes" } },
      ],
      predict: {
        prompt: "Copy B, the fixed leader, is about to crash. Writes will…",
        options: ["Move to another copy", "Fail until B is back"],
        answer: 1,
        before: "press",
        reveal: { beat: "stop", text: "Failed writes: {before} before the crash, {after} after." },
        track: { metric: failed },
        holds: (_, after) => after !== null && after > 0.3,
      },
      break: { action: "crash-leader", beat: "press" },
      build: () => group("fixed"),
    },
    {
      tone: "fix",
      short: "Anyone leads",
      title: "Whoever hears nothing, leads",
      caption: "The same copies. A copy that hears nothing from a leader for half a second leads itself, and takes writes at once.",
      actions: [cut],
      metrics,
      beats: [
        { id: "beats", when: { step: "enter" }, text: "Now the leader sends small beats; a copy that misses them takes over.", focus: { nodes: MEMBERS } },
        { id: "press-cut", when: { wait: 0 }, text: "Press ⚡ Cut the ocean link.", focus: { action: "cut" }, pause: true },
        {
          id: "two",
          when: { note: "Copy A elected leader" },
          text: "Copy A hears nothing, and leads Europe: two leaders, a [[split-brain|split brain]].",
          focus: { nodes: ["a"] },
          term: "split-brain",
        },
        { id: "both", when: { note: HEAL }, text: "Read Conflicting writes: {conflicts} keys written on both sides at once.", focus: { metric: "Conflicting writes" } },
      ],
      break: { action: "cut", beat: "press-cut" },
      build: () => group("naive"),
    },
    {
      tone: "fix",
      short: "Majority",
      title: "Elected by a majority",
      caption: "The same copies. A copy that hears nothing asks the others for votes; two votes of three make it leader for a new term.",
      actions: [cut, crash],
      metrics,
      beats: [
        {
          id: "vote",
          when: { step: "enter" },
          text: "Now a leader needs votes from a majority, two of three: [[consensus]].",
          focus: { nodes: MEMBERS },
          term: "consensus",
        },
        { id: "press-cut3", when: { wait: 0 }, text: "Press ⚡ Cut the ocean link.", focus: { action: "cut" }, pause: true },
        { id: "alone", when: { note: CUT }, text: "Alone, Copy A asks for votes it can't win: Europe's writes fail instead.", focus: { nodes: ["a"] } },
        { id: "none", when: { note: HEAL }, text: "Compare Conflicting writes: {conflicts:3} here, {conflicts:2} when anyone could lead.", focus: { metric: "Conflicting writes" } },
        { id: "crash-too", when: { wait: 600 }, text: "Press ⚡ Crash the leader: the others vote in a new one within a second.", focus: { action: "crash-leader" } },
      ],
      break: { action: "cut", beat: "press-cut3" },
      headline: { metric: "Conflicting writes", sentence: "The ocean cut for 2.5 s: {conflicts:2} keys conflicted when anyone could lead, {conflicts:3} with a majority." },
      build: () => group("majority"),
    },
  ],
  checks: [
    {
      prompt: "Why can't the copy cut off in Europe elect itself?",
      options: ["It can only get one vote of three", "It's too far away"],
      answer: 0,
      why: "A leader needs a majority. Two groups can't both have a majority, so there can never be two leaders.",
      focus: { nodes: ["a"] },
    },
    {
      prompt: "What does the majority rule cost Europe while the link is cut?",
      options: ["Its writes fail until the link is back", "Nothing"],
      answer: 0,
      why: "Staying consistent means the minority side refuses writes: availability given up for one truth.",
      focus: { metric: "Failed writes" },
    },
  ],
  takeaways: {
    use: "Any group of copies that must agree on one leader or one order: use a consensus system, not your own election.",
    catch: "The minority side of a split stops taking writes, and an odd number of members (3, 5) is what makes majorities work.",
    seen: "Raft in etcd and Consul, ZooKeeper, Kafka's KRaft, CockroachDB and TiKV, MongoDB replica set elections.",
    rule: "No majority, no leader.",
    interview: "Say: “Use Raft or Paxos: terms, majority votes and majority commits, so a partition can't create two leaders.”",
  },
};

export default leaderElection;
