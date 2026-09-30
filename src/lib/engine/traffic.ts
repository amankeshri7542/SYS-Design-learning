import { Timeline, node, sample, type Entity } from "./model";

export function cache(t: Timeline) {
  const { lesson: id, values: c, seed } = t.config,
    w = t.world;
  w.nodes = [
    node(
      "app",
      id === "cdn-cache" ? "Visitor" : "Application",
      "Application code",
    ),
    node(
      "cache",
      id === "cdn-cache" ? "Edge cache" : "Cache",
      id === "cdn-cache" ? "CloudFront" : "ElastiCache for Valkey",
    ),
    node(
      "origin",
      id === "cdn-cache" ? "Origin" : "Source of truth",
      id === "cdn-cache" ? "S3" : id === "invalidation" ? "DynamoDB" : "Aurora",
    ),
  ];
  w.edges =
    id === "cdn-cache"
      ? [
          ["app", "cache"],
          ["cache", "origin"],
        ]
      : [
          ["app", "cache"],
          ["app", "origin"],
        ];
  w.fields = { sourceVersion: 1, policy: c.policy === 1 ? "LFU" : "LRU" };
  t.start();
  const capacity = c.capacity || 6,
    ttl = c.ttl || 20;
  let invalidationDue = Infinity;
  for (let time = 1; time <= 24; time++) {
    t.tick(time);
    w.nodes[2].status =
      w.failed && id !== "write-through" && id !== "invalidation"
        ? "unavailable"
        : "ready";
    w.nodes[1].status =
      w.failed && id === "write-through" ? "unavailable" : "ready";
    if (id === "invalidation" && time === 5) {
      w.fields.sourceVersion = 2;
      invalidationDue = time + (c.lag || 0);
      t.count("writes");
      t.emit(
        time,
        "write",
        "Source advances to v2",
        "The source committed independently of the cache.",
        "The invalidation event is waiting for its propagation delay.",
        ["origin"],
      );
    }
    if (id === "invalidation" && time >= invalidationDue && !w.failed) {
      w.entities = [];
      invalidationDue = Infinity;
      t.emit(
        time,
        "invalidate",
        "Cached copies invalidated",
        "The application’s change consumer removed old values.",
        "The next read will fetch v2.",
        ["origin", "app", "cache"],
      );
    }
    for (const entry of [...w.entities])
      if ((entry.expires || 0) <= time) {
        w.entities = w.entities.filter((e) => e.id !== entry.id);
        t.count("expired");
        t.emit(
          time,
          "expire",
          `${entry.id} expired at ${entry.expires}s`,
          "An entry is valid only before its expiry time.",
          "A later read of this key must miss.",
          ["cache"],
          entry.id,
        );
      }
    const key =
      id === "stampede" || id === "invalidation" || id === "write-through"
        ? "product-1"
        : `product-${time % 3 === 0 ? 1 : 1 + Math.floor(sample(seed, `key:${time}`) * 6)}`;
    const burst = id === "stampede" ? c.burst : 1;
    if (id === "write-through" && time % c.writes === 0) {
      const version = Number(w.fields.sourceVersion) + 1;
      w.fields.sourceVersion = version;
      t.count("writes");
      if (w.failed) {
        w.entities = w.entities.filter((e) => e.id !== key);
        t.emit(
          time,
          "partial-write",
          "Database committed; cache write failed",
          "The two stores do not share a transaction. This model evicts a possibly stale copy.",
          "Retry the cache update or fill on a later read.",
          ["app", "origin", "app", "cache"],
        );
      } else {
        put(key, time, version);
        t.emit(
          time,
          "write-through",
          `${key} committed and cached v${version}`,
          "Acknowledgment follows both writes.",
          "A subsequent hit sees the new version.",
          ["app", "origin", "app", "cache"],
          key,
        );
      }
      continue;
    }
    const publicRequest =
      id !== "cdn-cache" || sample(seed, `public:${time}`) * 100 < c.cacheable;
    const hit = publicRequest
      ? w.entities.find((e) => e.id === key)
      : undefined;
    if (hit) {
      hit.last = time;
      hit.hits = (hit.hits || 0) + burst;
      t.count("hits", burst);
      if (hit.version !== w.fields.sourceVersion) t.count("stale", burst);
      w.fields.lastRead = `${key}: v${hit.version}`;
      t.emit(
        time,
        "hit",
        `${burst} read${burst > 1 ? "s" : ""} served from ${id === "cdn-cache" ? "edge" : "cache"}`,
        `The entry is valid until ${hit.expires}s; its value is v${hit.version}.`,
        "Inspect its remaining TTL, or continue to the next request.",
        ["app", "cache", "app"],
        key,
      );
    } else {
      t.count("misses", burst);
      t.emit(
        time,
        "miss",
        `${key}: ${publicRequest ? "cache miss" : "uncacheable request"}`,
        "No reusable valid entry exists for this request.",
        id === "cdn-cache"
          ? "CloudFront must forward the request to its S3 origin."
          : "The application must read the source.",
        ["app", "cache"],
        key,
      );
      const reads = id === "stampede" && c.coalesce === 0 ? burst : 1;
      t.count("origin", reads);
      t.emit(
        time,
        "fetch",
        id === "cdn-cache"
          ? "CloudFront requests the S3 object"
          : "Application requests the source value",
        id === "cdn-cache"
          ? "The viewer stays connected to CloudFront. The edge forwards the miss to the origin."
          : "Only the application coordinates this cache-aside source read.",
        "Wait for the origin response; the cache has not been filled yet.",
        id === "cdn-cache" ? ["cache", "origin"] : ["app", "origin"],
        key,
      );
      if (w.failed && id !== "write-through" && id !== "invalidation") {
        t.count("errors", burst);
        t.emit(
          time,
          "error",
          "Origin read failed",
          "A miss cannot be served while the origin is unavailable.",
          "Recover the origin; valid cached entries can still serve hits.",
          id === "cdn-cache" ? ["origin", "cache", "app"] : ["origin", "app"],
          key,
        );
      } else {
        t.count("coalesced", burst - reads);
        w.fields.lastRead = `${key}: v${w.fields.sourceVersion}`;
        if (publicRequest) put(key, time, Number(w.fields.sourceVersion));
        t.emit(
          time,
          "fill",
          `${reads} origin read${reads > 1 ? "s" : ""}; ${publicRequest ? "value cached" : "private response returned"}`,
          id === "stampede"
            ? `${burst - reads} readers reused the leader’s refresh. All readers in this burst requested the same key.`
            : id === "cdn-cache"
              ? "S3 returns the object to CloudFront, which stores it only when the response is cacheable."
              : "The source returns its committed value to the application, which fills its cache.",
          publicRequest
            ? "The following read can reuse the entry until expiry or eviction."
            : "This response is not stored for reuse.",
          id === "cdn-cache"
            ? ["origin", "cache"]
            : ["origin", "app", ...(publicRequest ? ["cache"] : [])],
          key,
        );
        if (id === "cdn-cache")
          t.emit(
            time,
            "response",
            "CloudFront returns the object to the viewer",
            "The response passes through CloudFront even when it is not cached.",
            "The next viewer request may reuse a valid cached object without contacting S3.",
            ["cache", "app"],
            key,
          );
      }
    }
  }
  function put(key: string, time: number, version: number) {
    w.entities = w.entities.filter((e) => e.id !== key);
    if (w.entities.length >= capacity) {
      const victim = [...w.entities].sort((a, b) =>
        c.policy === 1
          ? (a.hits || 0) - (b.hits || 0) || (a.last || 0) - (b.last || 0)
          : (a.last || 0) - (b.last || 0),
      )[0];
      w.entities = w.entities.filter((e) => e !== victim);
      t.count("evictions");
      t.emit(
        time,
        "evict",
        `${victim.id} evicted (${c.policy === 1 ? "LFU" : "LRU"})`,
        "All cache slots were occupied. The replacement policy selected this entry.",
        "The incoming key takes its slot.",
        ["cache"],
        victim.id,
      );
    }
    w.entities.push({
      id: key,
      kind: "cache entry",
      location: "cache",
      state: "valid",
      value: `price ${20 + version}`,
      version,
      expires: time + ttl,
      last: time,
      hits: 1,
    });
  }
}

