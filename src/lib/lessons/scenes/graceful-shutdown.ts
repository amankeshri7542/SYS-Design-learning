import { M, balancer, knob, lane, ms, scene, server, users } from "../kit";
import type { Action, LessonScene, Values } from "../types";
import type { MetricSpec } from "../../sim/metrics";
import type { SceneSpec, ScriptEvent } from "../../sim/types";

// O2: a rolling deploy restarts three servers one after another, 1.1 s apart. Killed, a server fails everything it is
// working on, and the balancer keeps sending to it until two health checks fail. Drained, it first leaves the
// rotation (the balancer stops sending at once), finishes what it has, and is stopped only if the drain time runs out.
// Either way it comes back after 0.3 s and takes traffic once it has started.

const IDS = ["s1", "s2", "s3"];
const FIRST = "Server 1 restarts";

/** The deploy: each server in turn, killed or drained (for at most `drainMs`), then started again. */
const rollout = (graceful: boolean, drainMs: number): { loopMs: number; events: ScriptEvent[] } => {
  const events: ScriptEvent[] = [];
  IDS.forEach((id, k) => {
    const at = 1200 + k * 1100;
    const name = `Server ${k + 1}`;
    const stop = graceful ? drainMs : 0;
    events.push({ at, label: `${name} restarts`, armed: true, node: id, run: (s) => (graceful ? s.drain(id) : s.setUp(id, false)) });
    if (graceful)
      events.push({
        at: at + stop,
        label: `${name} stops`,
        armed: true,
        node: id,
        // Out of time: whatever it still holds is cut off.
        run: (s) => {
          const n = s.nodes.get(id);
          if (n && (n.work.length || n.queue.length || n.held.length)) s.setUp(id, false);
        },
      });
    events.push({ at: at + stop + 300, label: `${name} is back`, armed: true, node: id, run: (s) => s.boot(id, 150) });
  });
  return { loopMs: 60_000, events };
};

/** The deploy button: starts the rollout in every world; stopping it starts any server that is down. */
const deploy: Action = {
  id: "deploy",
  label: "Roll out a deploy",
  undo: "Stop the rollout",
  run: (sim, on) => {
    if (on) return void sim.fire(FIRST);
    sim.cancel();
    for (const id of IDS) {
      const n = sim.nodes.get(id);
      if (n && (!n.up || !n.on)) sim.boot(id, 150);
    }
  },
  isOn: (sim) => IDS.some((id) => {
    const n = sim.nodes.get(id);
    return !!n && (!n.up || !n.on || !n.ready);
  }),
};

const fleet = (graceful: boolean, drainMs: number): SceneSpec =>
  scene(
    [
      users("u", [8, 50], { rate: 60, keys: 50 }, "lb"),
      balancer("lb", [38, 50], IDS, { label: "Balancer", health: { everyMs: 50, failAfter: 2, passAfter: 2, timeoutMs: 150 } }),
      ...IDS.map((id, i) => server(id, [78, lane(3, i)], { label: `Server ${i + 1}`, slots: 4, serviceMs: 80 })),
    ],
    { windowMs: 2500, seed: 20, script: rollout(graceful, drainMs) },
  );

const inRotation: MetricSpec = { id: "inRotation", label: "Servers in rotation", nodes: ["lb"], hint: "Servers the balancer is sending traffic to right now." };
const metrics = [M.errors(), inRotation, M.p95()];

const graceful: LessonScene = {
  hook: "Why does a routine deploy make some users see errors?",
  dots: ["req", "late", "ok", "failed"],
  figures: [
    {
      tone: "problem",
      short: "Kill",
      title: "Kill and restart",
      caption: "A deploy restarts each server in turn: it is stopped at once, mid-request, and started again 0.3 s later.",
      actions: [deploy],
      metrics,
      parts: [
        { node: "u", text: "Users: 60 requests a second." },
        { node: "lb", text: "Balancer: checks each server every 50 ms." },
        { node: IDS, text: "Servers: 3, 4 workers each, 80 ms a request.", sockets: true },
      ],
      beats: [
        { id: "calm", when: { at: 300 }, text: "Three servers share the traffic. A deploy will restart each one in turn.", focus: { nodes: IDS } },
        { id: "press", when: { wait: 0 }, text: "Press ⚡ Roll out a deploy.", focus: { action: "deploy" }, pause: true },
        { id: "kill", when: { note: FIRST }, text: "Server 1 is stopped mid-request: everything it was doing fails.", focus: { nodes: ["s1"] } },
        { id: "noticed", when: { metric: M.errors(), is: ">", value: 0.03 }, text: "More red diamonds: requests sent before the balancer noticed it was gone.", focus: { dots: "failed" } },
        { id: "every", when: { note: "Server 3 is back" }, text: "Count Failed: {errors}. A routine deploy, and real users saw errors.", focus: { metric: "Failed" } },
      ],
      predict: {
        prompt: "Each server restarts in turn, one at a time. Users will see…",
        options: ["Nothing: two are always up", "Errors at every restart"],
        answer: 1,
        before: "press",
        reveal: { beat: "noticed", text: "Failed: {before} before the deploy, {after} during it." },
        track: { metric: M.errors() },
        holds: (_, after) => after !== null && after > 0.03,
      },
      break: { action: "deploy", beat: "press" },
      build: () => fleet(false, 0),
    },
    {
      tone: "fix",
      short: "Drain",
      title: "Drain, then restart",
      caption: "Each server first leaves the rotation and finishes what it has, then restarts. You set how long it may take.",
      actions: [deploy],
      knobs: [knob("drain", "Drain time", 50, 800, 50, 500, ms)],
      metrics,
      beats: [
        {
          id: "drain",
          when: { step: "enter" },
          text: "Now a server stops taking new requests and finishes the rest: [[draining]].",
          focus: { nodes: IDS },
          term: "draining",
        },
        { id: "compare", when: { wait: 0 }, text: "Compare Failed: {errors:fix} here, {errors:problem} stopping servers mid-request.", focus: { metric: "Failed" } },
        { id: "rotation", when: { wait: 0 }, text: "Servers in rotation drops to 2 during each restart, and nobody notices.", focus: { metric: "Servers in rotation" } },
        { id: "short", when: { wait: 600 }, text: "Drag Drain time to 50 ms: too short to finish, and errors come back.", focus: { knob: "drain" } },
      ],
      headline: { metric: "Failed", sentence: "During the deploy: {errors:problem} failed stopping servers at once, {errors:fix} draining them first.", at: "every" },
      build: (v: Values) => fleet(true, v.drain),
    },
  ],
  checks: [
    {
      prompt: "What should a server do first when it's told to shut down?",
      options: ["Stop at once", "Leave the rotation, then finish its work"],
      answer: 1,
      why: "Once the balancer stops sending it work, it can finish what it has and exit without failing anyone.",
      focus: { nodes: IDS },
    },
    {
      prompt: "Why give draining a time limit?",
      options: ["So a stuck request can't hold up the deploy forever", "To make it faster"],
      answer: 0,
      why: "Most work finishes quickly; a limit cuts off the rare request that would never end.",
      focus: { knob: "drain" },
    },
  ],
  takeaways: {
    use: "Every restart and scale-in: fail the readiness check, finish in-flight work, then exit.",
    catch: "The balancer must actually stop sending first, and long requests or open connections need their own limit.",
    seen: "Kubernetes readiness probes and terminationGracePeriodSeconds, SIGTERM handlers, connection draining in AWS load balancers.",
    rule: "Stop taking work, then stop.",
  },
};

export default graceful;
