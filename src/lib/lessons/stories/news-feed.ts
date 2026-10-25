import type { NodeSpec, SceneSpec } from "../../sim/types";
import { M, database, lane, scene, server, users } from "../kit";
import type { StoryDef, StoryStage } from "../story";
import type { Values } from "../types";

// S6: a feed is built from the posts of everyone a reader follows. At first it is gathered when it is read, from four
// post shards at once, and is ready when the slowest answers. The target: feeds within 0.4 s, and almost none failed.
// Stages give the shards a slow tail (hedge them), send ten times the readers (build each feed when a post is made,
// through a topic into a timeline store, so a read is one cheap lookup), and add a celebrity whose every post is
// written into millions of timelines (leave celebrities' posts out of the fan-out, and merge them in on read). Gathered
// on read, a celebrity's post is simply stored once, on its shard.

const PRICE = { base: 160, hedge: 10, build: 80, hybrid: 40 };
const START: Values = { hedge: 0, build: 0, hybrid: 0 };
const SHARDS = ["s1", "s2", "s3", "s4"];

function feeds(a: Values, s: StoryStage): SceneSpec {
  const { readers, tail, posts, celeb } = s.params;
  const hybrid = !!(a.build && a.hybrid && celeb);
  const feed: NodeSpec = server("feed", [38, 50], {
    label: "Feed server",
    slots: 128,
    serviceMs: 2,
    blocking: true,
    callTimeoutMs: 800,
    ...(a.build ? (hybrid ? { fanout: { to: ["tl", "celeb"] } } : { calls: { read: ["tl"] } }) : { fanout: { to: SHARDS }, hedgeMs: a.hedge ? 60 : undefined }),
  });
  const nodes: NodeSpec[] = [users("r", [6, 50], { rate: readers, keys: 2000, tag: "feed" }, "feed", { label: "Readers" }), feed];
  if (celeb) {
    // Written into millions of timelines, a celebrity's post is twenty times the work of anyone else's.
    const fanned = a.build && !hybrid;
    nodes.push(users("c", [6, 14], { rate: celeb, keys: 1, writes: 1, heavy: fanned ? { share: 1, cost: 20 } : undefined, tag: "post" }, a.build ? (hybrid ? "celeb" : "topic") : "s1", { label: "Celebrity" }));
    if (hybrid) nodes.push(database("celeb", [84, 14], { label: "Celebrity posts", slots: 4, serviceMs: 5 }));
  }
  if (!a.build) {
    nodes.push(...SHARDS.map((id, i) => server(id, [84, lane(4, i)], { label: `Posts ${i + 1}`, slots: 8, serviceMs: 20, tail: { share: tail, mult: 20 } })));
  } else {
    nodes.push(
      users("p", [6, 86], { rate: posts, keys: 2000, writes: 1, tag: "post" }, "topic", { label: "Posters" }),
      { id: "topic", kind: "topic", label: "New posts", at: [38, 86], to: ["tl"] },
      database("tl", [84, 50], { label: "Timelines", slots: 6, serviceBy: { read: 4, write: 30 } }),
    );
  }
  return scene(nodes, {
    links: { ...Object.fromEntries(SHARDS.map((id) => [`feed>${id}`, 5])), "feed>tl": 5, "feed>celeb": 5, "topic>tl": 5 },
    windowMs: 3000,
    wideH: 440,
  });
}

const within = M.p95({ tag: "feed", label: "Feed time", hint: "95% of feeds are ready within this time (the p95)." });
const failed = M.errors({ tag: "feed", label: "Feeds failed", hint: "Share of feed reads that failed or gave up." });

/** Build feeds for everyone: four stages, from a small network to a celebrity with millions of followers. */
const newsFeed: StoryDef = {
  controls: [
    { kind: "switch", id: "hedge", label: "Hedge slow shards" },
    { kind: "switch", id: "build", label: "Build feeds on post" },
    { kind: "switch", id: "hybrid", label: "Celebrities on read" },
  ],
  start: START,
  cost: (a) => PRICE.base + a.hedge * PRICE.hedge + a.build * PRICE.build + a.hybrid * PRICE.hybrid,
  scene: feeds,
  targets: [
    { metric: within, label: "Feed time", max: 400 },
    { metric: failed, label: "Feeds failed", max: 0.02 },
  ],
  metrics: [
    { id: "util", label: "Stores busy", nodes: [...SHARDS, "tl"], hint: "Share of the post shards' or the timeline store's workers busy right now." },
    { id: "hedged", label: "Sent twice", hint: "Share of the requests to shards that were slow enough to get a second copy." },
  ],
  win: (cost) => `Your feeds stayed fast through all four stages for $${cost} a month. Can a cheaper design hold the last one?`,
  lead: (s) => `${s.params.readers} a second`,
  stages: [
    {
      name: "A small network",
      beats: [
        { id: "gather", when: { step: "enter" }, text: "Each feed is gathered when it's read, from four post shards at once.", focus: { nodes: ["feed"] } },
        { id: "slowest", when: { wait: 0 }, text: "Watch a feed wait for the slowest of its four answers.", focus: { nodes: SHARDS } },
      ],
      brief: "A small network. Check that gathering each feed from four shards keeps up.",
      hint: "Nothing to change yet.",
      params: { readers: 40, tail: 0.003, posts: 10, celeb: 0 },
      hold: 6,
      solution: START,
    },
    {
      name: "Stragglers",
      beats: [
        { id: "tail", when: { step: "enter" }, text: "Now one shard answer in 20 is twenty times slower.", focus: { nodes: SHARDS } },
        { id: "late", when: { wait: 0 }, text: "Watch Feed time: a feed waits for its slowest shard.", focus: { nodes: ["feed"] } },
      ],
      brief: "The shards are busier and stall now and then. A feed is only as fast as its slowest shard.",
      hint: "Ask a slow shard a second time, and take whichever answer comes first.",
      params: { readers: 80, tail: 0.05, posts: 10, celeb: 0 },
      hold: 8,
      solution: { ...START, hedge: 1 },
    },
    {
      name: "Prime time",
      beats: [
        { id: "crowd", when: { step: "enter" }, text: "Now 500 feeds a second, each one four reads.", focus: { nodes: ["r"] } },
        { id: "swamp", when: { wait: 0 }, text: "Watch the shards drown: every feed is gathered again from scratch.", focus: { nodes: SHARDS } },
      ],
      brief: "Everyone opens the app at once, and every feed is gathered again from scratch.",
      hint: "Posts are rare and reads are many. Do the work once, when a post is made.",
      params: { readers: 500, tail: 0.05, posts: 20, celeb: 0 },
      hold: 8,
      solution: { ...START, hedge: 1, build: 1 },
    },
    {
      name: "A celebrity posts",
      beats: [
        { id: "star", when: { step: "enter" }, text: "Now a celebrity posts, and each post goes to millions of timelines.", focus: { nodes: ["c"] } },
        { id: "where", when: { wait: 0 }, text: "Watch each celebrity post: written into every timeline, or stored once?", focus: { nodes: ["c"] } },
      ],
      brief: "A celebrity with millions of followers posts again and again. Each post is written into every follower's timeline.",
      hint: "Leave the celebrity's posts out of the fan-out, and fetch them when a feed is read.",
      params: { readers: 500, tail: 0.05, posts: 20, celeb: 16 },
      hold: 10,
      solution: { ...START, hedge: 1, build: 1, hybrid: 1 },
    },
  ],
};

export default newsFeed;
