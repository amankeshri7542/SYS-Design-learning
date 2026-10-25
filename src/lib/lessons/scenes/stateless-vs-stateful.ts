import { M, armedCrash, balancer, choice, database, fault, lane, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";

// F5: three servers behind a balancer that health-checks them. In the problem each server keeps its users' sessions in
// memory (`sessions`) and the balancer pins each user to one by hashing their id, so the heaviest users share a server.
// Crash server 2: the hash spreads users over the two left, and everyone who changes server arrives signed out; when
// server 2 comes back empty, its users move back and sign in again. In the fix the servers keep nothing and read each
// session from a shared store, so a crash costs capacity, not sessions.

const CRASH = "Server 2 crashes";
const BACK = "Server 2 is back";
const crash2 = fault("crash-2", "Crash server 2", "Restore server 2", CRASH, BACK, (s) => s.nodes.get("s2")?.up === false);
const SERVERS = ["s1", "s2", "s3"];

const fleet = (sticky: boolean, store: boolean) =>
  scene(
    [
      users("u", [8, 50], { rate: 40, keys: 40, skew: 1.1 }, "lb"),
      balancer("lb", [32, 50], SERVERS, { label: "Balancer", algo: sticky ? "hash" : "round-robin", health: { everyMs: 60, failAfter: 2, passAfter: 2, timeoutMs: 200 } }),
      ...SERVERS.map((id, i) =>
        server(id, [60, lane(3, i)], { label: `Server ${i + 1}`, slots: 4, serviceMs: 60, ...(store ? { to: ["store"] } : { sessions: true }) }),
      ),
      ...(store ? [database("store", [88, 86], { label: "Session store", slots: 16, serviceMs: 3 })] : []),
    ],
    {
      // The store is in the same data centre: 4 ms away.
      links: { "s1>store": 4, "s2>store": 4, "s3>store": 4 },
      windowMs: 2000,
      seed: 12,
      script: armedCrash("s2", 1200, 2000, CRASH, BACK),
    },
  );

const failed = M.errors({ hint: "Requests that failed: users signed out, or caught in the crash." });
const busiest = M.peak(SERVERS);
const metrics = [failed, busiest, M.p95()];

const stateless: LessonScene = {
  hook: "Why does losing one server sign people out?",
  dots: ["req", "late", "ok", "failed"],
  figures: [
    {
      tone: "problem",
      short: "In memory",
      title: "Sessions in each server's memory",
      caption: "The balancer sends each user to the same server every time. That server keeps their session in its memory.",
      actions: [crash2],
      metrics,
      parts: [
        { node: "u", text: "Users: 40 people, 40 requests a second." },
        { node: "lb", text: "Balancer: each user always to the same server." },
        { node: SERVERS, text: "Servers: 4 workers each, sessions kept in memory.", sockets: true },
      ],
      beats: [
        {
          id: "sticky",
          when: { at: 300 },
          text: "Each user lands on the same server every time: a [[sticky-session|sticky session]].",
          focus: { nodes: ["lb"] },
          term: "sticky-session",
        },
        { id: "hot", when: { wait: 0 }, text: "Read Busiest server: {peak}. The heaviest users happen to share one.", focus: { metric: "Busiest server" } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Crash server 2.", focus: { action: "crash-2" }, pause: true },
        { id: "out", when: { metric: failed, is: ">", value: 0.1 }, text: "Red diamonds: every user moved to another server arrives signed out.", focus: { dots: "failed" } },
        { id: "again", when: { note: BACK }, text: "Server 2 is back, but empty. Its users move back and sign in again.", focus: { nodes: ["s2"] } },
      ],
      predict: {
        prompt: "Server 2 crashes. Who has to sign in again?",
        options: ["Nobody: the others take over", "Everyone who changes server"],
        answer: 1,
        before: "press",
        reveal: { beat: "out", text: "Failed: {before} before the crash, {after} as users moved." },
        track: { metric: failed },
        holds: (_, after) => after !== null && after > 0.1,
      },
      break: { action: "crash-2", beat: "press" },
      build: () => fleet(true, false),
    },
    {
      tone: "fix",
      short: "Session store",
      title: "Sessions in a shared store",
      caption: "Servers keep nothing between requests; each reads the session from a shared store. You choose how users are spread.",
      actions: [crash2],
      knobs: [choice("balance", "Balancing", ["Sticky", "Round robin"], 1)],
      metrics,
      beats: [
        {
          id: "store",
          when: { step: "enter" },
          text: "Now sessions live in Session store, so any server can serve anyone: [[stateless]].",
          focus: { nodes: ["store"] },
          term: "stateless",
        },
        { id: "compare", when: { wait: 0 }, text: "Compare Failed: {errors:fix} here, {errors:problem} with sessions in memory.", focus: { metric: "Failed" } },
        { id: "stick", when: { wait: 600 }, text: "Switch Balancing to Sticky: still nobody signs out, but the heavy users share one server.", focus: { knob: "balance" } },
      ],
      headline: { metric: "Failed", sentence: "Server 2 crashed: {errors:problem} failed with sessions in memory, {errors:fix} with a session store.", at: "out" },
      build: (v: Values) => fleet(v.balance === 0, true),
    },
  ],
  checks: [
    {
      prompt: "Why can servers that keep no sessions be added or removed freely?",
      options: ["Any server can serve any user", "They have more workers"],
      answer: 0,
      why: "Nothing about a user lives on them, so the balancer can send anyone anywhere, and a crash loses no one's session.",
      focus: { nodes: ["store"] },
    },
    {
      prompt: "Sessions in memory, and a server dies. What do its users see?",
      options: ["Nothing", "They're signed out"],
      answer: 1,
      why: "Their sessions died with the server's memory. Wherever they land next, they must sign in again.",
      focus: { dots: "failed" },
    },
  ],
  takeaways: {
    use: "Keep servers stateless: sessions, carts and uploads go in a shared store, so any server can serve anyone.",
    catch: "The store is now on every request's path: keep it fast, and keep copies of it.",
    seen: "Redis and Memcached session stores, signed cookies such as JWTs, sticky load-balancer cookies.",
    rule: "Servers forget; the store remembers.",
  },
};

export default stateless;