export function fleet(t: Timeline) {
  const { lesson: id, values: c, seed } = t.config,
    w = t.world;
  const count =
    id === "vertical-scaling" ||
    id === "rate-limiting" ||
    id === "connection-pooling" ||
    id === "serverless"
      ? 1
      : id === "bulkheads" || id === "canary" || id === "blue-green"
        ? 2
        : c.replicas;
  w.nodes = [
    node(
      "entry",
      id === "rate-limiting"
        ? "Token bucket"
        : id === "serverless"
          ? "Invocation boundary"
          : id === "connection-pooling"
            ? "Connection pool"
            : "Request router",
      id === "rate-limiting"
        ? "API Gateway"
        : id === "serverless"
          ? "Lambda"
          : id === "connection-pooling"
            ? "RDS Proxy"
            : "Application Load Balancer",
    ),
    ...Array.from({ length: count }, (_, i) =>
      node(
        `n${i}`,
        id === "bulkheads"
          ? i
            ? "Background pool"
            : "Critical pool"
          : id === "canary" || id === "blue-green"
            ? i
              ? "Candidate"
              : "Stable"
            : `Instance ${i + 1}`,
        id === "serverless" || id === "canary"
          ? "Lambda"
          : id === "connection-pooling"
            ? "Aurora"
            : "EC2",
      ),
    ),
  ];
  w.edges = w.nodes.slice(1).map((n) => ["entry", n.id]);
  let tokens = c.burst || 0,
    roundRobin = 0,
    probeCount = 0,
    wasDown = false,
    rollback = false;
  w.counters.expected = id === "canary" ? (c.weight * c.errors) / 100 : 0;
  t.start();
  for (let time = 1; time <= 24; time++) {
    t.tick(time);
    if (w.failed !== wasDown) {
      probeCount = 1;
      wasDown = w.failed;
    } else probeCount++;
    const demand = c.rate || 6;
    t.count("offered", demand);
    const ready = w.nodes.slice(1).filter((n, i) => {
      let status = "ready";
      if (id === "autoscaling" && i > 0 && time < 3 + c.delay)
        status = "booting";
      if (
        i === 0 &&
        w.failed &&
        !["canary", "blue-green", "bulkheads"].includes(id)
      )
        status =
          id === "health-checks" && probeCount < c.checks
            ? "failing checks, still routed"
            : "unavailable";
      if (
        i === 0 &&
        !w.failed &&
        id === "health-checks" &&
        t.config.faults.some((f) => f.at < time && f.active) &&
        probeCount < c.checks
      )
        status = "probing";
      if (
        id === "multi-az" &&
        w.failed &&
        i > 0 &&
        time <
          (t.config.faults.filter((f) => f.at <= time && f.active).at(-1)?.at ||
            0) +
            c.delay
      )
        status = "promoting";
      if (
        i === 1 &&
        w.failed &&
        ["canary", "blue-green", "bulkheads"].includes(id)
      )
        status = "unavailable";
      n.status = status;
      n.detail = `${status}; completed requests this second shown below.`;
      return status === "ready" || status === "failing checks, still routed";
    });
    const loads: Record<string, number> = {};
    let completed = 0,
      accepted = 0,
      errors = 0;
    if (id === "rate-limiting") tokens = Math.min(c.burst, tokens + c.tokens);
    w.entities = [];
    for (let r = 0; r < demand; r++) {
      const request: Entity = {
        id: `request-${time}-${r + 1}`,
        kind: "request",
        location: "entry",
        state: "rejected",
        value: `batch ${time}`,
        operation: `r-${time}-${r + 1}`,
      };
      w.entities.push(request);
      let target: (typeof w.nodes)[number] | undefined;
      if (id === "canary" || id === "blue-green") {
        const candidate =
          id === "canary"
            ? sample(seed, `route:${time}:${r}`) * 100 < c.weight
            : time >= c.switch && !rollback;
        target = w.nodes[candidate ? 2 : 1];
        request.location = target.id;
        t.count(candidate ? "candidate" : "stable");
        accepted++;
        if (
          candidate &&
          (w.failed || sample(seed, `error:${time}:${r}`) * 100 < c.errors)
        ) {
          errors++;
          t.count("errors");
          request.state = "failed";
        } else {
          completed++;
          request.state = "completed";
          loads[target.id] = (loads[target.id] || 0) + 1;
        }
      } else {
        if (id === "bulkheads") target = w.nodes[r < 2 ? 1 : 2];
        else
          target = ready.length
            ? ready[roundRobin++ % ready.length]
            : undefined;
        const capacity =
          id === "vertical-scaling"
            ? c.capacity
            : id === "serverless"
              ? c.concurrency
              : id === "connection-pooling"
                ? c.pool
                : id === "bulkheads"
                  ? target?.id === "n0"
                    ? c.reserved
                    : 3
                  : 3;
        if (id === "rate-limiting" && tokens < 1) continue;
        if (target && target.status === "failing checks, still routed") {
          request.location = target.id;
          request.state = "failed";
          accepted++;
          errors++;
          t.count("errors");
          continue;
        }
        if (
          target &&
          target.status === "ready" &&
          (loads[target.id] || 0) < (id === "rate-limiting" ? demand : capacity)
        ) {
          if (id === "rate-limiting") tokens--;
          loads[target.id] = (loads[target.id] || 0) + 1;
          request.location = target.id;
          request.state = "completed";
          accepted++;
          completed++;
        }
      }
    }
    for (const n of w.nodes.slice(1))
      n.detail = `${loads[n.id] || 0} requests completed this second; ${n.status}.`;
    t.count("accepted", accepted);
    t.count("completed", completed);
    t.count("rejected", demand - completed);
    w.counters.tokens = tokens;
    w.fields.ready = ready.length;
    w.fields.capacity =
      id === "bulkheads"
        ? `${c.reserved} critical + 3 background`
        : id === "serverless"
          ? `${c.concurrency} concurrent 1s handlers`
          : id === "connection-pooling"
            ? `${c.pool} one-second transactions`
            : id === "vertical-scaling"
              ? `${c.capacity} req/s`
              : `${ready.length * 3} req/s`;
    t.emit(
      time,
      "dispatch",
      `${completed} of ${demand} requests completed this second`,
      id === "rate-limiting"
        ? `${tokens} tokens remain after admission. Rejected requests do not use service capacity.`
        : id === "canary"
          ? `Candidate share ${c.weight}%; candidate error probability ${c.errors}%. Each request makes an independent seeded choice.`
          : id === "bulkheads"
            ? "Two critical requests use only their reserved pool. All other offered requests use the background pool."
            : `${ready.length} serving component(s); capacity is enforced before completing work.`,
      "Inspect component health and the accepted/completed counts.",
      ["entry", ...ready.map((n) => n.id)],
    );
    if (id === "blue-green" && !rollback && time >= c.switch && errors > 0) {
      rollback = true;
      t.count("rollbacks");
      t.emit(
        time,
        "rollback",
        "Traffic rolled back to blue",
        "The green fleet produced an error after the switch.",
        "The next second routes all requests to the retained stable fleet.",
        ["entry", "n0"],
      );
    }
  }
}

