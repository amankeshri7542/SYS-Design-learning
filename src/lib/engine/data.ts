import { Timeline, node, hash, sample, type Entity } from "./model";

export function replicas(t: Timeline) {
  const { lesson: id, values: c } = t.config,
    w = t.world;
  const n = c.readers || c.copies || 1;
  w.nodes = [
    node(
      "primary",
      id === "cqrs" ? "Command model" : "Writer",
      id === "replication" ? "Aurora writer" : "DynamoDB",
    ),
    ...Array.from({ length: n }, (_, i) =>
      node(
        `replica${i}`,
        id === "cqrs"
          ? "Query projection"
          : id === "denormalization"
            ? `Read view ${i + 1}`
            : `Replica ${i + 1}`,
        id === "replication"
          ? "Aurora reader"
          : id === "eventual-consistency"
            ? "DynamoDB global table (MREC)"
            : "DynamoDB table",
      ),
    ),
  ];
  w.edges = w.nodes.slice(1).map((r) => ["primary", r.id]);
  w.entities = w.nodes.map((r) => ({
    id: r.id,
    kind: "versioned value",
    location: r.id,
    state: "current",
    value: "price 20",
    version: 1,
  }));
  const pending: { at: number; version: number }[] = [];
  let version = 1;
  t.start();
  for (let time = 1; time <= 24; time++) {
    t.tick(time);
    if ([2, 5, 8].includes(time)) {
      version++;
      const primary = w.entities[0];
      primary.version = version;
      primary.value = `price ${19 + version}`;
      for (const e of w.entities)
        e.state = e.version === version ? "current" : "stale";
      t.count("writes");
      pending.push({ at: time + c.lag, version });
      t.emit(
        time,
        "commit",
        `Writer committed v${version}`,
        "The committed source value changes before asynchronous copies receive it.",
        "Watch each replica version and the read path.",
        ["primary"],
        "primary",
      );
    }
    for (const r of w.nodes.slice(1))
      r.status = w.failed ? "disconnected" : "ready";
    if (!w.failed) {
      for (const update of pending.filter((p) => p.at <= time)) {
        for (const r of w.entities.slice(1)) {
          r.version = update.version;
          r.value = `price ${19 + update.version}`;
          r.state = r.version === version ? "current" : "stale";
          t.count("applied");
        }
        t.emit(
          time,
          "replicate",
          `Copies applied v${update.version}`,
          "Ordered delivery advances each copy to a newer committed version.",
          "Reads from these copies can now observe that version.",
          ["primary", ...w.nodes.slice(1).map((n) => n.id)],
        );
      }
      for (let i = pending.length - 1; i >= 0; i--)
        if (pending[i].at <= time) pending.splice(i, 1);
    }
    const quorumBlocked = id === "cap" && w.failed && !c.available;
    if (quorumBlocked) {
      t.count("denied");
      t.emit(
        time,
        "quorum-denied",
        "Read rejected: quorum unavailable",
        "The chosen policy refuses to return an uncoordinated value.",
        "Heal the partition or compare the available local-read policy.",
        ["replica0"],
      );
    } else {
      const strong = id === "strong-consistency" && c.strong === 1;
      const target = strong ? w.entities[0] : w.entities[1 + (time % n)];
      t.count("reads");
      t.count("rcu", strong ? 1 : 0.5);
      if (target.version !== version) t.count("stale");
      w.fields.lastRead = `${target.id}: v${target.version}; committed v${version}`;
      t.emit(
        time,
        target.version === version ? "fresh-read" : "stale-read",
        `Read returned v${target.version} from ${target.id}`,
        strong
          ? "The regional strong read uses the authoritative committed value."
          : `This local copy ${target.version === version ? "has caught up" : "has not received every update"}.`,
        "Continue until writes stop and replicas converge.",
        [target.location],
        target.id,
      );
    }
    w.fields.pendingVersions =
      pending.map((p) => `v${p.version} due ${p.at}s`).join(", ") || "none";
    for (const e of w.entities)
      e.state = e.version === version ? "current" : "stale";
    t.emit(
      time,
      "versions",
      "Version ledger updated",
      `Writer v${version}; ${pending.length} update(s) awaiting delivery.`,
      "Inspect a copy to see its value and version.",
    );
  }
}

