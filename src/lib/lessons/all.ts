// Every live lesson and story, loaded at once: for the tests, the scripts and server-rendered pages (the glossary).
// Never import this from a client component: it would ship every lesson's scenes with that page. Client code loads one
// at a time through `scenes/` and `stories/`. `npm run new-lesson` adds a line here; tests/lessons.test.ts checks it
// matches the lazy maps.

import { LESSONS, STORIES } from "./index";
import { whyOf } from "./words";
import type { StoryDef } from "./story";
import { defaultsOf, isChoice, withScene, type Lesson, type LessonMeta, type LessonScene, type Values } from "./types";
import { needsOf, type ModuleName } from "../sim/engine/needs";
import type { SceneSpec } from "../sim/types";
import autoscaling from "./scenes/autoscaling";
import cacheStampede from "./scenes/cache-stampede";
import caching from "./scenes/caching";
import cdn from "./scenes/cdn";
import circuitBreakers from "./scenes/circuit-breakers";
import consistencyVsAvailability from "./scenes/consistency-vs-availability";
import consistentHashing from "./scenes/consistent-hashing";
import healthChecks from "./scenes/health-checks";
import latencyAndThroughput from "./scenes/latency-and-throughput";
import loadBalancing from "./scenes/load-balancing";
import messageQueues from "./scenes/message-queues";
import publishSubscribe from "./scenes/publish-subscribe";
import rateLimiting from "./scenes/rate-limiting";
import readReplicas from "./scenes/read-replicas";
import retriesAndBackoff from "./scenes/retries-and-backoff";
import scalingUpVsOut from "./scenes/scaling-up-vs-out";
import sharding from "./scenes/sharding";
import staleData from "./scenes/stale-data";
import requestAndResponse from "./scenes/request-and-response";
import latencyVsBandwidth from "./scenes/latency-vs-bandwidth";
import timeoutsAndDeadlines from "./scenes/timeouts-and-deadlines";
import pipeliningAndBatching from "./scenes/pipelining-and-batching";
import nearestRegionAndFailover from "./scenes/nearest-region-and-failover";
import dns from "./scenes/dns";
import statelessVsStateful from "./scenes/stateless-vs-stateful";
import ninesAndErrorBudgets from "./scenes/nines-and-error-budgets";
import negativeCaching from "./scenes/negative-caching";
import indexes from "./scenes/indexes";
import loadShedding from "./scenes/load-shedding";
import bulkheads from "./scenes/bulkheads";
import cascadingFailures from "./scenes/cascading-failures";
import canaryRollouts from "./scenes/canary-rollouts";
import gracefulShutdown from "./scenes/graceful-shutdown";
import acknowledgements from "./scenes/acknowledgements";
import deliveryGuarantees from "./scenes/delivery-guarantees";
import backpressure from "./scenes/backpressure";
import idempotency from "./scenes/idempotency";
import deadLetterQueues from "./scenes/dead-letter-queues";
import outbox from "./scenes/outbox";
import partitionedLogs from "./scenes/partitioned-logs";
import handshakesAndKeepAlive from "./scenes/handshakes-and-keep-alive";
import windowsAndFlowControl from "./scenes/windows-and-flow-control";
import congestionControl from "./scenes/congestion-control";
import headOfLineBlocking from "./scenes/head-of-line-blocking";
import pushVsPoll from "./scenes/push-vs-poll";
import l4VsL7 from "./scenes/l4-vs-l7";
import heartbeats from "./scenes/heartbeats";
import connectionPools from "./scenes/connection-pools";
import failover from "./scenes/failover";
import coldCachesAndHerds from "./scenes/cold-caches-and-herds";
import quorums from "./scenes/quorums";
import leaderElection from "./scenes/leader-election";
import locksAndDoubleBooking from "./scenes/locks-and-double-booking";
import hedgedRequests from "./scenes/hedged-requests";
import sagas from "./scenes/sagas";
import streamWindows from "./scenes/stream-windows";
import cacheWriteStrategies from "./scenes/cache-write-strategies";
import capstone from "./stories/capstone";
import webCrawler from "./stories/web-crawler";
import videoPremiere from "./stories/video-premiere";
import chat from "./stories/chat";
import flashSale from "./stories/flash-sale";
import rideMatching from "./stories/ride-matching";
import newsFeed from "./stories/news-feed";
import payments from "./stories/payments";
import clickCounting from "./stories/click-counting";

