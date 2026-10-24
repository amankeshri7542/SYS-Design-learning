import { M, armed, database, fault, knob, scene, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { Sim } from "../../sim/engine";
import type { SceneSpec } from "../../sim/types";

// D1: one table of 100,000 rows. Without an index a read checks every row (0.6 ms per 1,000 rows, so 60 ms); with one
// it takes a few steps that grow with the log of the rows (about 5 ms), and each write also updates the index (4 ms
// becomes 10). The break doubles the table: scans take twice as long, lookups by index barely change.

const GROW = "The table doubles";
const SHRINK = "The table is back to 100,000 rows";
const double = fault("double", "Double the table", "Halve it again", GROW, SHRINK, (s) => (s.nodes.get("db")?.spec.serviceBy?.read ?? 0) > (indexed(s) ? 5.3 : 70));
const indexed = (s: Sim) => (s.nodes.get("db")?.spec.serviceBy?.write ?? 0) > 5;

/** Read and write cost for a table of `rows`, with or without an index. */
const cost = (rows: number, index: boolean) => (index ? { read: 1 + 0.25 * Math.log2(rows), write: 10 } : { read: rows * 0.0006, write: 4 });

const table = (index: boolean, writes: number, rows: number): SceneSpec =>
  scene(
    [users("u", [14, 50], { rate: 30, keys: 50, writes }, "db", { label: "App" }), database("db", [86, 50], { slots: 4, serviceBy: cost(rows, index) })],
    {
      links: { "u>db": 5 },
      windowMs: 1500,
      seed: 15,
      script: armed(
        { node: "db", at: 1200, lastsMs: 3000, start: GROW, end: SHRINK },
        { start: (s) => s.reconfigure(table(index, writes, rows * 2)), end: (s) => s.reconfigure(table(index, writes, rows)) },
      ),
    },
  );

const reads = M.p95({ op: "read", label: "Read time", hint: "95% of reads are answered faster than this (the p95)." });
const writeTime = M.p50({ op: "write", label: "Write time", hint: "Half of writes finish faster than this (the median)." });
const metrics = [reads, M.busy(["db"], "Database busy"), writeTime];

const indexes: LessonScene = {
  hook: "Why does a query that took 5 ms last year take 500 ms today?",
  dots: ["req", "late", "ok"],
  figures: [
    {
      tone: "problem",
      short: "Every row",
      title: "Check every row",
      caption: "One table of 100,000 rows. To find one row, the database reads them all.",
      actions: [double],
      metrics,
      parts: [
        { node: "u", text: "App: 30 queries a second, 1 in 10 writes." },
        { node: "db", text: "Database: 100,000 rows, 4 workers.", sockets: true },
      ],
      beats: [
        { id: "linger", when: { at: 300 }, text: "Watch a read sit in Database: it checks every row to find one.", focus: { nodes: ["db"], sockets: true } },
        {
          id: "scan",
          when: { wait: 0 },
          text: "Reading them all is a [[table-scan|table scan]]: 60 ms at 100,000 rows.",
          focus: { nodes: ["db"] },
          term: "table-scan",
        },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Double the table.", focus: { action: "double" }, pause: true },
        { id: "slower", when: { note: GROW }, text: "Twice the rows, twice the work: each read now takes 120 ms.", focus: { nodes: ["db"], sockets: true } },
        { id: "line", when: { metric: M.queue(["db"]), is: ">", value: 3 }, text: "A line forms: Database is {util:db} busy, and reads wait.", focus: { nodes: ["db"], dots: "waiting" } },
      ],
      predict: {
        prompt: "The table doubles to 200,000 rows. Reads will take…",
        options: ["About the same time", "About twice as long"],
        answer: 1,
        before: "press",
        reveal: { beat: "line", text: "Read time: {before} at 100,000 rows, {after} at 200,000." },
        track: { metric: reads },
        holds: (before, after) => before !== null && after !== null && after > before * 1.6,
      },
      break: { action: "double", beat: "press" },
      build: () => table(false, 0.1, 100_000),
    },
    {
      tone: "fix",
      short: "With index",
      title: "Go straight to the row",
      caption: "The same table, with a sorted list of the searched column pointing at each row. Every write updates the list too.",
      actions: [double],
      knobs: [knob("writes", "Writes", 0, 50, 5, 10, (v) => `${v}%`)],
      metrics,
      beats: [
        { id: "index", when: { step: "enter" }, text: "Now an [[index]] points straight at the row: a few steps, not 100,000.", focus: { nodes: ["db"] }, term: "index" },
        { id: "compare", when: { wait: 0 }, text: "Compare Read time: {p95:fix} here, {p95:problem} checking every row.", focus: { metric: "Read time" } },
        { id: "catch", when: { wait: 0 }, text: "The catch: each write updates the index too. Writes take {p50:fix} here.", focus: { metric: "Write time" } },
        { id: "more", when: { wait: 600 }, text: "Drag Writes to 50%: the index's cost grows with every write.", focus: { knob: "writes" } },
      ],
      headline: { metric: "Read time", sentence: "Table doubled: reads take {p95:problem} checking every row, {p95:fix} with an index.", at: "line" },
      build: (v: Values) => table(true, v.writes / 100, 100_000),
    },
  ],
  checks: [
    {
      prompt: "A table grows from 1 million to 10 million rows. With an index, reads get…",
      options: ["About 10 times slower", "Only a little slower"],
      answer: 1,
      why: "An index takes a few steps per tenfold growth. A scan takes ten times as long.",
      focus: { nodes: ["db"] },
    },
    {
      prompt: "Why not index every column?",
      options: ["Every write must update every index", "Indexes make reads slower"],
      answer: 0,
      why: "Each index is one more structure to change on every write, and more memory to keep.",
      focus: { metric: "Write time" },
    },
  ],
  takeaways: {
    use: "Index the columns your queries search and sort by; check slow queries with the database's query plan.",
    catch: "Each index slows every write and takes memory. Index what you query, not everything.",
    seen: "B-tree indexes in PostgreSQL and MySQL, secondary indexes in DynamoDB, EXPLAIN plans.",
    rule: "Find the row; don't read them all.",
  },
};

export default indexes;