export type RingPoint = { position: number; owner: string };
export function ring(
  nodes: number,
  virtual: number,
  seed: number,
): RingPoint[] {
  return Array.from({ length: nodes }, (_, i) =>
    Array.from({ length: virtual }, (_, j) => ({
      position: hash(`node:${i}:${j}`, seed) % 360,
      owner: `node-${i + 1}`,
    })),
  )
    .flat()
    .sort((a, b) => a.position - b.position || a.owner.localeCompare(b.owner));
}
export function owner(position: number, points: RingPoint[]): string {
  return (points.find((n) => n.position >= position) || points[0]).owner;
}
export function hashing(t: Timeline) {
  const { lesson: id, values: c, seed } = t.config,
    w = t.world;
  const initial = ring(c.nodes, c.virtual || 1, seed);
  const expanded = ring(c.nodes + 1, c.virtual || 1, seed);
  w.nodes = Array.from({ length: c.nodes }, (_, i) =>
    node(
      `node-${i + 1}`,
      `${id === "sharding" ? "Partition" : "Node"} ${i + 1}`,
      id === "sharding" ? "DynamoDB partition" : "EC2 application ring",
    ),
  );
  w.fields.positions = JSON.stringify(initial);
  w.fields.membership = "Initial";
  w.edges = [];
  w.entities = Array.from({ length: 24 }, (_, i) => {
    const position = hash(`key:${i}`, seed) % 360;
    const assigned =
      id === "sharding"
        ? `node-${1 + (hash(`key:${i}`, seed) % c.nodes)}`
        : owner(position, initial);
    return {
      id: `key-${i + 1}`,
      kind: "hashed key",
      position,
      owner: assigned,
      location: assigned,
      state: "assigned",
      value: 0,
    };
  });
  w.counters.keys = 24;
  const refreshRing = () => {
    const added = w.nodes.find((n) => n.id === `node-${c.nodes + 1}`);
    if (added) added.status = w.failed ? "unavailable" : "ready";
    const loads = w.nodes.map(
      (n) => w.entities.filter((e) => e.owner === n.id).length,
    );
    w.counters.maxload = Math.max(...loads);
    w.nodes.forEach(
      (n, i) => (n.detail = `${loads[i]} owned keys; ${n.status}.`),
    );
  };
  if (id !== "sharding") refreshRing();
  t.start();
  for (let time = 1; time <= 24; time++) {
    t.tick(time);
    if (id === "sharding") {
      const key =
        sample(seed, `hot:${time}`) * 100 < c.skew
          ? w.entities[0]
          : w.entities[Math.floor(sample(seed, `key:${time}`) * 24)];
      key.value = Number(key.value) + 1;
      w.fields.lastRead = key.id;
      const loads = w.nodes.map((n) =>
        w.entities
          .filter((e) => e.owner === n.id)
          .reduce((a, e) => a + Number(e.value), 0),
      );
      w.counters.maxload = Math.max(...loads);
      w.counters.minload = Math.min(...loads);
      w.nodes.forEach(
        (n, i) => (n.detail = `${loads[i]} requests to this partition.`),
      );
      t.emit(
        time,
        "partition-route",
        `${key.id} → ${key.owner}`,
        "The partition key selects one destination. Hot-key requests keep selecting that destination.",
        "Compare load imbalance as hot-key share increases.",
        [key.owner!],
        key.id,
      );
    } else {
      if (time === 8) {
        w.nodes.push(
          node(
            `node-${c.nodes + 1}`,
            `New node ${c.nodes + 1}`,
            "EC2 application ring",
          ),
        );
        w.fields.membership = "Node added";
        w.fields.positions = JSON.stringify(expanded);
        for (let i = 0; i < w.entities.length; i++) {
          const key = w.entities[i],
            next = owner(key.position!, expanded);
          if (next !== key.owner) {
            key.state = "moved";
            t.count("moved");
          }
          key.owner = next;
          key.location = next;
          if (
            hash(`key:${i}`, seed) % c.nodes !==
            hash(`key:${i}`, seed) % (c.nodes + 1)
          )
            t.count("modulo");
        }
        refreshRing();
        t.emit(
          time,
          "membership",
          "A node joined the ring",
          "Every key selects its first clockwise virtual position. The ring is finite, so movement is measured rather than assumed.",
          "Inspect moved keys and compare with modulo remapping.",
          w.nodes.map((n) => n.id),
        );
      }
      refreshRing();
      const added = w.nodes.find((n) => n.id === `node-${c.nodes + 1}`);
      const key = w.entities[time - 1];
      t.emit(
        time,
        "ring-lookup",
        `${key.id} at ${key.position}° → ${key.owner}`,
        w.failed && key.owner === added?.id
          ? "The owner is down. This model intentionally has no replication or automatic membership removal."
          : "Wrap clockwise from the key to the next virtual node position.",
        "Changing membership remaps keys; recovering the node restores its same ownership.",
        [key.owner!],
        key.id,
      );
    }
  }
}

