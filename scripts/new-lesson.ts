// Turns a planned catalog entry into a lesson to write: `npm run new-lesson -- <slug>`.
//
// It writes `src/lib/lessons/scenes/<slug>.ts` from a skeleton, adds the scene to the lazy map (`scenes/index.ts`) and
// the all-at-once map (`all.ts`), and marks the catalog entry live. The skeleton builds and runs, but its words are
// placeholders, so `npm test` fails until the lesson is written: that is the checklist.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOG, LINES } from "../src/lib/lessons/catalog";

const root = join(__dirname, "..");
const slug = process.argv[2];
const entry = CATALOG.find((e) => e.slug === slug);

function fail(why: string): never {
  console.error(why);
  process.exit(1);
}

if (!slug) fail("Usage: npm run new-lesson -- <slug>   (a planned lesson in src/lib/lessons/catalog.ts)");
if (!entry) fail(`No catalog entry for “${slug}”. Add it to src/lib/lessons/catalog.ts first, with its frozen code.`);
if (entry.kind !== "lesson") fail(`“${slug}” is a story: copy src/lib/lessons/stories/capstone.ts and add it to stories/index.ts and all.ts.`);
if (entry.status === "live") fail(`“${slug}” is already live.`);

const lessons = join(root, "src/lib/lessons");
const scenePath = join(lessons, "scenes", `${slug}.ts`);
const camel = slug.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
const key = /^[a-z]\w*$/.test(slug) ? slug : JSON.stringify(slug);
const line = LINES.find((l) => l.id === entry.line)!;

// 1. The scene file: a problem and a fix that build and run, with every word still to write.
if (existsSync(scenePath)) fail(`${scenePath} already exists.`);
writeFileSync(
  scenePath,
  `import { M, knob, scene, server, users } from "../kit";
import type { LessonScene, Values } from "../types";

// ${entry.code} ${entry.title}: ${entry.why}
// Write it to docs/plan-v3.md §8 and its row in docs/research/curriculum.md §3. Every TODO is a test that fails.

const lesson: LessonScene = {
  hook: "TODO: a question the learner has felt, 16 words at most?",
  dots: ["req", "late", "ok"],
  figures: [
    {
      tone: "problem",
      short: "Problem",
      title: "TODO: the problem, in a few words",
      caption: "TODO: the setup, not the outcome, in 25 words or fewer.",
      metrics: [M.p95(), M.busy(["app"])],
      parts: [
        { node: "u", text: "Users: 30 requests a second." },
        { node: "app", text: "Server: 4 workers, 120 ms each.", sockets: true },
      ],
      beats: [
        { id: "watch", when: { at: 300 }, text: "TODO: Watch …", focus: { nodes: ["app"] } },
        { id: "line", when: { metric: M.queue(["app"]), is: ">", value: 3 }, text: "TODO: Count …", focus: { nodes: ["app"], dots: "waiting" }, pause: true },
        { id: "slow", when: { metric: M.p95(), is: ">", value: 400 }, text: "TODO: The slowest 1 in 20 takes {p95:problem}.", focus: { metric: "Response time" } },
      ],
      predict: {
        prompt: "TODO: what the learner commits to before the fix?",
        options: ["TODO: the answer", "TODO: a real misconception"],
        answer: 0,
        before: "end",
        reveal: { beat: "compare", text: "TODO: {before} before, {after} after." },
        track: { metric: M.p95(), world: 0, afterWorld: 1, same: true },
        holds: (before, after) => before !== null && after !== null && after < before,
      },
      build: () => scene([users("u", [14, 50], { rate: 30, keys: 50 }, "app"), server("app", [86, 50], { slots: 4, serviceMs: 120, label: "Server" })]),
    },
    {
      tone: "fix",
      short: "Fix",
      title: "TODO: the fix, in a few words",
      caption: "TODO: what changed, in 25 words or fewer.",
      knobs: [knob("slots", "Workers", 2, 8, 1, 6)],
      metrics: [M.p95(), M.busy(["app"])],
      beats: [
        { id: "change", when: { step: "enter" }, text: "TODO: Watch …", focus: { nodes: ["app"] } },
        { id: "busy", when: { wait: 0 }, text: "TODO: Server busy: {util:app:fix}.", focus: { nodes: ["app"], sockets: true } },
        { id: "compare", when: { wait: 0 }, text: "TODO: {p95:fix} here, {p95:problem} before.", focus: { metric: "Response time" } },
      ],
      headline: { metric: "Response time", sentence: "TODO: Same traffic. {p95:problem} before, {p95:fix} with the fix." },
      build: (v: Values) => scene([users("u", [14, 50], { rate: 30, keys: 50 }, "app"), server("app", [86, 50], { slots: v.slots, serviceMs: 120, label: "Server" })]),
    },
  ],
  checks: [
    {
      prompt: "TODO: a question on the Recap?",
      options: ["TODO: the answer", "TODO: a wrong one"],
      answer: 0,
      why: "TODO: why, in 25 words or fewer.",
      focus: { nodes: ["app"] },
    },
  ],
  takeaways: {
    use: "TODO: use it when …",
    catch: "TODO: the catch …",
    seen: "TODO: products that do this.",
    rule: "TODO: eight words at most.",
  },
};

export default lesson;
`,
);

