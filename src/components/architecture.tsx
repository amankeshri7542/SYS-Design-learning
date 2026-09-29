"use client";
import { useState } from "react";
import { Database, Globe2, Server, Zap, Network, Layers3, X, ShieldCheck, Radio, Cloud, MousePointer2 } from "lucide-react";
import type { Concept } from "@/lib/catalog";
import type { Point } from "@/lib/simulation";
const topology = {
  caching: ["Cache", "ElastiCache", "Database", "Amazon Aurora"],
  scaling: ["Instance A", "Healthy replica", "Instance B", "Healthy replica"],
  data: ["Primary", "Write model", "Replica", "Read model"],
  messaging: ["Event queue", "Amazon SQS", "Consumer", "AWS Lambda"],
  resilience: ["Primary", "Availability zone A", "Standby", "Availability zone B"],
  security: ["Identity", "Amazon Cognito", "Resource", "Protected data"],
  distributed: ["Replica A", "us-east-1", "Replica B", "eu-west-1"],
};
const specificTopology: Record<string,string[]> = {
 "sharding":["Partition A","Key range A","Partition B","Key range B"],
 "indexing":["Base table","DynamoDB","Index","Secondary access"],
 "transactions":["Transaction","Aurora PostgreSQL","Commit log","Durable changes"],
 "optimistic-locking":["Version check","Conditional write","Item","DynamoDB"],
 "denormalization":["Source item","DynamoDB","Read view","Duplicated fields"],
 "object-storage":["Metadata","Object reference","Object","Amazon S3"],
 "data-lifecycle":["Hot storage","Amazon S3","Archive","S3 Glacier"],
 "cdn-cache":["Edge cache","CloudFront","Origin","Amazon S3"],
 "invalidation":["Cache","ElastiCache","Source of truth","DynamoDB"],
 "pubsub":["Subscriber A","Queue + worker","Subscriber B","Queue + worker"],
 "event-streams":["Event stream","Kinesis shard","Consumer","Checkpointed reads"],
 "dead-letter":["Work queue","Amazon SQS","Dead-letter queue","Failed messages"],
 "idempotency":["Consumer","AWS Lambda","Dedupe record","DynamoDB"],
 "event-routing":["Event bus","EventBridge rules","Target","Matching events"],
 "circuit-breaker":["Circuit","Application state","Dependency","Protected service"],
 "retries":["Orchestrator","Step Functions","Dependency","Bounded retries"],
 "timeouts":["Deadline","Request budget","Dependency","Bounded waiting"],
 "bulkheads":["Workload A","Reserved capacity","Workload B","Isolated capacity"],
 "disaster-recovery":["Primary data","Live environment","Recovery point","AWS Backup"],
 "observability":["Metrics & logs","CloudWatch","Traces","AWS X-Ray"],
 "authentication":["Identity","Amazon Cognito","Verified user","Token subject"],
 "authorization":["Policy check","IAM + ownership","Resource","Allowed operations"],
 "encryption":["Encryption key","AWS KMS","Object","Encrypted in S3"],
 "secrets":["Credential","Secrets Manager","Application","Cached credential"],
 "network-isolation":["Application","Private subnet","Database","Restricted ingress"],
 "edge-protection":["Edge filter","AWS WAF","Origin","Allowed requests"],
 "blue-green":["Blue fleet","Current version","Green fleet","Candidate version"],
 "canary":["Stable version","Lambda alias","Canary version","Weighted traffic"],
 "strong-consistency":["Committed write","DynamoDB table","Strong read","Latest value"],
 "cqrs":["Write model","DynamoDB table","Read model","Stream projection"],
 "event-sourcing":["Event history","Immutable log","Projection","Rebuilt state"],
 "sagas":["Transaction","Local commit","Compensation","Business undo"],
 "distributed-locks":["Lease","DynamoDB item","Resource","Fencing enforced"],
 "consistent-hashing":["Ring node A","Virtual positions","Ring node B","Key ownership"],
};
export function Architecture({concept,running,point,step,replicas,metric,unit}:{concept:Concept;running:boolean;point:Point;step:number;replicas:number;metric:string;unit:string}) {
  const [selected,setSelected] = useState<string|null>(null);
  const [zoom,setZoom] = useState(1);
  const family = specificTopology[concept.id] ?? topology[concept.group];
  const independent = ["scaling"].includes(concept.group) || ["sharding","pubsub","bulkheads","observability","blue-green","canary","consistent-hashing"].includes(concept.id);
  const relation = isRelation(concept);
  const serial = concept.group === "messaging" && concept.id !== "pubsub";
  const isCache = concept.group === "caching";
  const nodes = [
    {id:"clients",title:"Clients",subtitle:"Web & mobile",Icon:Globe2,color:"neutral",description:"Incoming requests originate here. Use the request-rate control to change the offered workload."},
    {id:"gateway",title:concept.compute === "EC2" ? "Load balancer" : "API gateway",subtitle:concept.compute === "EC2" ? "Application LB" : "Amazon API Gateway",Icon:Network,color:"violet",description:"The entry point routes accepted traffic. Authentication, rate limiting, and health checks belong at the appropriate boundary."},
    {id:"application",title:concept.compute === "EC2" ? "Application" : "Function",subtitle:concept.compute === "EC2" ? `Amazon EC2 · ×${replicas}` : `AWS Lambda · ×${replicas}`,Icon:concept.compute === "EC2" ? Server : Zap,color:"blue",description:"Application logic coordinates the request. Replica count is a teaching capacity control, not a literal Lambda fleet size."},
    {id:"fast",title:family[0],subtitle:family[1],Icon:isCache ? Layers3 : concept.group === "security" ? ShieldCheck : concept.group === "messaging" ? Radio : Database,color:"teal",description:isCache ? "A cached value avoids the origin read. Misses and expiration still require fetching a fresh value." : concept.steps[2]},
    {id:"slow",title:family[2],subtitle:family[3],Icon:Database,color:"amber",description:isCache ? "The database holds the source of truth. The application retrieves a missing value and populates the cache." : concept.steps[3]},
  ];
  return <div className={`architecture ${running ? "is-running" : ""}`}>
    <div className="canvas-meta"><span><span className="status-dot" />{running ? "Simulation running" : "Ready to explore"}</span><span className="model-badge">ILLUSTRATIVE MODEL</span></div>
    <div className="graph-viewport">
      <div className="graph-stage" style={{transform:`scale(${zoom})`}}>
        <div className="cloud-boundary"><span><Cloud size={13}/> AWS CLOUD <i>us-east-1</i></span></div>
        <svg className="connections" viewBox="0 0 960 380" preserveAspectRatio="none" aria-hidden="true">
          <defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="#acb8cb"/></marker><marker id="arrow-green" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7" fill="#48b89f"/></marker></defs>
          <path className="edge" d="M148 180 H242" markerEnd="url(#arrow)"/>
          <path className="edge" d="M362 180 H450" markerEnd="url(#arrow)"/>
          <path className="edge edge-fast" d="M574 166 H620 Q638 166 638 148 V105 Q638 88 656 88 H738" markerEnd="url(#arrow-green)"/>
          {!serial&&<path className="edge" d="M574 196 H620 Q638 196 638 214 V275 Q638 292 656 292 H738" markerEnd="url(#arrow)"/>}
          {!independent&&<path className="return-edge" d={isCache && concept.id !== "write-behind" ? "M800 241 V135" : "M800 135 V241"} markerEnd="url(#arrow)"/>}
          {running && <><circle r="4" fill="#4263ed"><animateMotion dur="1.8s" repeatCount="indefinite" path="M148 180 H574"/></circle><circle r="4" fill="#26a58a"><animateMotion dur="2.3s" repeatCount="indefinite" path="M574 166 H620 Q638 166 638 148 V105 Q638 88 656 88 H738"/></circle><circle r="4" fill="#dba342"><animateMotion dur="3s" repeatCount="indefinite" path={serial?"M800 135 V241":"M574 196 H620 Q638 196 638 214 V275 Q638 292 656 292 H738"}/></circle></>}
          <text x="182" y="166">HTTPS</text><text x="390" y="166">route</text>
          <text className="green-text" x="662" y="72">{isCache ? "cache hit" : "primary path"}</text>
          {!serial&&<text x="662" y="316">{isCache ? "cache miss" : "secondary path"}</text>}
          {!independent&&<text x="812" y="193">{relation}</text>}
        </svg>
        {nodes.map((node,index)=><button key={node.id} className={`diagram-node node-${node.id} ${node.color} ${running && (step===index || step===3 && index===4) ? "node-active" : ""}`} onClick={()=>setSelected(node.id)} aria-label={`Inspect ${node.title}`}>
          <span className="node-icon"><node.Icon size={25} strokeWidth={1.6}/></span><strong>{node.title}</strong><small>{node.subtitle}</small>
          {node.id==="fast" && isCache && metric.includes("hit ratio") && <span className="node-stat">{Math.round(point.value)}{unit} hit rate</span>}
          {node.id==="application" && <span className="node-status"><i/> healthy</span>}
        </button>)}
      </div>
    </div>
    <div className="canvas-bottom"><span><MousePointer2 size={13}/> Click a component to explore</span><div className="zoom-controls"><button aria-label="Zoom out" onClick={()=>setZoom(z=>Math.max(.8, +(z-.1).toFixed(1)))}>−</button><span>{Math.round(zoom*100)}%</span><button aria-label="Zoom in" onClick={()=>setZoom(z=>Math.min(1.2, +(z+.1).toFixed(1)))}>+</button></div></div>
    {selected && <div className="node-popover" role="dialog" aria-label="Component details"><button className="icon-button close-popover" onClick={()=>setSelected(null)} aria-label="Close component details"><X size={16}/></button><span className="eyebrow">COMPONENT DETAILS</span><h3>{nodes.find(n=>n.id===selected)?.title}</h3><p>{nodes.find(n=>n.id===selected)?.description}</p><small>Concept service: {concept.service}</small></div>}
  </div>;
}

function isRelation(concept:Concept) {
 if(concept.group==="caching")return "refresh";
 if(["eventual-consistency","cap","replication"].includes(concept.id))return "replicate";
 if(["cqrs","indexing","denormalization","event-sourcing"].includes(concept.id))return "project";
 if(concept.id==="data-lifecycle")return "archive";
 if(concept.id==="dead-letter")return "redrive limit";
 return "coordinate";
}
