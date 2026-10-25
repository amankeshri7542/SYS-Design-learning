import assert from "node:assert/strict";
import { test } from "node:test";
import { Sim } from "../src/lib/sim/engine";
import { accounted, arrivalTrace, leakedHolds } from "../src/lib/sim/invariants";
import { compile, type Compiled } from "../src/lib/system/compile";
import { KINDS, validate, type PartKind, type SystemDoc } from "../src/lib/system/doc";
import { TEMPLATES } from "../src/lib/system/templates";

// My System: a doc someone describes becomes a scene the engine runs. Every template compiles cleanly, runs with every
// request accounted for, and compiles the same way twice; a broken doc says what is wrong in plain words.

const ok = (doc: SystemDoc): Compiled => {
  const c = compile(doc);
  assert.ok(c.spec, `${doc.name}: ${c.issues.map((i) => i.text).join("; ")}`);
  return c as Compiled;
};

test("every template validates with no errors and compiles to a scene", () => {
  for (const t of TEMPLATES) {
    assert.deepEqual(validate(t.doc).filter((i) => i.level === "error"), [], t.id);
    const c = ok(t.doc);
    assert.ok(c.spec.nodes.length >= 2 && c.spec.nodes.length <= 16, `${t.id}: ${c.spec.nodes.length} stations`);
    for (const n of c.spec.nodes) {
      assert.ok(n.at[0] >= 0 && n.at[0] <= 100 && n.at[1] >= 0 && n.at[1] <= 100, `${t.id} ${n.id} is on the stage`);
      assert.ok(c.partOf.has(n.id), `${t.id} ${n.id} belongs to a part`);
    }
  }
});

test("every template runs with each request answered or on its way, and nothing leaks a hold", () => {
  for (const t of TEMPLATES) {
    const { spec } = ok(t.doc);
    const sim = new Sim({ ...spec, windowMs: 1e9 });
    sim.step(5000);
    const a = accounted(sim);
    assert.equal(a.sent, a.done + a.live, `${t.id}: ${JSON.stringify(a)}`);
    assert.deepEqual(leakedHolds(sim), [], t.id);
    assert.ok(a.done > 20, `${t.id} answered some requests`);
  }
});

test("a template at its defaults works: under its targets", () => {
  for (const t of TEMPLATES) {
    const { spec } = ok(t.doc);
    const sim = new Sim(spec);
    sim.step(6000);
    const failed = sim.done.filter((d) => d.result === "error").length / Math.max(1, sim.done.length);
    assert.ok(failed <= t.doc.targets.failed + 0.02, `${t.id}: ${(failed * 100).toFixed(1)}% failed`);
  }
});

test("the same doc compiles to the same scene, and two designs with the same users see the same traffic", () => {
  const web = TEMPLATES.find((t) => t.id === "web-app")!.doc;
  const a = ok(web).spec;
  const b = ok(structuredClone(web)).spec;
  assert.deepEqual(arrivalTrace(a, 3000), arrivalTrace(b, 3000));
  // Take the cache away: different stations, the same arrivals.
  const noCache: SystemDoc = { ...web, parts: web.parts.filter((p) => p.id !== "cache").map((p) => (p.id === "app" ? { ...p, to: ["db"] } : p)) };
  assert.deepEqual(arrivalTrace(ok(noCache).spec, 3000), arrivalTrace(a, 3000));
});

test("copies past four are one station with all their workers", () => {
  const doc: SystemDoc = {
    v: 1,
    name: "Big",
    targets: { p95Ms: 400, failed: 0.01 },
    parts: [
      { id: "users", kind: "users", name: "Users", to: ["api"] },
      { id: "api", kind: "service", name: "API", count: 12, set: { workers: 4 } },
    ],
  };
  const c = ok(doc);
  const api = c.spec.nodes.filter((n) => c.partOf.get(n.id) === "api");
  assert.equal(api.length, 1);
  assert.equal(api[0].slots, 48);
  assert.equal(api[0].label, "API ×12");
  assert.ok(c.notes.some((n) => n.includes("48 workers")));
});

test("a database's copies take reads, its writer takes writes, and writes go through a cache that forgets its copy", () => {
  const replicas = ok(TEMPLATES.find((t) => t.id === "replicas")!.doc);
  const app = replicas.spec.nodes.find((n) => n.id === "app-1")!;
  assert.deepEqual(app.calls?.read, [["db-copy-1", "db-copy-2"]]);
  assert.deepEqual(app.calls?.write, ["db-writer"]);
  const web = ok(TEMPLATES.find((t) => t.id === "web-app")!.doc);
  const server = web.spec.nodes.find((n) => n.id === "app-1")!;
  assert.deepEqual(server.calls, { read: ["cache"], write: ["cache"] });
  assert.equal(web.spec.nodes.find((n) => n.id === "cache")!.invalidate, true);
});

