import { Timeline, node, sample } from "./model";

export function circuit(t: Timeline) {
  const w = t.world,
    c = t.config.values;
  w.nodes = [
    node("caller", "Caller", "Application"),
    node("breaker", "Circuit breaker", "EC2 application policy"),
    node("dependency", "Dependency", "External service"),
  ];
  w.edges = [
    ["caller", "breaker"],
    ["breaker", "dependency"],
  ];
  let state = "closed",
    failures = 0,
    openedAt = -1;
  w.fields = { circuit: state, consecutiveFailures: 0 };
  t.start();
  for (let time = 1; time <= 24; time++) {
    t.tick(time);
    w.nodes[2].status = w.failed ? "unavailable" : "ready";
    if (state === "open" && time - openedAt >= c.cooldown) {
      state = "half-open";
      w.fields.circuit = state;
      w.nodes[1].status = state;
      t.emit(
        time,
        "half-open",
        "Half-open: one probe allowed",
        "The open-state cooldown elapsed. Normal traffic is still held back.",
        "The probe result either closes or reopens the circuit.",
        ["breaker"],
      );
    }
    if (state === "open") {
      t.count("blocked");
      t.emit(
        time,
        "fail-fast",
        "Caller rejected locally",
        "The circuit is open, so no call reaches the dependency.",
        "Wait until the cooldown permits a probe.",
        ["caller", "breaker"],
      );
      continue;
    }
    t.count("attempts");
    if (w.failed) {
      failures++;
      t.count("errors");
      const open = state === "half-open" || failures >= c.threshold;
      if (open) {
        state = "open";
        openedAt = time;
      }
      w.fields = {
        circuit: state,
        consecutiveFailures: failures,
        probeAfter: openedAt + c.cooldown,
      };
      w.nodes[1].status = state;
      t.emit(
        time,
        open ? "open" : "call-failed",
        open ? "Circuit opened" : "Dependency call failed",
        open
          ? "The failure threshold or half-open probe failed."
          : "The consecutive-failure threshold has not been reached.",
        "A successful probe after recovery can close the circuit.",
        ["caller", "breaker", "dependency"],
      );
    } else {
      const probed = state === "half-open";
      state = "closed";
      failures = 0;
      t.count("completed");
      w.fields = { circuit: state, consecutiveFailures: 0 };
      w.nodes[1].status = state;
      t.emit(
        time,
        probed ? "close" : "call-success",
        probed
          ? "Probe succeeded; circuit closed"
          : "Dependency returned successfully",
        probed
          ? "A bounded half-open probe verified recovery."
          : "A successful call resets the consecutive-failure count.",
        "Normal calls can continue.",
        ["caller", "breaker", "dependency"],
      );
    }
  }
}

