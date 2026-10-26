// Opening a trace file (Jaeger, Zipkin or OpenTelemetry JSON) as a system: its spans are read and scrubbed in the
// browser (nothing is uploaded), reduced to the services they ran through (`reduce.ts`), drawn as any import is
// (`toDoc`), sized to start healthy, and checked against the trace: the notes say how close the model's times come.
// Loaded only when a trace is opened; the file's text and IDs are dropped once it is read.

import { compile, type Compiled } from "../compile";
import { validate, type PartKind, type SystemDoc } from "../doc";
import { guessNote, toDoc, type Imported, type ReadError } from "../import/graph";
import { measure, sized } from "../import/size";
import { jaegerTraces, readJaeger } from "./jaeger";
import { otlpResources, readOtlp } from "./otlp";
import { msText, reduce, type Grouping, type Reduced } from "./reduce";
import { replayOf, type Replay } from "./replay";
import { serviceName } from "./scrub";
import { Reading, type Span } from "./span";
import { readZipkin, zipkinSpans } from "./zipkin";

export type TraceFormat = "Jaeger" | "Zipkin" | "OpenTelemetry";

const FORMS = "System Lab reads Jaeger ({ \"data\": [ { \"spans\": … } ] }), Zipkin ([ { \"traceId\": … } ]) and OpenTelemetry ({ \"resourceSpans\": … }) JSON.";

/** The line a JSON error is on: from its position, or the last line when the text ends too soon. */
function lineOf(text: string, e: unknown): number | undefined {
  const message = String((e as Error)?.message);
  const at = message.match(/position (\d+)/);
  if (at) return text.slice(0, Number(at[1])).split("\n").length;
  return /end of (JSON )?input/i.test(message) ? text.trimEnd().split("\n").length : undefined;
}

/** A trace file's spans, read and scrubbed, or what was wrong with it. */
export function readSpans(text: string): { spans: Span[]; format: TraceFormat | null; orphans: number; skipped: number; errors: ReadError[] } {
  const fail = (e: ReadError) => ({ spans: [], format: null, orphans: 0, skipped: 0, errors: [e] });
  let data: unknown[];
  try {
    data = [JSON.parse(text)];
  } catch (e) {
    // A collector's file exporter writes one JSON object a line.
    const lines = text.split("\n");
    if (lines.filter((l) => l.trim()).length < 2) {
      const line = lineOf(text, e);
      return fail({ line, text: `${line ? `Line ${line}: ` : ""}this isn't valid JSON (${(e as Error).message.replace(/ in JSON.*$/, "").replace(/,? ".*" is not valid JSON$/, "")}).` });
    }
    data = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      try {
        data.push(JSON.parse(lines[i]));
      } catch {
        return fail({ line: i + 1, text: `Line ${i + 1}: this isn't valid JSON. A file of spans is one JSON object, or one a line.` });
      }
    }
  }
  const into = new Reading();
  let format: TraceFormat | null = null;
  const otlp = otlpResources(data);
  const jaeger = data.length === 1 ? jaegerTraces(data[0]) : null;
  const zipkin = data.length === 1 ? zipkinSpans(data[0]) : null;
  if (otlp) readOtlp(otlp, into), (format = "OpenTelemetry");
  else if (jaeger) readJaeger(jaeger, into), (format = "Jaeger");
  else if (zipkin) readZipkin(zipkin, into), (format = "Zipkin");
  else return fail({ text: `This JSON isn't a trace. ${FORMS}` });
  const { spans, orphans } = into.finish();
  if (into.errors.length) return { spans: [], format, orphans, skipped: into.skipped, errors: into.errors };
  if (!spans.length) return fail({ text: `This ${format} file has no spans with times${into.skipped ? `: ${into.skipped} had no usable start or length` : " in it"}.` });
  return { spans, format, orphans, skipped: into.skipped, errors: [] };
}

type Read = ReturnType<typeof readSpans>;

/** A trace as a system, with what was read and changed in notes; the requests' times come along for checking. */
export function readTrace(text: string, name = "My system", by: Grouping = "service") {
  return systemOf(readSpans(text), name, by);
}

function systemOf(r: Read, name: string, by: Grouping): Imported & { format: TraceFormat | null; red: Reduced | null; p50: number; p95: number; work: number; requests: number } {
  const none = { guesses: [], notes: [], red: null, p50: 0, p95: 0, work: 0, requests: 0 };
  if (r.errors.length) return { ...none, doc: null, errors: r.errors, format: r.format };
  const red = reduce(r.spans, by);
  if (!red) return { ...none, doc: null, errors: [{ text: "No request starts in this file: every span's parent is missing. Export whole traces." }], format: r.format };
  const out = toDoc(red.graph, serviceName(name) || "My system");
  const errors = out.doc ? validate(out.doc).filter((i) => i.level === "error").map((i) => ({ text: i.text })) : [];
  const read = [
    `Read ${red.requests === 1 ? "one request" : `${red.requests} requests`} (${r.spans.length} spans) from ${r.format === "OpenTelemetry" ? "an" : "a"} ${r.format} file${red.seconds >= 1 ? `, over ${msText(red.seconds * 1000)}` : ""}. Only the names of services and operations were kept, with numbers, IDs, emails and addresses taken out; nothing was uploaded.`,
  ];
  if (r.orphans) read.push(`${r.orphans} ${r.orphans === 1 ? "span's parent wasn't" : "spans' parents weren't"} in the file; each is read as where a request starts.`);
  if (r.skipped) read.push(`${r.skipped} ${r.skipped === 1 ? "span had" : "spans had"} no usable times and ${r.skipped === 1 ? "was" : "were"} left out.`);
  return {
    doc: errors.length ? null : out.doc,
    guesses: red.guessed,
    notes: [...read, ...red.notes, ...out.notes],
    errors: [...out.errors, ...errors],
    format: r.format,
    red,
    p50: red.p50,
    p95: red.p95,
    work: red.work,
    requests: red.requests,
  };
}

