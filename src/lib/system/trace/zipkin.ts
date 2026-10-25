// Zipkin's v2 JSON: a list of spans (`[{ traceId, id, parentId, name, kind, timestamp, duration, localEndpoint }]`), or
// a list of such lists, one per trace, as its UI downloads several. Times are in microseconds; a client span names who
// it called in `remoteEndpoint`, and a server span may share its client's ID (`shared`).

import { kindOf, pick, type Reading } from "./span";

interface ZSpan {
  traceId?: unknown;
  id?: unknown;
  parentId?: unknown;
  name?: unknown;
  kind?: unknown;
  timestamp?: unknown;
  duration?: unknown;
  shared?: unknown;
  localEndpoint?: { serviceName?: unknown };
  remoteEndpoint?: { serviceName?: unknown };
  tags?: Record<string, unknown>;
}

/** Whether parsed JSON is Zipkin's, and its spans. */
export function zipkinSpans(data: unknown): ZSpan[] | null {
  if (!Array.isArray(data) || !data.length) return null;
  const spans = data.every(Array.isArray) ? (data as unknown[][]).flat() : data;
  return spans.length && spans.every((s) => s && typeof s === "object" && "traceId" in s) ? (spans as ZSpan[]) : null;
}

export function readZipkin(spans: ZSpan[], into: Reading) {
  for (const s of spans) {
    const tags = s.tags && typeof s.tags === "object" ? s.tags : {};
    const start = Number(s.timestamp) / 1000;
    into.add({
      trace: String(s.traceId ?? ""),
      id: String(s.id ?? ""),
      parent: s.parentId ? String(s.parentId) : undefined,
      service: s.localEndpoint?.serviceName ?? "unknown service",
      name: s.name,
      kind: kindOf(s.kind),
      start,
      end: start + Number(s.duration) / 1000,
      error: "error" in tags || Number(tags["http.status_code"]) >= 500,
      attr: pick<[string, unknown]>(
        Object.entries(tags),
        ([k]) => k,
        ([, v]) => v,
      ),
      shared: s.shared === true,
      remote: s.remoteEndpoint?.serviceName,
    });
  }
}
