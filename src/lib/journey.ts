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
      "A circuit breaker rejects calls locally, then probes before recovery.",
    limit:
      "A breaker does not fix the provider; accepted work can remain pending.",
    failure: "A failed half-open probe must reopen the circuit.",
    lessons: ["circuit-breaker", "bulkheads", "timeouts"],
  },
] as const;
export type Operation = "read" | "order" | "notification";
export type JourneyFrame = {
  time: number;
  title: string;
  why: string;
  path: string[];
  accepted: number;
  completed: number;
  state: string;
};
export function journeyTrace(
  stage: number,
  operation: Operation,
  failure: boolean,
): JourneyFrame[] {
  if (!Number.isInteger(stage) || stage < 0 || stage > 5)
    throw new Error("Unknown journey stage.");
  const frames: JourneyFrame[] = [];
  let accepted = 0,
    completed = 0;
  const emit = (title: string, why: string, path: string[], state: string) =>
    frames.push({
      time: frames.length,
      title,
      why,
      path,
      accepted,
      completed,
      state,
    });
  const app = stage >= 2 ? "app-a" : "app";
  const entry = stage >= 2 ? ["browser", "lb", app] : ["browser", app];
  emit(
    "Operation ready",
    `Follow one ${operation} operation with stable ID operation-42.`,
    [],
    "ready",
  );
  if (operation === "read") {
    emit(
      "GET /products/42",
      stage >= 2
        ? "The balancer selects a healthy application instance."
        : "The browser requests a product.",
      entry,
      "in progress",
    );
    if (stage >= 1 && !failure) {
      emit(
        "Warm cache hit: product v1",
        "This example begins with a valid product already cached. The database is not contacted.",
        [app, "cache"],
        "cached",
      );
      accepted = 1;
      completed = 1;
      emit(
        "Product returned",
        "This read completed; background components are unrelated.",
        ["cache", app, "browser"],
        "completed",
      );
    } else {
      if (stage >= 1)
        emit(
          "Cache miss",
          "The failure scenario starts with an expired entry. A refresh is required.",
          [app, "cache"],
          "miss",
        );
      const db = stage >= 2 ? "replica" : "db";
      emit(
        "Read source",
        stage >= 2
          ? "A replica serves this read; it may lag the writer."
          : "The database handles the product lookup.",
        [app, db],
        failure ? "source unavailable" : "reading",
      );
      if (failure) {
        emit(
          "Read failed",
          "The source is unavailable and there is no usable cache entry. This is not a successful completion.",
          [db, app, "browser"],
          "failed",
        );
      } else {
        accepted = 1;
        completed = 1;
        emit(
          "Product returned",
          "The source read completed.",
          [db, app, "browser"],
          "completed",
        );
      }
    }
  } else {
    if (operation === "order") {
      emit(
        "POST /orders · operation-42",
        "The application validates the order.",
        entry,
        "validating",
      );
      if (stage >= 4)
        emit(
          "Claim operation ID",
          "The idempotency result and order effect are committed in one local transaction.",
          [app, "dedupe", "db"],
          "claimed",
        );
      emit(
        "Order committed",
        stage >= 3
          ? "An order and an outbox row commit together. The outbox publisher will enqueue notification work."
          : "The writer commits the order. A notification is still part of this synchronous request.",
        [app, "db"],
        "order durable",
      );
    } else
      emit(
        "Order outbox event",
        "Start from an already committed order. This path only follows its notification.",
        stage >= 3 ? ["db", "queue"] : ["db", app],
        "notification due",
      );
    if (stage >= 3) {
      emit(
        "Notification queued",
        "The outbox publisher sends a durable message. Duplicate delivery remains possible.",
        ["db", "queue"],
        "queued",
      );
      accepted = 1;
      emit(
        "202 · accepted",
        operation === "order"
          ? "The order is durable; the response does not claim notification completion."
          : "Notification work is accepted but no email has been sent.",
        operation === "order" ? [app, "browser"] : ["queue"],
        "accepted, pending",
      );
      emit(
        "Worker receives message",
        "The delivery becomes invisible while one worker processes it.",
        ["queue", "worker"],
        "in flight",
      );
    }
    const worker = stage >= 3 ? "worker" : app;
    if (stage >= 5 && failure) {
      emit(
        "Provider fails; circuit opens",
        "The worker records failed calls and opens the application breaker.",
        [worker, "breaker", "provider"],
        "open",
      );
      emit(
        "Calls rejected locally",
        "No new provider call crosses the open breaker.",
        [worker, "breaker"],
        "pending",
      );
      emit(
        "Half-open probe after recovery",
        "This trace repairs the provider before a bounded recovery probe.",
        [worker, "breaker", "provider"],
        "half-open",
      );
    } else if (failure) {
      if (stage >= 4) {
        for (let i = 1; i <= 3; i++)
          emit(
            `Receive ${i} fails`,
            "Visibility timeout and bounded backoff precede another safe attempt.",
            [worker, "provider", "queue"],
            "retry waiting",
          );
        emit(
          "Poison delivery moved to DLQ",
          "No successful side effect occurred. Accepted work is isolated for repair.",
          ["queue", "dlq"],
          "dead letter",
        );
        return frames;
      }
      emit(
        "Provider unavailable",
        stage >= 3
          ? "Accepted work stays pending for a future worker."
          : "The synchronous request fails while waiting for notification.",
        [worker, "provider"],
        "pending or failed",
      );
      return frames;
    }
    emit(
      "Notification delivered",
      "The provider accepts the notification under a stable operation ID.",
      stage >= 5 ? [worker, "breaker", "provider"] : [worker, "provider"],
      "effect completed",
    );
    accepted = 1;
    completed = 1;
    emit(
      stage >= 3 ? "Message acknowledged" : "Request completed",
      "Only after the effect succeeds does completion advance.",
      stage >= 3 ? ["worker", "queue"] : [app, "browser"],
      "completed",
    );
    if (stage >= 4)
      emit(
        "Duplicate redelivery suppressed",
        "The recorded operation result prevents a second effect; completion stays one.",
        ["queue", "worker", "dedupe"],
        "one unique effect",
      );
  }
  return frames;
}
export function journeyNodes(stage: number) {
  return [
    ["browser", "Browser", "Web client", 0],
    ["app", "Application", "EC2 application", 0],
    ["db", "Writer / outbox", "Aurora PostgreSQL", 0],
    ["cache", "Product cache", "ElastiCache for Valkey", 1],
    ["lb", "Load balancer", "ALB", 2],
    ["app-a", "Application A", "EC2", 2],
    ["app-b", "Application B", "EC2", 2],
    ["replica", "Read replica", "Aurora reader", 2],
    ["queue", "Notification queue", "SQS", 3],
    ["worker", "Notification worker", "Lambda", 3],
    ["provider", "Email provider", "External provider", 0],
    [
      "dedupe",
      "Operation results",
      "Aurora transaction / provider idempotency",
      4,
    ],
    ["dlq", "Dead-letter queue", "SQS DLQ", 4],
    [
      "breaker",
      "Circuit breaker",
      "Application policy + shared durable state",
      5,
    ],
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
