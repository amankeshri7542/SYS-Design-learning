// Reading a system someone already has, from text: a few lines of arrows, a CSV of calls, a System Lab file, or a
// docker-compose file. Everything is read here, in the browser; nothing is uploaded. Each reader returns what it read
// as a graph (`graph.ts`) or says, by line, what it couldn't read.

import { KINDS, normalize, validate, type PartKind } from "../doc";
import { toDoc, type Graph, type GraphNode, type Imported, type ReadError } from "./graph";
import { detect, type Format } from "./detect";
import { kindFromImage, kindFromName } from "./infer";

export { FORMATS, detect, type Format } from "./detect";

/** Read text in the format it seems to be (or the one named), into a system. */
export function readSystem(text: string, format: Format = detect(text), name = "My system"): Imported & { format: Format } {
  const read = format === "json" ? readJson(text) : format === "compose" ? readCompose(text) : format === "csv" ? readCsv(text) : readArrows(text);
  if ("doc" in read) return { ...read, format };
  if (read.errors.length) return { doc: null, guesses: [], notes: [], errors: read.errors, format };
  const out = toDoc(read.graph, name);
  // Anything still wrong is said the way the builder says it.
  const errors = out.doc ? validate(out.doc).filter((i) => i.level === "error").map((i) => ({ text: i.text })) : [];
  return { ...out, errors: [...out.errors, ...errors], doc: errors.length ? null : out.doc, format };
}

type Read = { graph: Graph; errors: ReadError[] } | Imported;

// ------------------------------------------------------------------------------------------------ arrows

/** "[database]", "[db]": a kind named in brackets. */
function kindWord(word: string): PartKind | null {
  const w = word.trim().toLowerCase();
  if (w in KINDS) return w as PartKind;
  const named = (Object.keys(KINDS) as PartKind[]).find((k) => KINDS[k].name.toLowerCase() === w);
  if (named) return named;
  const guess = kindFromName(w);
  return guess !== "service" || /^(service|app|server|api)s?$/.test(w) ? guess : null;
}

/**
 * Lines of names joined by arrows: `Users -> LB -> API x3 -> Redis -> Postgres`. A name may carry copies (`x3`), a kind
 * in brackets (`Orders [database]`), a rate (`Users (120/s)`) and its work (`API 40ms`); commas send to several
 * (`API -> Redis, Stripe`). `#` starts a comment.
 */
export function readArrows(text: string): Read {
  const nodes = new Map<string, GraphNode>();
  const edges: [string, string][] = [];
  const errors: ReadError[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(/\s(#|\/\/).*$/, "").replace(/^(#|\/\/).*$/, "").trim();
    if (!line) return;
    const steps = line.split(/\s*(?:-+>|→|=>)\s*/);
    const groups: string[][] = [];
    for (const step of steps) {
      if (!step.trim()) {
        errors.push({ line: i + 1, text: `Line ${i + 1}: there's nothing ${groups.length ? "after an arrow" : "before the first arrow"}.` });
        return;
      }
      const names: string[] = [];
      for (const piece of step.split(/\s*,\s*/)) {
        let s = piece.trim();
        const node: GraphNode = { name: "" };
        const bracket = s.match(/\[([^\]]+)\]/);
        if (bracket) {
          const k = kindWord(bracket[1]);
          if (!k) {
            errors.push({ line: i + 1, text: `Line ${i + 1}: “[${bracket[1]}]” isn't a kind System Lab knows. Try service, database, cache, queue, topic, worker or balancer.` });
            return;
          }
          node.kind = k;
          s = s.replace(bracket[0], " ");
        }
        const rate = s.match(/\(?\s*(\d+(?:\.\d+)?)\s*(?:\/\s*s|rps|per second|a second)\s*\)?/i);
        if (rate) {
          node.rate = Number(rate[1]);
          s = s.replace(rate[0], " ");
        }
        const work = s.match(/\b(\d+(?:\.\d+)?)\s*ms\b/i);
        if (work) {
          node.ms = Number(work[1]);
          s = s.replace(work[0], " ");
        }
        const copies = s.match(/(?:\s[x×*]\s*(\d+)|\s(\d+)\s*[x×])\s*$/i);
        if (copies) {
          node.count = Number(copies[1] ?? copies[2]);
          s = s.slice(0, copies.index);
        }
        node.name = s.replace(/\s+/g, " ").trim();
        if (!node.name) {
          errors.push({ line: i + 1, text: `Line ${i + 1}: a part needs a name, as well as its numbers.` });
          return;
        }
        const had = nodes.get(node.name);
        nodes.set(node.name, { ...had, ...Object.fromEntries(Object.entries(node).filter(([, v]) => v !== undefined)), name: node.name });
        names.push(node.name);
      }
      groups.push(names);
    }
    for (let j = 1; j < groups.length; j++) for (const a of groups[j - 1]) for (const b of groups[j]) edges.push([a, b]);
  });
  if (!errors.length && !nodes.size) errors.push({ text: "Write one part per name, joined by arrows: Users -> API -> Database." });
  return { graph: { nodes: [...nodes.values()], edges }, errors };
}