export function records(t: Timeline) {
  const { lesson: id, values: c } = t.config,
    w = t.world;
  if (id === "transactions") {
    w.nodes = [node("ledger", "Atomic ledger", "Aurora PostgreSQL")];
    w.entities = [
      {
        id: "account-A",
        kind: "account",
        location: "ledger",
        state: "committed",
        value: 100,
      },
      {
        id: "account-B",
        kind: "account",
        location: "ledger",
        state: "committed",
        value: 50,
      },
    ];
  } else if (id === "optimistic-locking") {
    w.nodes = [node("item", "Versioned item", "DynamoDB conditional write")];
    w.entities = [
      {
        id: "product",
        kind: "record",
        location: "item",
        state: "committed",
        value: 20,
        version: 1,
      },
    ];
  } else if (id === "indexing") {
    w.nodes = [
      node("base", "Product table", "DynamoDB"),
      node("index", "Category index", "DynamoDB GSI"),
    ];
    w.edges = [["base", "index"]];
    w.entities = Array.from({ length: 20 }, (_, i) => ({
      id: `row-${i + 1}`,
      kind: "record",
      location: "base",
      state: "stored",
      value: i < c.selectivity ? "books" : "other",
    }));
  } else {
    w.nodes = [
      node("metadata", "Metadata / lifecycle rule", "Application metadata"),
      node("object", "Object", "S3"),
    ];
    w.edges = [["metadata", "object"]];
    w.entities = [
      {
        id: "image.jpg",
        kind: "object",
        location: "object",
        state: id === "object-storage" ? "uploading" : "hot",
        value: 0,
      },
    ];
  }
  t.start();
  let restoreStart: number | undefined;
  for (let time = 1; time <= 24; time++) {
    t.tick(time);
    if (id === "transactions") {
      const wait = 1 + c.conflict;
      if (time % wait !== 0) {
        t.count("wait");
        t.emit(
          time,
          "lock-wait",
          "Transfer waits for its turn",
          "Contending clients serialize access to these balances.",
          "The next free slot can execute an atomic transfer.",
          ["ledger"],
        );
        continue;
      }
      const reject =
        c.fail === 1 || w.failed || Number(w.entities[0].value) < 10;
      t.count("attempts");
      if (reject) {
        t.count("conflicts");
        t.emit(
          time,
          "rollback",
          "Transfer rolled back",
          "A constraint or dependency prevented commit; both balances remain unchanged.",
          "Inspect that A + B remains 150.",
          ["ledger"],
        );
      } else {
        w.entities[0].value = Number(w.entities[0].value) - 10;
        w.entities[1].value = Number(w.entities[1].value) + 10;
        t.count("writes", 2);
        t.emit(
          time,
          "commit",
          "Debit and credit committed together",
          "Both changes become visible in one atomic event.",
          "The total stays 150 after every event.",
          ["ledger"],
        );
      }
    } else if (id === "optimistic-locking") {
      const item = w.entities[0];
      const old = item.version!;
      item.version = old + 1;
      item.value = Number(item.value) + 1;
      t.count("writes");
      t.emit(
        time,
        "conditional-write",
        `Writer committed v${item.version}`,
        `Its expected version ${old} matched before the write.`,
        "Other editors still holding the old version must reread.",
        ["item"],
        item.id,
      );
      t.count("conflicts", c.conflict);
      w.fields.rejectedVersion = old;
      t.emit(
        time,
        "version-conflict",
        `${c.conflict} stale editor(s) rejected`,
        `Their expected v${old} does not match v${item.version}.`,
        "Reread and recompute before retrying.",
        ["item"],
        item.id,
      );
    } else if (id === "indexing") {
      const examined = c.indexed ? c.selectivity : 20;
      t.count("reads", examined);
      if (time === 1) {
        t.count("writes", 20 + (c.indexed ? 20 : 0));
        w.fields.indexEntries = c.indexed ? 20 : 0;
      }
      w.entities.forEach(
        (e) =>
          (e.state =
            e.value === "books"
              ? "matched"
              : c.indexed
                ? "not examined"
                : "scanned"),
      );
      t.emit(
        time,
        "query",
        `${c.selectivity} results; ${examined} rows examined`,
        c.indexed
          ? "The projected category index narrows the access path. Initial population also wrote 20 index entries."
          : "A full scan examines every base row and filters the results.",
        "Compare rows examined with write amplification.",
        [c.indexed ? "index" : "base"],
      );
    } else if (id === "object-storage") {
      const transferred = w.counters.transferred || 0;
      if (!w.failed)
        w.counters.transferred = Math.min(c.size, transferred + c.bandwidth);
      w.counters.remaining = c.size - (w.counters.transferred || 0);
      w.entities[0].value = `${w.counters.transferred || 0} / ${c.size} MB`;
      w.entities[0].state = w.counters.remaining ? "uploading" : "ready";
      w.nodes[1].status = w.failed ? "disconnected" : "ready";
      w.counters.writes = w.counters.remaining === 0 ? 1 : 0;
      t.emit(
        time,
        w.counters.remaining ? "transfer" : "object-ready",
        w.counters.remaining
          ? `${w.counters.remaining} MB remain`
          : "Object complete; metadata points to it",
        w.failed
          ? "No bytes cross the disconnected transfer."
          : `The link transfers up to ${c.bandwidth} MB per simulated second.`,
        "Only a completed upload produces a ready metadata pointer.",
        ["object", ...(w.counters.remaining ? [] : ["metadata"])],
        "image.jpg",
      );
    } else {
      const age = c.age + time - 1;
      w.counters.age = age;
      const tier =
        age >= 90 ? "archive" : age >= 30 ? "infrequent access" : "hot";
      if (tier === "archive" && restoreStart === undefined) restoreStart = time;
      const restored =
        restoreStart !== undefined && time - restoreStart >= c.restore;
      w.entities[0].state =
        tier === "archive" ? (restored ? "restored copy" : "restoring") : tier;
      w.entities[0].value = `${age} days`;
      w.counters.restores = restored ? 1 : 0;
      w.counters.wait =
        restoreStart === undefined
          ? 0
          : Math.min(time - restoreStart, c.restore);
      t.emit(
        time,
        "lifecycle",
        `${tier}: ${w.entities[0].state}`,
        "One observation advances object age by one day; playback uses simulated seconds. Thresholds are illustrative (30 and 90 days).",
        tier === "archive"
          ? "Restoration creates an accessible copy without changing the archived original."
          : "Continue until the next age threshold.",
        ["metadata", "object"],
        "image.jpg",
      );
    }
  }
}