export function workflow(t: Timeline) {
  const { lesson: id, values: c, seed } = t.config,
    w = t.world;
  const nodeSets: Record<string, ReturnType<typeof node>[]> = {
    retries: [
      node("caller", "Caller", "Application"),
      node("dependency", "Remote action", "Step Functions retry task"),
    ],
    timeouts: [
      node("caller", "Caller budget", "API Gateway / application"),
      node("dependency", "Remote effect", "Lambda"),
    ],
    "disaster-recovery": [
      node("primary", "Primary environment", "Application + data"),
      node("backup", "Recovery point", "AWS Backup"),
      node("restore", "Recovery environment", "Restored AWS resources"),
    ],
    observability: [
      node("app", "Application span", "Application"),
      node("db", "Database span", "Database"),
      node("telemetry", "Metrics, logs, traces", "CloudWatch + X-Ray"),
    ],
    "event-sourcing": [
      node("log", "Immutable event log", "DynamoDB"),
      node("projection", "Rebuilt projection", "Lambda"),
    ],
    sagas: [
      node("inventory", "Inventory", "Local transaction"),
      node("payment", "Payment", "Local transaction"),
      node("fulfillment", "Fulfillment", "Step Functions task"),
    ],
    "distributed-locks": [
      node("lease", "Lease authority", "DynamoDB conditional writes"),
      node("worker-a", "Worker A", "Application"),
      node("worker-b", "Worker B", "Application"),
      node("resource", "Fenced resource", "Application-enforced token"),
    ],
  };
  w.nodes = nodeSets[id];
  w.edges =
    id === "sagas"
      ? [
          ["inventory", "payment"],
          ["payment", "fulfillment"],
        ]
      : id === "distributed-locks"
        ? [
            ["lease", "worker-a"],
            ["lease", "worker-b"],
            ["worker-a", "resource"],
            ["worker-b", "resource"],
          ]
        : w.nodes.slice(1).map((n, i) => [w.nodes[i].id, n.id]);
  if (id === "event-sourcing") {
    w.entities = Array.from({ length: c.history }, (_, i) => ({
      id: `event-${i + 1}`,
      kind: "immutable event",
      location: "log",
      state: "retained",
      value: i % 2 === 0 ? 10 : -3,
      version: i + 1,
    }));
    const through = Math.min(c.snapshot, c.history);
    w.counters.balance = w.entities
      .slice(0, through)
      .reduce((sum, e) => sum + Number(e.value), 0);
    w.counters.skipped = through;
    w.fields.position = through;
  }
  if (id === "sagas")
    w.fields = {
      inventory: "available",
      payment: "not authorized",
      fulfillment: "not started",
    };
  if (id === "distributed-locks")
    w.fields = { holder: "A", leaseExpires: c.lease, fenceA: 1, fenceB: 0 };
  if (id === "disaster-recovery") w.counters.loss = c.backup;
  t.start();
  let attempt = 0,
    nextAttempt = 1,
    done = false,
    remoteDone = false,
    timeout = false,
    restoreAt: number | undefined,
    compensateAt: number | undefined;
  for (let time = 1; time <= 32; time++) {
    t.tick(time);
    if (id === "retries") {
      if (!done && time >= nextAttempt) {
        attempt++;
        t.count("attempts");
        const failed = w.failed || attempt < 3;
        w.nodes[1].status = failed ? "unavailable" : "ready";
        if (!failed) {
          done = true;
          t.count("completed");
          t.emit(
            time,
            "retry-success",
            `Attempt ${attempt} succeeded`,
            "The transient dependency failure has cleared.",
            "The operation stops retrying.",
            ["caller", "dependency"],
          );
        } else {
          t.count("errors");
          done = attempt >= c.attempts;
          nextAttempt =
            time +
            c.backoff * 2 ** (attempt - 1) +
            Math.floor(sample(seed, `jitter:${attempt}`) * 2);
          w.fields.nextAttempt = done ? "budget exhausted" : `${nextAttempt}s`;
          t.emit(
            time,
            done ? "exhausted" : "backoff",
            done
              ? "Attempt budget exhausted"
              : `Attempt ${attempt} failed; next at ${nextAttempt}s`,
            "The first two attempts fail transiently; injected failure can prolong the outage. Exponential backoff adds deterministic 0–1s jitter.",
            done
              ? "Surface the failure instead of retrying forever."
              : "Wait until the scheduled retry.",
            ["caller", "dependency"],
          );
        }
      } else
        t.emit(
          time,
          "wait",
          done ? "Retry sequence finished" : `Waiting until ${nextAttempt}s`,
          "No downstream call occurs during the wait.",
          "Step to the next scheduled event.",
        );
    } else if (id === "timeouts") {
      const duration = c.duration + (w.failed ? 32 : 0);
      w.counters.wait = Math.min(
        time,
        c.deadline,
        remoteDone ? c.duration : Infinity,
      );
      if (!remoteDone && time >= duration) {
        remoteDone = true;
        t.count("completed");
        w.fields.remote = "effect committed";
        t.emit(
          time,
          "remote-complete",
          "Remote effect committed",
          timeout
            ? "The caller already timed out; the effect still completed."
            : "The effect completed within the caller’s budget.",
          "Use the operation ID to reconcile before retrying.",
          ["dependency"],
        );
      }
      if (!timeout && !remoteDone && time >= c.deadline) {
        timeout = true;
        t.count("timedout");
        w.fields.caller = "timed out; outcome unknown";
        t.emit(
          time,
          "timeout",
          "Caller stopped waiting",
          "The caller’s deadline elapsed. It cannot infer whether the remote effect will commit.",
          "Continue to observe the remote operation.",
          ["caller"],
        );
      }
      t.emit(
        time,
        "budget",
        `Caller: ${timeout ? "timed out" : remoteDone ? "received result" : "waiting"}`,
        `Remote effect: ${remoteDone ? "committed" : "pending"}; operation ID order-42.`,
        "The two states are deliberately separate.",
      );
    } else if (id === "disaster-recovery") {
      if (time === 2 || (w.failed && restoreAt === undefined)) {
        restoreAt = time;
        w.nodes[0].status = "lost";
        w.nodes[2].status = "restoring";
        t.emit(
          time,
          "disaster",
          "Primary lost; restore begins",
          `The last verified backup is ${c.backup} minutes old.`,
          "The recovery environment must restore and validate.",
          ["primary", "backup", "restore"],
        );
      }
      if (restoreAt !== undefined) {
        w.counters.rto = Math.min(time - restoreAt, c.restore);
        if (time - restoreAt >= c.restore && !w.failed) {
          w.nodes[2].status = "ready";
          w.counters.completed = 1;
          t.emit(
            time,
            "restored",
            "Recovery environment ready",
            "The restore duration elapsed and recovery validation passed.",
            "Measure the loss window separately from recovery time.",
            ["backup", "restore"],
          );
        } else
          t.emit(
            time,
            "restoring",
            "Restoration in progress",
            "Service is still unavailable from the recovery environment.",
            "Continue until restore and validation finish.",
            ["backup", "restore"],
          );
      }
    } else if (id === "observability") {
      const traced = sample(seed, `trace:${time}`) * 100 < c.sample;
      const error = w.failed || time % 5 === 0;
      t.count("requests");
      if (error) t.count("errors");
      if (traced) t.count("traces");
      w.nodes[1].status = error ? "error" : "ready";
      w.entities.push({
        id: `request-${time}`,
        kind: traced ? "sampled trace" : "metric only",
        location: "telemetry",
        state: error ? "error" : "success",
        value: traced
          ? `app 1s → db ${error ? "failed" : "1s"} → response`
          : "request counted; spans not retained",
      });
      t.emit(
        time,
        "telemetry",
        `Request ${time}: ${error ? "error" : "success"}, ${traced ? "trace captured" : "not sampled"}`,
        "Every request contributes to metrics. A seeded sampling decision controls span retention only.",
        "Inspect the correlation ID and compare coverage.",
        ["app", "db", "telemetry"],
        `request-${time}`,
      );
    } else if (id === "event-sourcing") {
      if (w.failed) {
        w.nodes[1].status = "paused";
        t.emit(
          time,
          "projection-paused",
          "Projection worker paused",
          "The event log remains intact.",
          "Recovery resumes from the saved projection position.",
          ["projection"],
        );
        continue;
      }
      w.nodes[1].status = "ready";
      const position = Number(w.fields.position);
      if (position < c.history) {
        const e = w.entities[position];
        w.counters.balance += Number(e.value);
        w.fields.position = position + 1;
        t.count("replayed");
        e.state = "folded";
        t.emit(
          time,
          "fold",
          `${e.id} folded: ${Number(e.value) > 0 ? "+" : ""}${e.value}`,
          `The projection now has balance ${w.counters.balance}.`,
          "The next retained event advances the projection.",
          ["log", "projection"],
          e.id,
        );
      } else
        t.emit(
          time,
          "projection-complete",
          "Projection rebuilt",
          "The snapshot plus remaining event fold has reached the end of history.",
          "Compare with a replay from event one.",
          ["projection"],
        );
    } else if (id === "sagas") {
      if (time === 1) {
        w.fields.inventory = "reserved";
        t.count("attempts");
        t.count("completed");
        t.emit(
          time,
          "reserve",
          "Inventory reserved",
          "The inventory service committed its own local transaction.",
          "Authorize payment next.",
          ["inventory"],
        );
      } else if (time === 2) {
        w.fields.payment = "authorized";
        t.count("attempts");
        t.count("completed");
        t.emit(
          time,
          "authorize",
          "Payment authorized",
          "A second local transaction succeeded.",
          "Attempt fulfillment next.",
          ["payment"],
        );
      } else if (time === 4) {
        t.count("attempts");
        const fail = c.fail || w.failed;
        w.fields.fulfillment = fail ? "failed" : "fulfilled";
        if (fail) {
          t.count("errors");
          compensateAt = time + c.compensation;
        } else {
          done = true;
          t.count("completed");
        }
        t.emit(
          time,
          fail ? "fulfillment-failed" : "fulfilled",
          fail ? "Fulfillment failed" : "Order fulfilled",
          fail
            ? "Previous local commits remain in place. Compensation must undo the business effects."
            : "All local steps succeeded.",
          fail
            ? "Refund payment, then release inventory."
            : "The saga is complete.",
          ["fulfillment"],
        );
      } else if (compensateAt !== undefined && !done && time >= compensateAt) {
        if (time === compensateAt) {
          w.fields.payment = "refunded";
          t.count("completed");
          t.emit(
            time,
            "compensate",
            "Payment refunded",
            "Compensation records a new business action; it does not erase the authorization.",
            "Release inventory next.",
            ["payment"],
          );
        } else {
          w.fields.inventory = "released";
          done = true;
          t.count("completed");
          t.emit(
            time,
            "compensate",
            "Inventory released",
            "The inventory service reverses its reservation after the payment refund.",
            "The failed saga is compensated.",
            ["inventory"],
          );
        }
      } else
        t.emit(
          time,
          "saga-state",
          done ? "Saga finished" : "Waiting for next local action",
          Object.entries(w.fields)
            .map(([k, v]) => `${k}: ${v}`)
            .join("; "),
          "Inspect the timeline of commits and compensations.",
        );
    } else if (id === "distributed-locks") {
      const resume = c.pause + (w.failed ? 32 : 0);
      if (time === 1) {
        w.counters.token = 1;
        t.emit(
          time,
          "acquire",
          "Worker A acquired fence 1",
          `Its lease expires at ${c.lease}s.`,
          "The worker pauses before attempting its resource write.",
          ["lease", "worker-a"],
        );
      }
      if (time === c.lease) {
        w.fields.holder = "B";
        w.fields.fenceB = 2;
        w.counters.token = 2;
        t.count("writes");
        t.emit(
          time,
          "lease-expired",
          "Worker B acquired fence 2 and wrote",
          "A’s lease expired; the resource now remembers the higher token.",
          "A later write carrying fence 1 must be rejected.",
          ["lease", "worker-b", "resource"],
        );
      }
      if (!done && time >= resume) {
        done = true;
        const stale = time >= c.lease;
        if (stale) t.count("denied");
        else t.count("writes");
        t.emit(
          time,
          stale ? "fence-rejected" : "fence-write",
          stale
            ? "Worker A’s stale write rejected"
            : "Worker A wrote before lease expiry",
          stale
            ? "The protected resource rejects 1 < 2, even though A resumed believing it owned the lease."
            : "Fence 1 is still current at this point.",
          "Compare a pause shorter and longer than the lease.",
          ["worker-a", "resource"],
        );
      }
      t.emit(
        time,
        "lease-state",
        `Current holder: ${w.fields.holder}`,
        `Highest resource fence: ${w.counters.token || 0}; A’s token remains 1.`,
        "Inspect the lease and the resource-side fencing rule.",
      );
    }
  }
}