// ------------------------------------------------------------------------------------------------ CSV

/** `from,to,rps,latency_ms`: one call per row. A header names the columns; without one, they're in that order. */
export function readCsv(text: string): Read {
  const rows = text
    .split("\n")
    .map((l, i) => ({ i: i + 1, cells: l.split(",").map((c) => c.trim().replace(/^"(.*)"$/, "$1")) }))
    .filter((r) => r.cells.some(Boolean) && !r.cells[0].startsWith("#"));
  const errors: ReadError[] = [];
  let cols = { from: 0, to: 1, rps: 2, ms: 3 };
  const head = rows[0]?.cells.map((c) => c.toLowerCase());
  if (head && head.some((c) => /^(from|source|caller|to|target|callee)$/.test(c))) {
    const at = (re: RegExp) => head.findIndex((c) => re.test(c));
    cols = { from: at(/^(from|source|caller)$/), to: at(/^(to|target|callee|destination)$/), rps: at(/rps|rate|per.?s|calls/), ms: at(/ms|latency|duration|time/) };
    rows.shift();
    if (cols.from < 0 || cols.to < 0) errors.push({ line: 1, text: "Line 1: the header needs a “from” and a “to” column." });
  }
  const nodes = new Map<string, GraphNode>();
  const edges: [string, string][] = [];
  for (const r of rows) {
    const from = r.cells[cols.from];
    const to = r.cells[cols.to];
    if (!from || !to) {
      errors.push({ line: r.i, text: `Line ${r.i}: needs two names, who calls and who answers.` });
      continue;
    }
    const num = (k: "rps" | "ms") => {
      const v = cols[k] >= 0 ? r.cells[cols[k]] : "";
      if (!v) return undefined;
      const n = Number(v.replace(/[^\d.]/g, ""));
      if (!/\d/.test(v) || !Number.isFinite(n) || n < 0) errors.push({ line: r.i, text: `Line ${r.i}: “${v}” isn't a number of ${k === "rps" ? "requests a second" : "milliseconds"}.` });
      return n;
    };
    const rps = num("rps");
    const ms = num("ms");
    const a = nodes.get(from) ?? { name: from };
    if (rps) a.rate = (a.rate ?? 0) + rps;
    nodes.set(from, a);
    const b = nodes.get(to) ?? { name: to };
    if (ms) b.ms = Math.max(b.ms ?? 0, ms);
    nodes.set(to, b);
    edges.push([from, to]);
  }
  // A rate belongs to whoever starts the traffic: on anything else it was only an edge's count.
  for (const n of nodes.values()) if (edges.some(([, b]) => b === n.name)) delete n.rate;
  return { graph: { nodes: [...nodes.values()], edges }, errors };
}

// ------------------------------------------------------------------------------------------------ JSON

/** A System Lab file, or a list of calls `[{ "from": "Web", "to": "DB" }]`. */
export function readJson(text: string): Read {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    const at = String((e as Error).message).match(/position (\d+)/);
    const line = at ? text.slice(0, Number(at[1])).split("\n").length : undefined;
    return { graph: { nodes: [], edges: [] }, errors: [{ line, text: `${line ? `Line ${line}: ` : ""}this isn't valid JSON (${(e as Error).message.replace(/ in JSON.*$/, "")}).` }] };
  }
  if (Array.isArray(data)) {
    const edges = data.flatMap((d) => (d && typeof d === "object" && "from" in d && "to" in d ? [[String((d as { from: unknown }).from), String((d as { to: unknown }).to)] as [string, string]] : []));
    if (!edges.length) return { graph: { nodes: [], edges: [] }, errors: [{ text: "A list should hold calls like { \"from\": \"Web\", \"to\": \"Database\" }." }] };
    return { graph: { nodes: [], edges }, errors: [] };
  }
  const doc = normalize(data);
  if (!doc) return { graph: { nodes: [], edges: [] }, errors: [{ text: "This JSON isn't a System Lab system: it should start { \"v\": 1, \"parts\": [ … ] }." }] };
  const errors = validate(doc).filter((i) => i.level === "error").map((i) => ({ text: i.text }));
  return { doc: errors.length ? null : doc, guesses: [], notes: [], errors };
}

// ------------------------------------------------------------------------------------------------ YAML (a subset)

type Yaml = string | number | boolean | null | Yaml[] | { [k: string]: Yaml };

/**
 * The part of YAML compose files use: maps, lists, scalars, quotes, comments, flow lists (`[a, b]`) and block text
 * (`|`, skipped). Anchors and merges aren't read: the error says so, by line.
 */
