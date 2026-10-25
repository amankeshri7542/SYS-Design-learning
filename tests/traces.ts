// Synthetic trace files for the replay tests (unit and browser): one shop's requests, written as Jaeger, Zipkin and
// OpenTelemetry JSON, with personal data planted where real programs put it; and a platform of 200 services. No real
// data: every name, ID and address here is made up.

type Kind = "server" | "client" | "producer" | "consumer";
/** A span before it is written in any format: times in µs. */
interface L {
  trace: string;
  id: string;
  parent?: string;
  service: string;
  name: string;
  kind: Kind;
  start: number;
  dur: number;
  error?: boolean;
  attrs: Record<string, string | number | boolean>;
}

/** Personal data planted in the fixtures: none of it may survive the reading. */
export const PII = {
  "user.email": "jane.doe@example.com",
  "enduser.id": "user-829341",
  "http.url": "https://shop.example.com/checkout?token=sk_live_abc123XYZ",
  "net.peer.ip": "10.20.30.40",
  "http.client_ip": "203.0.113.7",
};
export const SECRETS = ["jane", "example.com", "829341", "10.20.30.40", "203.0.113.7", "sk_live", "abc123", "98765", "x2k9p", "7d9f8b6c4", "feed", "abcd"];

const rng = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const hex = (v: number, w: number) => v.toString(16).padStart(w, "0");

/**
 * A shop's requests, ten a second: four in five browse (the frontend asks the catalog and, at the same time, ads; the
 * catalog asks Redis, and Postgres on a miss); one in five checks out (checkout writes Postgres three times, asks
 * payments, which fails one time in ten, and sends an event on Kafka that the email service takes).
 */
export function shop(n = 200): L[] {
  const r = rng(7);
  const out: L[] = [];
  let next = 1;
  const vary = (ms: number) => Math.round(ms * 1000 * (0.7 + 0.6 * r()));
  for (let t = 0; t < n; t++) {
    const trace = hex(0xabcd0000 + t, 32);
    const id = () => hex(0xfeed0000 + next++, 16);
    const span = (s: Omit<L, "trace" | "id" | "attrs"> & { attrs?: L["attrs"] }) => {
      const l = { trace, id: id(), attrs: {}, ...s };
      out.push(l);
      return l;
    };
    /** A call from one service to another: the caller's client span around the callee's server span. */
    const call = (parent: L, from: string, to: string, name: string, at: number, work: number, inner: (server: L, at: number) => number = (_, a) => a) => {
      const c = span({ parent: parent.id, service: from, name, kind: "client", start: at, dur: 0 });
      const s = span({ parent: c.id, service: to, name, kind: "server", start: at + 300, dur: 0 });
      const end = inner(s, at + 300 + work);
      s.dur = end - s.start;
      c.dur = end + 300 - c.start;
      return c;
    };
    const t0 = 1_761_400_000_000_000 + t * 100_000;
    if (t % 5 !== 4) {
      const root = span({ service: "frontend", name: `GET /products/98765?ref=jane@example.com`, kind: "server", start: t0, dur: 0, attrs: { ...PII } });
      const at = t0 + vary(8);
      const ads = call(root, "frontend", "ads", "GET /ads", at, vary(30));
      const cat = call(root, "frontend", "catalog-7d9f8b6c4-x2k9p", "GET /catalog/98765", at, vary(20), (s, a) => {
        const redis = span({ parent: s.id, service: s.service, name: "GET", kind: "client", start: a, dur: vary(2), attrs: { "db.system": "redis", ...PII } });
        let end = redis.start + redis.dur;
        if (r() < 0.3) {
          const pg = span({ parent: s.id, service: s.service, name: "SELECT * FROM products WHERE id = '98765'", kind: "client", start: end, dur: vary(25), attrs: { "db.system": "postgresql" } });
          end = pg.start + pg.dur;
        }
        return end;
      });
      root.dur = Math.max(ads.start + ads.dur, cat.start + cat.dur) + vary(4) - t0;
    } else {
      const root = span({ service: "frontend", name: "POST /users/829341/checkout", kind: "server", start: t0, dur: 0, attrs: { ...PII } });
      const fails = t % 50 === 49;
      const c = call(root, "frontend", "checkout", "POST /checkout", t0 + vary(8), vary(15), (s, a) => {
        let at = a;
        for (let k = 0; k < 3; k++) {
          const pg = span({ parent: s.id, service: "checkout", name: "INSERT orders", kind: "client", start: at, dur: vary(5), attrs: { "db.system": "postgresql" } });
          at = pg.start + pg.dur;
        }
        const pay = call(s, "checkout", "payments", "POST /charge", at, vary(120));
        if (fails) pay.error = s.error = true;
        out.filter((x) => x.parent === pay.id).forEach((x) => (x.error = fails));
        at = pay.start + pay.dur;
        const send = span({ parent: s.id, service: "checkout", name: "orders publish", kind: "producer", start: at, dur: vary(1), attrs: { "messaging.system": "kafka", "messaging.destination.name": "orders" } });
        span({ parent: send.id, service: "email", name: "orders process", kind: "consumer", start: at + 5000, dur: vary(30), attrs: { "messaging.system": "kafka" } });
        return send.start + send.dur;
      });
      root.error = fails;
      root.dur = c.start + c.dur + vary(4) - t0;
    }
  }
  return out;
}

