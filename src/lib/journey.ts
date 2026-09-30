import { makeConfig, Timeline, sample, type Frame } from "./engine/model";
import { cache, queue } from "./engine/traffic";
import {
  allowCircuitCall,
  createCircuitState,
  recordCircuitResult,
} from "./engine/circuit-policy";

export const journeyStages = [
  {
    title: "Start with one app",
    problem:
      "A product read and an order share one application and one database.",
    benefit: "A short path is easy to understand and operate.",
    limit: "Every read reaches the database.",
    failure: "The single application or database can stop the whole operation.",
    lessons: ["transactions", "object-storage"],
  },
  {
    title: "Add a cache",
    problem: "Popular products repeatedly trigger the same database reads.",
    benefit: "A warm product key skips the database.",
    limit: "A cache hit can be stale; misses still need the database.",
    failure: "An expired key during a database outage cannot refresh.",
    lessons: ["cache-aside", "ttl", "invalidation"],
  },
  {
    title: "Balance & replicate",
    problem: "One application and one reader cannot handle growing traffic.",
    benefit:
      "Route to a healthy app; eligible product reads can use a replica.",
    limit: "Replication lags; orders still commit at the writer.",
    failure: "A recent write may not be visible on the replica.",
    lessons: ["load-balancing", "replication", "health-checks"],
  },
  {
    title: "Move work to a queue",
    problem: "Sending email keeps an order request waiting.",
    benefit: "Accept the order durably and let a worker notify asynchronously.",
    limit: "A 202 response means notification work remains pending.",
    failure: "A stalled worker grows a backlog after acceptance.",
    lessons: ["queues", "backpressure", "write-behind"],
  },
  {
    title: "Make delivery safe",
    problem:
      "A retry can repeat effects; a poison message can block useful work.",
    benefit:
      "Stable IDs suppress duplicate effects, bounded retries isolate poison work in a DLQ.",
    limit:
      "Deduplication and the effect must commit together; DLQ redrive needs repair.",
    failure: "A permanent notification error exhausts the receive budget.",
    lessons: ["idempotency", "retries", "dead-letter"],
  },
  {
    title: "Contain an outage",
    problem: "A failing provider attracts repeated calls and ties up workers.",
    benefit:
      "A circuit breaker limits repeated failures, waits, then permits one recovery probe.",
    limit:
      "A breaker does not fix the provider; accepted work can remain pending.",
    failure:
      "A failed half-open probe reopens the circuit; repairing the provider does not redrive isolated work.",
    lessons: ["circuit-breaker", "bulkheads", "timeouts"],
  },
] as const;
export type Operation = "read" | "order" | "notification";
export type JourneyOptions = {
  cache: "cold" | "warm" | "expired";
  source: "healthy" | "unavailable";
  worker: "healthy" | "stopped" | "recover";
  processing: "healthy" | "failing" | "repair";
  redriveAt: number | null;
};
export const defaultJourneyOptions: JourneyOptions = {
  cache: "cold",
  source: "healthy",
  worker: "healthy",
  processing: "healthy",
  redriveAt: null,
};
export type JourneyFrame = {
  time: number;
  title: string;
  why: string;
  path: string[];
  accepted: number;
  completed: number;
  pending: number;
  dead: number;
  state: string;
  health: "healthy" | "waiting" | "degraded" | "failed" | "recovering";
  evidence?: { lesson: string; event: number; type: string; entity?: string };
  detail?: string;
  circuit?: string;
};

