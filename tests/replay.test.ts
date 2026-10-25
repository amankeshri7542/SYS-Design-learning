import assert from "node:assert/strict";
import { test } from "node:test";
import { Sim } from "../src/lib/sim/engine";
import { compile, type Compiled } from "../src/lib/system/compile";
import type { SystemDoc } from "../src/lib/system/doc";
import { detect } from "../src/lib/system/import/detect";
import { openTrace, readSpans, readTrace } from "../src/lib/system/trace/open";
import { cleanName, serviceName } from "../src/lib/system/trace/scrub";
import { SECRETS, big, jaeger, otlp, scattered, shop, zipkin } from "./traces";

// Trace replay: a Jaeger, Zipkin or OpenTelemetry file becomes the system its requests ran through, read in the browser
// with personal data taken out first. The fixtures (`traces.ts`) are synthetic: one shop's requests, in each format.

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
    // IDs are numbers given in reading order; the file's own are gone.
    assert.ok(!/[0-9a-f]{16}/.test(spans) && !/[0-9a-f]{16}/.test(kept));
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
