import type { Knob } from "./lessons";

export type ControlPresentation =
  | { kind: "switch"; label: string }
  | { kind: "choice"; label: string; options: readonly [string, string] }
  | { kind: "count" | "quantity"; label: string };

const choices: Record<string, ControlPresentation> = {
  "eviction.policy": {
    kind: "choice",
    label: "Eviction policy",
    options: ["Least recently used", "Least frequently used"],
  },
  "stampede.coalesce": { kind: "switch", label: "Coalesce concurrent reads" },
  "indexing.indexed": { kind: "switch", label: "Use an index" },
  "transactions.fail": { kind: "switch", label: "Reject the transfer" },
  "idempotency.enabled": { kind: "switch", label: "Deduplicate deliveries" },
  "authorization.allow": {
    kind: "switch",
    label: "Allow reading owned records",
  },
  "encryption.allow": { kind: "switch", label: "Allow decryption" },
  "network-isolation.public": {
    kind: "switch",
    label: "Allow public database access",
  },
  "network-isolation.app": {
    kind: "switch",
    label: "Allow application ingress",
  },
  "edge-protection.enforce": {
    kind: "choice",
    label: "Rule action",
    options: ["Count matches", "Block matches"],
  },
  "strong-consistency.strong": {
    kind: "choice",
    label: "Read consistency",
    options: ["Eventual", "Strong"],
  },
  "cap.available": {
    kind: "choice",
    label: "Partition policy",
    options: ["Reject uncoordinated reads", "Serve the local copy"],
  },
  "sagas.fail": {
    kind: "choice",
    label: "Fulfillment result",
    options: ["Success", "Failure"],
  },
};
export function controlPresentation(
  lesson: string,
  knob: Knob,
): ControlPresentation {
  return (
    choices[`${lesson}.${knob.key}`] || {
      kind:
        !knob.unit ||
        ["keys", "tokens", "messages", "requests"].includes(knob.unit)
          ? "count"
          : "quantity",
      label: knob.label,
    }
  );
}
