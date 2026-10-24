import { M, balancer, knob, ms, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { NodeSpec, SceneSpec } from "../../sim/types";

// N11: twelve users browse through a balancer to three web servers; a few of them are much busier than the rest. A
// layer 4 balancer picks a server once per connection, so each user's requests all land on one server (the busiest users
// pile up), and it can't see that a request is a checkout, so the web servers handle checkouts too, slowly. A layer 7
// gateway reads every request: it spreads page views, and sends checkouts to a payments service of their own, at the
// cost of parsing each one.

const WEB = ["w1", "w2", "w3"];

/** `layer`: 4 pins connections; 7 reads each request, taking `parseMs` of one of its workers. */
const front = (layer: 4 | 7, parseMs: number): SceneSpec => {
  // A web server can take a checkout, but it isn't built for it: 60 ms instead of 20.
  const web = (id: string, i: number): NodeSpec => server(id, [62, 12 + 25 * i], { label: `Web ${i + 1}`, slots: 4, serviceBy: { read: 20, write: 60 } });
  const nodes: NodeSpec[] = [
    users("u", [8, 34], { rate: 280, keys: 12, skew: 1.3, tag: "web" }, "lb", { label: "Browsing" }),
    users("buy", [8, 76], { rate: 15, keys: 50, writes: 1, tag: "pay" }, "lb", { label: "Checkout" }),
    balancer("lb", [32, 50], WEB, layer === 4 ? { label: "L4 balancer", layer: 4 } : { label: "Gateway", byTag: { pay: ["pay"] }, slots: 4, serviceMs: parseMs }),
    ...WEB.map(web),
  ];
  if (layer === 7) nodes.push(server("pay", [62, 90], { label: "Payments", slots: 4, serviceMs: 20 }));
  return scene(nodes, { windowMs: 1500, seed: 37 });
};

const busiest = M.peak(WEB, "Busiest web server");
const checkout = M.p95({ tag: "pay", label: "Checkout time", hint: "95% of checkouts are answered faster than this (the p95)." });
const browse = M.p95({ tag: "web", label: "Browsing time", hint: "95% of page views are answered faster than this (the p95)." });
const gateway: MetricSpec = { id: "util", label: "Front busy", nodes: ["lb"], hint: "Share of the gateway's workers busy reading requests (a layer 4 balancer reads none)." };
const metrics = [busiest, browse, checkout, gateway];

const l4l7: LessonScene = {
  hook: "Should a load balancer read your requests, or just pass connections along?",
  dots: ["req", "late", "ok"],
  figures: [
    {
      tone: "problem",
      short: "Layer 4",
      title: "One server per connection",
      caption: "Twelve users browse, a few far more than the rest, and some check out. A balancer picks a web server once per user's connection.",
      metrics,
      parts: [
        { node: "u", text: "Browsing: 280 a second from twelve users." },
        { node: "buy", text: "Checkout: 15 payments a second." },
        { node: "lb", text: "L4 balancer: picks a server per connection." },
        { node: WEB, text: "Web servers: 20 ms a page, 60 a checkout.", sockets: true },
      ],
      beats: [
        {
          id: "pin",
          when: { at: 400 },
          text: "Watch each user stick to one web server: a [[layer-4|layer 4]] balancer sees connections only.",
          focus: { nodes: ["lb"] },
          pause: true,
          term: "layer-4",
        },
        { id: "hot", when: { metric: busiest, is: ">", value: 0.8 }, text: "Read Busiest web server: {peak}. The chattiest users all landed on it.", focus: { metric: "Busiest web server" } },
        { id: "pay", when: { wait: 0 }, text: "Checkouts land on web servers too: the balancer can't tell them apart.", focus: { nodes: WEB } },
      ],
      predict: {
        prompt: "Next, a gateway reads every request and picks a server for each one. The busiest web server will be…",
        options: ["Less busy", "Just as busy"],
        answer: 0,
        before: "end",
        reveal: { beat: "compare", text: "Busiest web server: {before} pinned per connection, {after} picked per request." },
        track: { metric: busiest, world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < before - 0.1,
      },
      build: () => front(4, 0),
    },
    {
      tone: "fix",
      short: "Layer 7",
      title: "Read each request, route each one",
      caption: "The same users. A gateway reads every request: page views go to any web server, checkouts to a payments service.",
      knobs: [knob("parse", "Reading cost", 1, 12, 1, 3, ms)],
      metrics,
      beats: [
        {
          id: "l7",
          when: { step: "enter" },
          text: "Now a [[layer-7|layer 7]] gateway reads each request and routes it by what it asks.",
          focus: { nodes: ["lb"] },
          term: "layer-7",
        },
        { id: "compare", when: { wait: 0 }, text: "Compare Busiest web server: {peak:fix} here, {peak:problem} pinned per connection.", focus: { metric: "Busiest web server" } },
        { id: "direct", when: { wait: 0 }, text: "Read Checkout time: {p95:pay:fix}, down from {p95:pay:problem}, on a service built for it.", focus: { metric: "Checkout time" } },
        { id: "cost", when: { wait: 600 }, text: "Drag Reading cost to 12 ms: the gateway becomes the bottleneck itself.", focus: { knob: "parse" } },
      ],
      headline: { metric: "Busiest web server", sentence: "Twelve users, a few very busy: busiest web server {peak:problem} pinned per connection, {peak:fix} per request." },
      build: (v: Values) => front(7, v.parse),
    },
  ],
  checks: [
    {
      prompt: "Why did one web server run hot behind the layer 4 balancer?",
      options: ["Each user's connection stuck to one server, busy users included", "That server was slower"],
      answer: 0,
      why: "Layer 4 balances connections, not requests. A few chatty connections can pin most of the load on one server.",
      focus: { metric: "Busiest web server" },
    },
    {
      prompt: "What does a layer 7 gateway cost?",
      options: ["Time to read every request, and it sees all of them", "Nothing at all"],
      answer: 0,
      why: "It parses each request, so it adds a little delay and can become the bottleneck. Run more than one.",
      focus: { nodes: ["lb"] },
    },
  ],
  takeaways: {
    use: "Layer 7 when you need routing by path, header or user, retries, auth or rate limits; layer 4 for raw speed and any protocol.",
    catch: "A gateway reads everything, so it adds latency and is a single point of failure unless you run several.",
    seen: "AWS NLB (layer 4) and ALB (layer 7), Envoy, NGINX, HAProxy, Kong and other API gateways.",
    rule: "Read requests only when you must route them.",
    interview: "Say: “L4 balances connections cheaply; L7 routes each request by content, at a parsing cost.”",
  },
};

export default l4l7;
