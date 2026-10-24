// Every live lesson and story, loaded at once: for the tests, the scripts and server-rendered pages (the glossary).
// Never import this from a client component: it would ship every lesson's scenes with that page. Client code loads one
// at a time through `scenes/` and `stories/`. `npm run new-lesson` adds a line here; tests/lessons.test.ts checks it
// matches the lazy maps.

import { LESSONS, STORIES } from "./index";
import type { StoryDef } from "./story";
import { withScene, type Lesson, type LessonMeta, type LessonScene } from "./types";
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
import capstone from "./stories/capstone";

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
};

export const STORY_DEFS: Record<string, StoryDef> = { capstone };

/** Every live lesson, whole, in path order. */
export const ALL_LESSONS: Lesson[] = LESSONS.map((m) => withScene(m, SCENE_DEFS[m.slug]));

/** Every live story with its definition, in path order. */
export const ALL_STORIES: { meta: LessonMeta; def: StoryDef }[] = STORIES.map((meta) => ({ meta, def: STORY_DEFS[meta.slug] }));

export function lessonOf(slug: string): Lesson | undefined {
  return ALL_LESSONS.find((l) => l.slug === slug);
}