test("a broken doc says what is wrong, in words someone new can act on", () => {
  const base = TEMPLATES.find((t) => t.id === "blank")!.doc;
  const texts = (doc: SystemDoc) => validate(doc).map((i) => i.text);
  assert.match(texts({ ...base, parts: [] }).join(" "), /Add a part/);
  assert.match(texts({ ...base, parts: [{ id: "s", kind: "service", name: "Service" }] }).join(" "), /Nothing sends requests yet/);
  assert.match(texts({ ...base, parts: [base.parts[0], { id: "service", kind: "service", name: "Service", to: ["users"] }] }).join(" "), /can't send to a users/);
  const loop: SystemDoc = {
    ...base,
    parts: [
      { id: "users", kind: "users", name: "Users", to: ["a"] },
      { id: "a", kind: "service", name: "A", to: ["b"] },
      { id: "b", kind: "service", name: "B", to: ["a"] },
    ],
  };
  assert.match(texts(loop).join(" "), /loop/);
  assert.match(texts({ ...base, parts: [...base.parts, { id: "cache", kind: "cache", name: "Cache" }] }).join(" "), /nowhere to fetch/);
  assert.equal(compile(loop).spec, null);
});

test("a doc from a link or a file is made safe: unknown kinds dropped, numbers brought into range", async () => {
  const { normalize } = await import("../src/lib/system/doc");
  assert.equal(normalize("nope"), null);
  assert.equal(normalize({ v: 2, parts: [] }), null);
  const d = normalize({
    v: 1,
    name: "x".repeat(200),
    parts: [
      { id: "users", kind: "users", name: "Users", to: ["svc"], set: { rate: 99999, writes: -3, shape: "weird", nope: 1 } },
      { id: "svc", kind: "service", name: "Svc", count: 1e9, set: { workers: "eight", ms: NaN } },
      { id: "evil", kind: "<script>", name: "x" },
    ],
    targets: { p95Ms: -5, failed: 7 },
  })!;
  assert.equal(d.name.length, 60);
  assert.equal(d.parts.length, 2);
  assert.deepEqual(d.parts[0].set, { rate: 400, writes: 0 });
  assert.equal(d.parts[1].count, 64);
  assert.ok(!("set" in d.parts[1]));
  assert.deepEqual(d.targets, { p95Ms: 50, failed: 0.5 });
});

test("a shared link carries the whole system, and reopens it exactly", async () => {
  const { decodeDoc, encodeDoc } = await import("../src/lib/system/share");
  for (const t of TEMPLATES) {
    const text = await encodeDoc(t.doc);
    assert.match(text, /^1\.[A-Za-z0-9_-]+$/, "deflated, in characters a URL fragment keeps");
    assert.deepEqual(await decodeDoc(text), JSON.parse(JSON.stringify(t.doc)));
  }
  assert.equal(await decodeDoc("1.not-really"), null);
  assert.equal(await decodeDoc("garbage"), null);
});

test("what breaks if a part dies: measured, ranked worst first, the same every time, and the fixes work", async () => {
  const { blastRadius } = await import("../src/lib/system/blast");
  const blank = TEMPLATES.find((t) => t.id === "blank")!.doc;
  const one = blastRadius(blank)!;
  assert.equal(one.parts[0].verdict, "spof");
  assert.equal(one.parts[0].failed, 1);
  assert.ok(one.parts[0].fixed, "a lone service can get a second copy");
  const after = blastRadius(one.parts[0].fixed!)!;
  assert.equal(after.parts[0].verdict, "fine", "with two copies, losing one is barely noticed");
  // Failover: losing the main copy of a database with a copy that takes over is barely noticed.
  const replicas = blastRadius(TEMPLATES.find((t) => t.id === "replicas")!.doc)!;
  assert.equal(replicas.parts.find((b) => b.part === "db")!.verdict, "fine");
  // Jobs wait in their queue while a worker's provider is down; the person who sent them doesn't notice.
  const jobs = blastRadius(TEMPLATES.find((t) => t.id === "jobs")!.doc)!;
  const email = jobs.parts.find((b) => b.part === "email")!;
  assert.equal(email.verdict, "fine");
  assert.ok(email.piled > 5);
  // Deterministic: the same report twice.
  const web = TEMPLATES.find((t) => t.id === "web-app")!.doc;
  assert.deepEqual(blastRadius(web), blastRadius(web));
  const order = blastRadius(web)!.parts.map((b) => b.verdict);
  assert.deepEqual(order, [...order].sort((a, b) => ["spof", "hurts", "slower", "fine"].indexOf(a) - ["spof", "hurts", "slower", "fine"].indexOf(b)));
});

test("the tour points at every part it names, in the order a request meets them", async () => {
  const { explainBeats } = await import("../src/lib/system/explain");
  for (const t of TEMPLATES) {
    const c = ok(t.doc);
    const beats = explainBeats(t.doc, c);
    assert.ok(beats.length >= 2 && beats.length <= 9, t.id);
    for (const b of beats) {
      for (const id of b.focus?.nodes ?? []) assert.ok(c.spec.nodes.some((n) => n.id === id), `${t.id}: ${b.id} points at ${id}`);
      assert.ok(!/undefined|NaN/.test(b.text), `${t.id}: “${b.text}”`);
    }
  }
  const web = TEMPLATES.find((t) => t.id === "web-app")!;
  assert.deepEqual(
    explainBeats(web.doc, ok(web.doc)).map((b) => b.id),
    ["part-users", "part-lb", "part-app", "part-cache", "part-db", "try"],
  );
});

test("adding any part to any template puts it where it usually goes, and the system still compiles and runs", async () => {
  const { addPart, canAdd, removePart, flowOrder } = await import("../src/lib/system/edit");
  const { KINDS } = await import("../src/lib/system/doc");
  for (const t of TEMPLATES) {
    for (const kind of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
      if (!canAdd(t.doc, kind)) continue;
      const { doc, id } = addPart(t.doc, kind);
      assert.ok(doc.parts.some((p) => p.id === id), `${t.id} + ${kind}`);
      const errors = validate(doc).filter((i) => i.level === "error");
      assert.deepEqual(errors, [], `${t.id} + ${kind}: ${errors.map((e) => e.text).join("; ")}`);
      const sim = new Sim(ok(doc).spec);
      sim.step(1500);
      // And taking it away again leaves a working system.
      assert.deepEqual(validate(removePart(doc, id)).filter((i) => i.level === "error"), [], `${t.id} + ${kind} − ${kind}`);
    }
    assert.equal(flowOrder(t.doc).length, t.doc.parts.length);
  }
  // A cache goes in front of the database: the app asks the cache, and the cache the database.
  const web = TEMPLATES.find((t) => t.id === "blank")!.doc;
  const withDb = addPart(web, "database").doc;
  const withCache = addPart(withDb, "cache");
  const svc = withCache.doc.parts.find((p) => p.id === "service")!;
  assert.deepEqual(svc.to, [withCache.id]);
  assert.deepEqual(withCache.doc.parts.find((p) => p.id === withCache.id)!.to, ["database"]);
});

test("removing a part sends its callers on to what it called", async () => {
  const { removePart } = await import("../src/lib/system/edit");
  const web = TEMPLATES.find((t) => t.id === "web-app")!.doc;
  const noLb = removePart(web, "lb");
  assert.deepEqual(noLb.parts.find((p) => p.id === "users")!.to, ["app"]);
  const noCache = removePart(web, "cache");
  assert.deepEqual(noCache.parts.find((p) => p.id === "app")!.to, ["db"]);
  assert.deepEqual(validate(noCache).filter((i) => i.level === "error"), []);
});

test("changing what a part is keeps only the arrows the new kind can send and take", async () => {
  const { updatePart } = await import("../src/lib/system/edit");
  for (const t of TEMPLATES)
    for (const p of t.doc.parts)
      for (const kind of Object.keys(KINDS) as PartKind[]) {
        const next = updatePart(t.doc, p.id, { kind });
        const bad = validate(next).filter((i) => /can't send|copies must/.test(i.text));
        assert.deepEqual(bad, [], `${t.id}: ${p.id} → ${kind}`);
        assert.equal(next.parts.find((q) => q.id === p.id)!.kind, kind);
      }
  // A service turned into a worker keeps its calls (users, who can't send to a worker, lose theirs).
  const jobs = TEMPLATES.find((t) => t.id === "jobs")!.doc;
  const api = jobs.parts.find((p) => p.id === "api")!;
  assert.deepEqual(updatePart(jobs, "api", { kind: "worker" }).parts.find((p) => p.id === "api")!.to, api.to);
});
