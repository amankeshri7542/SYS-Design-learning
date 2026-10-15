"use client";

import { useMemo, useState } from "react";
import { getLesson } from "@/lib/lessons";
import { defaultsOf, isChoice, type FigureDef, type Values } from "@/lib/lessons/types";
import { BoltIcon, Metrics, Transport, useLiveSim } from "./live";
import { Stage } from "./stage";

const TONE_LABEL: Record<FigureDef["tone"], string> = {
  problem: "The problem",
  fix: "The fix",
  tradeoff: "Trade-off",
  explore: "Explore",
};

export function LessonFigure({ slug, index }: { slug: string; index: number }) {
  const def = getLesson(slug)?.figures[index];
  if (!def) return null;
  return <FigureView def={def} number={index + 1} />;
}

/** One live scene: stage, transport controls, faults, knobs and metrics. */
export function FigureView({ def, number, variant = "lesson", warm }: { def: FigureDef; number?: number; variant?: "lesson" | "hero"; warm?: number }) {
  const [values, setValues] = useState<Values>(() => defaultsOf(def));
  const spec = useMemo(() => def.build(values), [def, values]);
  const baseSpec = useMemo(() => def.compare?.build(values), [def, values]);
  const live = useLiveSim(spec, baseSpec, { warm: warm ?? spec.warmMs ?? 400 });
  const { sim } = live;
  const id = `${def.title}-${number ?? variant}`;

  return (
    <figure
      ref={live.rootRef}
      className={`fig fig-${variant} tone-${def.tone}`}
      data-sim-time={Math.round(sim.t)}
      tabIndex={0}
      aria-label={`${def.title}. Animated simulation. Press space to play or pause, right arrow to step.`}
      onKeyDown={live.onKey}
    >
      {variant === "lesson" && (
        <figcaption className="fig-head">
          <span className="fig-tag">
            {number !== undefined && <span className="fig-num">{number}</span>}
            {TONE_LABEL[def.tone]}
          </span>
          <h2 className="fig-title">{def.title}</h2>
          <p className="fig-caption">{def.caption}</p>
        </figcaption>
      )}
      <div className="fig-stage">
        <Stage sim={sim} spec={spec} mode={live.mode} reduced={live.reduced} label={`${def.title}. ${def.caption}`} drawRef={live.drawRef} />
        <p className={`note${live.note ? " on" : ""}`} aria-live="polite">
          {live.note}
        </p>
      </div>
      <div className="fig-bar">
        <Transport live={live} name={id} />
        {def.actions && (
          <div className="faults">
            {def.actions.map((a) => {
              const on = a.isOn(sim);
              return (
                <button
                  key={a.id}
                  type="button"
                  className={`btn btn-fault${on ? " on" : ""}`}
                  aria-pressed={on}
                  onClick={() => {
                    a.run(sim, !on);
                    live.refresh();
                  }}
                >
                  <BoltIcon />
                  {on ? a.undo : a.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {def.knobs && def.knobs.length > 0 && (
        <div className="knobs">
          {def.knobs.map((k) =>
            isChoice(k) ? (
              <fieldset key={k.id} className="knob knob-choice">
                <legend>{k.label}</legend>
                <div className="seg">
                  {k.options.map((o) => (
                    <label key={o.value}>
                      <input
                        type="radio"
                        name={`${id}-${k.id}`}
                        checked={values[k.id] === o.value}
                        onChange={() => setValues((v) => ({ ...v, [k.id]: o.value }))}
                      />
                      <span>{o.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <label key={k.id} className="knob knob-range">
                <span className="knob-label">{k.label}</span>
                <input
                  type="range"
                  min={k.min}
                  max={k.max}
                  step={k.step}
                  value={values[k.id]}
                  onChange={(e) => setValues((v) => ({ ...v, [k.id]: Number(e.target.value) }))}
                />
                <output className="knob-value">{k.format ? k.format(values[k.id]) : values[k.id]}</output>
              </label>
            ),
          )}
        </div>
      )}
      <Metrics key={live.epoch} metrics={def.metrics} sim={sim} base={live.base} baseLabel={def.compare?.label} />
    </figure>
  );
}