/** A one-operation projection of the same cache and queue mechanisms as lessons. */
export function journeyTrace(
  stage: number,
  operation: Operation,
  input: JourneyOptions | boolean = defaultJourneyOptions,
): JourneyFrame[] {
  if (!Number.isInteger(stage) || stage < 0 || stage > 5)
    throw new Error("Unknown journey stage.");
  if (!["read", "order", "notification"].includes(operation))
    throw new Error("Unknown journey operation.");
  // Legacy callers can still request the old demonstration preset. The UI uses explicit inputs.
  const options: JourneyOptions =
    typeof input === "boolean"
      ? {
          ...defaultJourneyOptions,
          source: input ? "unavailable" : "healthy",
          processing: input ? (stage === 5 ? "repair" : "failing") : "healthy",
          redriveAt: input && stage === 5 ? 20 : null,
        }
      : { ...input };
  if (
    !["cold", "warm", "expired"].includes(options.cache) ||
    !["healthy", "unavailable"].includes(options.source) ||
    !["healthy", "stopped", "recover"].includes(options.worker) ||
    !["healthy", "failing", "repair"].includes(options.processing) ||
    (options.redriveAt !== null &&
      (!Number.isInteger(options.redriveAt) ||
        options.redriveAt < 1 ||
        options.redriveAt > 32))
  )
    throw new Error("Unsupported journey inputs.");
  const frames: JourneyFrame[] = [];
  const app = stage >= 2 ? "app-a" : "app";
  const entry = stage >= 2 ? ["browser", "lb", app] : ["browser", app];
  const emit = (
    value: Partial<JourneyFrame> & Pick<JourneyFrame, "title" | "why" | "path">,
  ) => {
    const previous = frames.at(-1);
    frames.push({
      time: previous?.time || 0,
      accepted: previous?.accepted || 0,
      completed: previous?.completed || 0,
      pending: previous?.pending || 0,
      dead: previous?.dead || 0,
      state: "Ready",
      health: "waiting",
      ...value,
    });
  };
  const evidence = (frame: Frame, lesson: string) => ({
    lesson,
    event: frame.event.id,
    type: frame.event.type,
    entity: frame.event.entity,
  });
  emit({
    title: "Operation ready",
    why:
      operation === "read"
        ? "Follow one product read. Cache contents and source availability are independent choices."
        : "Follow operation-42 from acceptance to its notification outcome.",
    path: operation === "notification" ? ["db"] : entry,
  });

  if (operation === "read") {
    emit({
      title: "GET /products/42",
      why:
        stage >= 2
          ? "The balancer routes this request to application A. This bounded operation assumes both apps are healthy."
          : "The application receives one product request.",
      path: entry,
      state: "Reading",
    });
    const source = stage >= 2 ? "replica" : "db";
    if (stage === 0) {
      emit({
        time: 1,
        title:
          options.source === "healthy" ? "Product returned" : "Read failed",
        why:
          options.source === "healthy"
            ? "The writer supplies product v1. This stage has no cache, so every read reaches the source."
            : "The database is unavailable. No cached value exists to satisfy the read.",
        path: [app, source, app, "browser"],
        accepted: options.source === "healthy" ? 1 : 0,
        completed: options.source === "healthy" ? 1 : 0,
        state: options.source === "healthy" ? "Completed" : "Failed",
        health: options.source === "healthy" ? "healthy" : "failed",
      });
      return frames;
    }
    const config = makeConfig("cache-aside");
    config.faults =
      options.source === "unavailable" ? [{ at: 0, active: true }] : [];
    const timeline = new Timeline(config);
    const key = `product-${1 + Math.floor(sample(config.seed, "key:1") * 6)}`;
    if (options.cache !== "cold")
      timeline.world.entities.push({
        id: key,
        kind: "cache entry",
        location: "cache",
        state: "valid",
        value: "price 21",
        version: 1,
        expires: options.cache === "warm" ? 20 : 1,
        last: 0,
        hits: 0,
      });
    cache(timeline);
    for (const frame of timeline.frames.filter((f) => f.event.time === 1)) {
      const type = frame.event.type;
      const entry = frame.world.entities.find((e) => e.id === key);
      const done = type === "hit" || type === "fill";
      emit({
        time: frame.event.time,
        title: frame.event.title,
        why: frame.event.why,
        path: frame.event.path.map((id) =>
          id === "origin" ? source : id === "app" ? app : id,
        ),
        state: type === "error" ? "Failed" : done ? "Value ready" : "Reading",
        health: type === "error" ? "failed" : done ? "healthy" : "waiting",
        evidence: evidence(frame, "cache-aside"),
        detail: entry
          ? `${key}: v${entry.version}, expires at ${entry.expires}s; ${Math.max(0, (entry.expires || 0) - frame.event.time)}s remaining.`
          : "No reusable product entry is present.",
      });
      if (done) {
        emit({
          time: 1,
          title: "Product returned",
          why:
            type === "hit"
              ? "The valid cache entry supplied v1. No source read occurred, even if the source is unavailable."
              : "The source supplied v1 and the cache stored it for the next read.",
          path:
            type === "hit"
              ? ["cache", app, "browser"]
              : [source, app, "browser"],
          accepted: 1,
          completed: 1,
          state: "Completed",
          health: "healthy",
          evidence: evidence(frame, "cache-aside"),
          detail: entry
            ? `Returned v${entry.version}; entry expires at ${entry.expires}s.`
            : "Returned v1.",
        });
        break;
      }
      if (type === "error") break;
    }
    return frames;
  }

  if (operation === "order") {
    emit({
      title: "POST /orders · operation-42",
      why: "The application validates the order before writing.",
      path: entry,
      state: "Validating",
    });
    if (options.source === "unavailable") {
      emit({
        title: "Order was not accepted",
        why: "The writer is unavailable, so neither the order nor its outbox row commits. No notification is queued.",
        path: [app, "db", app, "browser"],
        state: "Failed",
        health: "failed",
      });
      return frames;
    }
    emit({
      title: "Order committed",
      why:
        stage >= 3
          ? "The order and outbox row commit together. The publisher can retry enqueueing without losing the notification intent."
          : "The order is durable, but notification still runs inside the request. A notification failure does not roll back this order.",
      path: stage >= 4 ? [app, "dedupe", "db"] : [app, "db"],
      state: "Order durable",
    });
  } else {
    emit({
      title: "Committed order event",
      why: "Begin from an outbox event already read by the publisher. Writer availability now does not undo that committed work.",
      path: ["db"],
      state: "Notification due",
    });
  }
  if (stage < 3) {
    const success = options.processing === "healthy";
    emit({
      time: 1,
      title: success
        ? "Notification delivered"
        : "Synchronous notification failed",
      why: success
        ? "The provider accepts the notification and the caller receives the result."
        : "The provider failed during this single attempt. No queue exists to retain or retry notification work; a committed order remains durable.",
      path: [app, "provider", app, "browser"],
      accepted: success ? 1 : 0,
      completed: success ? 1 : 0,
      state: success ? "Completed" : "Failed",
      health: success ? "healthy" : "failed",
    });
    return frames;
  }

  const lesson = stage >= 4 ? "dead-letter" : "queues";
  const config = makeConfig(lesson);
  config.values.arrivals = 1;
  if ("workers" in config.values) config.values.workers = 1;
  config.faults =
    options.processing === "healthy"
      ? []
      : [
          { at: 0, active: true },
          ...(options.processing === "repair"
            ? [{ at: 16, active: false }]
            : []),
        ];
  config.actions =
    stage >= 4 && options.redriveAt !== null
      ? [{ at: options.redriveAt, type: "redrive" }]
      : [];
  const timeline = new Timeline(config);
  const breaker = createCircuitState();
  const recordBreaker = (
    time: number,
    type: string,
    title: string,
    why: string,
  ) => {
    timeline.world.fields.journeyCircuit = breaker.phase;
    timeline.emit(
      time,
      type,
      title,
      why,
      "Observe the next receive or probe.",
      ["worker"],
    );
  };
  queue(timeline, {
    arrivalsUntil: 1,
    workerUnavailable: (time) =>
      options.worker === "stopped" ||
      (options.worker === "recover" && time < 10),
    beforeReceive:
      stage < 5
        ? undefined
        : (time) => {
            const phase = breaker.phase;
            const allowed = allowCircuitCall(breaker, time, 4);
            if (!allowed)
              recordBreaker(
                time,
                "breaker-blocked",
                "Circuit open · work stays queued",
                "No message is received and no provider call occurs while the cooldown is active.",
              );
            else if (phase !== breaker.phase)
              recordBreaker(
                time,
                "breaker-half-open",
                "Half-open · allow one probe",
                "The 4s cooldown elapsed. One worker reserves at most one probe.",
              );
            return allowed;
          },
    afterAttempt:
      stage < 5
        ? undefined
        : (time, _message, success) => {
            const phase = breaker.phase;
            recordCircuitResult(breaker, time, 2, success);
            timeline.world.fields.journeyCircuit = breaker.phase;
            if (!success)
              recordBreaker(
                time,
                breaker.phase === "open"
                  ? "breaker-open"
                  : "breaker-call-failed",
                breaker.phase === "open"
                  ? "Provider failed · circuit opened"
                  : "Provider call failed",
                breaker.phase === "open"
                  ? "The failure threshold or a half-open probe failed. Stop receiving until the cooldown permits another probe."
                  : "One provider failure is recorded. The two-failure threshold has not yet been reached.",
              );
            else if (phase === "half-open")
              recordBreaker(
                time,
                "breaker-closed",
                "Probe succeeded · circuit closed",
                "A real successful processing outcome permits normal receives again.",
              );
          },
  });
  let previous = "";
  for (const frame of timeline.frames) {
    const message = frame.world.entities.find((entity) => entity.id === "m-1");
    const type = frame.event.type;
    const changed =
      message &&
      `${message.state}:${message.attempts}:${message.available}` !== previous;
    const noteworthy =
      [
        "failure",
        "recovery",
        "redrive",
        "ack",
        "dead-letter",
        "visibility-expired",
      ].includes(type) || type.startsWith("breaker-");
    if (!changed && !noteworthy) continue;
    if (message)
      previous = `${message.state}:${message.attempts}:${message.available}`;
    const completed = message?.state === "completed" ? 1 : 0;
    const dead = message?.state === "dead letter" ? 1 : 0;
    const accepted = message ? 1 : 0;
    const pending = accepted - completed - dead;
    const path = frame.event.path.map((id) =>
      id === "producer" ? "db" : id === "queue0" ? "queue" : id,
    );
    if (type.startsWith("breaker-"))
      path.splice(
        0,
        path.length,
        "worker",
        "breaker",
        ...(type === "breaker-blocked" || type === "breaker-half-open"
          ? []
          : ["provider"]),
      );
    if (["ack", "dead-letter", "visibility-expired"].includes(type))
      path.splice(
        0,
        path.length,
        "worker",
        ...(stage >= 5 ? ["breaker"] : []),
        "provider",
        "worker",
        type === "dead-letter" ? "dlq" : "queue",
      );
    emit({
      time: frame.event.time,
      title:
        type === "enqueue"
          ? operation === "order"
            ? "202 · order accepted, notification pending"
            : "Notification accepted, delivery pending"
          : type === "receive"
            ? "Worker received notification m-1"
            : frame.event.title,
      why:
        type === "enqueue"
          ? "The durable queue accepted notification m-1. No provider effect has completed yet."
          : frame.event.why,
      path,
      accepted,
      completed,
      pending,
      dead,
      state: completed
        ? "Completed"
        : dead
          ? "In DLQ"
          : message?.state === "in flight"
            ? "Processing"
            : accepted
              ? "Pending"
              : "Not yet accepted",
      health: completed
        ? "healthy"
        : dead
          ? "failed"
          : ["recovery", "redrive", "breaker-half-open"].includes(type)
            ? "recovering"
            : type === "failure" || type.startsWith("breaker-")
              ? "degraded"
              : "waiting",
      evidence: evidence(frame, lesson),
      circuit: String(frame.world.fields.journeyCircuit || "closed"),
      detail: message
        ? `m-1 · ${message.state} · ${message.attempts || 0} receives${message.available ? ` · next boundary ${message.available}s` : ""}.`
        : "No message has been accepted yet.",
    });
  }
  const last = frames.at(-1)!;
  emit({
    time: 32,
    title: "Playback ended · operation observed through 32s",
    why: last.completed
      ? "The notification was acknowledged after its effect completed."
      : last.dead
        ? "Notification m-1 remains in the DLQ. Repair alone does not replay it; explicitly redrive after repair."
        : "Notification m-1 remains pending. The simulation horizon is not a success or a recovery event.",
    path: last.dead ? ["dlq"] : last.completed ? ["provider"] : ["queue"],
    state: last.completed
      ? "Completed"
      : last.dead
        ? "In DLQ"
        : "Pending at horizon",
    health: last.completed ? "healthy" : last.dead ? "failed" : "waiting",
    detail: last.detail,
    circuit: last.circuit,
  });
  return frames;
}

