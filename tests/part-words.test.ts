import assert from "node:assert/strict";
import { test } from "node:test";
import { COURSE, getLesson } from "../src/lib/lessons";
import { ALL_LESSONS, lessonOf, partLessons, specsOf } from "../src/lib/lessons/all";
import { defaultsOf } from "../src/lib/lessons/types";
import { describe } from "../src/lib/sim/describe";
import { Sim } from "../src/lib/sim/engine";
import { CONCEPTS, conceptKey, conceptOf, hereOf, nowOf, readOf, setupOf, type ConceptKey } from "../src/lib/sim/part-words";
import type { NodeSpec } from "../src/lib/sim/types";

// A station's card (`part-card.tsx`) says what the station is, what it does in this scene, what it is doing now and how
// to read its drawing. Every station a page can show must have one that fits it.

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

test("every station on every page resolves to a concept, in at most 20 words, pointing at a live lesson", () => {
  for (const [key, c] of Object.entries(CONCEPTS)) {
    assert.ok(c.name && c.text, `${key} has a name and words`);
    assert.ok(words(c.text) <= 20, `${key}: “${c.text}” is ${words(c.text)} words`);
    if (c.learn) assert.ok(getLesson(c.learn), `${key} points at ${c.learn}, which isn't live`);
  }
  let stations = 0;
  for (const e of COURSE) {
    for (const spec of specsOf(e.slug)) {
      for (const n of spec.nodes) {
        assert.ok(conceptKey(n, spec) in CONCEPTS, `${e.code} ${n.label}`);
        stations++;
      }
    }
  }
  assert.ok(stations > 1000, "every scene of every page was seen");
});

/** A station in a lesson's figure at its defaults, by its label. */
function at(slug: string, fig: number, label: string): { key: ConceptKey; n: NodeSpec } {
  const f = lessonOf(slug)!.figures[fig];
  const spec = f.build(defaultsOf(f));
  const n = spec.nodes.find((x) => x.label === label);
  assert.ok(n, `${slug} figure ${fig} has a station named ${label}`);
  return { key: conceptKey(n, spec), n };
}

test("stations whose kind alone would mislead get the concept they are in their scene", () => {
  const cases: [string, number, string, ConceptKey][] = [
    // A balancer that hashes users to servers keeps sessions on one server; hashing keys to data picks a shard.
    ["stateless-vs-stateful", 0, "Balancer", "sticky"],
    ["stateless-vs-stateful", 1, "Balancer", "lb"],
    ["sharding", 1, "Shard router", "shardRouter"],
    ["consistent-hashing", 0, "hash % N", "shardRouter"],
    ["consistent-hashing", 1, "Hash ring", "ring"],
    // The writer endpoint is one before it learns to fail over, too.
    ["failover", 0, "Writer endpoint", "writer"],
    ["failover", 1, "Writer endpoint", "writer"],
    // The fixed leader the others forward to, and the copies forwarding to it.
    ["leader-election", 0, "Copy B", "leaderDb"],
    ["leader-election", 0, "Copy A", "follower"],
    ["leader-election", 1, "Copy B", "member"],
    ["consistency-vs-availability", 0, "EU database", "follower"],
    ["cdn", 0, "Origin (US)", "origin"],
    ["nearest-region-and-failover", 0, "EU region", "regionServer"],
    ["hedged-requests", 0, "Shard 1", "shardServer"],
    ["canary-rollouts", 1, "Canary", "canaryServer"],
    ["outbox", 1, "Broker", "broker"],
    ["backpressure", 0, "Producer", "sender"],
    ["acknowledgements", 0, "Sender", "sender"],
    ["acknowledgements", 0, "Receiver", "receiver"],
    ["dns", 0, "Root", "dnsServer"],
    ["dns", 0, "Resolver", "resolver"],
    ["dead-letter-queues", 1, "Dead letters", "dlq"],
    ["message-queues", 1, "Email queue", "queue"],
    ["message-queues", 1, "Worker 1", "worker"],
    ["partitioned-logs", 2, "Partition 1", "partition"],
    ["rate-limiting", 1, "Scraper bot", "bot"],
    ["caching", 0, "Users", "users"],
    ["caching", 1, "Cache", "cache"],
  ];
  for (const [slug, fig, label, want] of cases) assert.equal(at(slug, fig, label).key, want, `${slug} ${fig} ${label}`);
});

