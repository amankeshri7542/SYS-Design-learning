import type { Frame, Node, Entity } from "./engine";
export type InspectionField = { label: string; value: string; meaning: string };
export type Inspection = {
  title: string;
  summary: string;
  fields: InspectionField[];
  change?: Frame;
};
export function describeItem(
  item: Node | Entity,
  frame: Frame,
  frames: Frame[],
  lesson: string,
): Inspection {
  const fields: InspectionField[] = [];
  const put = (label: string, value: unknown, meaning: string) => {
    if (value !== undefined)
      fields.push({ label, value: String(value), meaning });
  };
  if ("label" in item) {
    put("Observed health", item.health, item.status);
    put(
      "Example implementation",
      item.aws,
      "An explanatory mapping; no resource is running here.",
    );
    put(
      "Role",
      item.detail,
      "State observed by this component in the selected event.",
    );
  } else {
    put(
      "Current value",
      item.value,
      "The value stored or returned at this event.",
    );
    put(
      "Lifecycle state",
      item.state,
      `Currently at ${frame.world.nodes.find((n) => n.id === item.location)?.label || item.location}.`,
    );
    put(
      "Version",
      item.version,
      "A later version represents a newer committed value.",
    );
    put(
      "Expires at",
      item.expires === undefined ? undefined : `${item.expires}s`,
      `Simulation time is ${frame.world.time}s; expired entries cannot serve a fresh hit.`,
    );
    put(
      "Receive attempts",
      item.attempts,
      "Repeated delivery attempts are separate from unique business effects.",
    );
    put(
      "Available at",
      item.available === undefined ? undefined : `${item.available}s`,
      "The next visibility or scheduling boundary.",
    );
    put(
      "Owner",
      item.owner,
      "The exact destination chosen by the partition or clockwise ring rule.",
    );
    if (item.owner)
      put(
        "Original owner",
        frames[0]?.world.entities.find((e) => e.id === item.id)?.owner,
        "Compare before and after membership using actual ownership.",
      );
    put(
      "Position",
      item.position === undefined ? undefined : `${item.position}°`,
      "Clockwise lookup wraps through 360° to the next node position.",
    );
    put(
      "Operation",
      item.operation,
      "Stable identity used to reason about duplicate side effects.",
    );
    put(
      "Grouping key",
      item.group,
      lesson === "ordering"
        ? "FIFO ordering applies inside this group, not across all groups."
        : lesson === "pubsub"
          ? "Identifies an independent subscriber, not a FIFO guarantee."
          : lesson === "event-streams"
            ? "Identifies an ordered stream shard."
            : "Groups deliveries for this example; this does not imply FIFO ordering.",
    );
  }
  const collection = "label" in item ? "nodes" : "entities";
  let change: Frame | undefined;
  for (let i = 1; i <= frame.event.id; i++) {
    const current = frames[i]?.world[collection].find((e) => e.id === item.id);
    const previous = frames[i - 1]?.world[collection].find(
      (e) => e.id === item.id,
    );
    if (current && JSON.stringify(current) !== JSON.stringify(previous))
      change = frames[i];
  }
  return {
    title: "label" in item ? item.label : item.id,
    summary:
      "label" in item
        ? item.detail
        : `${item.kind} · ${item.state}. Inspect the value and the event that last changed it.`,
    fields,
    change,
  };
}