export function parseYaml(text: string): { value: Yaml; errors: ReadError[] } {
  const errors: ReadError[] = [];
  const lines = text.split("\n").map((raw, i) => ({ i: i + 1, raw }));
  const scalar = (s: string): Yaml => {
    const t = s.trim();
    if (!t || t === "~" || t === "null") return null;
    if (/^["'].*["']$/.test(t)) return t.slice(1, -1);
    if (t.startsWith("[") && t.endsWith("]")) return t.slice(1, -1).split(",").map((x) => scalar(x)).filter((x) => x !== null);
    if (t === "true" || t === "false") return t === "true";
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    return t;
  };
  const items = lines
    .map(({ i, raw }) => {
      if (/\t/.test(raw.match(/^\s*/)![0])) errors.push({ line: i, text: `Line ${i}: indent with spaces, not tabs.` });
      const text = raw.replace(/(^|\s)#.*$/, "").trimEnd();
      if (/(^|\s)[&*][\w-]+|<<:/.test(text)) errors.push({ line: i, text: `Line ${i}: anchors and merges (& * <<) aren't read here; paste the file with them written out.` });
      return { i, indent: text.length - text.trimStart().length, text: text.trim() };
    })
    .filter((l) => l.text);
  let k = 0;
  const block = (indent: number): Yaml => {
    if (k >= items.length) return null;
    if (items[k].text.startsWith("- ") || items[k].text === "-") {
      const list: Yaml[] = [];
      while (k < items.length && items[k].indent === indent && (items[k].text.startsWith("- ") || items[k].text === "-")) {
        const rest = items[k].text.slice(1).trim();
        const at = items[k].indent;
        k++;
        if (!rest) list.push(k < items.length && items[k].indent > at ? block(items[k].indent) : null);
        else if (/^[\w.-]+\s*:(\s|$)/.test(rest)) {
          // A map inside a list item: its first key is on the dash's line.
          items.splice(k, 0, { i: items[k - 1].i, indent: at + 2, text: rest });
          list.push(block(at + 2));
        } else list.push(scalar(rest));
      }
      return list;
    }
    const map: { [key: string]: Yaml } = {};
    while (k < items.length && items[k].indent === indent) {
      const m = items[k].text.match(/^("[^"]+"|'[^']+'|[^:]+?)\s*:(?:\s+(.*))?$/);
      if (!m) {
        errors.push({ line: items[k].i, text: `Line ${items[k].i}: expected “name: value”.` });
        k++;
        continue;
      }
      const key = m[1].replace(/^["']|["']$/g, "");
      const value = m[2];
      const at = items[k].indent;
      k++;
      if (value === "|" || value === ">" || value === "|-" || value === ">-") {
        while (k < items.length && items[k].indent > at) k++;
        map[key] = "";
      } else if (value !== undefined && value !== "") map[key] = scalar(value);
      else map[key] = k < items.length && items[k].indent > at ? block(items[k].indent) : null;
    }
    return map;
  };
  const value = items.length ? block(items[0].indent) : null;
  if (k < items.length) errors.push({ line: items[k].i, text: `Line ${items[k].i}: this line's indent doesn't match the lines before it.` });
  return { value, errors };
}

/** A docker-compose file: each service a part (its image says what it is), `depends_on` its arrows, `ports` its door. */
export function readCompose(text: string): Read {
  const { value, errors } = parseYaml(text);
  if (errors.length) return { graph: { nodes: [], edges: [] }, errors };
  const services = value && typeof value === "object" && !Array.isArray(value) ? value.services : null;
  if (!services || typeof services !== "object" || Array.isArray(services)) return { graph: { nodes: [], edges: [] }, errors: [{ text: "This compose file has no “services:” map to read." }] };
  const nodes: GraphNode[] = [];
  const edges: [string, string][] = [];
  for (const [name, raw] of Object.entries(services)) {
    const s = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const image = typeof s.image === "string" ? s.image : "";
    const node: GraphNode = { name, kind: (image && kindFromImage(image)) || undefined };
    const replicas = (s.deploy as { replicas?: unknown } | undefined)?.replicas;
    if (typeof replicas === "number" && replicas > 1) node.count = replicas;
    if (s.ports) node.public = true;
    nodes.push(node);
    const deps = Array.isArray(s.depends_on) ? s.depends_on : s.depends_on && typeof s.depends_on === "object" ? Object.keys(s.depends_on) : [];
    for (const d of deps) edges.push([name, String(d)]);
    for (const l of Array.isArray(s.links) ? s.links : []) edges.push([name, String(l).split(":")[0]]);
  }
  const missing = edges.filter(([, b]) => !(b in services));
  for (const [a, b] of missing) errors.push({ text: `${a} depends on “${b}”, which isn't a service in this file.` });
  return { graph: { nodes, edges: edges.filter((e) => !missing.includes(e)) }, errors };
}
