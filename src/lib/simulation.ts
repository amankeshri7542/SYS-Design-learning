import { getConcept, type Concept } from "./catalog";
export type SimulationInput = { conceptId: string; traffic: number; replicas: number; parameter: number };
export type Point = { second: number; latency: number; throughput: number; success: number; value: number };
export type SimulationResult = { points: Point[]; metric: string; unit: string; summary: string; events: string[]; assumptions: string };
export type Control = { label: string; min: number; max: number; step: number; initial: number; unit: string };
const control = (label: string, min: number, max: number, initial: number, unit = "%", step = 1): Control => ({label,min,max,initial,unit,step});
export function getControl(concept: Concept): Control {
  switch (concept.id) {
    case "cache-aside": case "ttl": return control("Cache TTL", 5, 120, 60, "s", 5);
    case "eviction": return control("Cache capacity", 10, 200, 80, "keys", 10);
    case "stampede": return control("Requests per hot key", 1, 100, 40, "req");
    case "invalidation": case "eventual-consistency": case "cqrs": return control("Propagation delay", 10, 500, 100, "ms", 10);
    case "connection-pooling": return control("Connection pool", 5, 100, 30, "conn", 5);
    case "vertical-scaling": return control("Capacity per instance", 100, 2000, 500, "req/s", 100);
    case "autoscaling": return control("Scale-out delay", 5, 120, 30, "s", 5);
    case "timeouts": return control("Request deadline", 10, 200, 80, "ms", 5);
    case "data-lifecycle": return control("Object age", 1, 365, 120, "days");
    case "disaster-recovery": return control("Backup age", 1, 60, 15, "min");
    case "object-storage": return control("Object size", 1, 100, 10, "MB");
    case "batching": return control("Batch size", 1, 10, 5, "msg");
    case "ordering": return control("Message groups", 1, 20, 4, "groups");
    case "event-sourcing": return control("History length", 10, 1000, 200, "events", 10);
    case "distributed-locks": return control("Worker pause", 1, 60, 20, "s");
    case "health-checks": case "multi-az": return control("Failed capacity", 0, 75, 25);
    case "canary": case "blue-green": return control("New version traffic", 0, 100, 10);
    case "secrets": return control("Credential cache age", 1, 120, 30, "min");
    case "replication": return control("Replica lag", 0, 500, 50, "ms", 10);
    case "strong-consistency": return control("Strong read share", 0, 100, 100);
    case "consistent-hashing": return control("Existing ring nodes", 2, 20, 5, "nodes");
    case "circuit-breaker": case "retries": case "dead-letter": case "sagas": return control("Dependency failure rate", 0, 80, 20);
    case "authentication": case "authorization": case "encryption": case "network-isolation": case "edge-protection": return control("Unauthorized traffic", 0, 80, 20);
    case "optimistic-locking": case "transactions": return control("Write contention", 0, 80, 20);
    case "write-through": case "write-behind": case "denormalization": return control("Write traffic", 0, 100, 30);
    case "idempotency": return control("Duplicate deliveries", 0, 80, 20);
    case "observability": return control("Trace sampling", 1, 100, 25);
    case "event-routing": return control("Matching events", 0, 100, 40);
    case "cap": return control("Partitioned traffic", 0, 80, 30);
    default: return control(concept.group === "caching" ? "Cacheable requests" : "Target utilization", 10, 95, 80);
  }
}
export function validateInput(value: unknown): SimulationInput {
  if (!value || typeof value !== "object") throw new Error("Send a simulation configuration.");
  const input = value as SimulationInput;
  const concept = getConcept(input.conceptId);
  if (!concept) throw new Error("Choose a known concept.");
  const c = getControl(concept);
  if (![input.traffic,input.replicas,input.parameter].every(Number.isFinite) ||
    !Number.isInteger(input.traffic) || input.traffic < 50 || input.traffic > 2000 ||
    !Number.isInteger(input.replicas) || input.replicas < 1 || input.replicas > 8 ||
    input.parameter < c.min || input.parameter > c.max) throw new Error("Parameters are outside the supported range.");
  return {conceptId:concept.id,traffic:input.traffic,replicas:input.replicas,parameter:input.parameter};
}
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low,n));
// ponytail: deterministic teaching models omit service-specific quotas and network jitter;
// use measured traces for capacity planning, never these illustrative values.
export function simulate(raw: SimulationInput): SimulationResult {
  const input = validateInput(raw);
  const concept = getConcept(input.conceptId)!;
  const {traffic,replicas,parameter:p} = input;
  let metric = "Capacity used", unit = "%", summary = concept.experiment;
  const points: Point[] = [];
  for (let second = 1; second <= 24; second++) {
    const warm = 1 - Math.exp(-second / 4);
    let capacity = replicas * 500 * (getControl(concept).label === "Target utilization" ? p / 100 : 1);
    let latency = 28 + traffic / capacity * 12;
    let value = traffic / capacity * 100;
    let success = 100;
    let throughput = traffic;
    const ratio = p / 100;
    switch (concept.id) {
      case "cache-aside": case "ttl": {
        const hit = .94 * p / (p + 8) * warm;
        value = hit * 100; latency = hit * 4 + (1-hit) * 110;
        metric = "Cache hit ratio"; capacity = replicas * 500 / (1-hit);
        break;
      }
      case "write-through": value = traffic * ratio; metric = "Synchronous writes"; unit = "/s"; latency = 4 * (1-ratio) + 114 * ratio; break;
      case "write-behind": value = Math.max(0,traffic * ratio - replicas * 200) * second; metric = "Buffered writes"; unit = ""; latency = 8; break;
      case "eviction": value = Math.min(.95,p / 200) * 100 * warm; metric = "Cache hit ratio"; latency = 110 - value * 1.06; break;
      case "invalidation": value = p; metric = "Stale window"; unit = "ms"; latency = 8; break;
      case "stampede": value = p - 1; metric = "Coalesced reads"; unit = ""; latency = 4 + 106 * (1-warm); break;
      case "cdn-cache": value = p * warm; metric = "Edge hit ratio"; latency = 12 * ratio * warm + 130 * (1-ratio * warm); break;
      case "load-balancing": case "horizontal-scaling": value = traffic / replicas; metric = "Requests / replica"; unit = "/s"; break;
      case "vertical-scaling": capacity = p; value = traffic / capacity * 100; latency = 28 + traffic / capacity * 12; break;
      case "autoscaling": capacity = second * 5 >= p ? replicas * 500 : 500; value = second * 5 >= p ? replicas : 1; metric = "Ready instances"; unit = ""; break;
      case "serverless": capacity = replicas * 200; value = Math.min(traffic * .05,replicas * 10); metric = "Concurrent executions"; unit = ""; latency = 50 + 100 * (1-warm); break;
      case "rate-limiting": capacity = replicas * 500 * ratio; value = Math.max(0,traffic-capacity); metric = "Requests throttled"; unit = "/s"; break;
      case "backpressure": value = Math.max(0,traffic-capacity * ratio) * second; metric = "Queued requests"; unit = ""; latency += value / capacity * 1000; break;
      case "connection-pooling": capacity = p * 40; value = Math.min(p,Math.ceil(traffic / 40)); metric = "Connections in use"; unit = ""; break;
      case "sharding": value = traffic / replicas; metric = "Requests / partition"; unit = "/s"; break;
      case "replication": value = p; metric = "Replica lag"; unit = "ms"; capacity = replicas * 800; break;
      case "indexing": value = 99; metric = "Rows avoided"; latency = 6 + traffic / capacity * 2; break;
      case "transactions": value = p; metric = "Contended writes"; latency = 30 / (1-ratio); capacity *= 1-ratio; break;
      case "optimistic-locking": value = traffic * ratio; metric = "Version conflicts"; unit = "/s"; success *= 1-ratio; break;
      case "denormalization": value = 1 + ratio * 2; metric = "Writes / update (avg)"; unit = "×"; latency = 6 + 24 * ratio; break;
      case "object-storage": value = traffic * p; metric = "Requested transfer"; unit = "MB/s"; latency = p / 100 * 1000; break;
      case "data-lifecycle": value = p >= 90 ? 3 : p >= 30 ? 2 : 1; metric = "Storage tier"; unit = ""; summary = p >= 90 ? "Archive tier: restore the object before reading it." : p >= 30 ? "Infrequent-access tier: retrieval charges trade off against lower storage cost." : "Hot tier: the object is immediately available."; break;
      case "queues": value = Math.max(0,traffic - capacity * ratio) * second; metric = "Queue depth"; unit = "msg"; break;
      case "pubsub": value = traffic * replicas; metric = "Subscriber deliveries"; unit = "/s"; break;
      case "event-streams": value = traffic / replicas; metric = "Records / shard"; unit = "/s"; break;
      case "dead-letter": value = Math.floor(traffic * Math.pow(ratio,3) * second); metric = "DLQ messages"; unit = ""; break;
      case "idempotency": value = traffic * ratio; metric = "Duplicates suppressed"; unit = "/s"; throughput = traffic * (1-ratio); break;
      case "ordering": capacity = Math.min(p,replicas) * 250; value = Math.min(p,replicas); metric = "Parallel groups"; unit = ""; break;
      case "batching": value = Math.ceil(traffic / p); metric = "Worker invocations"; unit = "/s"; latency += (p-1) * 1000 / traffic; break;
      case "event-routing": value = traffic * ratio; metric = "Matched deliveries"; unit = "/s"; break;
      case "circuit-breaker": value = p >= 30 && second > 4 ? 100 : 0; metric = "Circuit open"; latency = value ? 2 : 35; success = value ? 0 : 100-p; break;
      case "retries": value = traffic * (1+ratio+ratio*ratio); metric = "Downstream attempts"; unit = "/s"; success = (1-Math.pow(ratio,3))*100; latency += ratio*100 + ratio*ratio*200; break;
      case "timeouts": value = clamp((110-p)/100,0,1) * 100; metric = "Timed-out requests"; latency = Math.min(p,60); success = 100-value; break;
      case "bulkheads": capacity = replicas * 500 * ratio; value = 100-p; metric = "Reserved for other pools"; break;
      case "health-checks": case "multi-az": capacity *= 1-ratio; value = capacity; metric = "Healthy capacity"; unit = "/s"; break;
      case "disaster-recovery": value = p; metric = "Potential data loss"; unit = "min"; break;
      case "observability": value = traffic * ratio; metric = "Sampled traces"; unit = "/s"; break;
      case "authentication": case "authorization": case "encryption": case "network-isolation": case "edge-protection": value = traffic * ratio; metric = "Denied requests"; unit = "/s"; success = 100-p; throughput = traffic * (1-ratio); break;
      case "secrets": value = Math.max(0,p-30); metric = "Rotation overlap exceeded"; unit = "min"; success = p > 30 ? Math.max(0,100-(p-30)) : 100; break;
      case "blue-green": value = traffic * ratio; metric = "Green requests"; unit = "/s"; break;
      case "canary": value = ratio * 10; metric = "Overall error rate"; success = 100-value; summary = "Assuming 10% errors in the new version, a 10% canary produces 1% overall errors."; break;
      case "eventual-consistency": case "cqrs": value = p; metric = "Convergence delay"; unit = "ms"; break;
      case "strong-consistency": value = traffic * (.5 + ratio * .5); metric = "Read capacity units"; unit = "/s"; summary = "For items up to 4 KB, eventual reads use 0.5 units; strong reads use 1 unit. GSIs cannot provide strong reads."; break;
      case "cap": value = p; metric = "Quorum path rejected"; success = 100-p; summary = "During the partition, the quorum path rejects unsafe requests. The available path can accept them but may serve stale data."; break;
      case "event-sourcing": value = p; metric = "Events replayed"; unit = ""; latency = p * .2; break;
      case "sagas": value = traffic * ratio; metric = "Compensations"; unit = "/s"; success = 100-p; latency += ratio * 60; break;
      case "distributed-locks": value = p > 15 ? 1 : 0; metric = "Stale holders rejected"; unit = ""; summary = "The modeled lease lasts 15 seconds. Paused workers beyond that window must have stale fencing tokens rejected."; break;
      case "consistent-hashing": value = 100 / (p+1); metric = "Expected keys moved"; summary = "With an ideal uniform ring, adding one node moves about 1/(N+1) keys. A finite ring may be uneven."; break;
    }
    // Preserve explicit semantic failures, then enforce the available throughput bound.
    success = Math.min(success,capacity / traffic * 100);
    throughput = Math.min(throughput,capacity,traffic * success / 100);
    if (traffic > capacity) latency += (traffic-capacity) / Math.max(capacity,1) * 80;
    points.push({second,latency:Math.round(latency*10)/10,throughput:Math.round(throughput),success:Math.round(clamp(success,0,100)*10)/10,value:Math.round(value*10)/10});
  }
  if(summary === concept.experiment) summary = `${metric}: ${points.at(-1)!.value}${unit ? " " + unit : ""}. ${concept.tradeoff}`;
  return {points,metric,unit,summary,events:concept.steps,assumptions:"Deterministic teaching model. Baseline: 500 requests/s per replica, 4 ms cache access, 110 ms origin access. Uniform traffic; no network jitter. Values illustrate trade-offs, not AWS performance guarantees."};
}
