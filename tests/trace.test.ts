import assert from "node:assert/strict";
import { test } from "node:test";
import { Sim } from "../src/lib/sim/engine";
import { accounted, leakedHolds } from "../src/lib/sim/invariants";
import { compile, type Compiled } from "../src/lib/system/compile";
import type { SystemDoc } from "../src/lib/system/doc";
import { detect } from "../src/lib/system/import/detect";
import { decodeDoc, encodeDoc } from "../src/lib/system/share";
import { openTrace, readSession, readSpans, readTrace, type TraceView } from "../src/lib/system/trace/open";
import { cleanName, serviceName } from "../src/lib/system/trace/scrub";
import { SECRETS, big, jaeger, otlp, scattered, shop, zipkin } from "./traces";

// Traces: a Jaeger, Zipkin or OpenTelemetry file becomes the system its requests ran through, read in the browser with
// personal data taken out first, and replays on it: sample requests span by span, and the second as the trace ran it.
// The fixtures (`traces.ts`) are synthetic: one shop's requests, in each format, and platforms of 200 and 300 services.

const part = (doc: SystemDoc | null, name: string) => doc!.parts.find((p) => p.name === name)!;
const named = (doc: SystemDoc | null, id: string) => doc!.parts.find((p) => p.id === id)?.name;
const sendsTo = (doc: SystemDoc | null, name: string) => (part(doc, name).to ?? []).map((id) => named(doc, id));
const runs = (doc: SystemDoc | null) => {
  assert.ok(doc, "it read");
  const c = compile(doc);
  assert.ok(c.spec, c.issues.map((i) => i.text).join("; "));
  const sim = new Sim((c as Compiled).spec);
  sim.step(2000);
  assert.ok(sim.done.length > 5, "it answers requests");
  return c as Compiled;
};

const SHOP = shop();

test("each format is recognised as a trace, and System Lab files and calls still read as before", () => {
  assert.equal(detect(jaeger(SHOP)), "trace");
  assert.equal(detect(zipkin(SHOP)), "trace");
  assert.equal(detect(otlp(SHOP)), "trace");
  assert.equal(detect(otlp(SHOP, true)), "trace");
  assert.equal(detect('{"v":1,"name":"x","parts":[]}'), "json");
  assert.equal(detect('[{"from":"Users","to":"API"}]'), "json");
});

test("a Jaeger trace becomes the system its requests ran through, with what it measured", () => {
  const r = readTrace(jaeger(SHOP), "shop");
  assert.deepEqual(r.errors, []);
  assert.equal(r.format, "Jaeger");
  const d = r.doc!;
  // Services are parts; what they called and nobody traced is named from the spans' attributes.
  assert.deepEqual(d.parts.map((p) => `${p.name}:${p.kind}`).sort(), ["Postgres:database", "Redis:cache", "Users:users", "ads:service", "catalog:service", "checkout:service", "email:worker", "frontend:service", "orders topic:topic", "payments:service"]);
  assert.deepEqual(sendsTo(d, "Users"), ["frontend"]);
  assert.deepEqual(sendsTo(d, "frontend").sort(), ["ads", "catalog", "checkout"]);
  // The cache stands in front of the database; the email service takes from the topic.
  assert.deepEqual(sendsTo(d, "catalog"), ["Redis"]);
  assert.deepEqual(sendsTo(d, "Redis"), ["Postgres"]);
  assert.deepEqual(sendsTo(d, "checkout").sort(), ["Postgres", "orders topic", "payments"]);
  assert.deepEqual(sendsTo(d, "orders topic"), ["email"]);
  // Ten requests a second at the way in; each part's own work is the middle of what the trace measured.
  assert.equal(part(d, "Users").set?.rate, 10);
  // Payments works about 120 ms on the fifth of requests that reach it: the model sends every request, for 24 ms each.
  assert.ok(Math.abs(part(d, "payments").set!.ms! - 24) <= 4, `payments ${part(d, "payments").set?.ms}`);
  // The catalog is reached by four requests in five; the model sends every request there, so it does 4/5 of its work.
  assert.ok(Math.abs(part(d, "catalog").set!.ms! - 16) <= 3, `catalog ${part(d, "catalog").set?.ms}`);
  // The notes say what was read, the repeated calls, the calls made together, the slowest and the failed request.
  const notes = r.notes.join("\n");
  assert.match(notes, /^Read 200 requests \(\d+ spans\) from a Jaeger file, over 19\.9 s\. Only the names of services and operations were kept/);
  assert.match(notes, /checkout calls Postgres about 3 times for each request it gets/);
  const ways = notes.match(/Requests through frontend go different ways \((.*)\); in the model each takes every arrow, doing that share of the work/);
  assert.ok(ways && ways[1].includes("80% to catalog") && ways[1].includes("20% to checkout"), notes);
  assert.match(notes, /frontend calls (ads and catalog|catalog and ads) at the same time/);
  assert.match(notes, /Users send 10 requests a second, as in the trace\./);
  assert.match(notes, /The slowest request \(POST \/users\/\{id\}\/checkout\) took \d+ ms, \d+ ms of it in payments\./);
  assert.match(notes, /\d+% of requests failed\. One \(POST \/users\/\{id\}\/checkout\) broke in payments, \d+ ms in: frontend → checkout → payments\./);
  assert.match(notes, /email is drawn as a worker: it takes its work from orders topic\./);
  runs(d);
});

