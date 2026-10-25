import { M, armed, database, fault, scene, users } from "../kit";
import type { Action, LessonScene } from "../types";

const CUT = "The link between regions breaks";
const REPAIR = "The link is repaired";

const capScene = (mode: "cp" | "ap") =>
  scene(
    [
      users("us", [10, 20], { rate: 14, keys: 8, writes: 0.4, tag: "us" }, "dbUS", { label: "US users" }),
      users("eu", [10, 80], { rate: 14, keys: 8, writes: 0.4, tag: "eu" }, "dbEU", { label: "EU users" }),
      database("dbUS", [74, 20], {
        // In the consistent world its role shows as a LEADER badge (the follower's `leader` points here).
        label: "US database",
        slots: 4,
        serviceMs: 40,
        region: "us",
        peer: "dbEU",
        lagMs: 90,
      }),
      database("dbEU", [74, 80], {
        label: "EU database",
        slots: 4,
        serviceMs: 40,
        region: "eu",
        leader: mode === "cp" ? "dbUS" : undefined,
        peer: mode === "ap" ? "dbUS" : undefined,
        lagMs: 90,
      }),
    ],
    {
      sloMs: 300,
      links: { "dbUS>dbEU": 90 },
      linkLabels: { "dbUS>dbEU": "across the Atlantic" },
      wideH: 460,
      // Armed: the learner cuts the link; it is repaired 1.9 s later.
      script: armed({ node: "dbEU", at: 1500, lastsMs: 1900, start: CUT, end: REPAIR }, { start: (s) => s.setPartition(true), end: (s) => s.setPartition(false) }),
    },
  );

const cut: Action = fault("cut", "Cut the network", "Repair the network", CUT, REPAIR, (s) => s.partitioned);

const answered = { id: "answered" as const, label: "EU requests answered", tag: "eu", hint: "Share of EU requests that got a real answer." };
const euStale = M.stale({ tag: "eu", label: "EU stale reads" });
const conflicts = { id: "conflicts" as const, label: "Conflicting writes", hint: "Keys written on both sides during a split." };

const cap: LessonScene = {
  hook: "The ocean cable is cut. Should Europe refuse requests, or answer with old data?",
  dots: ["req", "late", "ok", "stale", "failed", "copy"],
  figures: [
    {
      tone: "tradeoff",
      short: "Consistent",
      title: "Choose consistency: refuse when unsure",
      caption: "The EU copy forwards every request to the US copy, so answers are always current.",
      actions: [cut],
      metrics: [answered, M.p95({ tag: "eu", label: "EU response time" }), euStale],
      parts: [
        { node: ["us", "eu"], text: "US and EU users: 14 a second each." },
        { node: "dbUS", text: "US database: every read and write lands here." },
        { node: "dbEU", text: "EU database: forwards everything across the Atlantic." },
      ],
      beats: [
        { id: "forward", when: { at: 200 }, text: "Watch an EU request cross the Atlantic to the US database and back.", focus: { link: ["dbUS", "dbEU"] } },
        { id: "roles", when: { wait: 0 }, text: "The US copy decides: the [[leader]]. The EU copy only forwards.", focus: { nodes: ["dbUS", "dbEU"] }, term: "leader" },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Cut the network.", focus: { action: "cut" }, pause: true },
        {
          id: "refuse",
          when: { note: CUT },
          text: "Cut off, the EU copy refuses rather than answer from old data.",
          focus: { nodes: ["dbEU"], dots: "failed" },
          pause: true,
        },
        { id: "answered", when: { metric: answered, is: "<", value: 0.6 }, text: "EU requests answered: {answered:eu}. Every answer given is current.", focus: { metric: "EU requests answered" } },
      ],
      predict: {
        prompt: "The cable is cut. If Europe keeps answering on its own, some answers will…",
        options: ["be refused", "be out of date", "be lost"],
        answer: 1,
        before: "press",
        reveal: { beat: "stale", text: "{after} of EU reads were stale during the cut." },
        track: { metric: euStale, world: 1 },
        holds: (_, after) => after !== null && after > 0,
      },
      break: { action: "cut", beat: "press" },
      build: () => capScene("cp"),
    },
    {
      tone: "tradeoff",
      short: "Available",
      title: "Choose availability: answer anyway",
      caption: "Each region reads and writes locally, and copies its writes across in the background.",
      actions: [cut],
      metrics: [answered, euStale, conflicts],
      beats: [
        { id: "local", when: { step: "enter" }, text: "Each region now answers on its own and copies writes across later.", focus: { nodes: ["dbEU", "dbUS"] } },
        {
          id: "same",
          // The cut hit both worlds when it was pressed, and is still on.
          when: { note: CUT, since: "lesson" },
          text: "Same cut, same moment: Europe is cut off here too.",
          focus: { link: ["dbUS", "dbEU"] },
        },
        {
          id: "stale",
          when: { metric: euStale, is: ">", value: 0 },
          text: "Europe still answers, but a violet donut is an out-of-date answer.",
          focus: { dots: "stale" },
          pause: true,
        },
        { id: "conflict", when: { note: REPAIR }, text: "Repaired. Keys written on both sides now conflict: {conflicts:2}.", focus: { metric: "Conflicting writes" } },
      ],
      headline: {
        metric: "EU requests answered",
        sentence: "Same cut. Consistent: {answered:eu:1} of EU requests answered, all current. Available: {answered:eu:2} answered, {stale:eu:2} stale.",
        at: "stale",
      },
      build: () => capScene("ap"),
    },
  ],
  checks: [
    {
      prompt: "During the cut, the consistent side chose to…",
      options: ["answer from its own copy", "refuse rather than risk old data", "wait for the cable"],
      answer: 1,
      why: "It can't reach the leader, so it can't be sure its copy is current; it refuses instead.",
      focus: { nodes: ["dbEU"] },
    },
    {
      prompt: "Which should stay available during a split?",
      options: ["Bank balances", "A social feed", "Seat bookings"],
      answer: 1,
      why: "A feed can show something slightly old; money and seats need one correct answer.",
      focus: { nodes: ["dbEU"] },
    },
  ],
  takeaways: {
    use: "Choose consistency for money, inventory and anything with a single correct answer. Choose availability for feeds, carts and likes.",
    catch: "Even with a healthy network, consistency costs speed: every EU request crossed the ocean.",
    seen: "Spanner and etcd lean consistent. Cassandra, DynamoDB global tables and DNS lean available.",
    rule: "Cut off, refuse or risk old data.",
    interview: "During a partition I'd choose per feature: consistency for money and inventory, availability for feeds and carts.",
  },
};

export default cap;
