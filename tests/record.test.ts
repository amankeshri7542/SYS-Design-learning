import assert from "node:assert/strict";
import { test } from "node:test";
import { EVENTS, MAX_EVENTS, TALLIES, clearRecord, readEvents, readTallies, record, recordingFor } from "../src/lib/record";

// The learning record keeps only this browser's storage: a stand-in for it here.
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

test("the record keeps events and a tally per lesson, to the second", () => {
  store.clear();
  record("open");
  assert.equal(readEvents().length, 0, "nothing is recorded before a page names its lesson");
  recordingFor("caching");
  record("open");
  record("beat", { at: "0:hit" });
  record("beat", { at: "0:hit" });
  record("predict", { chosen: 1, correct: true });
  record("check", { n: 1, chosen: 0, correct: false });
  record("recap", { s: 40 });
  const events = readEvents();
  assert.equal(events.length, 6);
  assert.ok(events.every((e) => Number.isInteger(e.t) && e.lesson === "caching"), "whole seconds, and the lesson");
  const t = readTallies().caching;
  assert.deepEqual({ ...t }, { opened: 1, beats: ["0:hit"], predicted: 1, predictedRight: 1, checks: 1, checksRight: 0, recap: true, stages: [] });
});

test("the ring keeps the latest events only, while the tallies keep counting", () => {
  store.clear();
  recordingFor("cdn");
  for (let i = 0; i < MAX_EVENTS + 50; i++) record("beat", { at: `0:b${i}` });
  const events = readEvents();
  assert.equal(events.length, MAX_EVENTS);
  assert.equal(events[0].data?.at, "0:b50", "the oldest went first");
  assert.equal(readTallies().cdn.beats.length, MAX_EVENTS + 50);
});

test("clearing forgets the events and the tallies; broken storage records nothing and throws nothing", () => {
  recordingFor("dns");
  record("open");
  clearRecord();
  assert.equal(store.has(EVENTS) || store.has(TALLIES), false);
  store.set(EVENTS, "not json");
  assert.deepEqual(readEvents(), []);
  assert.doesNotThrow(() => record("open"));
});
