"use client";

import { useMemo } from "react";
import { HERO } from "@/lib/lessons/hero";
import { MetricList, Transport, useLiveSims } from "./live";
import { BeatStrip } from "./beats";
import { Stage } from "./stage";

/** The home page's live scene: already running when you arrive, so it shows the visual language in motion. */
export function HeroScene() {
  const specs = useMemo(() => [HERO.build({})], []);
  const live = useLiveSims(specs, { warm: 1500 });
  const sim = live.sims[0];
  return (
    <figure className="hero-fig" ref={live.rootRef} aria-label={HERO.title} data-sim-time={Math.round(sim.t)}>
      <div className="sheet hero-stage">
        <BeatStrip sim={sim} lead={<span className="beat-tone tone-explore">{HERO.short}</span>} />
        <Stage sim={sim} spec={specs[0]} mode={live.mode} reduced={live.reduced} label={`${HERO.title}. ${HERO.caption}`} drawRef={live.drawRef} />
      </div>
      <figcaption className="hero-bar">
        <Transport live={live} />
        <MetricList metrics={HERO.metrics} sim={sim} />
      </figcaption>
    </figure>
  );
}
