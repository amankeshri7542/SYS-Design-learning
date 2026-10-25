import { M, balancer, choice, lane, range, scene, server, users } from "../kit";
import type { LessonScene } from "../types";

const REGIONS = [
  { id: "eu", label: "Europe", rate: 30 },
  { id: "as", label: "Asia", rate: 8 },
  { id: "am", label: "Americas", rate: 4 },
];
const regionUsers = (to: (i: number) => string) =>
  REGIONS.map((r, i) =>
    users(r.id, [8, lane(3, i)], { rate: r.rate, keys: 50, heavy: { share: 0.15, cost: 3 } }, to(i), {
      label: r.label,
    }),
  );
const lbServers = () => range(3).map((i) => server(`s${i + 1}`, [86, lane(3, i)], { slots: 3, serviceMs: 120, label: `Server ${i + 1}` }));

const sticky = () => scene([...regionUsers((i) => `s${i + 1}`), ...lbServers()], { wideH: 460 });
const busiest = M.peak(["s1", "s2", "s3"]);

const balancing: LessonScene = {
  hook: "Three servers, and one is drowning while another sits idle. Why?",
  dots: ["req", "late", "ok"],
  figures: [
    {
      tone: "problem",
      short: "Fixed servers",
      title: "Each region is stuck with one server",
      caption: "Europe sends 30 a second, Asia 8, the Americas 4. Some requests are heavier: bigger dots take longer.",
      metrics: [M.p95(), busiest, M.errors()],
      parts: [
        { node: ["eu", "as", "am"], text: "Three regions: 30, 8 and 4 requests a second." },
        { node: ["s1", "s2", "s3"], text: "Servers: 3 workers each, 120 ms per request.", sockets: true },
      ],
      beats: [
        { id: "europe", when: { at: 300 }, text: "Watch Server 1: Europe's 30 a second all go to it.", focus: { nodes: ["s1"], link: ["eu", "s1"] } },
        {
          id: "line",
          when: { metric: M.queue(["s1"]), is: ">", value: 3 },
          text: "A line builds in front of Server 1.",
          focus: { nodes: ["s1"], dots: "waiting" },
          pause: true,
        },
        { id: "idle", when: { wait: 0 }, text: "Server 3 sits mostly idle: the Americas send only 4 a second.", focus: { nodes: ["s3"], sockets: true } },
        { id: "late", when: { metric: M.p95(), is: ">", value: 400 }, text: "The slowest 1 in 20 takes {p95:problem}, target 400 ms.", focus: { metric: "Response time" } },
      ],
      predict: {
        prompt: "One balancer will share all three servers, with the same traffic. The slowest 1 in 20 will…",
        options: ["get a little faster", "get much faster", "stay the same"],
        answer: 1,
        before: "end",
        reveal: { beat: "compare", text: "{before} without a balancer, {after} with one." },
        track: { metric: M.p95(), world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < 0.6 * before,
      },
      build: sticky,
    },
    {
      tone: "fix",
      short: "Balanced",
      title: "One balancer in front of all three",
      caption: "Every request goes to the balancer, which picks a server. Try each strategy.",
      knobs: [choice("algo", "Strategy", ["Round robin", "Random", "Least busy"], 0)],
      metrics: [M.p95(), busiest, M.errors()],
      parts: [{ node: "lb", text: "Load balancer: picks a server for each request." }],
      beats: [
        { id: "turns", when: { wait: 0 }, text: "The balancer takes the servers in turn: [[round-robin|round robin]].", focus: { nodes: ["lb"] }, term: "round-robin" },
        { id: "shared", when: { metric: M.busy(["s3"]), is: ">", value: 0.5 }, text: "Server 3 is busy now too: every server takes a share.", focus: { nodes: ["s3"], sockets: true } },
        { id: "compare", when: { metric: M.p95(), is: "<", value: 650, forMs: 400 }, text: "The slowest 1 in 20: {p95:fix} here, {p95:problem} without the balancer.", focus: { metric: "Response time" } },
      ],
      invite: [{ id: "invite", when: { wait: 0 }, text: "Try “Least busy”: it steers new work away from servers stuck on heavy requests.", focus: { knob: "algo" } }],
      headline: {
        metric: "Response time",
        sentence: "Same traffic. Stuck to one server each, the slowest 1 in 20 took {p95:problem}; balanced, {p95:fix}.",
      },
      build: (v) =>
        scene(
          [
            ...regionUsers(() => "lb"),
            balancer("lb", [46, 50], ["s1", "s2", "s3"], {
              algo: (["round-robin", "random", "least"] as const)[v.algo],
            }),
            ...lbServers(),
          ],
          { wideH: 460 },
        ),
    },
  ],
  checks: [
    {
      prompt: "Some requests cost three times more. Which strategy copes best?",
      options: ["Round robin", "Random", "Least busy"],
      answer: 2,
      why: "Least busy sends new work to the server with the fewest requests in hand, so heavy ones don't pile up.",
      focus: { nodes: ["lb"] },
    },
    {
      prompt: "Why did Server 3 sit idle without a balancer?",
      options: ["It was slower", "Only the Americas' few requests could reach it", "It had crashed"],
      answer: 1,
      why: "Each region was stuck with one server, so spare capacity elsewhere couldn't help Europe.",
      focus: { nodes: ["s3"] },
    },
  ],
  takeaways: {
    use: "Use one whenever you run more than one copy of a service, which is almost always.",
    catch: "The balancer is now on every request path. Run at least two, and pick an algorithm that suits your request costs.",
    seen: "Nginx, HAProxy, AWS ALB, Envoy, and Kubernetes Services.",
    rule: "Share the work, not just the servers.",
  },
};

export default balancing;
