"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import { getConcept } from "@/lib/catalog";
import { getLesson, recommendations } from "@/lib/lessons";
import {
  runExperiment,
  makeConfig,
  comparisonConfig,
  experimentQuery,
  type Config,
} from "@/lib/engine";
import { Architecture } from "./architecture";

export function Experiment({
  initial,
  onExplore,
  onUnderstand,
  onSelect,
}: {
  initial: Config;
  onExplore: (id: string) => void;
  onUnderstand: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const [config, setConfig] = useState(initial),
    [cursor, setCursor] = useState(0),
    [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(1),
    [aws, setAws] = useState(false),
    [mode, setMode] = useState<"guided" | "experiment">("guided"),
    [comparison, setComparison] = useState(false),
    [prediction, setPrediction] = useState<number | null>(null),
    [checked, setChecked] = useState(false),
    [notice, setNotice] = useState(""),
    [share, setShare] = useState(""),
    [controlsOpen, setControlsOpen] = useState(false),
    [scenario, setScenario] = useState(
      JSON.stringify(initial) === JSON.stringify(makeConfig(initial.lesson))
        ? "baseline"
        : "custom",
    );
  const lesson = getLesson(config.lesson),
    concept = getConcept(config.lesson)!;
  const run = useMemo(() => runExperiment(config), [config]);
  const frame = run.frames[Math.min(cursor, run.frames.length - 1)];
  const finished = cursor === run.frames.length - 1;
  const baseline = useMemo(
    () => runExperiment(comparisonConfig(config)),
    [config],
  );
  const baselineFinal = baseline.frames.at(-1)!,
    currentFinal = run.frames.at(-1)!;
  const explored = useRef(false);
  useEffect(() => {
    history.replaceState(null, "", experimentQuery(config));
  }, [config]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => setCursor((n) => Math.min(n + 1, run.frames.length - 1)),
      700 / speed,
    );
    return () => clearInterval(timer);
  }, [playing, speed, run.frames.length]);
  useEffect(() => {
    if (finished) setPlaying(false);
  }, [finished]);
  useEffect(() => {
    if (cursor > 0 && !explored.current) {
      explored.current = true;
      onExplore(config.lesson);
    }
  }, [cursor, config.lesson, onExplore]);
  const change = (
    next: Config,
    message = "Configuration changed. Experiment restarted at 0s.",
  ) => {
    setPlaying(false);
    setCursor(0);
    setConfig(next);
    setChecked(false);
    setNotice(message);
    setShare("");
  };
  const fault = () => {
    const at = frame.world.time + 1;
    if (at > 32) {
      setNotice("Reset or seek earlier to inject a fault.");
      return;
    }
    setScenario("custom");
    setConfig({
      ...config,
      faults: [
        ...config.faults.filter((f) => f.at < at),
        { at, active: !frame.world.failed },
      ],
    });
    setNotice(
      `${frame.world.failed ? "Recovery" : "Failure"} scheduled at ${at}s. Later scheduled faults were replaced; the current snapshot stays fixed.`,
    );
  };
  const copy = async () => {
    const url = `${window.location.origin}/${experimentQuery(config)}`;
    setShare(url);
    try {
      await navigator.clipboard.writeText(url);
      setNotice(
        "Experiment link copied with model version, seed, controls, and faults.",
      );
    } catch {
      setNotice("Copy is unavailable. Select and copy the URL below.");
    }
  };
  const choices = (
    <fieldset>
      <legend>{lesson.challenge.question}</legend>
      {lesson.challenge.options.map((option, i) => (
        <label className="prediction" key={option}>
          <input
            type="radio"
            name="prediction"
            checked={prediction === i}
            onChange={() => {
              setPrediction(i);
              setChecked(false);
            }}
          />
          {option}
        </label>
      ))}
    </fieldset>
  );
  return (
    <>
      <header className="lesson-heading">
        <div>
          <div className="eyebrow">
            {concept.group} / {lesson.family} model
          </div>
          <h1>{concept.title}</h1>
          <p>{concept.description}</p>
          <div className="lesson-meta">
            <span>{concept.difficulty}</span>
            <span>{concept.minutes} min</span>
            <span>
              Model v{config.version} · seed {config.seed}
            </span>
          </div>
        </div>
        <div className="segmented" aria-label="Learning mode">
          <button
            aria-pressed={mode === "guided"}
            onClick={() => setMode("guided")}
          >
            Guided lesson
          </button>
          <button
            aria-pressed={mode === "experiment"}
            onClick={() => setMode("experiment")}
          >
            Experiment
          </button>
        </div>
      </header>
      {mode === "guided" && (
        <section className="guided-opening" aria-labelledby="problem-title">
          <div>
            <span className="step-label">01 / THE PROBLEM</span>
            <h2 id="problem-title">{lesson.problem}</h2>
            <p>{lesson.analogy}</p>
          </div>
          <div>
            <span className="step-label">02 / PREDICT</span>
            {choices}
          </div>
        </section>
      )}
      <button
        className="button mobile-control-toggle"
        aria-expanded={controlsOpen}
        aria-controls="experiment-controls"
        onClick={() => setControlsOpen(!controlsOpen)}
      >
        <SlidersHorizontal size={17} />
        {controlsOpen ? "Hide experiment controls" : "Tune this experiment"}
      </button>
      <div className="experiment-layout">
        <section
          className="experiment-main"
          aria-label="Interactive experiment"
        >
          <div className="canvas-card">
            <div className="canvas-heading">
              <div>
                <span className="blue-dot" />
                <h2>
                  {mode === "guided" ? "03 / Make it happen" : "State bench"}
                </h2>
              </div>
              <div className="segmented compact" aria-label="Service labels">
                <button aria-pressed={!aws} onClick={() => setAws(false)}>
                  Conceptual
                </button>
                <button aria-pressed={aws} onClick={() => setAws(true)}>
                  AWS
                </button>
              </div>
            </div>
            <Architecture
              lesson={lesson}
              frame={frame}
              aws={aws}
              onInspect={() => setPlaying(false)}
            />
            <div className="playback">
              <div className="playback-buttons">
                <button
                  className="button primary"
                  onClick={() => {
                    if (finished) setCursor(0);
                    setPlaying(!playing);
                  }}
                >
                  {playing ? <Pause size={17} /> : <Play size={17} />}{" "}
                  {playing
                    ? "Pause"
                    : finished
                      ? "Replay"
                      : cursor
                        ? "Resume"
                        : "Run"}
                </button>
                <button
                  className="button"
                  onClick={() => {
                    setPlaying(false);
                    setCursor((n) => Math.min(n + 1, run.frames.length - 1));
                  }}
                  disabled={finished}
                >
                  <SkipForward size={17} />
                  Step event
                </button>
                <button
                  className="icon-button"
                  aria-label="Reset experiment"
                  onClick={() => {
                    setPlaying(false);
                    setCursor(0);
                    setNotice(
                      "Reset to the first snapshot. Controls and fault schedule retained.",
                    );
                  }}
                >
                  <RotateCcw size={18} />
                </button>
                <label className="speed-control">
                  Speed
                  <select
                    aria-label="Playback speed"
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                  >
                    {[0.5, 1, 2, 4].map((s) => (
                      <option key={s} value={s}>
                        {s}×
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="play-state">
                <b data-testid="clock">{frame.world.time}s</b>
                <span>
                  {playing
                    ? "Playing"
                    : finished
                      ? "Complete"
                      : cursor
                        ? "Paused"
                        : "Ready"}{" "}
                  · event {cursor} / {run.frames.length - 1}
                </span>
              </div>
              <label className="timeline-control">
                <span>Replay timeline</span>
                <input
                  aria-label="Replay timeline"
                  type="range"
                  min="0"
                  max={run.frames.length - 1}
                  value={cursor}
                  onChange={(e) => {
                    setPlaying(false);
                    setCursor(Number(e.target.value));
                  }}
                />
              </label>
            </div>
          </div>
          <div className="metrics" aria-label="Metrics at current event">
            {frame.metrics.map((m) => (
              <div key={m.key}>
                <span>{m.label}</span>
                <strong>
                  {m.value}
                  <small>{m.unit}</small>
                </strong>
              </div>
            ))}
          </div>
          <section className="event-explanation" aria-label="Current event">
            <div className="event-time">
              {frame.event.time}s<span>EVENT {frame.event.id}</span>
            </div>
            <div>
              <span className="step-label">
                {mode === "guided" ? "04 / OBSERVE" : "CURRENT EVENT"} ·{" "}
                {frame.event.type}
              </span>
              <h2>{frame.event.title}</h2>
              <p>{frame.event.why}</p>
              <p className="next-event">
                <ChevronRight size={16} />
                {frame.event.next}
              </p>
            </div>
          </section>
          <details className="event-history">
            <summary>Event history · {cursor} recorded transitions</summary>
            <ol>
              {run.frames.slice(1, cursor + 1).map((f) => (
                <li key={f.event.id}>
                  <button
                    onClick={() => {
                      setPlaying(false);
                      setCursor(f.event.id);
                    }}
                  >
                    <time>{f.event.time}s</time>
                    <span>{f.event.title}</span>
                  </button>
                </li>
              ))}
            </ol>
            {!cursor && <p>Run or step the experiment to record events.</p>}
          </details>
          <section className="comparison">
            <div className="section-heading">
              <div>
                <span className="step-label">COMPARE THE TRADE-OFF</span>
                <h2>Same workload. One different decision.</h2>
              </div>
              <button
                className="button"
                aria-expanded={comparison}
                onClick={() => setComparison(!comparison)}
              >
                {comparison ? "Hide comparison" : "Compare with baseline"}
              </button>
            </div>
            {comparison && (
              <>
                <p>
                  Final outcomes from complete runs with seed {config.seed}.
                  Offered load and seed are identical. Baseline uses default
                  strategy controls and faults; modified uses your
                  configuration.
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Metric</th>
                        <th>Baseline</th>
                        <th>Modified</th>
                        <th>Difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentFinal.metrics.map((m) => {
                        const base =
                            baselineFinal.metrics.find((b) => b.key === m.key)
                              ?.value || 0,
                          delta = Math.round((m.value - base) * 100) / 100;
                        return (
                          <tr key={m.key}>
                            <th>
                              {m.label} {m.unit && `(${m.unit})`}
                            </th>
                            <td>{base}</td>
                            <td>{m.value}</td>
                            <td>
                              {delta > 0 ? "+" : ""}
                              {delta}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="takeaway">{run.summary}</p>
                <p>
                  <strong>Trade-off:</strong> {concept.tradeoff}
                </p>
              </>
            )}
          </section>
        </section>
        <aside
          id="experiment-controls"
          className={`experiment-controls ${controlsOpen ? "controls-open" : ""}`}
        >
          <div className="control-heading">
            <SlidersHorizontal size={18} />
            <h2>Tune this model</h2>
          </div>
          <label className="field">
            Scenario
            <select
              aria-label="Scenario"
              value={scenario}
              onChange={(e) => {
                const chosen = e.target.value;
                setScenario(chosen);
                const next = makeConfig(concept.id, chosen === "contrast");
                next.seed = config.seed;
                if (chosen === "failure")
                  next.faults = [
                    { at: 4, active: true },
                    { at: 12, active: false },
                  ];
                change(next, `Scenario loaded: ${chosen}. Restarted at 0s.`);
              }}
            >
              <option value="baseline">Baseline</option>
              <option value="contrast">{lesson.contrastName}</option>
              {lesson.fault && (
                <option value="failure">Failure → recovery</option>
              )}
              <option value="custom" disabled>
                Custom configuration
              </option>
            </select>
          </label>
          {lesson.controls.map((k) => (
            <label className="knob" key={k.key}>
              <span>
                {k.label}
                <output>
                  {config.values[k.key]} {k.unit}
                </output>
              </span>
              <input
                aria-label={k.label}
                type="range"
                min={k.min}
                max={k.max}
                step="1"
                value={config.values[k.key]}
                onChange={(e) => {
                  setScenario("custom");
                  change({
                    ...config,
                    values: {
                      ...config.values,
                      [k.key]: Number(e.target.value),
                    },
                  });
                }}
              />
              <small>
                {k.min} — {k.max} {k.unit}
              </small>
            </label>
          ))}
          <label className="field">
            Workload seed
            <input
              aria-label="Workload seed"
              type="number"
              min="1"
              max="999999"
              value={config.seed}
              onChange={(e) => {
                const seed = Number(e.target.value);
                if (Number.isInteger(seed) && seed >= 1 && seed <= 999999)
                  change({ ...config, seed });
              }}
            />
          </label>
          <p className="control-note">
            Changing a control restarts at 0s. Speed changes wall time only.
            Pause freezes the whole snapshot.
          </p>
          {lesson.fault && (
            <div className="fault-controls">
              <h3>Introduce a failure</h3>
              <p>{lesson.fault}</p>
              <button
                className={`button ${frame.world.failed ? "" : "danger"}`}
                onClick={fault}
                disabled={finished}
              >
                <Zap size={16} />
                {frame.world.failed ? "Recover dependency" : "Inject failure"}
              </button>
              <small>Applies at the next simulated second.</small>
            </div>
          )}
          <button className="button full" onClick={copy}>
            <Copy size={16} />
            Share experiment
          </button>
          {share && (
            <label className="field">
              Experiment URL
              <input
                readOnly
                value={share}
                onFocus={(e) => e.currentTarget.select()}
              />
            </label>
          )}
          <details className="assumptions">
            <summary>Model assumptions</summary>
            <p>{run.assumptions}</p>
            <p>
              {lesson.family === "queue"
                ? "Eight seconds of arrivals, then draining through 32s. Workers hold messages for at least one second; retries respect visibility."
                : "Events are ordered atomic transitions; several can share a simulated timestamp."}{" "}
              No measured service performance is inferred.
            </p>
            <p>
              Fault schedule:{" "}
              {config.faults.length
                ? config.faults
                    .map((f) => `${f.at}s ${f.active ? "fail" : "recover"}`)
                    .join(" → ")
                : "none"}
              .
            </p>
            <p>
              AWS example: {concept.service}.{" "}
              {concept.compute === "EC2"
                ? "Long-lived application state makes EC2 a useful example."
                : concept.compute === "Lambda"
                  ? "Bounded handlers suit Lambda; durable state lives outside invocations."
                  : "A managed data plane implements this primitive."}{" "}
              Exploration never provisions services.
            </p>
          </details>
        </aside>
      </div>
      {notice && (
        <p className="inline-notice" role="status">
          {notice}
        </p>
      )}
      <section className="learning-notes">
        <div>
          <span className="step-label">05 / EXPLAIN</span>
          <h2>What changed, and why?</h2>
          <p>{concept.steps.join(". ")}.</p>
          <h3>Common misconception</h3>
          <p>{lesson.misconception}</p>
          <h3>06 / The trade-off</h3>
          <p>{concept.tradeoff}</p>
          <h3>Check your understanding</h3>
          {mode === "experiment" && choices}
          <button
            className="button"
            disabled={cursor === 0 || prediction === null}
            onClick={() => {
              setChecked(true);
              if (prediction === lesson.challenge.answer)
                onUnderstand(concept.id);
            }}
          >
            <Check size={16} />
            Check my prediction
          </button>
          {cursor === 0 && (
            <p className="muted">
              Interact with the model before checking your prediction.
            </p>
          )}
          {checked && (
            <p
              role="status"
              className={
                prediction === lesson.challenge.answer
                  ? "success-note"
                  : "answer-note"
              }
            >
              {prediction === lesson.challenge.answer
                ? "Prediction correct. Understanding recorded for this session."
                : "Try again after reconsidering the state."}{" "}
              {lesson.challenge.explanation}
            </p>
          )}
        </div>
        <div>
          <span className="step-label">07 / IMPLEMENT</span>
          <h2>The mechanism in code</h2>
          <pre>
            <code>{lesson.code}</code>
          </pre>
          <p className="muted">
            Pattern pseudocode; use bounded, authenticated adapters in an
            implementation.
          </p>
          <a href={lesson.reference} target="_blank" rel="noreferrer">
            Read the authoritative reference ↗
          </a>
          <h3>Before this lesson</h3>
          {lesson.prerequisites.length ? (
            <div className="lesson-links">
              {lesson.prerequisites.map((id) => (
                <button key={id} onClick={() => onSelect(id)}>
                  {getConcept(id)!.title}
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          ) : (
            <p>Basic HTTP, application code, and database reads.</p>
          )}
        </div>
      </section>
      <section className="recommendations">
        <h2>Connect the next idea</h2>
        {recommendations(concept.id).map((id) => (
          <button key={id} onClick={() => onSelect(id)}>
            {getConcept(id)!.title}
            <ChevronRight size={17} />
          </button>
        ))}
      </section>
    </>
  );
}