const JAEGER_KIND = { server: "server", client: "client", producer: "producer", consumer: "consumer" };
const tagOf = (key: string, value: string | number | boolean) => ({ key, type: typeof value === "string" ? "string" : typeof value === "number" ? "int64" : "bool", value });

export function jaeger(spans: L[]): string {
  const traces = [...new Set(spans.map((s) => s.trace))].map((traceID) => {
    const mine = spans.filter((s) => s.trace === traceID);
    const services = [...new Set(mine.map((s) => s.service))];
    return {
      traceID,
      spans: mine.map((s) => ({
        traceID,
        spanID: s.id,
        operationName: s.name,
        references: s.parent ? [{ refType: "CHILD_OF", traceID, spanID: s.parent }] : [],
        startTime: s.start,
        duration: s.dur,
        tags: [tagOf("span.kind", JAEGER_KIND[s.kind]), ...Object.entries(s.attrs).map(([k, v]) => tagOf(k, v)), ...(s.error ? [tagOf("error", true)] : [])],
        processID: `p${services.indexOf(s.service) + 1}`,
      })),
      processes: Object.fromEntries(services.map((name, i) => [`p${i + 1}`, { serviceName: name, tags: [tagOf("hostname", "ip-10-20-30-40"), tagOf("ip", PII["net.peer.ip"])] }])),
    };
  });
  return JSON.stringify({ data: traces, total: 0, limit: 0, offset: 0, errors: null });
}

export function zipkin(spans: L[]): string {
  return JSON.stringify(
    spans.map((s) => ({
      traceId: s.trace,
      id: s.id,
      ...(s.parent ? { parentId: s.parent } : {}),
      name: s.name,
      kind: s.kind.toUpperCase(),
      timestamp: s.start,
      duration: s.dur,
      localEndpoint: { serviceName: s.service, ipv4: PII["net.peer.ip"] },
      tags: { ...Object.fromEntries(Object.entries(s.attrs).map(([k, v]) => [k, String(v)])), ...(s.error ? { error: "payment declined for jane.doe@example.com" } : {}) },
    })),
  );
}

const OTLP_KIND = { server: 2, client: 3, producer: 4, consumer: 5 };
const otlpValue = (v: string | number | boolean) => (typeof v === "string" ? { stringValue: v } : typeof v === "number" ? { intValue: String(v) } : { boolValue: v });

