import { M, knob, ms, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";

// N1: one user, one server across the world (New York to Sydney is about 80 ms each way in fibre). A few requests a
// second, so each dot can be followed out and back, and the table splits each answer's time into travel, waiting and
// working. The server is fast; the wire is not.

const n1 = (away: number, work: number) =>
  scene([users("u", [14, 50], { rate: 5, keys: 50 }, "app", { label: "User" }), server("app", [86, 50], { slots: 4, serviceMs: work, label: "Server" })], {
    links: { "u>app": { ms: away, label: `${away} ms each way` } },
    windowMs: 3000,
    seed: 5,
  });

const metrics = [M.p50(), M.wire(), M.wait(), M.work()];

const requestAndResponse: LessonScene = {
  hook: "Why does a fast server still feel slow from far away?",
  dots: ["req", "ok"],
  figures: [
    {
      tone: "problem",
      short: "Far away",
      title: "Out and back",
      caption: "A user in New York, a server in Sydney: 80 ms apart each way. The server's work takes 20 ms.",
      metrics,
      parts: [
        { node: "u", text: "User: clicks 5 times a second." },
        { node: "app", text: "Server: 4 workers, 20 ms each.", sockets: true },
      ],
      beats: [
        {
          id: "request",
          when: { at: 250 },
          text: "Watch a blue dot leave User. It's a [[request]]: a message asking Server for something.",
          focus: { link: ["u", "app"] },
          follow: true,
          pause: true,
          term: "request",
        },
        { id: "idle", when: { wait: 0 }, text: "Count Server's part: 20 ms of work. Its workers sit empty most of the time.", focus: { nodes: ["app"], sockets: true } },
        {
          id: "response",
          when: { metric: M.wire(), is: ">", value: 0 },
          text: "The green dot coming back is the [[response]]: another 80 ms on the wire.",
          focus: { link: ["u", "app"] },
          term: "response",
        },
        {
          id: "round",
          when: { wait: 0 },
          text: "Out and back is a [[round-trip|round trip]]: 160 ms before any work counts.",
          focus: { link: ["u", "app"] },
          term: "round-trip",
        },
        { id: "split", when: { wait: 0 }, text: "Read where the time went: {wire} travelling, {work} working.", focus: { metric: "Travel" } },
      ],
      predict: {
        prompt: "Server gets twice as fast: 10 ms per request instead of 20. The typical response will…",
        options: ["Halve", "Shrink by about 10 ms"],
        answer: 1,
        before: "end",
        reveal: { beat: "faster", text: "Typical response: {before} with the 20 ms server, {after} with the 10 ms one." },
        track: { metric: M.p50(), world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < before && after > before * 0.85,
      },
      build: () => n1(80, 20),
    },
    {
      tone: "explore",
      short: "Your setup",
      title: "Where the time goes",
      caption: "The same user and server, now twice as fast. You set how far apart they are and how long the server works.",
      knobs: [knob("away", "Distance", 5, 150, 5, 80, (v) => `${ms(v)} each way`), knob("work", "Server time", 5, 200, 5, 10, ms)],
      metrics,
      beats: [
        { id: "faster", when: { step: "enter" }, text: "Compare Working: down to {work:explore}. Travel is still {wire:explore}.", focus: { metric: "Working" } },
        { id: "closer", when: { wait: 0 }, text: "Drag Distance to 10 ms: the same server, in the user's own city.", focus: { knob: "away" } },
        { id: "flip", when: { wait: 600 }, text: "Now drag Server time to 100 ms. Working outweighs travel.", focus: { knob: "work" } },
      ],
      headline: {
        metric: "Typical response",
        sentence: "In your scene: {wire:2} travelling and {work:2} working, so a typical answer takes {p50:2}.",
      },
      build: (v: Values) => n1(v.away, v.work),
    },
  ],
  checks: [
    {
      prompt: "A server 100 ms away needs 10 ms per request. About how long does one request take?",
      options: ["110 ms", "210 ms", "20 ms"],
      answer: 1,
      why: "Out and back is two trips of 100 ms, plus 10 ms of work: 210 ms. Travel is nearly all of it.",
      focus: { link: ["u", "app"] },
    },
    {
      prompt: "Users far away say the site is slow. Which helps them most?",
      options: ["A faster server", "A server closer to them", "More workers"],
      answer: 1,
      why: "Their time is mostly travel. Halving the distance halves it; a faster server trims only the small working part.",
      focus: { metric: "Travel" },
    },
  ],
  takeaways: {
    use: "Every design: count the round trips before you count the server's work.",
    catch: "Light in fibre covers about 200 km a millisecond. No faster server makes a far one near.",
    seen: "Every page load and API call. New York to Sydney is about 160 ms there and back.",
    rule: "Distance is time.",
  },
};

export default requestAndResponse;