export function journeyNodes(stage: number) {
  return [
    ["browser", "Browser", "Web client", 0],
    ["app", "Application", "EC2 application", 0],
    ["db", "Writer / outbox", "Aurora writer", 0],
    ["cache", "Product cache", "ElastiCache", 1],
    ["lb", "Load balancer", "ALB", 2],
    ["app-a", "Application A", "EC2", 2],
    ["app-b", "Application B", "EC2", 2],
    ["replica", "Read replica", "Aurora reader", 2],
    ["queue", "Notification queue", "SQS", 3],
    ["worker", "Worker", "Lambda", 3],
    ["provider", "Email provider", "External provider", 0],
    ["dedupe", "Operation results", "Aurora transaction", 4],
    ["dlq", "Dead-letter queue", "SQS DLQ", 4],
    ["breaker", "Breaker policy", "Application policy", 5],
  ]
    .filter(
      ([id, , , level]) =>
        Number(level) <= stage && !(stage >= 2 && id === "app"),
    )
    .map(([id, label, aws]) => ({
      id: String(id),
      label: String(label),
      aws: String(aws),
    }));
}

export function journeyEdges(stage: number): [string, string][] {
  const app = stage >= 2 ? "app-a" : "app";
  const edges: [string, string][] =
    stage >= 2
      ? [
          ["browser", "lb"],
          ["lb", "app-a"],
          ["lb", "app-b"],
          ["app-b", "db"],
        ]
      : [["browser", "app"]];
  edges.push([app, "db"]);
  if (stage >= 1) edges.push([app, "cache"]);
  if (stage >= 2) edges.push(["db", "replica"], [app, "replica"]);
  if (stage >= 3) edges.push(["db", "queue"], ["queue", "worker"]);
  if (stage >= 4)
    edges.push([app, "dedupe"], ["queue", "dlq"], ["dlq", "queue"]);
  if (stage >= 5) edges.push(["worker", "breaker"], ["breaker", "provider"]);
  else edges.push([stage >= 3 ? "worker" : app, "provider"]);
  return edges;
}

/** Stable focused route; event paths highlight the active subset without layout jumps. */
export function journeyRoute(stage: number, operation: Operation): string[] {
  const app = stage >= 2 ? "app-a" : "app";
  if (operation === "read")
    return [
      "browser",
      ...(stage >= 2 ? ["lb"] : []),
      app,
      ...(stage >= 1 ? ["cache"] : []),
      stage >= 2 ? "replica" : "db",
    ];
  return [
    ...(operation === "order"
      ? ["browser", ...(stage >= 2 ? ["lb"] : []), app]
      : []),
    "db",
    ...(stage >= 3
      ? ["queue", "worker"]
      : operation === "notification"
        ? [app]
        : []),
    ...(stage >= 5 ? ["breaker"] : []),
    "provider",
    ...(stage >= 4 ? ["dlq"] : []),
  ];
}