export function otlp(spans: L[], lines = false): string {
  const services = [...new Set(spans.map((s) => s.service))];
  const resource = (name: string) => ({
    resource: { attributes: [{ key: "service.name", value: { stringValue: name } }, { key: "host.ip", value: { stringValue: PII["net.peer.ip"] } }] },
    scopeSpans: [
      {
        scope: { name: "fixture" },
        spans: spans
          .filter((s) => s.service === name)
          .map((s) => ({
            traceId: s.trace,
            spanId: s.id,
            parentSpanId: s.parent ?? "",
            name: s.name,
            kind: OTLP_KIND[s.kind],
            startTimeUnixNano: `${s.start}000`,
            endTimeUnixNano: `${s.start + s.dur}000`,
            attributes: Object.entries(s.attrs).map(([key, v]) => ({ key, value: otlpValue(v) })),
            status: s.error ? { code: 2, message: "declined for jane.doe@example.com" } : {},
          })),
      },
    ],
  });
  if (lines) return services.map((name) => JSON.stringify({ resourceSpans: [resource(name)] })).join("\n");
  return JSON.stringify({ resourceSpans: services.map(resource) });
}

/** 200 services in 8 teams behind a gateway, each team with its own database: far too many for one stage. */
export function big(): string {
  const teams = ["payments", "orders", "search", "accounts", "catalog", "shipping", "reviews", "pricing"];
  const words = "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee".split(" ");
  const r = rng(11);
  const spans: L[] = [];
  let next = 1;
  for (let t = 0; t < 400; t++) {
    const trace = hex(0x5000 + t, 32);
    const t0 = 1_761_400_000_000_000 + t * 25_000;
    const root: L = { trace, id: hex(next++, 16), service: "gateway", name: "GET /", kind: "server", start: t0, dur: 0, attrs: {} };
    spans.push(root);
    let at = t0 + 2000;
    const team = teams[t % teams.length];
    for (let k = 0; k < 3; k++) {
      const svc = `${team}-${words[Math.floor(r() * 25)]}`;
      const s: L = { trace, id: hex(next++, 16), parent: root.id, service: svc, name: "GET /work", kind: "server", start: at, dur: 0, attrs: {} };
      const db: L = { trace, id: hex(next++, 16), parent: s.id, service: svc, name: "SELECT", kind: "client", start: at + 5000, dur: 8000, attrs: { "db.system": "postgresql", "peer.service": `${team}-db` } };
      s.dur = 20_000;
      spans.push(s, db);
      at += 21_000;
    }
    root.dur = at - t0 + 1000;
  }
  // Every team's 25 services appear somewhere.
  for (const team of teams)
    for (let k = 0; k < 25; k++) {
      const trace = hex(0x9000 + teams.indexOf(team) * 100 + k, 32);
      const t0 = 1_761_400_000_000_000 + 10_000_000 + k * 1000;
      const root: L = { trace, id: hex(next++, 16), service: "gateway", name: "GET /", kind: "server", start: t0, dur: 30_000, attrs: {} };
      spans.push(root, { trace, id: hex(next++, 16), parent: root.id, service: `${team}-${words[k]}`, name: "GET /work", kind: "server", start: t0 + 1000, dur: 20_000, attrs: {} });
    }
  return otlp(spans);
}


/** 300 services with unrelated names behind an edge, each with its own database, every one in about 1 in 100 requests. */
export function scattered(): string {
  const names = Array.from({ length: 300 }, (_, i) => `svc${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + (Math.floor(i / 26) % 26))}q`);
  const spans: object[] = [];
  let next = 1;
  const id = () => hex(next++, 16);
  for (let t = 0; t < 600; t++) {
    const traceId = hex(0x7000 + t, 32);
    const root = { traceId, id: id(), name: "GET /", kind: "SERVER", timestamp: 1_761_400_000_000_000 + t * 10_000, duration: 40_000, localEndpoint: { serviceName: "edge" } };
    spans.push(root);
    let parent = root;
    for (let d = 0; d < 3; d++) {
      const s = names[(t * 7 + d * 13) % names.length];
      const sp = { traceId, id: id(), parentId: parent.id, name: "GET /x", kind: "SERVER", timestamp: parent.timestamp + 1000, duration: parent.duration - 6000, localEndpoint: { serviceName: s } };
      spans.push(sp, { traceId, id: id(), parentId: sp.id, name: "q", kind: "CLIENT", timestamp: sp.timestamp + 500, duration: 2000, localEndpoint: { serviceName: s }, tags: { "db.system": "postgresql", "peer.service": `${s}-db` } });
      parent = sp;
    }
  }
  return JSON.stringify(spans);
}
