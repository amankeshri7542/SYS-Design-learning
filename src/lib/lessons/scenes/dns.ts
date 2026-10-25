import { M, cache, knob, ms, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";

// N5: before each page, Browser asks Resolver for the site's address, then fetches the page. Without a cache, Resolver
// walks the name servers every time (root, then .com, then example.com's own, 25 ms apart, stacked in one column so a
// phone's tall layout keeps four rows). With answers kept for their
// time to live, the walk happens once per site, then not again until the answer expires. Users visit 8 sites.

const nameServer = (id: string, across: number, label: string, next?: string) =>
  server(id, [72, across], { label, slots: 32, serviceMs: 2, ...(next ? { to: [next] } : {}) });

/** `ttl`: how long Resolver keeps an answer (0: not at all). */
const lookup = (ttl: number) =>
  scene(
    [
      users("u", [6, 50], { rate: 20, keys: 8 }, "br", { label: "Users" }),
      server("br", [24, 50], { label: "Browser", slots: 32, serviceMs: 1, calls: { read: ["res", "web"], write: [] } }),
      cache("res", [48, 24], "root", { label: "Resolver", capacity: ttl ? 20 : 0, ttlMs: ttl || undefined }),
      nameServer("root", 8, "Root", "tld"),
      nameServer("tld", 34, ".com", "auth"),
      nameServer("auth", 60, "example.com"),
      server("web", [72, 88], { label: "Web server", slots: 8, serviceMs: 20 }),
    ],
    {
      links: { "u>br": 2, "br>res": 10, "res>root": 25, "root>tld": 25, "tld>auth": 25, "br>web": 40 },
      windowMs: 2000,
      seed: 9,
    },
  );

const load = M.p50({ label: "Typical page load", hint: "Half of page loads finish faster than this (the median), lookup included." });
const fromCache: MetricSpec = { id: "hit", label: "Lookups from cache", nodes: ["res"], hint: "Share of lookups Resolver answered from its own memory." };
const rootLoad = M.load(["root"], "Root queries");
const metrics = [load, fromCache, rootLoad];

const dns: LessonScene = {
  hook: "Before your browser can fetch a page, what does it have to find first?",
  dots: ["req", "ok"],
  figures: [
    {
      tone: "problem",
      short: "Every time",
      title: "Look it up every time",
      caption: "Before each page, Browser asks Resolver for the site's address. Resolver keeps nothing, so it asks again every time.",
      metrics,
      parts: [
        { node: "u", text: "Users: 20 page loads a second, 8 sites." },
        { node: "br", text: "Browser: finds the address, then fetches the page." },
        { node: "res", text: "Resolver: 10 ms away, remembers nothing." },
        { node: ["root", "tld", "auth"], text: "Name servers: asked one after another, 25 ms apart." },
        { node: "web", text: "Web server: 40 ms away, 20 ms a page." },
      ],
      beats: [
        { id: "ask", when: { at: 300 }, text: "Watch Browser ask Resolver first: it doesn't know the site's address yet.", focus: { link: ["br", "res"] }, follow: true },
        {
          id: "walk",
          when: { wait: 0 },
          text: "Resolver asks Root, then .com, then example.com's own server: that's [[dns|DNS]].",
          focus: { nodes: ["root", "tld", "auth"] },
          pause: true,
          term: "dns",
        },
        { id: "then", when: { wait: 0 }, text: "Only then does the page request leave for Web server.", focus: { link: ["br", "web"] } },
        { id: "cost", when: { metric: load, is: ">", value: 200 }, text: "Read Typical page load: {p50}, more than half of it finding the address.", focus: { metric: "Typical page load" } },
      ],
      predict: {
        prompt: "Resolver will keep each answer for 5 s. The typical page load will…",
        options: ["Barely change", "Fall by more than half"],
        answer: 1,
        before: "end",
        reveal: { beat: "compare", text: "Typical page load: {before} looking up every time, {after} with answers kept." },
        track: { metric: load, world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < before / 2,
      },
      build: () => lookup(0),
    },
    {
      tone: "fix",
      short: "Kept answers",
      title: "Keep the answer",
      caption: "Resolver keeps each answer for 5 s, then asks the name servers again.",
      knobs: [knob("ttl", "Kept for", 250, 10000, 250, 5000, ms)],
      metrics,
      beats: [
        {
          id: "kept",
          when: { step: "enter" },
          text: "Now Resolver keeps each answer for its [[ttl|time to live]]: 5 s here.",
          focus: { nodes: ["res"] },
          term: "ttl",
        },
        { id: "hits", when: { wait: 0 }, text: "Read Lookups from cache: {hit:res:fix}. The name servers go quiet.", focus: { metric: "Lookups from cache" } },
        { id: "compare", when: { wait: 0 }, text: "Compare Typical page load: {p50:fix} here, {p50:problem} looking up every time.", focus: { metric: "Typical page load" } },
        { id: "short", when: { wait: 600 }, text: "Drag Kept for down to 0.25 s: more lookups reach the name servers.", focus: { knob: "ttl" } },
      ],
      headline: { metric: "Typical page load", sentence: "The same pages: {p50:problem} looking the address up every time, {p50:fix} with answers kept for 5 s." },
      build: (v: Values) => lookup(v.ttl),
    },
  ],
  checks: [
    {
      prompt: "Why is a site a little slower the very first time you visit it?",
      options: ["Its address has to be looked up", "Its server is cold"],
      answer: 0,
      why: "The first visit pays the lookup's round trips. After that the answer is kept, and the lookup vanishes.",
      focus: { nodes: ["root", "tld", "auth"] },
    },
    {
      prompt: "A site moves to a new server, and some users still reach the old one. Why?",
      options: ["Their kept answer hasn't expired", "The new server is slow"],
      answer: 0,
      why: "A kept answer names the old address until its time to live runs out. Shorten it before a move.",
      focus: { nodes: ["res"] },
    },
  ],
  takeaways: {
    use: "Every request to a name. Keep answers close to users, with long lifetimes for addresses that rarely change.",
    catch: "A long time to live means a move or failover takes that long to reach everyone. Shorten it before a change.",
    seen: "Browsers, operating systems and ISPs all keep DNS answers; Route 53, Cloudflare DNS, 8.8.8.8.",
    rule: "Look it up once, then remember.",
  },
};

export default dns;
