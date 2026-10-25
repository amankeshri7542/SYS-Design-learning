import assert from "node:assert/strict";
import { test } from "node:test";
import { Sim } from "../src/lib/sim/engine";
import { compile, type Compiled } from "../src/lib/system/compile";
import { MAX_PARTS, type SystemDoc } from "../src/lib/system/doc";
import { detect, parseYaml, readSystem } from "../src/lib/system/import/read";
import { TEMPLATES } from "../src/lib/system/templates";

// Imports: text someone already has becomes a system that runs, and what can't be read is said by line.

const runs = (doc: SystemDoc | null) => {
  assert.ok(doc, "it read");
  const c = compile(doc);
  assert.ok(c.spec, c.issues.map((i) => i.text).join("; "));
  const sim = new Sim((c as Compiled).spec);
  sim.step(2000);
  assert.ok(sim.done.length > 5, "it answers requests");
};
const part = (doc: SystemDoc | null, name: string) => doc!.parts.find((p) => p.name === name)!;
const named = (doc: SystemDoc | null, id: string) => doc!.parts.find((p) => p.id === id)?.name;

test("arrows: the shape people sketch becomes the system, with kinds guessed from names", () => {
  const r = readSystem("Users -> LB -> API x3 -> Redis -> Postgres\nAPI -> Stripe");
  assert.equal(r.format, "arrows");
  assert.deepEqual(r.errors, []);
  assert.equal(part(r.doc, "Users").kind, "users");
  assert.equal(part(r.doc, "LB").kind, "balancer");
  assert.deepEqual([part(r.doc, "API").kind, part(r.doc, "API").count], ["service", 3]);
  assert.equal(part(r.doc, "Redis").kind, "cache");
  assert.equal(part(r.doc, "Postgres").kind, "database");
  assert.equal(part(r.doc, "Stripe").kind, "external");
  assert.deepEqual(part(r.doc, "API").to!.map((id) => named(r.doc, id)), ["Redis", "Stripe"]);
  runs(r.doc);
});

test("arrows carry kinds, rates, work and fan-out, and a missing Users is added", () => {
  const r = readSystem("Mobile app (120/s) -> Gateway -> Orders [service] 40ms -> Orders DB, Payments [external]\n# a comment\nOrders -> Events [topic] -> Mailer");
  assert.deepEqual(r.errors, []);
  assert.equal(part(r.doc, "Mobile app").set?.rate, 120);
  assert.equal(part(r.doc, "Orders").set?.ms, 40);
  assert.equal(part(r.doc, "Payments").kind, "external");
  assert.equal(part(r.doc, "Events").kind, "topic");
  runs(r.doc);
  const bare = readSystem("API -> Postgres");
  assert.ok(bare.notes.some((n) => n.includes("Added Users")));
  assert.equal(part(bare.doc, "Users").to![0], part(bare.doc, "API").id);
  // What a queue hands work to is a worker, even when its name says nothing.
  const jobs = readSystem("API -> Jobs [queue] -> Billing, Thumbnails");
  assert.deepEqual([part(jobs.doc, "Billing").kind, part(jobs.doc, "Thumbnails").kind], ["worker", "worker"]);
  assert.ok(jobs.notes.some((n) => n === "Billing is drawn as a worker: it takes its work from Jobs."));
  runs(jobs.doc);
});