test("stories' stations fit too: the web being crawled, a booking matcher, a waiting room", () => {
  const find = (slug: string, label: string) => {
    for (const spec of specsOf(slug)) {
      const n = spec.nodes.find((x) => x.label === label);
      if (n) return conceptKey(n, spec);
    }
    assert.fail(`${slug} never shows ${label}`);
  };
  assert.equal(find("web-crawler", "The web"), "web");
  assert.equal(find("web-crawler", "Frontier"), "frontier");
  assert.equal(find("ride-matching", "East"), "booking");
  assert.equal(find("flash-sale", "Waiting room"), "waitingRoom");
  assert.equal(find("capstone", "Primary DB"), "primary");
  assert.equal(find("video-premiere", "Asia edge"), "edge");
});

test("a card's Here line is the station's own build line, or its group's whole", () => {
  const c1 = lessonOf("caching")!;
  const fix = c1.figures[1].build(defaultsOf(c1.figures[1]));
  const db = fix.nodes.find((n) => n.id === "db")!;
  // The fix step doesn't introduce the database again: its line from the problem still describes it.
  assert.equal(hereOf(db, c1.figures, 1), "About 36 a second (4 workers, 110 ms).");
  // A knob that changes the station leaves no line: the line's numbers would be wrong.
  const smaller = c1.figures[1].build({ ...defaultsOf(c1.figures[1]), size: 3 });
  assert.equal(hereOf(smaller.nodes.find((n) => n.id === "cache")!, c1.figures, 1), null);
  assert.equal(hereOf(fix.nodes.find((n) => n.id === "cache")!, c1.figures, 1), "Keeps the last 15 answers it fetched.");

  const f3 = lessonOf("load-balancing")!;
  const eu = f3.figures[0].build(defaultsOf(f3.figures[0])).nodes.find((n) => n.id === "eu")!;
  assert.equal(hereOf(eu, f3.figures, 0), "Three regions: 30, 8 and 4 requests a second.");

  const a3 = lessonOf("retries-and-backoff")!;
  const u = a3.figures[0].build(defaultsOf(a3.figures[0])).nodes.find((n) => n.id === "u")!;
  assert.equal(hereOf(u, a3.figures, 0), "22 a second; give up after 500 ms. Then retry at once, up to 3 times.");
});

test("every station's card reads well at every step: Here, Now and Read it, with no gaps in the words", () => {
  const bad = /undefined|NaN|null|\[\[|\{/;
  for (const l of ALL_LESSONS) {
    l.figures.forEach((f, i) => {
      const spec = f.build(defaultsOf(f));
      const sim = new Sim(spec);
      sim.step(Math.max(1500, spec.warmMs ?? 0));
      for (const e of spec.script?.events ?? []) if (e.armed && !e.ends) sim.fire(e.label);
      sim.step(600);
      const lbs = sim.list.filter((x) => x.spec.health || x.spec.rollback);
      for (const n of spec.nodes) {
        const rt = sim.nodes.get(n.id)!;
        const here = hereOf(n, l.figures, i) ?? setupOf(n);
        const now = nowOf(sim, rt, describe(sim, rt, lbs));
        const read = readOf(rt, conceptKey(n, spec));
        for (const [row, text] of [["here", here], ["now", now], ["read", read]])
          assert.ok(!bad.test(text), `${l.code} step ${i + 1} ${n.label} ${row}: “${text}”`);
        assert.ok(read.length > 20, `${l.code} ${n.label} says how to read it`);
        assert.ok(here || n.kind === "client", `${l.code} step ${i + 1} ${n.label} says what it does here`);
        assert.equal(conceptOf(n, spec), CONCEPTS[conceptKey(n, spec)]);
      }
    });
  }
});

test("a page is sent the lessons its cards point to, never itself", () => {
  for (const e of COURSE) {
    const links = partLessons(e.slug);
    assert.ok(!(e.slug in links), `${e.code} links to itself`);
    for (const [slug, l] of Object.entries(links)) assert.deepEqual(l, { code: getLesson(slug)!.code, title: getLesson(slug)!.title });
  }
  assert.ok("caching" in partLessons("cache-stampede"), "C4's cache points at C1");
});
