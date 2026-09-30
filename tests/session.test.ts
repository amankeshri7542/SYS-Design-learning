import assert from "node:assert/strict";
import test from "node:test";
import { experimentQuery, makeConfig } from "../src/lib/engine/model";
import {
  SESSION_KEY,
  defaultDraft,
  emptySession,
  parseSession,
  readSession,
  restoreSessionRoute,
  saveSession,
  sessionQuery,
  validateDraft,
  visitSession,
} from "../src/lib/session";

test("lesson drafts preserve independent controls, replay and pinned baseline across navigation and refresh", () => {
  let session = emptySession();
  const config = makeConfig("cache-aside");
  config.seed = 87;
  config.values.capacity = 5;
  config.faults = [
    { at: 3, active: true },
    { at: 9, active: false },
  ];
  const draft = {
    ...defaultDraft(config),
    cursor: 17,
    speed: 4,
    mode: "experiment" as const,
    aws: true,
    comparison: true,
    baselineA: makeConfig("cache-aside"),
    prediction: 1,
    checked: true,
    controlsOpen: true,
    predictionSkipped: true,
  };
  session.drafts["cache-aside"] = draft;
  const lessonUrl = sessionQuery(session);
  session = visitSession(session, "library");
  session.query = "queue";
  session.filter = "messaging";
  const libraryUrl = sessionQuery(session);
  session = visitSession(session, "lesson", "queues");
  session.drafts.queues.cursor = 4;
  session = restoreSessionRoute(session, libraryUrl);
  assert.equal(session.page, "library");
  assert.equal(session.query, "queue");
  session = restoreSessionRoute(session, lessonUrl);
  assert.deepEqual(session.drafts["cache-aside"], draft);
  assert.equal(session.drafts.queues.cursor, 4);
  const stored = new Map<string, string>();
  saveSession(
    {
      setItem: (key, value) => {
        stored.set(key, value);
      },
    },
    session,
  );
  assert.deepEqual(
    readSession({ getItem: (key) => stored.get(key) ?? null }),
    session,
  );
});

test("shared and legacy URLs import fresh experiments without deleting other lesson drafts", () => {
  const session = emptySession();
  session.drafts["cache-aside"].cursor = 21;
  const shared = makeConfig("queues");
  shared.seed = 123;
  const imported = restoreSessionRoute(session, experimentQuery(shared));
  assert.equal(imported.page, "lesson");
  assert.equal(imported.lesson, "queues");
  assert.deepEqual(imported.drafts.queues.config, shared);
  assert.equal(imported.drafts.queues.cursor, 0);
  assert.equal(imported.drafts["cache-aside"].cursor, 21);
  imported.drafts.queues.cursor = 8;
  assert.equal(
    restoreSessionRoute(imported, sessionQuery(imported)).drafts.queues.cursor,
    8,
  );
  assert.equal(
    restoreSessionRoute(imported, experimentQuery(shared)).drafts.queues.cursor,
    0,
  );
  assert.equal(restoreSessionRoute(imported, "?concept=ttl").lesson, "ttl");
});

test("navigation and persistence retain config identity so playback does not recompute runs", () => {
  const session = emptySession();
  const config = session.drafts[session.lesson].config;
  const next = visitSession(visitSession(session, "library"), "lesson");
  assert.equal(next.drafts[next.lesson].config, config);
  const stepped = {
    ...next,
    drafts: {
      ...next.drafts,
      [next.lesson]: { ...next.drafts[next.lesson], cursor: 7 },
    },
  };
  saveSession({ setItem() {} }, stepped);
  assert.equal(stepped.drafts[next.lesson].config, config);
  assert.equal(session.drafts[session.lesson].cursor, 0);
});

test("draft validation rejects invalid state and baseline lesson mismatches", () => {
  const draft = defaultDraft();
  for (const invalid of [
    { ...draft, cursor: -1 },
    { ...draft, cursor: 0.5 },
    { ...draft, speed: 0 },
    { ...draft, mode: "broken" },
    { ...draft, prediction: 100 },
    { ...draft, baselineA: makeConfig("queues") },
    { ...draft, aws: "yes" },
  ])
    assert.throws(() => validateDraft(invalid));
  const validated = validateDraft(draft);
  validated.config.values.capacity = 1;
  assert.notEqual(
    draft.config.values.capacity,
    1,
    "validation detaches stored snapshots from mutable input",
  );
  assert.throws(() =>
    parseSession({ ...emptySession(), drafts: { queues: draft } }),
  );
});

test("malformed, unknown-version and unavailable storage never gets overwritten while reading", () => {
  for (const raw of [
    "{bad",
    JSON.stringify({ version: 9 }),
    JSON.stringify({ ...emptySession(), page: "bogus" }),
  ]) {
    let writes = 0;
    const storage = {
      getItem: () => raw,
      setItem: () => {
        writes++;
      },
    };
    assert.throws(() => readSession(storage));
    assert.equal(writes, 0);
  }
  assert.throws(
    () =>
      readSession({
        getItem() {
          throw new Error("Storage disabled");
        },
      }),
    /Storage disabled/,
  );
  assert.throws(
    () =>
      saveSession(
        {
          setItem() {
            throw new Error("Quota exceeded");
          },
        },
        emptySession(),
      ),
    /Quota exceeded/,
  );
  assert.throws(() =>
    restoreSessionRoute(emptySession(), "?lesson=not-a-lesson"),
  );
  assert.throws(() => restoreSessionRoute(emptySession(), "?page=not-a-page"));
  assert.throws(
    () => restoreSessionRoute(emptySession(), "?experiment=%7Bbad"),
    /invalid JSON/,
  );
  assert.equal(SESSION_KEY, "system-lab-session-v1");
});