test("arrows that can't be read say which line and why", () => {
  assert.match(readSystem("Users -> -> API").errors[0].text, /^Line 1: there's nothing after an arrow/);
  assert.match(readSystem("Users -> API\nAPI -> Thing [gizmo]").errors[0].text, /^Line 2: “\[gizmo\]” isn't a kind/);
  assert.equal(readSystem("Users -> -> API").doc, null);
});

test("CSV of calls: rates belong to whoever starts the traffic, latencies to who answers", () => {
  const csv = "from,to,rps,latency_ms\nBrowsers,Web,80,\nWeb,Search,,120\nWeb,Postgres,,30\n";
  assert.equal(detect(csv), "csv");
  const r = readSystem(csv);
  assert.deepEqual(r.errors, []);
  assert.equal(part(r.doc, "Browsers").kind, "users");
  assert.equal(part(r.doc, "Browsers").set?.rate, 80);
  assert.equal(part(r.doc, "Search").set?.ms, 120);
  runs(r.doc);
  assert.match(readSystem("a,b,fast").errors[0].text, /^Line 1: “fast” isn't a number/);
});

test("JSON: a System Lab file reopens as it was, and a list of calls reads like arrows", () => {
  const web = TEMPLATES.find((t) => t.id === "web-app")!.doc;
  const r = readSystem(JSON.stringify(web, null, 2));
  assert.equal(r.format, "json");
  assert.deepEqual(r.doc, JSON.parse(JSON.stringify(web)));
  runs(readSystem('[{"from":"Users","to":"API"},{"from":"API","to":"MySQL"}]').doc);
  assert.match(readSystem('{"v":1,"parts":[').errors[0].text, /isn't valid JSON/);
  assert.match(readSystem('{"hello":1}').errors[0].text, /isn't a System Lab system/);
});

const COMPOSE = `
# A small shop
services:
  web:
    image: nginx:1.27
    ports:
      - "80:80"
    depends_on:
      - api
  api:
    build: ./api
    deploy:
      replicas: 3
    depends_on:
      db:
        condition: service_healthy
      cache:
        condition: service_started
      rabbit:
        condition: service_started
  worker:
    build: ./worker
    depends_on: [rabbit, db]
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: example
  cache:
    image: redis:7
  rabbit:
    image: rabbitmq:3-management
`;

test("docker-compose: images say what each service is, depends_on draws the arrows, ports are the way in", () => {
  assert.equal(detect(COMPOSE), "compose");
  const r = readSystem(COMPOSE);
  assert.deepEqual(r.errors, []);
  const d = r.doc!;
  assert.equal(part(d, "web").kind, "balancer");
  assert.equal(part(d, "api").count, 3);
  assert.equal(part(d, "db").kind, "database");
  assert.equal(part(d, "cache").kind, "cache");
  assert.equal(part(d, "rabbit").kind, "queue");
  // The worker takes jobs from the queue; the cache stands in front of the database; users come in through the web.
  assert.equal(part(d, "worker").kind, "worker");
  assert.ok(part(d, "rabbit").to!.includes(part(d, "worker").id));
  assert.deepEqual(part(d, "cache").to, [part(d, "db").id]);
  assert.ok(!part(d, "api").to!.includes(part(d, "db").id));
  assert.equal(named(d, part(d, "Users").to![0]), "web");
  runs(d);
});

test("YAML that can't be read says which line", () => {
  assert.match(readSystem("services:\n  a:\n    image: x\n  b: &base\n    image: y\n").errors[0].text, /^Line 4: anchors/);
  assert.match(readSystem("services:\n\tweb:\n").errors[0].text, /^Line 2: indent with spaces/);
  assert.deepEqual(parseYaml("a:\n  - 1\n  - two\nb: [x, y]\nc: \"q\"").value, { a: [1, "two"], b: ["x", "y"], c: "q" });
});

test("numbered copies count as one part, and a huge system is grouped to fit a stage", () => {
  const r = readSystem("Users -> lb -> api-1, api-2, api-3 -> db");
  assert.equal(part(r.doc, "api").count, 3);
  assert.ok(r.notes.some((n) => n.includes("api ×3")));
  const many = Array.from({ length: 40 }, (_, i) => `gateway -> svc${String.fromCharCode(97 + (i % 26))}${Math.floor(i / 26)}x`).join("\n");
  const big = readSystem(`Users -> gateway\n${many}`);
  assert.ok(big.doc!.parts.length <= MAX_PARTS);
  assert.ok(big.notes.some((n) => n.includes("Other services")));
  runs(big.doc);
});

test("an import opens healthy: parts sized to about 60% busy, and a target it meets, each said in a note", async () => {
  const { sized } = await import("../src/lib/system/import/size");
  const r = readSystem("Users -> Load balancer -> API x3 -> Redis -> Postgres\nAPI -> Stripe\nAPI -> Jobs [queue] -> Mailer -> SendGrid");
  // Read from names, and nothing the reader added counts as a guess.
  assert.deepEqual(
    r.guesses.map((g) => `${g.name}:${g.kind}`),
    ["Users:users", "Load balancer:balancer", "API:service", "Redis:cache", "Postgres:database", "Stripe:external", "Mailer:worker", "SendGrid:external"],
  );
  const s = await sized(r.doc!);
  assert.equal(part(s.doc, "Mailer").set?.workers, 12);
  assert.ok(s.notes[0].startsWith("Workers are set so each part starts about 60% busy: Mailer 1 → 12."));
  assert.ok(s.doc.targets.p95Ms > 400 && s.notes.some((n) => n.includes(`working means answered within ${s.doc.targets.p95Ms} ms`)));
  // Run as the player runs it: nothing piles up in the queue, and people's answers meet the target.
  const c = compile(s.doc) as Compiled;
  const sim = new Sim(c.spec);
  sim.step(6000);
  const lat = sim.done.filter((d) => d.t > 2000 && d.result === "ok").map((d) => d.lat).sort((a, b) => a - b);
  assert.ok(lat[Math.floor(lat.length * 0.95)] <= s.doc.targets.p95Ms);
  assert.ok(sim.list.filter((n) => n.spec.kind === "queue").every((n) => n.queue.length < 20));
  // A part given its own number of workers keeps it.
  const own = readSystem("Users -> API -> Jobs [queue] -> Mailer");
  const mailer = own.doc!.parts.find((p) => p.name === "Mailer")!;
  mailer.set = { ...mailer.set, workers: 2 };
  assert.equal(part((await sized(own.doc!)).doc, "Mailer").set?.workers, 2);
});