// 2. The lazy map: one literal import per lesson, under its line.
const indexPath = join(lessons, "scenes/index.ts");
let index = readFileSync(indexPath, "utf8");
const loader = `  ${key}: () => import("./${slug}"),\n`;
const head = `  // ${line.name}\n`;
const end = index.indexOf("\n};", index.indexOf("export const SCENES"));
if (index.includes(head)) {
  // After the last entry of the line's group.
  const from = index.indexOf(head) + head.length;
  const next = index.slice(from).search(/\n {2}\/\/ |\n};/);
  const at = from + next + 1;
  index = index.slice(0, at) + loader + index.slice(at);
} else {
  index = index.slice(0, end + 1) + head + loader + index.slice(end + 1);
}
writeFileSync(indexPath, index);

// 3. The all-at-once map, for the tests and scripts.
const allPath = join(lessons, "all.ts");
let all = readFileSync(allPath, "utf8");
const imports = [...all.matchAll(/^import \w+ from "\.\/scenes\/[\w-]+";$/gm)];
const last = imports[imports.length - 1];
const at = last.index! + last[0].length + 1;
all = all.slice(0, at) + `import ${camel} from "./scenes/${slug}";\n` + all.slice(at);
const def = camel === slug ? `  ${slug},` : `  ${key}: ${camel},`;
all = all.replace(/(export const SCENE_DEFS: Record<string, LessonScene> = \{\n[\s\S]*?)(\n\};)/, `$1\n${def}$2`);
writeFileSync(allPath, all);

// 4. The catalog entry goes live (its code was frozen long ago).
const catalogPath = join(lessons, "catalog.ts");
const catalog = readFileSync(catalogPath, "utf8");
const planned = `{ ...planned, slug: "${slug}"`;
if (!catalog.includes(planned)) fail(`Couldn't find ${planned} in catalog.ts; mark it live by hand.`);
writeFileSync(catalogPath, catalog.replace(planned, `{ ...live, slug: "${slug}"`));

console.log(`${entry.code} ${entry.title} is live, with a skeleton at src/lib/lessons/scenes/${slug}.ts.

Next:
  1. Write the scene to docs/plan-v3.md §8 and its curriculum row. Add its terms to src/lib/glossary.ts.
  2. Give it \`requires\` in catalog.ts (live lessons only), and add it as a prerequisite where the curriculum says.
  3. npm run tune -- ${slug} --beats      (timeline of its beats)
  4. npm run typecheck && npm test && npm run build && npm run test:browser`);