export function identity(t: Timeline) {
  const { lesson: id, values: c, seed } = t.config,
    w = t.world;
  w.nodes =
    id === "secrets"
      ? [
          node("authority", "Secret versions", "Secrets Manager"),
          node("client", "Application credential", "Application code"),
        ]
      : id === "encryption"
        ? [
            node("authority", "Key policy", "KMS"),
            node("client", "Encrypted object", "S3"),
          ]
        : [
            node(
              "authority",
              id === "authentication"
                ? "Token verifier"
                : "Action / ownership policy",
              id === "authentication"
                ? "Cognito JWT validation"
                : "IAM + application ownership checks",
            ),
            node("client", "Requested resource", "Application"),
          ];
  w.edges = [["authority", "client"]];
  let cached = 1,
    lastRefresh = 0;
  t.start();
  for (let time = 1; time <= 24; time++) {
    let allowed = false,
      reason = "";
    if (id === "authentication") {
      const signature = sample(seed, `signature:${time}`) * 100 >= c.invalid;
      const issued = time <= 12 ? 0 : 12;
      allowed = signature && time < issued + c.lifetime;
      reason = `Token issued at ${issued}s; expiry ${issued + c.lifetime}s; signature ${signature ? "valid" : "invalid"}.`;
      w.entities = [
        {
          id: `token-${issued}`,
          kind: "token",
          location: "authority",
          state: allowed ? "verified" : "invalid or expired",
          value: "subject: learner",
          expires: issued + c.lifetime,
        },
      ];
    }
    if (id === "authorization") {
      const own = sample(seed, `owner:${time}`) * 100 >= c.cross;
      allowed = own && c.allow === 1;
      reason = `Verified learner requests read on ${own ? "own" : "another user’s"} order; own-read policy ${c.allow ? "allows" : "denies"}.`;
      w.entities = [
        {
          id: `order-${time}`,
          kind: "authorization request",
          location: "client",
          state: allowed ? "allowed" : "denied",
          value: "read",
          owner: own ? "learner" : "another-user",
        },
      ];
    }
    if (id === "encryption") {
      const key = time >= c.rotation ? 2 : 1;
      allowed = c.allow === 1;
      reason = `Ciphertext uses key v1; current key is v${key}. Rotation retains v1 for decryption. Key permission ${allowed ? "allows" : "denies"} this call.`;
      w.entities = [
        {
          id: "ciphertext",
          kind: "encrypted object",
          location: "client",
          state: "encrypted",
          value: "ciphertext",
          version: 1,
        },
        {
          id: "key",
          kind: "key version",
          location: "authority",
          state: "enabled; old key retained",
          value: `current v${key}`,
          version: key,
        },
      ];
    }
    if (id === "secrets") {
      const current = time >= 6 ? 2 : 1;
      if (time === 1 || time - lastRefresh >= c.refresh) {
        cached = current;
        lastRefresh = time;
        t.count("refreshes");
      }
      allowed = cached === current || time < 6 + c.overlap;
      reason = `Rotation at 6s; old version retires at ${6 + c.overlap}s; last client refresh ${lastRefresh}s.`;
      w.entities = [
        {
          id: "secret",
          kind: "secret version",
          location: "authority",
          state: "current",
          value: "redacted",
          version: current,
        },
        {
          id: "credential-cache",
          kind: "cached credential",
          location: "client",
          state: allowed ? "accepted" : "retired",
          value: "redacted",
          version: cached,
        },
      ];
    }
    t.count(allowed ? "allowed" : "denied");
    w.nodes[1].status = allowed ? "accessible" : "denied";
    t.emit(
      time,
      allowed ? "allow" : "deny",
      `Request ${time}: ${allowed ? "allowed" : "denied"}`,
      reason,
      "Inspect the identity, version, or policy fields before the next request.",
      ["authority", ...(allowed ? ["client"] : [])],
    );
  }
}

