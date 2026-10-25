// Systems to start from: each a common shape, small enough to read at a glance, with one line saying what it is. A
// template is only a `SystemDoc`; everything after the first tap is the learner's own.

import type { SystemDoc } from "./doc";

export interface Template {
  id: string;
  name: string;
  /** What it is, in a line. */
  line: string;
  /** The shape in arrows, for the gallery. */
  shape: string;
  doc: SystemDoc;
}

const targets = { p95Ms: 400, failed: 0.01 };

export const TEMPLATES: Template[] = [
  {
    id: "web-app",
    name: "Web app",
    line: "The classic: a balancer, a few app servers, a cache and a database.",
    shape: "Users → Load balancer → App ×3 → Cache → Database",
    doc: {
      v: 1,
      name: "My web app",
      template: "web-app",
      targets,
      parts: [
        { id: "users", kind: "users", name: "Users", to: ["lb"], set: { rate: 60, writes: 0.1 } },
        { id: "lb", kind: "balancer", name: "Load balancer", to: ["app"] },
        { id: "app", kind: "service", name: "App", count: 3, to: ["cache"], set: { workers: 4, ms: 40 } },
        { id: "cache", kind: "cache", name: "Cache", to: ["db"], set: { capacity: 80 } },
        { id: "db", kind: "database", name: "Database", set: { workers: 4, ms: 90 } },
      ],
    },
  },
  {
    id: "replicas",
    name: "Read-heavy app",
    line: "Most requests read. Copies of the database share the reads, and one takes over if the main copy dies.",
    shape: "Users → Load balancer → App ×2 → Database + 2 copies",
    doc: {
      v: 1,
      name: "My read-heavy app",
      template: "replicas",
      targets,
      parts: [
        { id: "users", kind: "users", name: "Users", to: ["lb"], set: { rate: 80, writes: 0.15 } },
        { id: "lb", kind: "balancer", name: "Load balancer", to: ["app"] },
        { id: "app", kind: "service", name: "App", count: 2, to: ["db"], set: { workers: 8, ms: 20 } },
        { id: "db", kind: "database", name: "Database", set: { workers: 4, ms: 70, replicas: 2, lagMs: 200, failover: true } },
      ],
    },
  },
  {
    id: "shop",
    name: "Online shop",
    line: "Pages call a slow recommendations service. A bot scrapes prices; a limiter keeps it in check.",
    shape: "Shoppers, Bot → Rate limiter → Shop ×2 → Cache → Database, Recommendations",
    doc: {
      v: 1,
      name: "My shop",
      template: "shop",
      targets: { p95Ms: 600, failed: 0.01 },
      parts: [
        { id: "shoppers", kind: "users", name: "Shoppers", to: ["limiter"], set: { rate: 40, writes: 0.2 } },
        { id: "bot", kind: "bots", name: "Scraper bot", to: ["limiter"], set: { rate: 120 } },
        { id: "limiter", kind: "limiter", name: "Rate limiter", to: ["lb"], set: { rps: 50 } },
        { id: "lb", kind: "balancer", name: "Load balancer", to: ["shop"] },
        { id: "shop", kind: "service", name: "Shop", count: 2, to: ["cache", "recs"], set: { workers: 8, ms: 30 } },
        { id: "recs", kind: "external", name: "Recommendations", set: { ms: 120 } },
        { id: "cache", kind: "cache", name: "Cache", to: ["db"] },
        { id: "db", kind: "database", name: "Database", set: { workers: 6 } },
      ],
    },
  },
  {
    id: "jobs",
    name: "Background jobs",
    line: "Sign-ups answer at once; workers send the welcome emails from a queue, setting aside the ones that keep failing.",
    shape: "Users → API → Queue → Worker ×3 → Email provider",
    doc: {
      v: 1,
      name: "My background jobs",
      template: "jobs",
      targets,
      parts: [
        { id: "users", kind: "users", name: "Sign-ups", to: ["api"], set: { rate: 20, writes: 1, shape: "spiky" } },
        { id: "api", kind: "service", name: "API", to: ["queue"], set: { workers: 6, ms: 15 } },
        { id: "queue", kind: "queue", name: "Email queue", to: ["worker"], set: { ack: true, deadLetter: true } },
        { id: "worker", kind: "worker", name: "Worker", count: 3, to: ["email"], set: { ms: 30 } },
        { id: "email", kind: "external", name: "Email provider", set: { ms: 200 } },
      ],
    },
  },
  {
    id: "events",
    name: "Event-driven orders",
    line: "Each order is saved, then announced on a topic; three services each get their own copy.",
    shape: "Shop → Orders → Database, Topic → Email, Stock, Analytics",
    doc: {
      v: 1,
      name: "My order events",
      template: "events",
      targets,
      parts: [
        { id: "shop", kind: "users", name: "Shop", to: ["orders"], set: { rate: 15, writes: 1 } },
        { id: "orders", kind: "service", name: "Orders", to: ["db", "topic"], set: { workers: 8, ms: 25 } },
        { id: "db", kind: "database", name: "Orders DB", set: { ms: 40 } },
        { id: "topic", kind: "topic", name: "Order placed", to: ["email", "stock", "stats"] },
        { id: "email", kind: "worker", name: "Email", set: { workers: 3, ms: 60 } },
        { id: "stock", kind: "worker", name: "Stock", set: { workers: 3, ms: 40 } },
        { id: "stats", kind: "worker", name: "Analytics", set: { workers: 3, ms: 60 } },
      ],
    },
  },
  {
    id: "video",
    name: "Video to the world",
    line: "Viewers on three continents; a CDN edge near each answers from its copies, and only misses cross to the origin.",
    shape: "Europe, Americas, Asia → their CDN edges → Origin",
    doc: {
      v: 1,
      name: "My video service",
      template: "video",
      targets,
      parts: [
        { id: "eu", kind: "users", name: "Europe", to: ["edge-eu"], set: { rate: 30, writes: 0 } },
        { id: "am", kind: "users", name: "Americas", to: ["edge-am"], set: { rate: 30, writes: 0 } },
        { id: "as", kind: "users", name: "Asia", to: ["edge-as"], set: { rate: 30, writes: 0 } },
        { id: "edge-eu", kind: "cdn", name: "Edge Europe", to: ["origin"] },
        { id: "edge-am", kind: "cdn", name: "Edge Americas", to: ["origin"] },
        { id: "edge-as", kind: "cdn", name: "Edge Asia", to: ["origin"] },
        { id: "origin", kind: "service", name: "Origin", set: { workers: 8, ms: 40 } },
      ],
    },
  },
  {
    id: "crawler",
    name: "Web crawler",
    line: "Fetchers take pages from a frontier queue and fetch them from a slow, flaky web.",
    shape: "New links → Frontier → Fetcher ×4 → The web",
    doc: {
      v: 1,
      name: "My crawler",
      template: "crawler",
      targets: { p95Ms: 1000, failed: 0.02 },
      parts: [
        { id: "links", kind: "users", name: "New links", to: ["frontier"], set: { rate: 30, writes: 1 } },
        { id: "frontier", kind: "queue", name: "Frontier", to: ["fetcher"], set: { ack: true, deadLetter: true } },
        { id: "fetcher", kind: "worker", name: "Fetcher", count: 4, to: ["web"], set: { workers: 4, ms: 10 } },
        { id: "web", kind: "external", name: "The web", set: { workers: 64, ms: 250 } },
      ],
    },
  },
  {
    id: "sharded",
    name: "Write-heavy app",
    line: "Most requests write. The keys are split across three databases, so each takes a third.",
    shape: "Users → App → Database in 3 shards",
    doc: {
      v: 1,
      name: "My write-heavy app",
      template: "sharded",
      targets,
      parts: [
        { id: "users", kind: "users", name: "Users", to: ["app"], set: { rate: 60, writes: 0.8 } },
        { id: "app", kind: "service", name: "App", to: ["db"], set: { workers: 24, ms: 10 } },
        { id: "db", kind: "database", name: "Database", set: { workers: 3, ms: 60, shards: 3 } },
      ],
    },
  },
  {
    id: "feed",
    name: "Social feed",
    line: "Readers open feeds all day; one celebrity's posts are a third of everything read.",
    shape: "Readers → Load balancer → Feed ×3 → Cache → Timelines",
    doc: {
      v: 1,
      name: "My social feed",
      template: "feed",
      targets,
      parts: [
        { id: "readers", kind: "users", name: "Readers", to: ["lb"], set: { rate: 90, writes: 0.05, hot: 0.33, shape: "daily" } },
        { id: "lb", kind: "balancer", name: "Load balancer", to: ["feed"] },
        { id: "feed", kind: "service", name: "Feed", count: 3, to: ["cache"], set: { workers: 6, ms: 25 } },
        { id: "cache", kind: "cache", name: "Cache", to: ["db"], set: { capacity: 60, ttlMs: 8000 } },
        { id: "db", kind: "database", name: "Timelines", set: { workers: 6, ms: 80 } },
      ],
    },
  },
  {
    id: "blank",
    name: "Start small",
    line: "Users and one service. Add parts as you go.",
    shape: "Users → Service",
    doc: {
      v: 1,
      name: "My system",
      template: "blank",
      targets,
      parts: [
        { id: "users", kind: "users", name: "Users", to: ["service"], set: { rate: 20 } },
        { id: "service", kind: "service", name: "Service" },
      ],
    },
  },
];

export const templateOf = (id: string) => TEMPLATES.find((t) => t.id === id);
