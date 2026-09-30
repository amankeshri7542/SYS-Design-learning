import { getConcept } from "./catalog";
export const PROGRESS_KEY = "system-lab-progress-v2";
export const LEGACY_KEY = "system-lab-progress-v1";
export type Progress = { version: 2; explored: string[]; understood: string[] };
export const emptyProgress = (): Progress => ({
  version: 2,
  explored: [],
  understood: [],
});
export function parseProgress(raw: unknown): Progress {
  const ids = (value: unknown) =>
    Array.isArray(value)
      ? [
          ...new Set(
            value.filter(
              (id): id is string => typeof id === "string" && !!getConcept(id),
            ),
          ),
        ]
      : [];
  // Legacy completion did not prove understanding. Never upgrade it silently.
  if (Array.isArray(raw))
    return { version: 2, explored: ids(raw), understood: [] };
  if (
    !raw ||
    typeof raw !== "object" ||
    (raw as Progress).version !== 2 ||
    !Array.isArray((raw as Progress).explored) ||
    !Array.isArray((raw as Progress).understood)
  )
    throw new Error(
      "Unrecognized progress format. Existing storage was left unchanged.",
    );
  const p = raw as Progress,
    understood = ids(p.understood);
  return {
    version: 2,
    explored: [...new Set([...ids(p.explored), ...understood])],
    understood,
  };
}
export function readProgress(
  storage: Pick<Storage, "getItem" | "setItem">,
  account = "guest",
): Progress {
  const key = account === "guest" ? PROGRESS_KEY : `${PROGRESS_KEY}:${account}`;
  const raw = storage.getItem(key);
  if (raw) return parseProgress(JSON.parse(raw));
  if (account !== "guest") return emptyProgress();
  const legacy = storage.getItem(LEGACY_KEY);
  if (!legacy) return emptyProgress();
  const migrated = parseProgress(JSON.parse(legacy));
  storage.setItem(key, JSON.stringify(migrated));
  return migrated;
}
export function saveProgress(
  storage: Pick<Storage, "setItem">,
  progress: Progress,
  account = "guest",
) {
  storage.setItem(
    account === "guest" ? PROGRESS_KEY : `${PROGRESS_KEY}:${account}`,
    JSON.stringify(parseProgress(progress)),
  );
}
export function markProgress(
  progress: Progress,
  id: string,
  understood = false,
): Progress {
  if (!getConcept(id)) throw new Error("Unknown lesson.");
  return {
    version: 2,
    explored: [...new Set([...progress.explored, id])],
    understood: understood
      ? [...new Set([...progress.understood, id])]
      : progress.understood,
  };
}
export function mergeCloud(progress: Progress, raw: unknown): Progress {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray((raw as { items: unknown }).items)
  )
    throw new Error("Cloud returned an invalid progress response.");
  const items = (raw as { items: unknown[] }).items;
  if (
    items.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        typeof (item as { conceptId: unknown }).conceptId !== "string" ||
        !getConcept((item as { conceptId: string }).conceptId),
    )
  )
    throw new Error("Cloud returned an invalid lesson record.");
  return {
    ...progress,
    explored: [
      ...new Set([
        ...progress.explored,
        ...items.map((item) => (item as { conceptId: string }).conceptId),
      ]),
    ],
  };
}