export function network(t: Timeline) {
  const { lesson: id, values: c, seed } = t.config,
    w = t.world;
  w.nodes =
    id === "network-isolation"
      ? [
          node("internet", "Public internet", "Internet gateway"),
          node("app", "Application subnet", "VPC private subnet"),
          node("db", "Database subnet", "RDS security group"),
        ]
      : [
          node("internet", "HTTP clients", "Internet"),
          node("edge", "Edge filter", "CloudFront + WAF"),
          node("origin", "Application origin", "ALB"),
        ];
  w.edges =
    id === "network-isolation"
      ? [
          ["internet", "app"],
          ["app", "db"],
          ...(c.public ? [["internet", "db"] as [string, string]] : []),
        ]
      : [
          ["internet", "edge"],
          ["edge", "origin"],
        ];
  t.start();
  for (let time = 1; time <= 24; time++) {
    const external = time % 2 === 1;
    const abuse = sample(seed, `abuse:${time}`) * 100 < c.abuse;
    const allowed =
      id === "network-isolation"
        ? external
          ? !!c.public
          : !!c.app
        : !abuse || !c.enforce;
    const source = external ? "internet" : "app";
    t.count("offered");
    t.count(allowed ? "allowed" : "denied");
    w.entities = [
      {
        id: `connection-${time}`,
        kind: id === "network-isolation" ? "TCP connection" : "HTTP request",
        location: allowed
          ? id === "network-isolation"
            ? "db"
            : "origin"
          : id === "network-isolation"
            ? source
            : "edge",
        state: allowed ? "allowed" : "blocked",
        value:
          id === "network-isolation"
            ? `${source} → database:5432`
            : abuse
              ? "rule matched"
              : "no rule match",
      },
    ];
    w.fields.rule =
      id === "network-isolation"
        ? `Public ingress ${c.public ? "open" : "closed"}; application ingress ${c.app ? "allowed" : "denied"}`
        : `WAF mode: ${c.enforce ? "block" : "count"}`;
    t.emit(
      time,
      allowed ? "forward" : "block",
      `${id === "network-isolation" ? source : abuse ? "Matching request" : "Clean request"}: ${allowed ? "forwarded" : "blocked"}`,
      id === "network-isolation"
        ? "Source identity and the database ingress rule determine this connection. Security groups are stateful."
        : abuse && !c.enforce
          ? "Count mode records the match without blocking the request."
          : "Only matching requests under an enforcing rule are blocked.",
      "Inspect the boundary rule and the destination.",
      id === "network-isolation"
        ? [source, ...(allowed ? ["db"] : [])]
        : ["internet", "edge", ...(allowed ? ["origin"] : [])],
      `connection-${time}`,
    );
  }
}