test("Zipkin and OpenTelemetry files of the same requests make the same system", () => {
  const j = readTrace(jaeger(SHOP), "shop");
  for (const [format, text] of [
    ["Zipkin", zipkin(SHOP)],
    ["OpenTelemetry", otlp(SHOP)],
    ["OpenTelemetry", otlp(SHOP, true)],
  ]) {
    const r = readTrace(text, "shop");
    assert.deepEqual(r.errors, [], format);
    assert.equal(r.format, format);
    assert.deepEqual(r.doc, j.doc, format);
    assert.deepEqual(r.notes.slice(1), j.notes.slice(1), format);
  }
});

test("personal data never survives: no attribute value, ID, email or address reaches the spans, the system or the notes", async () => {
  for (const text of [jaeger(SHOP), zipkin(SHOP), otlp(SHOP)]) {
    const spans = JSON.stringify(readSpans(text).spans);
    const opened = await openTrace(text, "shop trace jane.doe@example.com 829341");
    const kept = JSON.stringify(opened);
    for (const s of SECRETS) {
      assert.ok(!spans.includes(s), `spans keep “${s}”`);
      assert.ok(!kept.includes(s), `the system or its notes keep “${s}”`);
    }
    // IDs are numbers given in reading order; the file's own are gone (a run of hex with a letter in it; a long run of
    // digits is a time).
    const hexId = /(?=[0-9a-f]*[a-f])[0-9a-f]{16,}/;
    assert.ok(!hexId.test(spans) && !hexId.test(kept));
    for (const id of new Set(SHOP.flatMap((s) => [s.trace, s.id]))) assert.ok(!spans.includes(id) && !kept.includes(id), `the file's ID ${id} is kept`);
    assert.equal(opened.doc!.name, "shop trace");
  }
  // Names keep their shape, without what identifies anyone.
  assert.equal(cleanName("GET /users/12345/orders/67?token=abc"), "GET /users/{id}/orders/{id}");
  assert.equal(cleanName("POST https://10.0.0.4:8080/login"), "POST /login");
  assert.equal(cleanName("SELECT * FROM users WHERE email = 'jane@x.com'"), "SELECT * FROM users WHERE email = {text}");
  assert.equal(cleanName("lookup jane%40example.com"), "lookup {email}");
  assert.equal(cleanName("/files/9f8e7d6c-1234-5678-9abc-def012345678"), "/files/{id}");
  assert.equal(cleanName("fe80::1ff:fe23:4567:890a"), "");
  assert.equal(cleanName("hyper::client::conn S3.PutObject oauth2/token v2"), "hyper::client::conn S3.PutObject oauth2/token v2");
  assert.equal(serviceName("orders-7d9f8b6c4-x2k9p"), "orders");
  assert.equal(serviceName("10.0.3.12"), "");
  // A service named only by an address is lettered, so two stay apart without either address.
  const bare = readTrace(
    JSON.stringify([
      { traceId: "a1", id: "b1", name: "GET /", kind: "SERVER", timestamp: 1e6, duration: 50e3, localEndpoint: { serviceName: "10.0.0.1" } },
      { traceId: "a1", id: "b2", parentId: "b1", name: "GET /x", kind: "SERVER", timestamp: 1.01e6, duration: 20e3, localEndpoint: { serviceName: "10.0.0.2" } },
    ]),
  );
  assert.deepEqual(bare.doc!.parts.map((p) => p.name), ["Users", "Service A", "Service B"]);
});