export const SCENE_DEFS: Record<string, LessonScene> = {
  "latency-and-throughput": latencyAndThroughput,
  "scaling-up-vs-out": scalingUpVsOut,
  "load-balancing": loadBalancing,
  "health-checks": healthChecks,
  caching,
  cdn,
  "stale-data": staleData,
  "cache-stampede": cacheStampede,
  "read-replicas": readReplicas,
  sharding,
  "consistent-hashing": consistentHashing,
  "consistency-vs-availability": consistencyVsAvailability,
  "message-queues": messageQueues,
  "publish-subscribe": publishSubscribe,
  "retries-and-backoff": retriesAndBackoff,
  "rate-limiting": rateLimiting,
  "circuit-breakers": circuitBreakers,
  autoscaling,
  "request-and-response": requestAndResponse,
  "latency-vs-bandwidth": latencyVsBandwidth,
  "timeouts-and-deadlines": timeoutsAndDeadlines,
  "pipelining-and-batching": pipeliningAndBatching,
  "nearest-region-and-failover": nearestRegionAndFailover,
  dns,
  "stateless-vs-stateful": statelessVsStateful,
  "nines-and-error-budgets": ninesAndErrorBudgets,
  "negative-caching": negativeCaching,
  indexes,
  "load-shedding": loadShedding,
  bulkheads,
  "cascading-failures": cascadingFailures,
  "canary-rollouts": canaryRollouts,
  "graceful-shutdown": gracefulShutdown,
  acknowledgements,
  "delivery-guarantees": deliveryGuarantees,
  backpressure,
  idempotency,
  "dead-letter-queues": deadLetterQueues,
  outbox,
  "partitioned-logs": partitionedLogs,
  "handshakes-and-keep-alive": handshakesAndKeepAlive,
  "windows-and-flow-control": windowsAndFlowControl,
  "congestion-control": congestionControl,
  "head-of-line-blocking": headOfLineBlocking,
  "push-vs-poll": pushVsPoll,
  "l4-vs-l7": l4VsL7,
  heartbeats,
  "connection-pools": connectionPools,
  failover,
  "cold-caches-and-herds": coldCachesAndHerds,
  quorums,
  "leader-election": leaderElection,
  "locks-and-double-booking": locksAndDoubleBooking,
  "hedged-requests": hedgedRequests,
  sagas,
  "stream-windows": streamWindows,
  "cache-write-strategies": cacheWriteStrategies,
};

export const STORY_DEFS: Record<string, StoryDef> = { capstone, "web-crawler": webCrawler, "video-premiere": videoPremiere, chat, "flash-sale": flashSale, "ride-matching": rideMatching, "news-feed": newsFeed, payments, "click-counting": clickCounting };

/** Every live lesson, whole, in path order. */
export const ALL_LESSONS: Lesson[] = LESSONS.map((m) => withScene(m, SCENE_DEFS[m.slug], whyOf(m.slug)));

/** Every live story with its definition, in path order. */
export const ALL_STORIES: { meta: LessonMeta; def: StoryDef }[] = STORIES.map((meta) => ({ meta, def: STORY_DEFS[meta.slug] }));

export function lessonOf(slug: string): Lesson | undefined {
  return ALL_LESSONS.find((l) => l.slug === slug);
}

/**
 * Every scene a page can show: each figure at its defaults and at each knob's ends and choices (one knob moved at a time,
 * and all at their lows and highs), and each story stage in every design its controls can make.
 */
export function specsOf(slug: string): SceneSpec[] {
  const scene = SCENE_DEFS[slug];
  if (scene) {
    return scene.figures.flatMap((f) => {
      const base = defaultsOf(f);
      const knobs = f.knobs ?? [];
      const ends = (k: (typeof knobs)[number]) => (isChoice(k) ? k.options.map((o) => o.value) : [k.min, k.max]);
      const sets: Values[] = [base, ...knobs.flatMap((k) => ends(k).map((v) => ({ ...base, [k.id]: v })))];
      if (knobs.length > 1) for (const end of [0, -1]) sets.push({ ...base, ...Object.fromEntries(knobs.map((k) => [k.id, ends(k).at(end)!])) });
      return sets.map((v) => f.build(v));
    });
  }
  const story = STORY_DEFS[slug];
  if (!story) return [];
  // Every design: each count from its least to its most, each switch off and on.
  let designs: Values[] = [{ ...story.start }];
  for (const c of story.controls) {
    const values = c.kind === "count" ? Array.from({ length: c.max - c.min + 1 }, (_, i) => c.min + i) : [0, 1];
    designs = designs.flatMap((d) => values.map((v) => ({ ...d, [c.id]: v })));
  }
  return story.stages.flatMap((stage) => designs.map((d) => story.scene(d, stage)));
}

/** The engine's optional modules a page needs: every module any of its scenes uses. */
export function engineNeeds(slug: string): ModuleName[] {
  return [...new Set(specsOf(slug).flatMap(needsOf))].sort();
}
