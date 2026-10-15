"use client";

import { useMemo } from "react";
import { HERO } from "@/lib/lessons/hero";
import { MetricList, Transport, freshNote, useLiveSims } from "./live";
import { Stage } from "./stage";

/** The home page's live scene: already running when you arrive, so it shows the visual language in motion. */
export function HeroScene() {
  const specs = useMemo(() => [HERO.build({})], []);
  const live = useLiveSims(specs, { warm: 1500 });
  const sim = live.sims[0];
  const note = freshNote(sim);
  return (
    <figure className="hero-fig" ref={live.rootRef} aria-label={HERO.title} data-sim-time={Math.round(sim.t)}>
      <div className="hero-stage">
        <Stage sim={sim} spec={specs[0]} mode={live.mode} reduced={live.reduced} label={`${HERO.title}. ${HERO.caption}`} drawRef={live.drawRef} />
        <p className={`note${note ? " on" : ""}`} aria-live="polite">
          {note}
        </p>
      </div>
      <figcaption className="hero-bar">
        <Transport live={live} name="hero" compact />
        <MetricList metrics={HERO.metrics} sim={sim} />
      </figcaption>
    </figure>
  );
}