test("files that aren't traces, or are broken, say what was wrong and open nothing", () => {
  const err = (text: string) => {
    const r = readTrace(text);
    assert.equal(r.doc, null);
    return r.errors.map((e) => e.text);
  };
  assert.match(err('{ "data": [')[0], /^Line 1: this isn't valid JSON/);
  assert.match(err('{"hello": 1}')[0], /^This JSON isn't a trace\. System Lab reads Jaeger .* Zipkin .* and OpenTelemetry/);
  assert.match(err('{"resourceSpans": [{"scopeSpans": []}]}\n{"resourceSpans": oops}')[0], /^Line 2: this isn't valid JSON\. A file of spans is one JSON object, or one a line\./);
  const lost = JSON.parse(jaeger(SHOP.slice(0, 6)));
  lost.data[0].spans[1].processID = "p9";
  assert.deepEqual(err(JSON.stringify(lost)), ["Jaeger trace 1, span 2: its process isn't listed under “processes”, so its service is unknown."]);
  assert.deepEqual(err(JSON.stringify([{ traceId: "a", id: "b", name: "x" }, { traceId: "a", id: "c", name: "y", timestamp: 5 }])), ["This Zipkin file has no spans with times: 2 had no usable start or length."]);
  assert.deepEqual(err('{"resourceSpans": []}'), ["This OpenTelemetry file has no spans with times in it."]);
});

test("Zipkin's shared spans, missing parents and a single request still read", () => {
  // The server half of a call shares its client's ID; the client's time outside the server is the network's.
  const shared = [
    { traceId: "t", id: "a", name: "GET /", kind: "SERVER", timestamp: 0, duration: 100e3, localEndpoint: { serviceName: "web" } },
    { traceId: "t", id: "b", parentId: "a", name: "get", kind: "CLIENT", timestamp: 10e3, duration: 80e3, localEndpoint: { serviceName: "web" } },
    { traceId: "t", id: "b", parentId: "a", name: "get", kind: "SERVER", shared: true, timestamp: 12e3, duration: 76e3, localEndpoint: { serviceName: "api" } },
    { traceId: "t", id: "c", parentId: "b", name: "query", kind: "CLIENT", timestamp: 20e3, duration: 50e3, localEndpoint: { serviceName: "api" }, remoteEndpoint: { serviceName: "mysql" } },
    { traceId: "t", id: "d", parentId: "zz", name: "orphan", kind: "SERVER", timestamp: 0, duration: 5e3, localEndpoint: { serviceName: "audit" } },
  ];
  const r = readTrace(JSON.stringify(shared));
  assert.deepEqual(r.errors, []);
  const d = r.doc!;
  assert.deepEqual(sendsTo(d, "web users"), ["web"]);
  assert.deepEqual(sendsTo(d, "audit users"), ["audit"]);
  assert.deepEqual(sendsTo(d, "web"), ["api"]);
  assert.deepEqual(sendsTo(d, "api"), ["mysql"]);
  assert.equal(part(d, "mysql").kind, "database");
  assert.equal(part(d, "api").set?.ms, 26);
  assert.equal(part(d, "mysql").set?.ms, 50);
  assert.ok(r.notes.some((n) => n === "1 span's parent wasn't in the file; each is read as where a request starts."));
  assert.ok(r.notes.some((n) => n.startsWith("2 requests are too few to measure traffic, so Users send 40 a second.")));
  runs(d);
});

test("a 200-service trace is grouped to at most 12 parts and stations, and each grouping is a note", () => {
  const r = readTrace(big(), "platform");
  assert.deepEqual(r.errors, []);
  const d = r.doc!;
  assert.ok(d.parts.length <= 12, `${d.parts.length} parts`);
  const c = runs(d);
  assert.ok(c.spec.nodes.length <= 12, `${c.spec.nodes.length} stations`);
  const notes = r.notes.join("\n");
  assert.match(notes, /Services that share a name are drawn as one part each: accounts \(25\), catalog \(25\), orders \(25\), payments \(25\), pricing \(25\), reviews \(25\) and 2 more\./);
  assert.match(notes, /The \d+ least used parts are drawn as one, “Other services”, so the stage stays readable: accounts, accounts-db/);
  // The busiest stay themselves, with their own databases.
  assert.ok(d.parts.some((p) => p.name === "gateway"));
  assert.ok(d.parts.some((p) => p.kind === "database" && /-db$/.test(p.name)));
});

test("hundreds of unrelated services, each in few requests, keep the busiest as parts", () => {
  const r = readTrace(scattered(), "scattered");
  assert.deepEqual(r.errors, []);
  const d = r.doc!;
  // Every service is in under 2 in 100 requests: only as many go to "Other services" as the stage needs.
  assert.ok(d.parts.length >= 9 && d.parts.length <= 12, `${d.parts.length} parts`);
  assert.ok(d.parts.filter((p) => p.kind === "service" && p.name !== "Other services" && p.name !== "edge").length >= 3);
  assert.ok(runs(d).spec.nodes.length <= 12);
});

test("a trace opens healthy, and its times come close to the trace's", async () => {
  const opened = await openTrace(jaeger(SHOP), "shop");
  assert.deepEqual(opened.errors, []);
  const d = opened.doc!;
  // Calibrated on the work each request does, every part's together: within 15% of the trace's, and the note says so
  // (and that its requests take longer, and why).
  const close = opened.notes[1].match(/^How close it runs: each request does (\d+) ms of work across the parts, against (\d+) ms in the trace\. Its requests take longer \(half within \d+ ms, against \d+ ms\): each takes every arrow/);
  assert.ok(close, opened.notes[1]);
  const [, model, trace] = close.map(Number);
  assert.ok(Math.abs(model - trace) / trace <= 0.15, `model ${model} ms of work vs the trace's ${trace} ms`);
  // Run as the player runs it: people's answers meet the target, and nothing piles up.
  const c = compile(d) as Compiled;
  const sim = new Sim(c.spec);
  sim.step(6000);
  const lat = sim.done.filter((x) => x.t > 2000 && x.result === "ok" && x.tag === "users").map((x) => x.lat).sort((a, b) => a - b);
  assert.ok(lat[Math.floor(lat.length * 0.95)] <= d.targets.p95Ms);
  assert.ok(sim.list.filter((x) => x.spec.kind === "queue" || x.spec.kind === "topic").every((x) => x.queue.length < 20));
});

// ------------------------------------------------------------------------------------------------ replaying

/** A trace opened grouped one way, as the replay screen gets it. */
async function viewOf(text: string, by: "service" | "prefix" | "kind" = "service"): Promise<TraceView> {
  const { session, errors } = readSession(text, "shop");
  assert.deepEqual(errors, []);
  const v = await session!.view(by);
  assert.ok(!("errors" in v), JSON.stringify(v));
  return v as TraceView;
}

test("three requests replay as they ran: a typical one, the slowest and the failed one, every span to the millisecond", async () => {
  const v = await viewOf(jaeger(SHOP));
  const samples = v.replay.samples;
  assert.deepEqual(samples.map((s) => s.kind), ["typical", "slowest", "failed"]);
  const byTrace = new Map<string, typeof SHOP>();
  for (const s of SHOP) byTrace.set(s.trace, [...(byTrace.get(s.trace) ?? []), s]);
  const roots = SHOP.filter((s) => !s.parent);
  for (const sample of samples) {
    // The request the sample is: the one with its time (and, for the failed one, an error). Times on a file's clock are
    // about 1.8 × 10¹² ms, which a double holds to about a quarter of a microsecond: a microsecond is the tolerance.
    const US = 1e-3;
    const root = roots.find((r) => Math.abs(r.dur / 1000 - sample.ms) < US && !!r.error === sample.error);
    assert.ok(root, `${sample.kind} is one of the trace's requests`);
    // Its waterfall is its spans, from when it began, to the microsecond the file gave.
    const want = byTrace
      .get(root.trace)!
      .filter((s) => s.start <= root.start + root.dur)
      .map((s) => [(s.start - root.start) / 1000, (s.start + s.dur - root.start) / 1000, !!s.error])
      .sort((a, b) => (a[0] as number) - (b[0] as number) || (a[1] as number) - (b[1] as number));
    const got = sample.spans.map((s) => [s.t0, s.t1, s.error]).sort((a, b) => (a[0] as number) - (b[0] as number) || (a[1] as number) - (b[1] as number));
    assert.equal(got.length, want.length, sample.kind);
    got.forEach((g, i) => {
      assert.ok(Math.abs((g[0] as number) - (want[i][0] as number)) < US && Math.abs((g[1] as number) - (want[i][1] as number)) < US, `${sample.kind} span ${i}: ${g} against ${want[i]}`);
      assert.equal(g[2], want[i][2], `${sample.kind} span ${i} failed or not as the trace says`);
    });
    // The dot's way covers the request from its first moment to its last, without a gap, along drawn stations.
    const stations = new Set(compile(v.doc).spec!.nodes.map((n) => n.id));
    assert.equal(sample.hops[0].t0, 0);
    assert.ok(Math.abs(sample.hops[sample.hops.length - 1].t1 - sample.ms) < US);
    sample.hops.forEach((h, i) => {
      assert.ok(stations.has(h.node) && (!h.from || stations.has(h.from)), `${sample.kind} hop ${i} is on the stage`);
      if (i) assert.ok(Math.abs(h.t0 - sample.hops[i - 1].t1) < US, `${sample.kind} hop ${i} starts where the last ended`);
    });
    assert.ok(sample.path.includes("users") && sample.path.includes("frontend"));
  }
  // The slowest is the slowest; the failed one broke in payments, at the moment its span there began.
  assert.ok(Math.abs(samples[1].ms - Math.max(...roots.map((r) => r.dur / 1000))) < 1e-3);
  const failed = samples[2];
  assert.equal(failed.broke?.part, "payments");
  const pay = failed.spans.find((s) => s.part === "payments" && s.error)!;
  assert.equal(failed.broke!.at, pay.t0);
  assert.ok(failed.path.includes("payments") && !failed.path.includes("ads"));
  // Calls made at the same time are followed by the one waited for, the other named.
  assert.ok(samples[0].hops.some((h) => h.also?.length));
});

test("the same requests in each format replay the same", async () => {
  const j = await viewOf(jaeger(SHOP));
  for (const text of [zipkin(SHOP), otlp(SHOP), otlp(SHOP, true)]) {
    const o = await viewOf(text);
    assert.deepEqual(
      o.replay.samples.map((s) => [s.kind, s.name, s.spans.map((x) => [x.part, x.name, x.depth, x.error]), s.path, s.broke?.part]),
      j.replay.samples.map((s) => [s.kind, s.name, s.spans.map((x) => [x.part, x.name, x.depth, x.error]), s.path, s.broke?.part]),
    );
    assert.equal(o.replay.second.routes, j.replay.second.routes);
    assert.ok(Math.abs(o.replay.second.model!.p95 - j.replay.second.model!.p95) < 0.5);
  }
});

test("the second runs each request its own way: its p95 is within 15% of the trace's, in every format and grouping", async () => {
  const cases: [string, string, ("service" | "prefix" | "kind")[]][] = [
    ["Jaeger", jaeger(SHOP), ["service", "prefix", "kind"]],
    ["Zipkin", zipkin(SHOP), ["service"]],
    ["OpenTelemetry", otlp(SHOP), ["service"]],
    ["200 services", big(), ["service", "prefix", "kind"]],
    ["300 services", scattered(), ["service", "kind"]],
  ];
  for (const [name, text, groupings] of cases)
    for (const by of groupings) {
      const { trace, model, routes } = (await viewOf(text, by)).replay.second;
      assert.ok(model, `${name} by ${by} was checked`);
      const off = Math.abs(model.p95 - trace.p95) / trace.p95;
      assert.ok(off <= 0.15, `${name} by ${by}: p95 ${model.p95.toFixed(1)} ms against ${trace.p95.toFixed(1)} ms (${Math.round(off * 100)}% off)`);
      assert.ok(Math.abs(model.p50 - trace.p50) / trace.p50 <= 0.25, `${name} by ${by}: p50 ${model.p50} against ${trace.p50}`);
      assert.ok(routes >= 1);
    }
  // Failures where the trace's broke, about as often: 2 in 100 in the shop.
  const { trace, model } = (await viewOf(jaeger(SHOP))).replay.second;
  assert.equal(trace.failed, 0.02);
  assert.ok(Math.abs(model!.failed - trace.failed) < 0.01, `failed ${model!.failed}`);
  // The notes say how close it comes, and that it is checked slowed down.
  const v = await viewOf(jaeger(SHOP));
  assert.ok(v.notes.some((n) => /^Replayed the way the trace's requests went \(checked \d+ times slower.*\), 95 in 100 were answered within \d+ ms, against \d+ ms in the trace \(\d+% off\)/.test(n)), v.notes.join("\n"));
});

test("the second's books balance: every request accounted for and nothing leaks, with a part crashed and back", async () => {
  for (const text of [jaeger(SHOP), big()]) {
    const { spec } = (await viewOf(text)).replay.second;
    const quiet = { ...spec, windowMs: 1e9, nodes: spec.nodes.map((n) => (n.client ? { ...n, client: { ...n.client, rate: (t: number) => (t < 6000 ? (n.client!.rate as number) : 0) } } : n)) };
    const sim = new Sim(quiet);
    const busiest = spec.nodes.filter((n) => n.kind === "server").sort((a, b) => Object.keys(b.paths ?? {}).length - Object.keys(a.paths ?? {}).length)[1]?.id ?? "";
    for (let t = 0; t < 30_000; t += 100) {
      sim.step(100);
      if (t === 2000) sim.setUp(busiest, false);
      if (t === 2600) sim.setUp(busiest, true);
      if (t % 1000 === 0) assert.deepEqual(leakedHolds(sim), [], `at ${t}`);
    }
    const a = accounted(sim);
    assert.equal(a.sent, a.done + a.live, JSON.stringify(a));
    assert.equal(a.live, 0, "every request ended once traffic stopped");
  }
});

test("one click regroups a 200-service trace: by service, prefix or kind, each at most 14 stations, each merge a note", async () => {
  const { session } = readSession(big(), "platform");
  const seen = new Map<string, string[]>();
  for (const by of ["service", "prefix", "kind"] as const) {
    const preview = session!.preview(by);
    const v = (await session!.view(by)) as TraceView;
    const stations = compile(v.doc).spec!.nodes.length;
    assert.ok(stations <= 14, `${by}: ${stations} stations`);
    assert.ok(preview.parts.length <= 13 && preview.parts.length >= 2, `${by}: ${preview.parts.length} parts`);
    assert.ok(preview.notes.length >= 1, `${by} says what it merged`);
    // Each grouped part says how many of the file's it stands for, and the notes agree.
    assert.ok(preview.parts.some((p) => (p.merged ?? 0) > 1));
    assert.ok(v.replay.samples.length >= 2 && v.replay.second.model);
    seen.set(by, v.doc.parts.map((p) => p.name));
  }
  assert.ok(seen.get("kind")!.includes("Services") && seen.get("kind")!.includes("Databases"), seen.get("kind")!.join(", "));
  assert.notDeepEqual(seen.get("kind"), seen.get("service"));
  assert.deepEqual(session!.preview("kind").notes, ["Grouped by kind: behind the way in, each kind of part is one part: Services (200) and Databases (8)."]);
  // By prefix, every team's services are one part, whatever the stage needed.
  const prefix = session!.preview("prefix").parts;
  for (const team of ["payments", "orders", "search", "accounts"]) assert.ok(prefix.some((p) => p.name === team || p.name === "Other services"), team);
  // The same grouping is worked out once.
  assert.equal(await session!.view("kind"), await session!.view("kind"));
});

test("a shared trace system carries the reduced system only: no spans, samples or operation names", async () => {
  const v = await viewOf(jaeger(SHOP));
  const back = await decodeDoc(await encodeDoc(v.doc));
  assert.deepEqual(back, v.doc);
  const text = JSON.stringify(back);
  for (const word of ["POST /", "GET /", "INSERT", "spans", "samples", "paths", "routes"]) assert.ok(!text.includes(word), `the link carries “${word}”`);
});