export function queue(
  t: Timeline,
  options: {
    arrivalsUntil?: number;
    workerUnavailable?: (time: number) => boolean;
    beforeReceive?: (time: number, message: Entity) => boolean;
    afterAttempt?: (time: number, message: Entity, success: boolean) => void;
  } = {},
) {
  const { lesson: id, values: c, seed } = t.config,
    w = t.world;
  const subscribers = id === "pubsub" ? c.subscribers : 1;
  w.nodes = [
    node(
      "producer",
      id === "write-behind" ? "Write API" : "Producer",
      "Application code",
    ),
    ...Array.from({ length: subscribers }, (_, i) =>
      node(
        `queue${i}`,
        id === "pubsub"
          ? `Subscriber ${i + 1} queue`
          : id === "event-streams"
            ? "Retained stream"
            : "Work queue",
        id === "event-streams" ? "Kinesis Data Streams" : "SQS",
      ),
    ),
    node(
      "worker",
      id === "write-behind" ? "Persistence worker" : "Consumers",
      "Lambda",
    ),
    ...(id === "dead-letter"
      ? [node("dlq", "Dead-letter queue", "SQS DLQ")]
      : []),
  ];
  w.edges = [
    ...Array.from(
      { length: subscribers },
      (_, i) => ["producer", `queue${i}`] as [string, string],
    ),
    ...Array.from(
      { length: subscribers },
      (_, i) => [`queue${i}`, "worker"] as [string, string],
    ),
    ...(id === "dead-letter" ? [["queue0", "dlq"] as [string, string]] : []),
  ];
  const effects = new Set<string>();
  let serial = 0;
  const arrivalsUntil = Math.max(0, Math.min(8, options.arrivalsUntil ?? 8));
  w.fields.arrivalsUntil = arrivalsUntil;
  w.fields.intake = `Arrivals at t=1..${arrivalsUntil}; then drain through t=32.`;
  t.start();
  const pending = () =>
    w.entities.filter((e) => e.state === "ready" || e.state === "in flight")
      .length;
  const account = () => {
    w.counters.pending = pending();
    w.counters.dead = w.entities.filter(
      (e) => e.state === "dead letter",
    ).length;
    const dlq = w.nodes.find((n) => n.id === "dlq");
    if (dlq) dlq.status = w.counters.dead ? "waiting" : "ready";
  };
  const redrive = (time: number) => {
    if (!t.config.actions?.some((action) => action.at === time)) return;
    // ponytail: atomic redrive retains learning IDs; model transport IDs/rate only for a dedicated SQS transport lab.
    const messages = w.entities.filter((e) => e.state === "dead letter");
    for (const m of messages) {
      m.state = "ready";
      m.location = "queue0";
      m.attempts = 0;
      m.available = time;
    }
    t.count("redriven", messages.length);
    account();
    t.emit(
      time,
      "redrive",
      `Explicit redrive moved ${messages.length} DLQ message${messages.length === 1 ? "" : "s"}`,
      messages.length
        ? "A separate operator action returned quarantined work to the source queue. Repair alone never moves it."
        : "The DLQ was empty, so the requested action moved no work.",
      w.failed
        ? "The cause is still active; redriven work can fail again."
        : "Workers may retry these messages with a fresh receive budget.",
      ["dlq", "queue0"],
    );
  };
  redrive(0);
  for (let time = 1; time <= 32; time++) {
    t.tick(time);
    const workerUnavailable = options.workerUnavailable?.(time) ?? false;
    w.nodes.find((n) => n.id === "worker")!.status = workerUnavailable
      ? "unavailable"
      : w.failed
        ? id === "dead-letter"
          ? "poison payload failing"
          : "fault injected"
        : "ready";
    redrive(time);
    for (const m of w.entities.filter(
      (e) => e.state === "in flight" && (e.available || 0) <= time,
    )) {
      const poison = id === "dead-letter" && m.operation === "op-1" && w.failed;
      if (workerUnavailable) {
        m.state = "ready";
        m.location = `queue${id === "pubsub" ? m.group : 0}`;
        m.available = time + 2;
        account();
        t.emit(
          time,
          "retry-visible",
          `${m.id}: worker interrupted`,
          "The worker stopped before acknowledgment. No provider result was observed.",
          "Recover the worker; visibility delays the next attempt by 2s.",
          ["worker", m.location],
          m.id,
        );
      } else if (poison) {
        if ((m.attempts || 0) >= c.attempts) {
          m.state = "dead letter";
          m.location = "dlq";
        } else {
          m.state = "ready";
          m.location = "queue0";
          m.available = time + 2;
        }
        account();
        options.afterAttempt?.(time, m, false);
        t.emit(
          time,
          m.state === "dead letter" ? "dead-letter" : "visibility-expired",
          `${m.id}: ${m.state}`,
          `Receive ${m.attempts} failed. ${m.state === "dead letter" ? "The retry budget is exhausted." : "Visibility delays the next attempt by 2s."}`,
          "Healthy messages can continue. Repair the cause before redrive.",
          m.state === "dead letter"
            ? ["worker", "queue0", "dlq"]
            : ["worker", m.location],
          m.id,
        );
      } else if (
        w.failed &&
        id !== "dead-letter" &&
        !(id === "pubsub" && m.group !== "0") &&
        !(id === "ordering" && m.group !== "0")
      ) {
        m.state = "ready";
        m.location = `queue${id === "pubsub" ? m.group : 0}`;
        m.available = time + 2;
        account();
        t.emit(
          time,
          "retry-visible",
          `${m.id}: processing interrupted`,
          "No successful acknowledgment occurred; the delivery becomes visible again after its timeout.",
          "Recover the worker and retry.",
          ["worker", m.location],
          m.id,
        );
      } else {
        m.state = id === "event-streams" ? "consumed" : "completed";
        m.location = id === "event-streams" ? "queue0" : "worker";
        t.count("completed");
        if (effects.has(m.operation!) && id === "idempotency" && c.enabled) {
          t.count("duplicates");
        } else {
          effects.add(m.operation!);
          t.count("effects");
        }
        account();
        options.afterAttempt?.(time, m, true);
        t.emit(
          time,
          "ack",
          `${m.id}: ${id === "event-streams" ? "checkpoint advanced" : "successfully acknowledged"}`,
          id === "idempotency" && c.enabled
            ? "The operation ID and business effect are committed atomically. Duplicate delivery adds no extra effect."
            : "Only a completed side effect permits acknowledgment.",
          "The worker can now receive more work.",
          ["worker"],
          m.id,
        );
      }
    }
    if (time <= arrivalsUntil) {
      const n = c.arrivals || 1;
      for (let a = 0; a < n; a++) {
        t.count("offered");
        if (
          id === "event-routing" &&
          sample(seed, `event:${time}:${a}`) * 100 >= c.match
        ) {
          t.count("filtered");
          continue;
        }
        const copies = id === "idempotency" ? 1 + c.duplicates : subscribers;
        for (let sub = 0; sub < copies; sub++) {
          if (id === "backpressure" && pending() >= c.limit) {
            t.count("rejected");
            continue;
          }
          serial++;
          const group =
            id === "pubsub"
              ? String(sub)
              : id === "ordering"
                ? String(((time - 1) * n + a) % c.groups)
                : id === "event-streams"
                  ? String(((time - 1) * n + a) % c.shards)
                  : "0";
          w.entities.push({
            id: `m-${serial}`,
            kind: id === "event-streams" ? "stream record" : "message",
            location: `queue${id === "pubsub" ? sub : 0}`,
            state: "ready",
            value: `${id === "event-routing" ? "order.created" : "work"} ${time}.${a}`,
            attempts: 0,
            available: time,
            group,
            operation: `op-${(time - 1) * n + a + 1}`,
          });
          t.count("accepted");
        }
      }
      account();
      t.emit(
        time,
        "enqueue",
        `${w.counters.accepted || 0} accepted; ${pending()} pending`,
        id === "pubsub"
          ? "Each subscriber gets a separate delivery and independent progress."
          : id === "idempotency"
            ? "Deliveries share stable operation IDs so duplicates can be identified."
            : "Acceptance adds pending work. It is not counted as completion.",
        "Workers receive only as much work as their available slots allow.",
        [
          "producer",
          ...w.nodes.filter((n) => n.id.startsWith("queue")).map((n) => n.id),
        ],
      );
    }
    const active = w.entities.filter((e) => e.state === "in flight");
    let slots =
      id === "pubsub"
        ? subscribers - active.length
        : id === "batching"
          ? c.batch - active.length
          : (c.workers || 2) - active.length;
    if (id === "event-streams" && time % (c.slow || 1) !== 0) slots = 0;
    if (w.failed && !["dead-letter", "pubsub", "ordering"].includes(id))
      slots = 0;
    if (workerUnavailable) slots = 0;
    let received = 0;
    for (const m of w.entities.filter(
      (e) => e.state === "ready" && (e.available || 0) <= time,
    )) {
      if (slots <= 0) break;
      if ((id === "pubsub" || id === "ordering") && w.failed && m.group === "0")
        continue;
      if (
        (id === "pubsub" || id === "ordering" || id === "event-streams") &&
        w.entities.some((e) => e.group === m.group && e.state === "in flight")
      )
        continue;
      if (
        id === "ordering" &&
        w.entities.some(
          (e) =>
            e.group === m.group &&
            Number(e.id.slice(2)) < Number(m.id.slice(2)) &&
            ["ready", "in flight"].includes(e.state),
        )
      )
        continue;
      if (
        id === "batching" &&
        pending() < c.batch &&
        time - (m.available || 0) < c.window
      )
        continue;
      if (options.beforeReceive && !options.beforeReceive(time, m)) break;
      m.state = "in flight";
      m.location = "worker";
      m.attempts = (m.attempts || 0) + 1;
      m.available = time + (id === "pubsub" && m.group === "0" ? c.slow : 1);
      slots--;
      received++;
    }
    if (received) {
      t.count("invocations", id === "batching" ? 1 : received);
      account();
      t.emit(
        time,
        "receive",
        `${received} message${received > 1 ? "s" : ""} in flight`,
        "Receiving reserves worker capacity. Messages remain pending until successful acknowledgment.",
        "The next completion or timeout determines the message’s next state.",
        ["queue0", "worker"],
      );
    }
    if (id === "event-streams" && time === 30) {
      t.count("replayed", w.counters.completed || 0);
      t.emit(
        time,
        "replay",
        "Second reader replayed retained records",
        "Consumption did not delete stream history. This second reader starts from the beginning.",
        "Compare retained records with the first reader’s checkpoint.",
        ["queue0"],
      );
    }
    account();
    if (!received && time > arrivalsUntil)
      t.emit(
        time,
        "clock",
        "Queue observation",
        `${pending()} pending; ${w.counters.completed || 0} completed; ${w.counters.dead || 0} in DLQ.`,
        "Continue to observe draining or inject recovery.",
      );
  }
}
