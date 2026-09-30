import { runExperiment, makeConfig } from "./engine";
import { getLesson } from "./lessons";
import { getConcept, type Concept } from "./catalog";
export type SimulationInput = {
  conceptId: string;
  traffic: number;
  replicas: number;
  parameter: number;
};
export type Control = {
  label: string;
  min: number;
  max: number;
  step: number;
  initial: number;
  unit: string;
};
const control = (
  label: string,
  min: number,
  max: number,
  initial: number,
  unit = "%",
  step = 1,
): Control => ({ label, min, max, initial, unit, step });
export function getControl(concept: Concept): Control {
  switch (concept.id) {
    case "cache-aside":
    case "ttl":
      return control("Cache TTL", 5, 120, 60, "s", 5);
    case "eviction":
      return control("Cache capacity", 10, 200, 80, "keys", 10);
    case "stampede":
      return control("Requests per hot key", 1, 100, 40, "req");
    case "invalidation":
    case "eventual-consistency":
    case "cqrs":
      return control("Propagation delay", 10, 500, 100, "ms", 10);
    case "connection-pooling":
      return control("Connection pool", 5, 100, 30, "conn", 5);
    case "vertical-scaling":
      return control("Capacity per instance", 100, 2000, 500, "req/s", 100);
    case "autoscaling":
      return control("Scale-out delay", 5, 120, 30, "s", 5);
    case "timeouts":
      return control("Request deadline", 10, 200, 80, "ms", 5);
    case "data-lifecycle":
      return control("Object age", 1, 365, 120, "days");
    case "disaster-recovery":
      return control("Backup age", 1, 60, 15, "min");
    case "object-storage":
      return control("Object size", 1, 100, 10, "MB");
    case "batching":
      return control("Batch size", 1, 10, 5, "msg");
    case "ordering":
      return control("Message groups", 1, 20, 4, "groups");
    case "event-sourcing":
      return control("History length", 10, 1000, 200, "events", 10);
    case "distributed-locks":
      return control("Worker pause", 1, 60, 20, "s");
    case "health-checks":
    case "multi-az":
      return control("Failed capacity", 0, 75, 25);
    case "canary":
    case "blue-green":
      return control("New version traffic", 0, 100, 10);
    case "secrets":
      return control("Credential cache age", 1, 120, 30, "min");
    case "replication":
      return control("Replica lag", 0, 500, 50, "ms", 10);
    case "strong-consistency":
      return control("Strong read share", 0, 100, 100);
    case "consistent-hashing":
      return control("Existing ring nodes", 2, 20, 5, "nodes");
    case "circuit-breaker":
    case "retries":
    case "dead-letter":
    case "sagas":
      return control("Dependency failure rate", 0, 80, 20);
    case "authentication":
    case "authorization":
    case "encryption":
    case "network-isolation":
    case "edge-protection":
      return control("Unauthorized traffic", 0, 80, 20);
    case "optimistic-locking":
    case "transactions":
      return control("Write contention", 0, 80, 20);
    case "write-through":
    case "write-behind":
    case "denormalization":
      return control("Write traffic", 0, 100, 30);
    case "idempotency":
      return control("Duplicate deliveries", 0, 80, 20);
    case "observability":
      return control("Trace sampling", 1, 100, 25);
    case "event-routing":
      return control("Matching events", 0, 100, 40);
    case "cap":
      return control("Partitioned traffic", 0, 80, 30);
    default:
      return control(
        concept.group === "caching"
          ? "Cacheable requests"
          : "Target utilization",
        10,
        95,
        80,
      );
  }
}
export function validateInput(value: unknown): SimulationInput {
  if (!value || typeof value !== "object")
    throw new Error("Send a simulation configuration.");
  const input = value as SimulationInput;
  const concept = getConcept(input.conceptId);
  if (!concept) throw new Error("Choose a known concept.");
  const c = getControl(concept);
  if (
    ![input.traffic, input.replicas, input.parameter].every(Number.isFinite) ||
    !Number.isInteger(input.traffic) ||
    input.traffic < 50 ||
    input.traffic > 2000 ||
    !Number.isInteger(input.replicas) ||
    input.replicas < 1 ||
    input.replicas > 8 ||
    input.parameter < c.min ||
    input.parameter > c.max
  )
    throw new Error("Parameters are outside the supported range.");
  return {
    conceptId: concept.id,
    traffic: input.traffic,
    replicas: input.replicas,
    parameter: input.parameter,
  };
}
// Compatibility adapter for the original endpoint/progress envelope. The UI uses v2 directly.
// The old primary range maps proportionally to the first relevant lesson control.
export function simulate(raw: SimulationInput) {
  const input = validateInput(raw),
    config = makeConfig(input.conceptId);
  const old = getControl(getConcept(input.conceptId)!),
    knobs = getLesson(input.conceptId).controls;
  const primary = knobs[0];
  config.values[primary.key] = Math.round(
    primary.min +
      ((input.parameter - old.min) / (old.max - old.min)) *
        (primary.max - primary.min),
  );
  for (const knob of knobs) {
    if (["replicas", "workers", "readers"].includes(knob.key))
      config.values[knob.key] = Math.min(
        knob.max,
        Math.max(knob.min, input.replicas),
      );
    if (knob.key === "rate")
      config.values.rate = Math.min(
        knob.max,
        Math.max(knob.min, Math.round(input.traffic / 200)),
      );
  }
  return runExperiment(config);
}
