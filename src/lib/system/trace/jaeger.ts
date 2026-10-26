// Jaeger's JSON, as its UI downloads it and its query API answers: `{ "data": [trace, …] }`, one trace, or a list of
// them, where a trace is `{ traceID, spans, processes }` and each span names its process (the service) by key. Times
// are in microseconds.

import { kindOf, pick, type Reading } from "./span";

type Tag = { key?: unknown; value?: unknown };
type Ref = { refType?: unknown; spanID?: unknown };
interface JSpan {
  traceID?: unknown;
  spanID?: unknown;
  parentSpanID?: unknown;
  operationName?: unknown;
  references?: Ref[];
  startTime?: unknown;
  duration?: unknown;
  tags?: Tag[];
  processID?: unknown;
  process?: { serviceName?: unknown };
}
interface JTrace {
  traceID?: unknown;
  spans?: JSpan[];
  processes?: Record<string, { serviceName?: unknown }>;
}

/** Whether parsed JSON is Jaeger's, and its traces. */
export function jaegerTraces(data: unknown): JTrace[] | null {
  const isTrace = (t: unknown): t is JTrace => !!t && typeof t === "object" && Array.isArray((t as JTrace).spans);
  if (Array.isArray(data)) return data.length && data.every(isTrace) ? data : null;
  if (!data || typeof data !== "object") return null;
  const d = (data as { data?: unknown }).data;
  if (Array.isArray(d)) return d.every(isTrace) ? d : null;
  return isTrace(data) && "processes" in data ? [data] : null;
}

const tagValue = (tags: Tag[] | undefined, key: string) => tags?.find((t) => t?.key === key)?.value;

export function readJaeger(traces: JTrace[], into: Reading) {
  traces.forEach((t, ti) => {
    (t.spans ?? []).forEach((s, si) => {
      if (!s || typeof s !== "object") return into.skipped++;
      const process = (typeof s.processID === "string" ? t.processes?.[s.processID] : undefined) ?? s.process;
      if (!process) return into.error(`Jaeger trace ${ti + 1}, span ${si + 1}: its process isn't listed under “processes”, so its service is unknown.`);
      const parent = s.references?.find((r) => r?.refType === "CHILD_OF") ?? s.references?.[0];
      const start = Number(s.startTime) / 1000;
      const status = tagValue(s.tags, "http.status_code");
      into.add({
        trace: String(s.traceID ?? t.traceID ?? ""),
        id: String(s.spanID ?? ""),
        parent: parent?.spanID ? String(parent.spanID) : s.parentSpanID ? String(s.parentSpanID) : undefined,
        service: process.serviceName,
        name: s.operationName,
        kind: kindOf(tagValue(s.tags, "span.kind")),
        start,
        end: start + Number(s.duration) / 1000,
        error: [true, "true"].includes(tagValue(s.tags, "error") as never) || tagValue(s.tags, "otel.status_code") === "ERROR" || Number(status) >= 500,
        attr: pick<Tag>(
          s.tags,
          (a) => a.key,
          (a) => a.value,
        ),
      });
    });
  });
}
