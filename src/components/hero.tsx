"use client";

import { useMemo } from "react";
import { HERO } from "@/lib/lessons/hero";
import { BeatStrip, type BeatView } from "./beats";
import { useMode } from "./hooks";
import { Transport, useLiveSims } from "./live";
import { MetricList, useSceneBeats } from "./scene-run";
import { Stage } from "./stage";

const BEATS = HERO.beats ?? [];
const LOOP = HERO.build({}).script?.loopMs ?? 1;
/** Before a beat has fired (and under reduced motion, where nothing runs), the strip opens on the first. */
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
        />
      </div>
      <figcaption className="hero-bar">
        <Transport live={live} />
        <MetricList metrics={metrics} sim={sim} />
      </figcaption>
    </figure>
  );
}
