"use client";

import { useMemo } from "react";
import { COURSE } from "@/lib/lessons";
import { HERO } from "@/lib/lessons/hero";
import { BeatStrip, type BeatView } from "./strip";
import { useMode } from "./hooks";
import { DOTS, Dot } from "./legend";
import type { Explain } from "./part-card";
import { Transport, useLiveSims } from "./live";
import { useSceneBeats } from "./scene-beats";
import { MetricList } from "./scene-run";
import { Stage } from "./stage";

const BEATS = HERO.beats ?? [];
const LOOP = HERO.build({}).script?.loopMs ?? 1;
/** Before a beat has fired (and under reduced motion, where nothing runs), the strip opens on the first. */
// Its stations open their cards like a lesson's, pointing at the lessons that teach them.
const EXPLAIN: Explain = { lesson: "", learn: Object.fromEntries(COURSE.map((e) => [e.slug, { code: e.code, title: e.title }])) };
/** The dots a first look needs, in one row under the scene: the rest are named in the lessons that show them. */
const KEY = DOTS.filter((d) => ["req", "late", "ok", "failed", "turned"].includes(d.kind));
const FIRST: BeatView = { id: "first", text: BEATS[0]?.text ?? "", focus: null, n: 1, total: BEATS.length, waiting: false, part: false, follow: false };

/**
 * The home page's live scene: already running when you arrive, so it shows the visual language in motion. Its three
 * beats come round with the loop: the flow, a server crashing, and the server coming back.
 */
export function HeroScene() {
  // Phones get the scene's front half, as a short ticker: the cache and database don't fit at a readable size.
  const compact = useMode() === "compact";
  const specs = useMemo(() => [HERO.build({ compact: compact ? 1 : 0 })], [compact]);
  const beats = useSceneBeats(BEATS, (sim) => Math.floor(sim.t / LOOP));
  const live = useLiveSims(specs, { warm: 1500, onGrid: beats.onGrid });
  const sim = live.sims[0];
  const beat = beats.beat ?? FIRST;
  const caption = compact ? "Users send requests through a load balancer to three servers. Now and then a server crashes." : HERO.caption;
  const metrics = compact ? HERO.metrics.filter((m) => m.id !== "hit") : HERO.metrics;
  return (
    <figure className="hero-fig" ref={live.rootRef} aria-label={HERO.title} data-sim-time={Math.round(sim.t)}>
      <div className="sheet hero-stage">
        <BeatStrip sim={sim} lead={<span className="beat-tone tone-explore">{HERO.short}</span>} beat={beat} />
        <Stage
          sim={sim}
          spec={specs[0]}
          mode={live.mode}
          reduced={live.reduced}
          label={`${HERO.title}. ${caption}`}
          drawRef={live.drawRef}
          explain={EXPLAIN}
        />
      </div>
      <figcaption className="hero-bar">
        <Transport live={live} />
        <MetricList metrics={metrics} sim={sim} />
        <p className="hero-key">
          {KEY.map((d) => (
            <span key={d.kind}>
              <Dot shape={d.shape} cls={d.cls} />
              {d.name}
            </span>
          ))}
          <span className="hero-tip">Tap a name to see what it is.</span>
        </p>
      </figcaption>
    </figure>
  );
}
