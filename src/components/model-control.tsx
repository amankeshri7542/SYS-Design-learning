import type { Knob } from "@/lib/lessons";
import { controlPresentation } from "@/lib/controls";
import { useId } from "react";

export function ModelControl({
  lesson,
  knob,
  value,
  onChange,
}: {
  lesson: string;
  knob: Knob;
  value: number;
  onChange: (value: number) => void;
}) {
  const view = controlPresentation(lesson, knob);
  const inputId = useId();
  if (view.kind === "switch")
    return (
      <label className="model-switch">
        <input
          type="checkbox"
          role="switch"
          checked={value === 1}
          onChange={(e) => onChange(e.target.checked ? 1 : 0)}
        />
        <span>{view.label}</span>
        <small>{value ? "On" : "Off"}</small>
      </label>
    );
  if (view.kind === "choice")
    return (
      <label className="field">
        {view.label}
        <select
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        >
          {view.options.map((label, index) => (
            <option key={label} value={index}>
              {label}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <div className={`model-control ${view.kind}`}>
      <label htmlFor={inputId}>
        {view.label}
        <span>{knob.unit}</span>
      </label>
      <div className="quantity-row">
        {view.kind === "count" && (
          <button
            className="stepper"
            aria-label={`Decrease ${view.label}`}
            disabled={value <= knob.min}
            onClick={() => onChange(value - 1)}
          >
            −
          </button>
        )}
        {view.kind === "quantity" && (
          <input
            type="range"
            aria-label={view.label}
            min={knob.min}
            max={knob.max}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        )}
        <input
          id={inputId}
          aria-label={`${view.label} value`}
          type="number"
          min={knob.min}
          max={knob.max}
          value={value}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (
              e.target.value &&
              Number.isInteger(next) &&
              next >= knob.min &&
              next <= knob.max
            )
              onChange(next);
          }}
        />
        {view.kind === "count" && (
          <button
            className="stepper"
            aria-label={`Increase ${view.label}`}
            disabled={value >= knob.max}
            onClick={() => onChange(value + 1)}
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}
