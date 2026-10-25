// Guessing what a part is from what people call it: "postgres" is a database, "redis" a cache, "nginx" a balancer. The
// import screen shows each guess, and one tap changes it.

import type { PartKind } from "../doc";

/** Name patterns, most specific first. */
const RULES: [RegExp, PartKind][] = [
  [/\b(bots?|scrapers?|crawler traffic|attackers?)\b/i, "bots"],
  [/\b(users?|clients?|customers?|people|visitors?|browsers?|shoppers?|readers?|viewers?|riders?|players?|mobile|web app|frontend users)\b/i, "users"],
  [/\b(dead[- ]?letters?|dlq)\b/i, "queue"],
  [/\b(sqs|rabbit(mq)?|queue|celery|sidekiq|nats|beanstalk|resque|bull|jobs?)\b/i, "queue"],
  [/\b(kafka|kinesis|pulsar|topic|pub\/?sub|sns|event ?bus|eventbridge|stream)\b/i, "topic"],
  [/\b(redis|memcached?|valkey|cache|varnish)\b/i, "cache"],
  [/\b(cdn|cloudfront|fastly|akamai|cloudflare|edge)\b/i, "cdn"],
  [/\b(dns|route ?53|geo)\b/i, "dns"],
  [/\b(rate ?limit(er)?|throttle|waf)\b/i, "limiter"],
  [/\b(nginx|envoy|haproxy|traefik|alb|elb|nlb|lb|load ?balancer|ingress|gateway|proxy|kong|apigee)\b/i, "balancer"],
  [/\b(postgres(ql)?|pg|mysql|mariadb|aurora|mongo(db)?|dynamo(db)?|spanner|cockroach(db)?|cassandra|scylla|sqlite|oracle|mssql|sql ?server|db|database|datastore|store|elastic(search)?|opensearch|clickhouse|bigtable|firestore)\b/i, "database"],
  [/\b(workers?|consumers?|crons?|scheduler|processors?|mailer|sender)\b/i, "worker"],
  [/\b(stripe|paypal|adyen|braintree|twilio|sendgrid|mailgun|ses|s3|gcs|blob|openai|anthropic|external|third[- ]?party|vendor|provider|webhook)\b/i, "external"],
];

/** The kind a part's name suggests; a service when nothing does. */
export function kindFromName(name: string): PartKind {
  for (const [re, kind] of RULES) if (re.test(name)) return kind;
  return "service";
}

/** A docker image's kind ("postgres:16" is a database), or null when the image says nothing. */
export function kindFromImage(image: string): PartKind | null {
  const base = image.split("/").pop()!.split(":")[0];
  const k = kindFromName(base);
  return k === "service" ? null : k;
}
