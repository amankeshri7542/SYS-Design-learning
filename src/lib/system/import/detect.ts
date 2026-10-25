// What pasted text most likely is, on its own so the import box can say it as someone types without loading the
// readers (they load when the text is opened).

export type Format = "arrows" | "csv" | "json" | "compose";

export const FORMATS: Record<Format, string> = {
  arrows: "arrows",
  csv: "CSV of calls",
  json: "System Lab file",
  compose: "docker-compose file",
};

/** What the text most likely is. */
export function detect(text: string): Format {
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) return "json";
  if (/^services\s*:/m.test(t)) return "compose";
  if (/->|→|=>/.test(t)) return "arrows";
  const first = t.split("\n").find((l) => l.trim() && !l.trim().startsWith("#")) ?? "";
  return first.includes(",") ? "csv" : "arrows";
}
