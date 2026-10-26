// Personal data out of a trace before anything is shown or kept. A trace file can carry anything a program attached to
// its spans: emails, user IDs, addresses, tokens in URLs. System Lab keeps only two kinds of words from it, the names of
// services and of operations, and takes out of those whatever looks like an ID, an email, an address or a secret. Of
// the attributes, it reads only the few that say which database or queue a span called, and keeps them only as a kind
// and a name from a fixed list (or a service name, cleaned the same way). Every other value is never read.

import type { PartKind } from "../doc";
import { kindFromName } from "../import/infer";

/** The attributes read at all; every other attribute is skipped without looking at its value. */
export const READ_ATTRS = ["peer.service", "db.system", "messaging.system", "messaging.destination.name", "messaging.destination"] as const;
export type ReadAttr = (typeof READ_ATTRS)[number];

/** `db.system` and `messaging.system` values System Lab knows, as the name it shows and what kind of part it is. */
const SYSTEMS: Record<string, [string, PartKind]> = {
  postgresql: ["Postgres", "database"],
  mysql: ["MySQL", "database"],
  mariadb: ["MariaDB", "database"],
  mssql: ["SQL Server", "database"],
  oracle: ["Oracle", "database"],
  sqlite: ["SQLite", "database"],
  mongodb: ["MongoDB", "database"],
  cassandra: ["Cassandra", "database"],
  dynamodb: ["DynamoDB", "database"],
  cosmosdb: ["Cosmos DB", "database"],
  elasticsearch: ["Elasticsearch", "database"],
  opensearch: ["OpenSearch", "database"],
  clickhouse: ["ClickHouse", "database"],
  cockroachdb: ["CockroachDB", "database"],
  spanner: ["Spanner", "database"],
  firestore: ["Firestore", "database"],
  couchbase: ["Couchbase", "database"],
  neo4j: ["Neo4j", "database"],
  hbase: ["HBase", "database"],
  redis: ["Redis", "cache"],
  valkey: ["Valkey", "cache"],
  memcached: ["Memcached", "cache"],
  kafka: ["Kafka", "topic"],
  pulsar: ["Pulsar", "topic"],
  rocketmq: ["RocketMQ", "topic"],
  aws_sns: ["SNS", "topic"],
  gcp_pubsub: ["Pub/Sub", "topic"],
  aws_kinesis: ["Kinesis", "topic"],
  eventhubs: ["Event Hubs", "topic"],
  rabbitmq: ["RabbitMQ", "queue"],
  aws_sqs: ["SQS", "queue"],
  activemq: ["ActiveMQ", "queue"],
  servicebus: ["Service Bus", "queue"],
  nats: ["NATS", "queue"],
};

/** A known database or messaging system, by its attribute value; null for anything not on the list. */
function systemOf(value: unknown): [string, PartKind] | null {
  if (typeof value !== "string") return null;
  return SYSTEMS[value.toLowerCase().replace(/[.\s-]/g, "_")] ?? null;
}

/**
 * A name with what could identify someone taken out: the query string and anything after it, quoted text, a URL's
 * host, emails, IP addresses, UUIDs and long hex, long tokens, and any word that is a number or carries two or more
 * digits (`/users/12345` → `/users/{id}`; `v2`, `s3` and `oauth2` stay). Empty when nothing is left but placeholders.
 */
export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const s = raw
    .slice(0, 400)
    .replace(/[?#;].*$/s, "")
    .replace(/'[^']*'|"[^"]*"/g, "{text}")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/]*/gi, "")
    .replace(/[\w.+-]+(?:@|%40)[\w-]+(?:\.[\w-]+)+/gi, "{email}")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "{ip}")
    .replace(/(?<![\w:.])(?=[0-9a-f:]*\d)(?=(?:[^:\s]*:){2})[0-9a-f:]{3,}(?![\w:.])/gi, "{ip}")
    .replace(/\b[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\b/gi, "{id}")
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, "{id}")
    .replace(/[A-Za-z0-9]{24,}/g, "{token}")
    .replace(/[A-Za-z0-9]+/g, (w) => (/^\d+$/.test(w) || (w.match(/\d/g)?.length ?? 0) >= 2 ? "{id}" : w))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
  return /[A-Za-z]/.test(s.replace(/\{\w+\}/g, "")) ? s : "";
}

/**
 * A service's name, cleaned, with the placeholders a pod's or host's name leaves at its end taken off
 * (`orders-7d9f8b6c4-x2k9p` → `orders`). Empty when nothing is left: the reader letters it ("Service B").
 */
export function serviceName(raw: unknown): string {
  return cleanName(raw)
    .replace(/(?:[-_. :]*\{\w+\})+$/, "")
    .replace(/^(?:\{\w+\}[-_. :]*)+/, "")
    .slice(0, 40)
    .trim();
}

/**
 * What a call leaves to, from its whitelisted attributes: a named service, a database or cache from the list, or a
 * queue or topic. Null when the attributes say nothing about it.
 */
export function peerOf(attr: (key: ReadAttr) => unknown, messaging: boolean): { name: string; kind?: PartKind } | null {
  const service = serviceName(attr("peer.service"));
  const db = systemOf(attr("db.system"));
  if (db) return { name: service || db[0], kind: db[1] };
  const sys = systemOf(attr("messaging.system"));
  if (sys || messaging || attr("messaging.system") !== undefined) {
    const kind = sys?.[1] === "queue" || sys?.[1] === "topic" ? sys[1] : "queue";
    const where = serviceName(attr("messaging.destination.name") ?? attr("messaging.destination"));
    // A queue named like a service ("orders") says what it is, so it never merges with the service.
    return { name: where ? (kindFromName(where) === kind ? where : `${where} ${kind}`) : (sys?.[0] ?? "Messages"), kind };
  }
  if (attr("db.system") !== undefined) return { name: service || "Database", kind: "database" };
  return service ? { name: service } : null;
}
