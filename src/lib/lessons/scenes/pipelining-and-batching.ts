import { M, choice, database, knob, ms, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";

// N13: each page needs 8 items from a database 20 ms away. One item per trip is 8 round trips in a row (the N+1
// problem); one batched query is one round trip, with a query a little longer (5 ms for one item, 1 ms more for each
// extra). The users, their traffic and the database are the same in both steps; only how App asks changes.

const ITEMS = 8;
const SIZES = [1, 2, 4, 8];

/** `batch`: items fetched per trip. `away`: App to Database, one way. */
const page = (batch: number, away: number) =>
  scene(
    [
      users("u", [8, 50], { rate: 20, keys: 50 }, "app", { label: "Users" }),
      server("app", [46, 50], { label: "App", slots: 16, serviceMs: 5, calls: { read: Array.from({ length: ITEMS / batch }, () => "db"), write: [] } }),
      database("db", [86, 50], { slots: 8, serviceMs: 5 + (batch - 1) }),
    ],
    { links: { "u>app": 10, "app>db": { ms: away, label: `${away} ms away` } }, windowMs: 2000, seed: 4 },
  );

const ready = M.p95({ label: "Page ready", hint: "95% of pages have all their items within this time (the p95)." });
const trips = M.load(["db"], "Database trips");
const metrics = [ready, M.wire(), M.work(), trips];

const batching: LessonScene = {
  hook: "Why do eight small database calls take longer than one big one?",
  dots: ["req", "late", "ok"],
  figures: [
    {
      tone: "problem",
      short: "One per trip",
      title: "One item per trip",
      caption: "Each page needs 8 items. App asks Database for one, waits for it, then asks for the next.",
      metrics,
      parts: [
        { node: "u", text: "Users: 20 pages a second." },
        { node: "app", text: "App: needs 8 items from Database per page." },
        { node: "db", text: "Database: 20 ms away, 5 ms an item." },
      ],
      beats: [
        { id: "trips", when: { at: 300 }, text: "Watch App ask for one item, wait for it, then ask for the next.", focus: { link: ["app", "db"] }, follow: true },
        {
          id: "nplus1",
          when: { wait: 0 },
          text: "Eight round trips, one after another: the [[n-plus-one|N+1 problem]].",
          focus: { link: ["app", "db"] },
          pause: true,
          term: "n-plus-one",
        },
        { id: "load", when: { metric: trips, is: ">", value: 100 }, text: "Read Database trips: {load:db}, for just 20 pages a second.", focus: { metric: "Database trips" } },
        { id: "slow", when: { metric: ready, is: ">", value: 380 }, text: "Read Page ready: {p95}, nearly all of it travel, not work.", focus: { metric: "Page ready" } },
      ],
      predict: {
        prompt: "App fetches all 8 items in one trip, with a query twice as long. The page will be…",
        options: ["About as slow", "Several times faster"],
        answer: 1,
        before: "end",
        reveal: { beat: "compare", text: "Page ready: {before} one item per trip, {after} in one trip." },
        track: { metric: ready, world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < before / 2.5,
      },
      build: () => page(1, 20),
    },
    {
      tone: "fix",
      short: "One trip",
      title: "One trip for all eight",
      caption: "App asks for all 8 items in one query. That query takes 12 ms instead of 5.",
      knobs: [choice("batch", "Items per trip", SIZES.map(String), 3), knob("away", "Database distance", 5, 50, 5, 20, (v) => `${ms(v)} each way`)],
      metrics,
      beats: [
        { id: "one", when: { step: "enter" }, text: "Now one trip carries all 8 items: that's [[batching]].", focus: { link: ["app", "db"] }, term: "batching" },
        { id: "compare", when: { wait: 0 }, text: "Compare Page ready: {p95:fix} here, {p95:problem} one item per trip.", focus: { metric: "Page ready" } },
        { id: "fewer", when: { wait: 0 }, text: "Read Database trips: {load:db:fix}. Same items, an eighth of the trips.", focus: { metric: "Database trips" } },
        { id: "smaller", when: { wait: 600 }, text: "Drag Items per trip down to 1: the trips come back, and the wait.", focus: { knob: "batch" } },
      ],
      headline: { metric: "Page ready", sentence: "The same 8 items a page: {p95:problem} one per trip, {p95:fix} in one batch." },
      build: (v: Values) => page(SIZES[v.batch], v.away),
    },
  ],
  checks: [
    {
      prompt: "A page makes 20 database calls, one after another, each a 2 ms round trip. How much is travel?",
      options: ["2 ms", "40 ms"],
      answer: 1,
      why: "Each call waits for the last, so 20 round trips of 2 ms add up to 40 ms before any query work.",
      focus: { link: ["app", "db"] },
    },
    {
      prompt: "Which fixes a page that makes one query per item?",
      options: ["A faster database", "One query for all the items"],
      answer: 1,
      why: "The page pays a round trip per item. One batched query pays one, whatever the database's speed.",
      focus: { metric: "Database trips" },
    },
  ],
  takeaways: {
    use: "Any page or job that fetches many items: batch them, or send them all without waiting for each answer (pipelining).",
    catch: "A batch waits for its slowest item, and a huge batch is slow to build and send.",
    seen: "ORMs' N+1 queries, GraphQL's DataLoader, Redis pipelines, HTTP/2 multiplexing.",
    rule: "Pay for trips, not items.",
  },
};

export default batching;
