"use client";
import { useEffect, useState } from "react";
import { ArrowRight, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import {
  journeyStages,
  journeyTrace,
  journeyNodes,
  type Operation,
} from "@/lib/journey";
import { getConcept } from "@/lib/catalog";
export function Journey({ onSelect }: { onSelect: (id: string) => void }) {
  const [stage, setStage] = useState(0),
    [operation, setOperation] = useState<Operation>("read"),
    [fault, setFault] = useState(false),
    [cursor, setCursor] = useState(0),
    [playing, setPlaying] = useState(false),
    [aws, setAws] = useState(false);
  const trace = journeyTrace(stage, operation, fault),
    current = trace[Math.min(cursor, trace.length - 1)],
    info = journeyStages[stage];
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(
      () => setCursor((n) => Math.min(n + 1, trace.length - 1)),
      850,
    );
    return () => clearInterval(timer);
  }, [playing, trace.length]);
  useEffect(() => {
    if (cursor === trace.length - 1) setPlaying(false);
  }, [cursor, trace.length]);
  const reset = () => {
    setCursor(0);
    setPlaying(false);
  };
  return (
    <>
      <header className="lesson-heading">
        <div>
          <div className="eyebrow">A CONNECTED SYSTEM JOURNEY</div>
          <h1>Build a system.</h1>
          <p>
            Start with one request. Add a mechanism when a concrete problem asks
            for it.
          </p>
        </div>
      </header>
      <nav className="journey-stages" aria-label="Build stages">
        {journeyStages.map((s, i) => (
          <button
            key={s.title}
            aria-current={i === stage ? "step" : undefined}
            onClick={() => {
              reset();
              setStage(i);
            }}
          >
            <span>{i + 1}</span>
            {s.title}
          </button>
        ))}
      </nav>
      <section className="journey-problem">
        <h2>{info.title}</h2>
        <p>{info.problem}</p>
        <div>
          <p>
            <strong>Benefit</strong>
            {info.benefit}
          </p>
          <p>
            <strong>Limitation</strong>
            {info.limit}
          </p>
          <p>
            <strong>New failure mode</strong>
            {info.failure}
          </p>
        </div>
      </section>
      <section className="canvas-card journey-canvas">
        <div className="canvas-heading">
          <h2>Follow this operation</h2>
          <div className="segmented">
            <button aria-pressed={!aws} onClick={() => setAws(false)}>
              Conceptual
            </button>
            <button aria-pressed={aws} onClick={() => setAws(true)}>
              AWS
            </button>
          </div>
        </div>
        <div className="journey-controls">
          <label>
            Operation
            <select
              aria-label="Operation"
              value={operation}
              onChange={(e) => {
                reset();
                setOperation(e.target.value as Operation);
              }}
            >
              <option value="read">Product read</option>
              <option value="order">Order placement</option>
              <option value="notification">Asynchronous notification</option>
            </select>
          </label>
          <label className="prediction">
            <input
              type="checkbox"
              checked={fault}
              onChange={(e) => {
                reset();
                setFault(e.target.checked);
              }}
            />
            Introduce a dependency failure
          </label>
          <small>
            Changing stage, operation, or failure restarts this trace.
          </small>
        </div>
        <div className="journey-map">
          {journeyNodes(stage)
            .filter((n) => operation !== "read" || n.id !== "provider")
            .map((n) => (
              <div
                key={n.id}
                className={`journey-node ${current.path.includes(n.id) ? "on-path" : "subdued"}`}
              >
                <strong>{aws ? n.aws : n.label}</strong>
                {aws && <small>{n.label}</small>}
                <span>
                  {current.path.includes(n.id)
                    ? "On this operation’s path"
                    : "Not active in this event"}
                </span>
              </div>
            ))}
        </div>
        <div className="operation-path" aria-label="Active operation path">
          {current.path.length
            ? current.path.map((id, i) => (
                <span key={`${id}-${i}`}>
                  {i > 0 && <ArrowRight size={16} />}{" "}
                  {journeyNodes(stage).find((n) => n.id === id)?.label}
                </span>
              ))
            : "Run to follow the relevant path."}
        </div>
        <div className="playback">
          <div className="playback-buttons">
            <button
              className="button primary"
              onClick={() => {
                if (cursor === trace.length - 1) setCursor(0);
                setPlaying(!playing);
              }}
            >
              {playing ? <Pause size={17} /> : <Play size={17} />}{" "}
              {playing ? "Pause journey" : "Follow operation"}
            </button>
            <button
              className="button"
              disabled={cursor === trace.length - 1}
              onClick={() => {
                setPlaying(false);
                setCursor((n) => n + 1);
              }}
            >
              <SkipForward size={17} />
              Step operation
            </button>
            <button
              className="icon-button"
              aria-label="Reset journey"
              onClick={reset}
            >
              <RotateCcw size={17} />
            </button>
          </div>
          <label className="timeline-control">
            Operation timeline
            <input
              type="range"
              aria-label="Operation timeline"
              min="0"
              max={trace.length - 1}
              value={cursor}
              onChange={(e) => {
                setPlaying(false);
                setCursor(Number(e.target.value));
              }}
            />
          </label>
        </div>
      </section>
      <div className="metrics journey-metrics">
        <div>
          <span>Accepted</span>
          <strong>{current.accepted}</strong>
        </div>
        <div>
          <span>Completed effects</span>
          <strong>{current.completed}</strong>
        </div>
        <div>
          <span>Operation state</span>
          <b>{current.state}</b>
        </div>
      </div>
      <section className="event-explanation">
        <div className="event-time">{current.time}s</div>
        <div>
          <h2>{current.title}</h2>
          <p>{current.why}</p>
        </div>
      </section>
      <p className="model-note">
        Example assumptions: one product and one order; warm product cache on
        the healthy read path; primary-only order writes; a transactional outbox
        avoids the database/queue dual-write gap; provider idempotency supports
        duplicate suppression. Times show event order, not measured AWS
        durations. No infrastructure is provisioned.
      </p>
      <div className="recommendations">
        <h2>Explore the mechanisms</h2>
        {info.lessons.map((id) => (
          <button key={id} onClick={() => onSelect(id)}>
            {getConcept(id)!.title}
            <ArrowRight size={16} />
          </button>
        ))}
      </div>
      {stage < 5 && (
        <button
          className="button primary"
          onClick={() => {
            reset();
            setStage(stage + 1);
          }}
        >
          Next: {journeyStages[stage + 1].title}
          <ArrowRight size={16} />
        </button>
      )}
    </>
  );
}
