// The one shape every trace reader leaves its spans in. IDs are replaced by numbers in reading order as each span is
// read, names are scrubbed (`scrub.ts`), and of a span's attributes only which database, queue or service it called is
// kept, as a kind and a name. What a format calls things (Jaeger's processes, Zipkin's endpoints, OpenTelemetry's
// resources) stays in its reader.

import type { PartKind } from "../doc";
import type { ReadError } from "../import/graph";
import { READ_ATTRS, cleanName, peerOf, serviceName, type ReadAttr } from "./scrub";

export type SpanKind = "server" | "client" | "producer" | "consumer" | "internal";

export interface Span {
  /** Which request (trace) it belongs to, numbered from 0 in reading order. */
  trace: number;
  /** Its place in the list; `parent` is its parent's place, or -1. */
  parent: number;
  service: string;
  /** What it did, scrubbed ("GET /users/{id}"); empty when nothing was left. */
  name: string;
  kind: SpanKind;
  /** Start and end, in ms on the file's clock. */
  start: number;
  end: number;
  error: boolean;
  /** Where a call went, when its attributes say: a database, cache, queue, topic or named service. */
  peer?: { name: string; kind?: PartKind };
}

/** A span as a reader found it, before its IDs are numbered and its names cleaned. */
export interface RawSpan {
  trace: string;
  id: string;
  parent?: string;
  service: unknown;
  name: unknown;
  kind: SpanKind;
  start: number;
  end: number;
  error: boolean;
  /** Reads one whitelisted attribute; nothing else is asked for. */
  attr: (key: ReadAttr) => unknown;
  /** Zipkin: the server half of a call that shares its client's ID. */
  shared?: boolean;
  /** Zipkin: who a client span called, by name. */
  remote?: unknown;
}

const WANTED = new Set<string>(READ_ATTRS);

/** 1 → A, 26 → Z, 27 → AA: a name for a service called only by an address (a number would read as a copy). */
const letters = (n: number): string => (n > 26 ? letters(Math.floor((n - 1) / 26)) : "") + String.fromCharCode(65 + ((n - 1) % 26));

/** Only the whitelisted entries of a list of key/value attributes, as a lookup. */
export function pick<T>(list: unknown, key: (a: T) => unknown, value: (a: T) => unknown): (k: ReadAttr) => unknown {
  const m = new Map<string, unknown>();
  if (Array.isArray(list)) for (const a of list as T[]) if (a && WANTED.has(String(key(a)))) m.set(String(key(a)), value(a));
  return (k) => m.get(k);
}

/** "span.kind" as Jaeger and Zipkin write it, or OpenTelemetry's number or name. */
export function kindOf(v: unknown): SpanKind {
  const s = String(v ?? "").toLowerCase().replace(/^span_kind_/, "");
  if (s === "server" || s === "2") return "server";
  if (s === "client" || s === "3") return "client";
  if (s === "producer" || s === "4") return "producer";
  if (s === "consumer" || s === "5") return "consumer";
  return "internal";
}

/**
 * Collects a file's spans: each gets a number as it is read and its names cleaned; parents are found once every span
 * is in, and the file's IDs are dropped with the reading.
 */
export class Reading {
  readonly spans: Span[] = [];
  readonly errors: ReadError[] = [];
  /** Spans left out for having no usable times. */
  skipped = 0;
  private traces = new Map<string, number>();
  private keys = new Map<string, number>();
  private parents: (string | undefined)[] = [];
  private shared: boolean[] = [];
  private ids: string[] = [];
  /** Services whose name was all ID or address, lettered in the order they came. */
  private unnamed = new Map<string, number>();

  error(text: string) {
    if (this.errors.length < 6) this.errors.push({ text });
  }

  add(raw: RawSpan) {
    if (!Number.isFinite(raw.start) || !Number.isFinite(raw.end) || raw.end < raw.start || !raw.trace || !raw.id) {
      this.skipped++;
      return;
    }
    let trace = this.traces.get(raw.trace);
    if (trace === undefined) this.traces.set(raw.trace, (trace = this.traces.size));
    let service = serviceName(raw.service);
    if (!service) {
      const key = String(raw.service ?? "");
      if (!this.unnamed.has(key)) this.unnamed.set(key, this.unnamed.size + 1);
      service = `Service ${letters(this.unnamed.get(key)!)}`;
    }
    const remote = raw.kind === "client" ? serviceName(raw.remote) : "";
    const peer = peerOf(raw.attr, raw.kind === "producer" || raw.kind === "consumer") ?? (remote ? { name: remote } : null);
    const at = this.spans.length;
    this.spans.push({ trace, parent: -1, service, name: cleanName(raw.name), kind: raw.kind, start: raw.start, end: raw.end, error: raw.error, ...(peer ? { peer } : {}) });
    const key = `${trace}\u0000${raw.id}${raw.shared && raw.kind === "server" ? "\u0000s" : ""}`;
    if (!this.keys.has(key)) this.keys.set(key, at);
    this.parents.push(raw.parent || undefined);
    this.shared.push(!!raw.shared && raw.kind === "server");
    this.ids.push(raw.id);
  }

  /** The spans, each pointing at its parent by place. A parent missing from the file leaves its child a root. */
  finish(): { spans: Span[]; orphans: number } {
    let orphans = 0;
    this.spans.forEach((s, i) => {
      const t = `${s.trace}\u0000`;
      // The server half of a shared Zipkin span hangs under its client half.
      if (this.shared[i]) {
        const client = this.keys.get(t + this.ids[i]);
        if (client !== undefined && client !== i) return void (s.parent = client);
      }
      const p = this.parents[i];
      if (!p) return;
      const plain = this.keys.get(t + p);
      const server = this.keys.get(`${t + p}\u0000s`);
      // A shared ID names two spans: a child in the server's service belongs under the server half.
      const pick = server !== undefined && (plain === undefined || this.spans[server].service === s.service) ? server : plain;
      if (pick === undefined || pick === i) orphans++;
      else s.parent = pick;
    });
    this.traces.clear();
    this.keys.clear();
    this.unnamed.clear();
    this.parents = [];
    this.shared = [];
    this.ids = [];
    return { spans: this.spans, orphans };
  }
}
