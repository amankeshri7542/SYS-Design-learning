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
  experimentQuery,
  validateConfig,
  type Config,
} from "@/lib/engine";
import type { DraftUpdate, LessonDraft } from "@/lib/session";
import { controlPresentation } from "@/lib/controls";
import { Architecture } from "./architecture";
import { ModelControl } from "./model-control";

export function Experiment({
  draft,
  onDraftChange,
  onExplore,
  onUnderstand,
  onSelect,
}: {
  draft: LessonDraft;
  onDraftChange: (next: DraftUpdate) => void;
  onExplore: (id: string) => void;
  onUnderstand: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const {
    config,
    cursor: storedCursor,
    mode,
    speed,
    aws,
    comparison,
    baselineA,
    prediction,
    checked,
    controlsOpen,
    scenario,
    predictionSkipped,
  } = draft;
  const [playing, setPlaying] = useState(false),
    [notice, setNotice] = useState(""),
    [share, setShare] = useState("");
  const lesson = getLesson(config.lesson),
    concept = getConcept(config.lesson)!;
  const update = (patch: Partial<LessonDraft>) =>
    onDraftChange((d) => ({ ...d, ...patch }));
  const run = useMemo(() => runExperiment(config), [config]);
  // A is intentionally computed only while its evidence is open. Scrubbing doesn't recompute either model.
  const baseline = useMemo(
    () => (comparison && baselineA ? runExperiment(baselineA) : null),
    [comparison, baselineA],
  );
  const cursor = Math.min(storedCursor, run.frames.length - 1),
    frame = run.frames[cursor],
    finished = cursor === run.frames.length - 1;
  const changeDraft = useRef(onDraftChange);
  changeDraft.current = onDraftChange;
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () =>
        changeDraft.current((d) => ({
          ...d,
          cursor: Math.min(d.cursor + 1, run.frames.length - 1),
        })),
      700 / speed,
    );
    return () => clearInterval(timer);
  }, [playing, speed, run.frames.length]);
  useEffect(() => {
    if (finished) setPlaying(false);
  }, [finished]);
  const seek = (next: number) => {
    setPlaying(false);
    if (next > 0) onExplore(config.lesson);
    update({ cursor: next });
  };
  const change = (
    next: Config,
    nextScenario: LessonDraft["scenario"] = "custom",
    message = "Input changed. Playback restarted; your pinned A is unchanged.",
  ) => {
    setPlaying(false);
    update({ config: next, cursor: 0, checked: false, scenario: nextScenario });
    setNotice(message);
    setShare("");
  };
  const inject = () => {
    const at = frame.world.time + 1;
    if (at > run.frames.at(-1)!.world.time) {
      setNotice(
        "Seek earlier to schedule a change within this model’s horizon.",
      );
      return;
    }
    update({
      config: {
        ...config,
        faults: [
          ...config.faults.filter((f) => f.at < at),
          { at, active: !frame.world.failed },
        ],
      },
      scenario: "custom",
    });
    setNotice(
      `${frame.world.failed ? "Recovery" : "Failure"} scheduled at ${at}s. Future faults replaced; observed events are retained.`,
    );
  };
  const redrive = () => {
    const at = frame.world.time + 1;
    if (at > run.frames.at(-1)!.world.time) {
      setNotice("Seek earlier to redrive within the simulation horizon.");
      return;
    }
    update({
      config: {
        ...config,
        actions: [
          ...(config.actions || []).filter((a) => a.at < at),
          { at, type: "redrive" },
        ],
      },
      scenario: "custom",
    });
    setNotice(
      `Explicit DLQ redrive scheduled at ${at}s. Repair alone never moves messages.`,
    );
  };
  const copy = async () => {
    const url = `${window.location.origin}/${experimentQuery(config)}`;
    setShare(url);
    try {
      await navigator.clipboard.writeText(url);
      setNotice(
        "Experiment link copied. New visitors start at the first event with these exact inputs.",
      );
    } catch {
      setNotice("Select and copy the experiment URL below.");
    }
  };
  const pin = () => {
    update({ baselineA: validateConfig(config), comparison: true });
    setNotice(
      "Current configuration pinned as A. B starts with the same workload, seed, environment and controls. Change an input to compare.",
    );
  };
  const changes = baselineA
    ? [
        ...lesson.controls
          .filter((k) => baselineA.values[k.key] !== config.values[k.key])
          .map((k) => ({
            label: controlPresentation(lesson.id, k).label,
            before: `${baselineA.values[k.key]} ${k.unit}`,
            after: `${config.values[k.key]} ${k.unit}`,
          })),
        ...(baselineA.seed !== config.seed
          ? [
              {
                label: "Workload seed",
                before: String(baselineA.seed),
                after: String(config.seed),
              },
            ]
          : []),
        ...(JSON.stringify(baselineA.faults) !== JSON.stringify(config.faults)
          ? [
              {
                label: "Environment / faults",
                before: schedule(baselineA),
                after: schedule(config),
              },
            ]
          : []),
        ...(JSON.stringify(baselineA.actions || []) !==
        JSON.stringify(config.actions || [])
          ? [
              {
                label: "Redrive actions",
                before: actionTimes(baselineA),
                after: actionTimes(config),
              },
            ]
          : []),
      ]
    : [];
  const evidence = run.frames
    .slice(1, cursor + 1)
    .filter((f) => f.event.type !== "versions")
    .slice(-4);
  const focusedKnob =
    lesson.controls.find((k) => k.key in lesson.contrast) || lesson.controls[0];
  const check = () => {
    update({ checked: true });
    if (prediction === lesson.challenge.answer) onUnderstand(concept.id);
  };
  const predictionPanel = (
    <section className="prediction-panel" aria-label="Prediction and feedback">
      {!predictionSkipped ? (
        <>
          <fieldset>
            <legend>{lesson.challenge.question}</legend>
            {lesson.challenge.options.map((option, i) => (
              <label className="prediction" key={option}>
                <input
                  type="radio"
                  name="prediction"
                  checked={prediction === i}
                  onChange={() => update({ prediction: i, checked: false })}
                />
                {option}
              </label>
            ))}
          </fieldset>
          <div className="button-row">
            <button
              className="button"
              disabled={cursor === 0 || prediction === null}
              onClick={check}
            >
              <Check size={16} />
              Check my prediction
            </button>
            <button
              className="text-button"
              onClick={() => update({ predictionSkipped: true })}
            >
              Skip prediction
            </button>
          </div>
          {cursor === 0 && (
            <small>Try an event, then check against what you observed.</small>
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
                ? "Prediction correct. Understanding recorded."
                : "Revisit the evidence, then try again."}{" "}
              {lesson.challenge.explanation}
            </p>
          )}
        </>
      ) : (
        <button
          className="text-button"
          onClick={() => update({ predictionSkipped: false })}
        >
          Try the optional prediction
        </button>
      )}
    </section>
  );
  const controls = (
    <>
      <label className="field">
        Scenario
        <select
          aria-label="Scenario"
          value={scenario}
          onChange={(e) => {
            const chosen = e.target.value as LessonDraft["scenario"];
            const next = makeConfig(concept.id, chosen === "contrast");
            next.seed = config.seed;
            if (chosen === "failure")
              next.faults = [
                { at: 4, active: true },
                { at: 12, active: false },
              ];
            change(
              next,
              chosen,
              `Named scenario loaded. Its controls and environmental schedule replace B; A is retained.`,
            );
          }}
        >
          <option value="baseline">Baseline</option>
          <option value="contrast">{lesson.contrastName}</option>
          {lesson.fault && (
            <option value="failure">Failure, then repair</option>
          )}
          <option value="custom" disabled>
            Custom configuration
          </option>
        </select>
      </label>
      {lesson.controls.map((k) => (
        <ModelControl
          key={k.key}
          lesson={lesson.id}
          knob={k}
          value={config.values[k.key]}
          onChange={(value) =>
            change({ ...config, values: { ...config.values, [k.key]: value } })
          }
        />
      ))}
      <p className="control-note">
        Input changes restart playback. Speed affects viewing time only. Pausing
        freezes the snapshot.
      </p>
      {lesson.fault && (
        <div className="fault-controls">
          <h3>Change the environment</h3>
          <p>{lesson.fault}</p>
          <button
            className={`button ${frame.world.failed ? "" : "danger"}`}
            onClick={inject}
            disabled={finished}
          >
            <Zap size={16} />
            {frame.world.failed ? "Recover dependency" : "Inject failure"}
          </button>
          <small>Observed by the next domain action.</small>
          {lesson.id === "dead-letter" && (
            <button
              className="button"
              disabled={
                finished ||
                frame.world.time >= run.frames.at(-1)!.world.time ||
                frame.world.failed ||
                !(frame.world.counters.dead > 0)
              }
              onClick={redrive}
            >
              Redrive DLQ
            </button>
          )}
          {lesson.id === "dead-letter" && (
            <small>
              Repair the cause, then explicitly redrive isolated work.
            </small>
          )}
        </div>
      )}
      <details className="advanced-settings">
        <summary>Advanced · reproduction & assumptions</summary>
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
              if (Number.isInteger(seed) && seed > 0 && seed < 1000000)
                change({ ...config, seed });
            }}
          />
        </label>
        <p>
          Model version {config.version}. Environment: {schedule(config)}.
          Redrive: {actionTimes(config)}.
        </p>
        <p>{run.assumptions}</p>
        <p>
          Ordered synthetic events; timestamps are simulated seconds. Several
          events may share a timestamp. These are mechanisms, not service
          performance forecasts.
        </p>
        <p>AWS example: {concept.service}. Exploration provisions nothing.</p>
      </details>
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
    </>
  );
  return (
    <div className={`lesson-workbench mode-${mode}`}>
      <header className="lesson-heading">
        <div>
          <div className="eyebrow">
            {concept.group} · {concept.difficulty} · {concept.minutes} min
          </div>
          <h1>{concept.title}</h1>
          <p>{concept.description}</p>
        </div>
        <div className="segmented" aria-label="Learning mode">
          <button
            aria-pressed={mode === "guided"}
            onClick={() => update({ mode: "guided" })}
          >
            Guided lesson
          </button>
          <button
            aria-pressed={mode === "experiment"}
            onClick={() => update({ mode: "experiment" })}
          >
            Experiment
          </button>
        </div>
      </header>
      {mode === "guided" && (
        <div className="guided-question">
          <strong>{lesson.problem}</strong>
          <span>{lesson.analogy}</span>
        </div>
      )}
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
                  {mode === "guided"
                    ? "Try it. Follow the result."
                    : "Operation & state"}
                </h2>
              </div>
              <div className="segmented compact" aria-label="Service labels">
                <button
                  aria-pressed={!aws}
                  onClick={() => update({ aws: false })}
                >
                  Conceptual
                </button>
                <button
                  aria-pressed={aws}
                  onClick={() => update({ aws: true })}
                >
                  AWS
                </button>
              </div>
            </div>
            <div className="playback primary-playback">
              <div className="playback-buttons">
                <button
                  className="button primary"
                  onClick={() => {
                    onExplore(config.lesson);
                    if (finished) update({ cursor: 0 });
                    setPlaying(!playing);
                  }}
                >
                  {playing ? <Pause size={17} /> : <Play size={17} />}
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
                  onClick={() => seek(cursor + 1)}
                  disabled={finished}
                >
                  <SkipForward size={17} />
                  Step event
                </button>
                <button
                  className="icon-button"
                  aria-label="Reset experiment"
                  onClick={() => {
                    seek(0);
                    setNotice("Rewound. Inputs and pinned A are retained.");
                  }}
                >
                  <RotateCcw size={18} />
                </button>
                <label className="speed-control">
                  Speed
                  <select
                    aria-label="Playback speed"
                    value={speed}
                    onChange={(e) => update({ speed: Number(e.target.value) })}
                  >
                    {[0.5, 1, 2, 4].map((s) => (
                      <option key={s} value={s}>
                        {s}×
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button tune-button"
                  aria-expanded={controlsOpen}
                  aria-controls="experiment-controls"
                  onClick={() => update({ controlsOpen: !controlsOpen })}
                >
                  <SlidersHorizontal size={16} />
                  {controlsOpen
                    ? "Hide controls"
                    : mode === "guided"
                      ? "Predict & tune"
                      : "Tune model"}
                </button>
              </div>
              <div className="play-state">
                <b data-testid="clock">{frame.world.time}s</b>
                <span>
                  {playing
                    ? "Playing"
                    : finished
                      ? "Playback ended"
                      : cursor
                        ? "Paused"
                        : "Ready"}{" "}
                  · event {cursor} / {run.frames.length - 1}
                </span>
              </div>
            </div>
            <Architecture
              lesson={lesson}
              frame={frame}
              frames={run.frames}
              aws={aws}
              onInspect={() => setPlaying(false)}
              onSeek={seek}
            />
            <section
              className="event-explanation evidence-strip"
              aria-label="Current event"
            >
              <div className="event-time">
                {frame.event.time}s<span>EVENT {frame.event.id}</span>
              </div>
              <div>
                <h2>{frame.event.title}</h2>
                <p>{frame.event.why}</p>
                <p className="next-event">
                  <ChevronRight size={15} />
                  {frame.event.next}
                </p>
              </div>
            </section>
            <label className="timeline-control">
              <span>Replay timeline</span>
              <input
                aria-label="Replay timeline"
                type="range"
                min="0"
                max={run.frames.length - 1}
                value={cursor}
                onChange={(e) => seek(Number(e.target.value))}
              />
            </label>
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
          <p className={`operation-outcome outcome-${frame.outcome.state}`}>
            <strong>
              {finished ? "At the simulation horizon: " : "Current outcome: "}
            </strong>
            {frame.outcome.detail}
          </p>
          {notice && (
            <p className="inline-notice" role="status">
              {notice}
            </p>
          )}
        </section>
        <aside
          id="experiment-controls"
          className={`experiment-controls ${controlsOpen ? "controls-open" : ""}`}
        >
          {mode === "guided" ? (
            <>
              <div className="control-heading">
                <h2>One decision to explore</h2>
              </div>
              <ModelControl
                lesson={lesson.id}
                knob={focusedKnob}
                value={config.values[focusedKnob.key]}
                onChange={(value) =>
                  change({
                    ...config,
                    values: { ...config.values, [focusedKnob.key]: value },
                  })
                }
              />
              {predictionPanel}
              <details className="all-controls">
                <summary>All controls & failure experiments</summary>
                {controls}
              </details>
            </>
          ) : (
            <>
              <div className="control-heading">
                <SlidersHorizontal size={18} />
                <h2>Experiment inputs</h2>
              </div>
              {controls}
            </>
          )}
        </aside>
      </div>
      {mode === "experiment" && (
        <section className="comparison">
          <div className="section-heading">
            <div>
              <span className="step-label">COMPARE EVIDENCE</span>
              <h2>Pin A. Change B. Inspect the difference.</h2>
            </div>
            <div className="button-row">
              <button className="button" onClick={pin}>
                {baselineA ? "Replace pinned A" : "Pin current as A"}
              </button>
              {baselineA && (
                <button
                  className="button"
                  onClick={() =>
                    change(
                      validateConfig(baselineA),
                      "custom",
                      "Forked B from A. Every input is identical until you change it.",
                    )
                  }
                >
                  Fork B from A
                </button>
              )}
              {baselineA && (
                <button
                  className="text-button"
                  aria-expanded={comparison}
                  onClick={() => update({ comparison: !comparison })}
                >
                  {comparison ? "Hide comparison" : "Show comparison"}
                </button>
              )}
            </div>
          </div>
          {baseline && baselineA && (
            <div className="comparison-evidence">
              <p>
                {changes.length === 0
                  ? "A and B have identical inputs. Choose one control to test a decision."
                  : `${changes.length} changed input${changes.length === 1 ? "" : "s"} shown below. ${changes.length > 1 ? "These results cannot isolate a single cause." : "The other inputs are held constant."}`}{" "}
                Both columns show complete finite runs.
              </p>
              {changes.length > 0 && (
                <table className="input-differences">
                  <caption>Every changed input</caption>
                  <thead>
                    <tr>
                      <th>Input</th>
                      <th>Pinned A</th>
                      <th>Current B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.map((c) => (
                      <tr key={c.label}>
                        <th>{c.label}</th>
                        <td>{c.before}</td>
                        <td>{c.after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>Pinned A</th>
                      <th>Current B</th>
                      <th>Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.frames.at(-1)!.metrics.map((m) => {
                      const before =
                        baseline.frames
                          .at(-1)!
                          .metrics.find((b) => b.key === m.key)?.value || 0;
                      const delta = Math.round((m.value - before) * 100) / 100;
                      return (
                        <tr key={m.key}>
                          <th>
                            {m.label} {m.unit && `(${m.unit})`}
                          </th>
                          <td>{before}</td>
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
              <p>
                <strong>A:</strong> {baseline.outcome.detail}{" "}
                <strong>B:</strong> {run.outcome.detail}
              </p>
              <button
                className="text-button"
                onClick={() => seek(run.frames.length - 1)}
              >
                Inspect B’s final evidence →
              </button>
              <p>
                <strong>Trade-off:</strong> {concept.tradeoff}
              </p>
            </div>
          )}
        </section>
      )}
      <section className="learning-notes">
        <div>
          <h2>What changed, and why?</h2>
          {!cursor ? (
            <p>
              No events observed yet. Run or step the operation; this section
              will cite what actually changed.
            </p>
          ) : (
            <>
              <p>
                {frame.event.why}{" "}
                {frame.metrics
                  .map(
                    (m) =>
                      `${m.label}: ${m.value}${m.unit ? " " + m.unit : ""}`,
                  )
                  .join(" · ")}
                .
              </p>
              <ol className="evidence-links">
                {evidence.map((f) => (
                  <li key={f.event.id}>
                    <button onClick={() => seek(f.event.id)}>
                      <time>{f.event.time}s</time>
                      {f.event.title}
                      <ChevronRight size={15} />
                    </button>
                  </li>
                ))}
              </ol>
            </>
          )}
          <details className="event-history">
            <summary>
              Full event history · {cursor} observed transitions
            </summary>
            <ol>
              {run.frames.slice(1, cursor + 1).map((f) => (
                <li key={f.event.id}>
                  <button onClick={() => seek(f.event.id)}>
                    <time>{f.event.time}s</time>
                    {f.event.title}
                  </button>
                </li>
              ))}
            </ol>
          </details>
          <h3>The trade-off</h3>
          <p>{concept.tradeoff}</p>
          <h3>Common misconception</h3>
          <p>{lesson.misconception}</p>
          {mode === "experiment" && (
            <details>
              <summary>Optional understanding check</summary>
              {predictionPanel}
            </details>
          )}
        </div>
        <div>
          <h2>The mechanism in code</h2>
          <pre>
            <code>{lesson.code}</code>
          </pre>
          <p className="muted">
            Pattern pseudocode; production adapters need authentication and
            bounded retries.
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
    </div>
  );
}
function schedule(c: Config) {
  return (
    c.faults
      .map((f) => `${f.at}s ${f.active ? "fail" : "repair"}`)
      .join(" → ") || "No faults"
  );
}
function actionTimes(c: Config) {
  return c.actions?.map((a) => `${a.at}s ${a.type}`).join(", ") || "None";
}