/** A trace opened as a system grouped one way: sized to start healthy, its notes, and its replay. */
export interface TraceView {
  doc: SystemDoc;
  notes: string[];
  replay: Replay;
  by: Grouping;
}

/**
 * A trace file, read once: its spans scrubbed and numbered (the file's text is let go), ready to be drawn grouped by
 * service, prefix or kind. Each grouping is worked out the first time it is asked for. Nothing here is saved or sent.
 */
export interface TraceSession {
  format: TraceFormat;
  requests: number;
  spans: number;
  /** What it would be drawn as, grouped this way: at once, before anything runs. */
  preview(by: Grouping): Preview;
  view(by: Grouping): Promise<TraceView | { errors: ReadError[] }>;
}

/** The parts a grouping makes, what each is taken for and how many of the file's it stands for, and the notes. */
export interface Preview {
  parts: { name: string; kind: PartKind; merged?: number }[];
  notes: string[];
}

/** Read a trace file into a session, or say what was wrong with it. */
export function readSession(text: string, name = "My system"): { session: TraceSession | null; errors: ReadError[] } {
  const r = readSpans(text);
  if (r.errors.length) return { session: null, errors: r.errors };
  const first = systemOf(r, name, "service");
  if (!first.doc || first.errors.length) return { session: null, errors: first.errors };
  const views = new Map<Grouping, Promise<TraceView | { errors: ReadError[] }>>();
  const previews = new Map<Grouping, Preview>();
  return {
    session: {
      format: r.format!,
      requests: first.requests,
      spans: r.spans.length,
      preview: (by) => {
        if (previews.has(by)) return previews.get(by)!;
        const x = by === "service" ? first : systemOf(r, name, by);
        const p: Preview = {
          parts: (x.doc?.parts ?? []).filter((p) => p.kind !== "users").map((p) => ({ name: p.name, kind: p.kind, ...(x.red?.merged[p.name] ? { merged: x.red.merged[p.name] } : {}) })),
          notes: x.red?.notes.filter((n) => /drawn as one|folded into|Grouped by kind|left out/.test(n)) ?? [],
        };
        previews.set(by, p);
        return p;
      },
      view: (by) => views.get(by) ?? views.set(by, viewOf(r, name, by)).get(by)!,
    },
    errors: [],
  };
}

async function viewOf(read: Read, name: string, by: Grouping): Promise<TraceView | { errors: ReadError[] }> {
  const r = systemOf(read, name, by);
  if (!r.doc || r.errors.length || !r.red) return { errors: r.errors };
  // What working means, from the trace: half again its slowest 1 in 20, when that is past the usual target.
  let doc = r.doc;
  const target = Math.min(10000, Math.ceil((r.p95 * 1.5) / 100) * 100);
  const notes = [...r.notes, ...guessNote(r.guesses)];
  if (r.p95 > doc.targets.p95Ms) {
    doc = { ...doc, targets: { ...doc.targets, p95Ms: target } };
    notes.push(`In the trace, 95 in 100 requests were answered within ${msText(r.p95)}, so working means answered within ${msText(target)}. Set your own under “Working means”.`);
  }
  const s = await sized(doc);
  notes.push(...s.notes);
  // How close the drawing runs to what the trace measured: the work each request does (so how busy each part is), and
  // how long requests take, which it can't match (every request takes every arrow, one call at a time, along wires
  // slow enough to watch). The replay runs each request its own way.
  const m = r.requests > 1 ? await measure(s.doc) : null;
  if (m && m.p50 > 0) {
    notes.splice(
      1,
      0,
      `How close it runs: each request does ${msText(m.work)} of work across the parts, against ${msText(r.work)} in the trace. Its requests take longer (half within ${msText(m.p50)}, against ${msText(r.p50)}): each takes every arrow, one call at a time, along wires slow enough to watch.`,
    );
  }
  const replay = await replayOf(read.spans, r.red, s.doc, compile(s.doc) as Compiled);
  notes.splice(m && m.p50 > 0 ? 2 : 1, 0, ...replay.second.notes);
  return { doc: s.doc, notes, replay, by };
}

/** Open a trace file as a running system: read, sized to start healthy, and its times checked against the trace's. */
export async function openTrace(text: string, name?: string, by: Grouping = "service"): Promise<{ doc: SystemDoc | null; notes: string[]; errors: ReadError[]; replay?: Replay }> {
  const { session, errors } = readSession(text, name);
  if (!session) return { doc: null, notes: [], errors };
  const v = await session.view(by);
  return "errors" in v ? { doc: null, notes: [], errors: v.errors } : { doc: v.doc, notes: v.notes, errors: [], replay: v.replay };
}
