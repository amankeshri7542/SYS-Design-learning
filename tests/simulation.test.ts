import { test } from "node:test";
import assert from "node:assert/strict";
import { concepts } from "../src/lib/catalog";
import { simulate,validateInput,getControl } from "../src/lib/simulation";
import { POST } from "../src/app/api/simulate/route";
const last=(id:string,parameter:number,traffic=1200,replicas=3)=>simulate({conceptId:id,parameter,traffic,replicas}).points.at(-1)!;
test("all 56 scenarios remain bounded at control boundaries",()=>{
  assert.equal(concepts.length,56);assert.equal(new Set(concepts.map(c=>c.id)).size,56);
  for(const concept of concepts){const control=getControl(concept);for(const parameter of [control.min,control.initial,control.max])for(const traffic of [50,2000]){
    const result=simulate({conceptId:concept.id,traffic,replicas:1,parameter});
    assert.equal(result.points.length,24);assert.equal(result.events.length,4);
    for(const point of result.points){assert.ok(Object.values(point).every(Number.isFinite),concept.id);assert.ok(point.latency>=0);assert.ok(point.throughput>=0&&point.throughput<=traffic);assert.ok(point.success>=0&&point.success<=100);}
  }}
});
test("controls preserve the intended system trade-offs",()=>{
 assert.ok(last("cache-aside",120).value>last("cache-aside",5).value);
 assert.ok(last("cache-aside",120).latency<last("cache-aside",5).latency);
 assert.ok(last("horizontal-scaling",80,2000,8).throughput>last("horizontal-scaling",80,2000,1).throughput);
 assert.ok(last("queues",80,2000,1).value>last("queues",80,2000,8).value);
 assert.equal(last("idempotency",20,1000).throughput,800);
 assert.equal(last("strong-consistency",100,1000).value,1000);
 assert.equal(last("strong-consistency",0,1000).value,500);
 assert.equal(last("consistent-hashing",4).value,20);
 assert.equal(last("distributed-locks",16).value,1);
 assert.equal(last("distributed-locks",15).value,0);
 assert.equal(last("canary",10).success,99);
});
test("invalid configurations cannot enter the simulation",()=>{
 for(const patch of [{traffic:Infinity},{traffic:-1},{replicas:1.5},{parameter:NaN},{parameter:121},{conceptId:"missing"}])assert.throws(()=>validateInput({conceptId:"cache-aside",traffic:1000,replicas:3,parameter:60,...patch}));
});
test("API rejects malformed, oversized, and unknown inputs and executes valid requests",async()=>{
 const request=(body:string)=>new Request("http://localhost/api/simulate",{method:"POST",body});
 assert.equal((await POST(request("{"))).status,400);
 assert.equal((await POST(request("x".repeat(2049)))).status,413);
 assert.equal((await POST(request(JSON.stringify({conceptId:"unknown"})))).status,400);
 const response=await POST(request(JSON.stringify({conceptId:"cache-aside",traffic:1200,replicas:3,parameter:60})));
 assert.equal(response.status,200);assert.equal((await response.json()).points.length,24);
});
