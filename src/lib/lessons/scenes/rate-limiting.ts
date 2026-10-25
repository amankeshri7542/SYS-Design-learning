import type { NodeSpec } from "../../sim/types";
import { M, knob, perSecond, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";

const people = () => users("u", [6, 26], { rate: 14, keys: 50, tag: "user" }, "svc", { label: "Users" });
const bot = () => users("bot", [6, 76], { rate: 40, keys: 50, tag: "bot" }, "svc", { label: "Scraper bot", glyph: "bot" });

const unlimited = () =>
  scene([people(), bot(), server("svc", [84, 50], { slots: 4, serviceMs: 100, queueMax: 30, label: "API server" })], { wideH: 440 });

const usersP95 = M.p95({ tag: "user", label: "Users' response time" });

const limiting: LessonScene = {
  hook: "One scraper sends more than all your users combined. Why should your users pay for it?",
  dots: ["req", "late", "ok", "failed", "turned"],
  figures: [
    {
      tone: "problem",
      short: "No limit",
      title: "A scraper floods the API",
      caption: "The bot sends 40 a second, nearly three times all the real users combined.",
      metrics: [usersP95, M.errors({ tag: "user", label: "Users failed" }), M.busy(["svc"])],
      parts: [
        { node: "u", text: "Users: 14 requests a second." },
        { node: "bot", text: "Scraper bot: 40 a second." },
        { node: "svc", text: "API server: about 40 a second, 4 workers.", sockets: true },
      ],
      beats: [
        { id: "flood", when: { at: 200 }, text: "Watch the bot's requests crowd the line at API server.", focus: { nodes: ["svc"], dots: "waiting" } },
        { id: "share", when: { wait: 0 }, text: "Real users wait in the same line as the bot.", focus: { nodes: ["u"], link: ["u", "svc"] } },
        {
          id: "slow",
          when: { metric: usersP95, is: ">", value: 400 },
          text: "Users' slowest 1 in 20: {p95:user}, target 400 ms.",
          focus: { metric: "Users' response time" },
          pause: true,
        },
      ],
      predict: {
        prompt: "We cap each client at 16 requests a second. Real users' slowest 1 in 20 will…",
        options: ["stay slow", "get fast again", "be turned away"],
        answer: 1,
        before: "end",
        reveal: { beat: "users", text: "Users' slowest 1 in 20: {before} without a limit, {after} with one." },
        track: { metric: usersP95, world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < 0.5 * before,
      },
      build: unlimited,
    },
    {
      tone: "fix",
      short: "Rate limit",
      title: "A limit per client",
      caption: "Each client gets a steady allowance plus a small burst. Requests over it are turned away at once.",
      knobs: [knob("rps", "Limit per client", 5, 50, 1, 16, perSecond)],
      metrics: [
        usersP95,
        M.errors({ tag: "user", label: "Users failed" }),
        { id: "rejected", label: "Bot turned away", tag: "bot", better: "high", hint: "Share of the bot's requests rejected by the limiter." },
      ],
      parts: [{ node: "lim", text: "Rate limiter: 16 a second per client, plus bursts." }],
      beats: [
        {
          id: "bucket",
          when: { wait: 0 },
          text: "Each client earns 16 tokens a second to spend: a [[token-bucket|token bucket]].",
          focus: { nodes: ["lim"] },
          term: "token-bucket",
        },
        {
          id: "turned",
          when: { fx: "reject", node: "lim" },
          text: "Out of tokens: the bot's request is turned away at once, a grey square.",
          focus: { nodes: ["lim"], dots: "turned" },
          pause: true,
        },
        {
          id: "users",
          when: { metric: usersP95, is: "<", value: 400, forMs: 300 },
          text: "Users' slowest 1 in 20: {p95:user:fix}, down from {p95:user:problem}.",
          focus: { metric: "Users' response time" },
        },
      ],
      invite: [{ id: "invite", when: { wait: 0 }, text: "Drag Limit per client down to 5: real users start being turned away too.", focus: { knob: "rps" } }],
      headline: {
        metric: "Users' response time",
        sentence: "Same flood. Users' slowest 1 in 20 waited {p95:user:problem} without a limit, {p95:user:fix} with one.",
      },
      build: (v: Values) =>
        scene(
          [
            { ...people(), to: ["lim"] },
            { ...bot(), to: ["lim"] },
            { id: "lim", kind: "limiter", label: "Rate limiter", at: [42, 50], limit: { rps: v.rps, burst: 6 }, to: ["svc"] } satisfies NodeSpec,
            server("svc", [84, 50], { slots: 4, serviceMs: 100, queueMax: 30, label: "API server" }),
          ],
          { wideH: 440 },
        ),
    },
  ],
  checks: [
    {
      prompt: "The bot is turned away. Where does that happen?",
      options: ["At the API server", "Before the server, at the limiter", "At the bot"],
      answer: 1,
      why: "Its excess never reaches the server, so it costs the server nothing.",
      focus: { nodes: ["lim"] },
    },
    {
      prompt: "A limit set too low…",
      options: ["turns real users away too", "makes the server faster", "has no effect"],
      answer: 0,
      why: "Real users have bursts too; a tight limit turns them away along with the bot.",
      focus: { nodes: ["lim"] },
    },
  ],
  takeaways: {
    use: "Put limits on public APIs, logins and expensive endpoints, set per user, per key or per IP.",
    catch: "Limits that are too tight hurt real users. Spread across many servers, the counters need shared state.",
    seen: "API gateways, Nginx limit_req, Stripe's and GitHub's per-key API limits.",
    rule: "Cap each client; protect everyone else.",
  },
};

export default limiting;
