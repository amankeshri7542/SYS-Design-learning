import { M, armed, database, fault, knob, ms, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";

// N8: users → API → database. Everyone gives up after 0.6 s, but in the problem each hop keeps its own clock: the API
// waits 0.6 s from when it calls, and the database works on whatever reaches it. When the database slows (the break),
// its line passes the users' deadline and most of its work is for users who have left. With one deadline passed along
// (`deadlines: "honour"`), the API stops waiting at the deadline and the database refuses work it can't finish in time.

const SLOW = "The database slows down";
const FAST = "The database recovers";
const slowDb = fault("slow-db", "Slow the database", "Speed it up again", SLOW, FAST, (s) => (s.nodes.get("db")?.spec.serviceMs ?? 0) > 100);

const chain = (honour: boolean, deadline: number, slow: boolean): ReturnType<typeof scene> => {
  const deadlines = honour ? ("honour" as const) : undefined;
  return scene(
    [
      users("u", [8, 50], { rate: 30, keys: 50, timeoutMs: deadline }, "api", { label: "Users" }),
      server("api", [46, 50], { label: "API", slots: 12, serviceMs: 10, to: ["db"], blocking: true, callTimeoutMs: 600, deadlines }),
      database("db", [86, 50], { slots: 4, serviceMs: slow ? 200 : 40, deadlines }),
    ],
    {
      timeoutMs: 600,
      windowMs: 1500,
      seed: 8,
      script: armed(
        { node: "db", at: 1200, lastsMs: 3200, start: SLOW, end: FAST },
        { start: (s) => s.reconfigure(chain(honour, deadline, true)), end: (s) => s.reconfigure(chain(honour, deadline, false)) },
      ),
    },
  );
};

const wasted = { id: "wasted", label: "Wasted work", hint: "Share of the workers' time spent on requests whose user had already given up." } as const;
const metrics = [wasted, M.p95(), M.errors(), { id: "rejected", label: "Turned away", hint: "Requests refused at once because they could not finish before their deadline." } as const];

const timeouts: LessonScene = {
  hook: "Why does a server keep working for a user who already closed the tab?",
  dots: ["req", "late", "ok", "gaveup", "turned", "failed"],
  figures: [
    {
      tone: "problem",
      short: "Own clocks",
      title: "A clock per hop",
      caption: "Users give up after 0.6 s. The API also waits up to 0.6 s, counted from when it calls the database.",
      actions: [slowDb],
      metrics,
      parts: [
        { node: "u", text: "Users: 30 a second, give up after 0.6 s." },
        { node: "api", text: "API: 12 workers, waiting 0.6 s at most.", sockets: true },
        { node: "db", text: "Database: 4 workers, 40 ms each.", sockets: true },
      ],
      beats: [
        { id: "clocks", when: { at: 300 }, text: "Each hop keeps its own clock. Nobody tells Database when a user has left.", focus: { nodes: ["api", "db"] } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Slow the database.", focus: { action: "slow-db" }, pause: true },
        {
          id: "line",
          when: { metric: M.busy(["api"]), is: ">", value: 0.85 },
          text: "Watch API's workers fill up: each one waits on a 200 ms query.",
          focus: { nodes: ["api"], sockets: true },
        },
        {
          id: "ghost",
          when: { fx: "timeout", node: "u" },
          text: "A red ring: that user gave up, yet Database still works on it. A [[ghost]].",
          focus: { dots: "gaveup" },
          pause: true,
          term: "ghost",
        },
        { id: "waste", when: { metric: wasted, is: ">", value: 0.5 }, text: "Count the waste: {wasted} of the workers' time goes to users who left.", focus: { metric: "Wasted work" } },
      ],
      predict: {
        prompt: "The database slows to 200 ms a query. Its workers will spend most of their time on…",
        options: ["Users still waiting", "Users who have already left"],
        answer: 1,
        before: "press",
        reveal: { beat: "waste", text: "Wasted work rose from {before} to {after}." },
        track: { metric: wasted },
        holds: (_, after) => after !== null && after > 0.5,
      },
      break: { action: "slow-db", beat: "press" },
      build: () => chain(false, 600, false),
    },
    {
      tone: "fix",
      short: "One clock",
      title: "One clock, passed along",
      caption: "The users' 0.6 s limit travels with each request. API and Database drop work for anyone out of time.",
      actions: [slowDb],
      knobs: [knob("deadline", "Deadline", 300, 1200, 100, 600, ms)],
      metrics,
      beats: [
        {
          id: "travels",
          when: { step: "enter" },
          text: "Now the [[deadline]] travels with each request: every hop knows the time left.",
          focus: { nodes: ["api", "db"] },
          term: "deadline",
        },
        { id: "compare", when: { wait: 0 }, text: "Compare Wasted work: {wasted:fix} here, {wasted:problem} with a clock per hop.", focus: { metric: "Wasted work" } },
        { id: "turned", when: { wait: 0 }, text: "Slate squares are queries refused early: a fast no beats a slow nothing.", focus: { dots: "turned" } },
        { id: "longer", when: { wait: 600 }, text: "Drag Deadline to 1.2 s: fewer turned away, and still almost no waste.", focus: { knob: "deadline" } },
      ],
      headline: {
        metric: "Wasted work",
        sentence: "Database slowed: {wasted:problem} of the work wasted with a clock per hop, {wasted:fix} with one deadline.",
        at: "compare",
      },
      build: (v: Values) => chain(true, v.deadline, false),
    },
  ],
  checks: [
    {
      prompt: "Why pass the deadline along instead of giving each service its own timeout?",
      options: ["So every hop stops when the user stops", "So each service runs faster"],
      answer: 0,
      why: "Work past the user's deadline helps nobody. A travelling deadline lets every hop drop it and free the worker.",
      focus: { nodes: ["db"] },
    },
    {
      prompt: "A database gets a query it can't finish before the deadline. What's best?",
      options: ["Run it anyway", "Refuse it at once"],
      answer: 1,
      why: "Refusing frees the worker for someone it can still help, and the caller hears no straight away.",
      focus: { dots: "turned" },
    },
  ],
  takeaways: {
    use: "Any request that crosses services: set one deadline at the edge and pass the time left along.",
    catch: "Every hop must check it. One that ignores the deadline keeps working for ghosts.",
    seen: "gRPC deadlines, Go's context package, and timeout headers in Envoy.",
    rule: "One deadline, passed along.",
  },
};

export default timeouts;
