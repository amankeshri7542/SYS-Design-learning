"use client";

import { useMemo } from "react";
import type { SceneSpec } from "@/lib/sim/types";
import { useLiveSims } from "./live";
import { Stage } from "./stage";

/**
 * A small live scene with no controls: a station preview on the map, a journey card's finished architecture. It runs
 * only while it is on screen, opens already warmed, and is a still frame under reduced motion.
 */
export function MiniScene({ spec, label, warm = 1500 }: { spec: SceneSpec; label: string; warm?: number }) {
  const specs = useMemo(() => [spec], [spec]);
  const live = useLiveSims(specs, { warm });
  return (
    <div className="mini-scene" ref={live.rootRef as React.Ref<HTMLDivElement>} data-sim-time={Math.round(live.sims[0].t)}>
      <Stage sim={live.sims[0]} spec={spec} mode={live.mode} reduced={live.reduced} label={label} drawRef={live.drawRef} remember={false} />
    </div>
  );
}
