// OpenTelemetry's JSON (OTLP/JSON): `{ "resourceSpans": [ { resource, scopeSpans: [ { spans } ] } ] }`, as a collector's
// file exporter writes it (one such object a line) and Tempo answers (`batches`, `instrumentationLibrarySpans`). The
// service is the resource's `service.name`; times are nanoseconds, written as strings.

import { kindOf, pick, type Reading } from "./span";

type Attr = { key?: unknown; value?: Record<string, unknown> };
interface OSpan {
  traceId?: unknown;
  spanId?: unknown;
  parentSpanId?: unknown;
  name?: unknown;
  kind?: unknown;
  startTimeUnixNano?: unknown;
  endTimeUnixNano?: unknown;
  attributes?: Attr[];
  status?: { code?: unknown };
}
interface OResource {
  resource?: { attributes?: Attr[] };
  scopeSpans?: { spans?: OSpan[] }[];
  instrumentationLibrarySpans?: { spans?: OSpan[] }[];
}

/** Whether parsed JSON (one object, or one per line) is OTLP's, and its resources. */
export function otlpResources(data: unknown[]): OResource[] | null {
  const out: OResource[] = [];
  for (const d of data) {
    const list = d && typeof d === "object" ? ((d as { resourceSpans?: unknown }).resourceSpans ?? (d as { batches?: unknown }).batches) : null;
    if (!Array.isArray(list)) return null;
    out.push(...list);
  }
  return out;
}

/** An attribute's value, whichever of OTLP's typed fields holds it. */
const valueOf = (v: Record<string, unknown> | undefined) => (v ? (v.stringValue ?? v.intValue ?? v.boolValue ?? v.doubleValue) : undefined);

/** Nanoseconds (a string of digits, or a number) as ms, without losing the digits a double can't hold. */
function ms(v: unknown): number {
  if (typeof v === "number") return v / 1e6;
  if (typeof v !== "string" || !/^\d+$/.test(v)) return NaN;
  return v.length <= 6 ? Number(v) / 1e6 : Number(v.slice(0, -6)) + Number(v.slice(-6)) / 1e6;
}

export function readOtlp(resources: OResource[], into: Reading) {
  for (const r of resources) {
    const service = valueOf(r?.resource?.attributes?.find((a) => a?.key === "service.name")?.value) ?? "unknown service";
    for (const scope of r?.scopeSpans ?? r?.instrumentationLibrarySpans ?? []) {
      for (const s of scope?.spans ?? []) {
        if (!s || typeof s !== "object") continue;
        into.add({
          trace: String(s.traceId ?? ""),
          id: String(s.spanId ?? ""),
          parent: s.parentSpanId ? String(s.parentSpanId) : undefined,
          service,
          name: s.name,
          kind: kindOf(s.kind),
          start: ms(s.startTimeUnixNano),
          end: ms(s.endTimeUnixNano),
          error: s.status?.code === 2 || s.status?.code === "STATUS_CODE_ERROR",
          attr: pick<Attr>(
            s.attributes,
            (a) => a.key,
            (a) => valueOf(a.value),
          ),
        });
      }
    }
  }
}
