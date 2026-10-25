// Opening a trace file (Jaeger, Zipkin or OpenTelemetry JSON) as a system: its spans are read and scrubbed in the
// browser (nothing is uploaded), reduced to the services they ran through (`reduce.ts`), drawn as any import is
// (`toDoc`), sized to start healthy, and checked against the trace: the notes say how close the model's times come.
// Loaded only when a trace is opened; the file's text and IDs are dropped once it is read.

import { validate, type SystemDoc } from "../doc";
import { guessNote, toDoc, type Imported, type ReadError } from "../import/graph";
import { measure, sized } from "../import/size";
import { jaegerTraces, readJaeger } from "./jaeger";
import { otlpResources, readOtlp } from "./otlp";
import { msText, reduce } from "./reduce";
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

/** A trace as a system, with what was read and changed in notes; the requests' times come along for checking. */
export function readTrace(text: string, name = "My system"): Imported & { format: TraceFormat | null; p50: number; p95: number; work: number; requests: number } {
  const none = { guesses: [], notes: [], p50: 0, p95: 0, work: 0, requests: 0 };
  const r = readSpans(text);
  if (r.errors.length) return { ...none, doc: null, errors: r.errors, format: r.format };
  const red = reduce(r.spans);
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
    p50: red.p50,
    p95: red.p95,
    work: red.work,
    requests: red.requests,
  };
}

/** Open a trace file as a running system: read, sized to start healthy, and its times checked against the trace's. */
export async function openTrace(text: string, name?: string): Promise<{ doc: SystemDoc | null; notes: string[]; errors: ReadError[] }> {
  const r = readTrace(text, name);
  if (!r.doc || r.errors.length) return { doc: null, notes: [], errors: r.errors };
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
  // How close the model comes to what the trace measured: the work each request does (so how busy each part is), and
  // how long requests take, which the model can't match (every request takes every arrow, one call at a time, along
  // wires slow enough to watch).
  const m = r.requests > 1 ? await measure(s.doc) : null;
  if (m && m.p50 > 0) {
    notes.splice(
      1,
      0,
      `How close it runs: each request does ${msText(m.work)} of work across the parts, against ${msText(r.work)} in the trace. Its requests take longer (half within ${msText(m.p50)}, against ${msText(r.p50)}): each takes every arrow, one call at a time, along wires slow enough to watch.`,
    );
  }
  return { doc: s.doc, notes, errors: [] };
}
