"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  X,
} from "lucide-react";
import {
  defaultJourneyOptions,
  journeyStages,
  journeyTrace,
  journeyNodes,
  journeyEdges,
  journeyRoute,
  type JourneyOptions,
  type Operation,
} from "@/lib/journey";
import { getConcept } from "@/lib/catalog";

export function Journey({ onSelect }: { onSelect: (id: string) => void }) {
  const [stage, setStage] = useState(0);
  const [operation, setOperation] = useState<Operation>("read");
  const [options, setOptions] = useState(defaultJourneyOptions);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [aws, setAws] = useState(false);
  const [full, setFull] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trace = useMemo(
    () => journeyTrace(stage, operation, options),
    [stage, operation, options],
  );
  const current = trace[Math.min(cursor, trace.length - 1)];
  const info = journeyStages[stage];
  const nodes = journeyNodes(stage);
  const route = journeyRoute(stage, operation);
  const visible = full
    ? nodes
    : route.map((id) => nodes.find((n) => n.id === id)!);
  const edges = journeyEdges(stage).filter(
    ([a, b]) =>
      visible.some((n) => n.id === a) && visible.some((n) => n.id === b),
  );
  const positions = Object.fromEntries(
    visible.map((n, i) => [
      n.id,
      { x: 100 + (i % 3) * 230, y: 55 + Math.floor(i / 3) * 105 },
    ]),
  );
  const rows = Math.ceil(visible.length / 3);
  const inspection: Record<string, string> = {
    browser:
      "The browser observes the response. An accepted notification can still be pending after the response.",
    app: "The application coordinates the product lookup or the local order transaction.",
    "app-a":
      "Application A handles this bounded operation; both applications are assumed healthy.",
    "app-b":
      "Application B is available behind the load balancer, but this operation was routed to A.",
    lb: "The load balancer selects application A for this request. Fleet health behavior is explored in its own lesson.",
    cache:
      current.detail ||
      `The configured product cache starts ${options.cache}. A valid entry can survive a source outage.`,
    db:
      operation === "notification"
        ? "The order and outbox row already committed before this trace begins."
        : `The writer is ${options.source === "healthy" ? "available" : "unavailable"}. Orders require a successful writer transaction.`,
    replica: `The product read source is ${options.source === "healthy" ? "available" : "unavailable"}. This trace uses v1 on both writer and replica; replication lag is explored in its own lesson.`,
    queue: `${current.pending} notification pending. Receiving does not count as completion; acknowledgment does.`,
    worker:
      options.worker === "stopped" ||
      (options.worker === "recover" && current.time < 10)
        ? "The worker is stopped. Accepted messages remain queued until a worker returns."
        : `One worker is available. ${current.detail || "No message has been received yet."}`,
    provider: `Processing ${options.processing === "healthy" || (options.processing === "repair" && current.time >= 16) ? "can succeed" : "fails"} at ${current.time}s. Completion advances only after a successful effect.`,
    dlq: `${current.dead} message isolated. Repair changes the cause of failure; an explicit redrive moves the message back to the queue.`,
    dedupe:
      "The order ID and local business effect must commit atomically. Provider idempotency is an explicit assumption; duplicate deliveries are covered in the idempotency lesson.",
    breaker: `The circuit is ${current.circuit || "closed"}. Two failed provider calls open it; after 4s, one probe decides whether it closes or reopens.`,
  };
  const reset = () => {
    setCursor(0);
    setPlaying(false);
  };
  function update<K extends keyof JourneyOptions>(
    key: K,
    value: JourneyOptions[K],
  ) {
    reset();
    setOptions((previous) => ({ ...previous, [key]: value }));
  }
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
  useEffect(() => {
    if (selected) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selected]);
  const question =
    operation === "read"
      ? stage === 0
        ? "What happens when every product read needs the database?"
        : "Can this cache serve a read while the source is unavailable?"
      : stage < 3
        ? "What happens to a committed order when notification fails?"
        : "Does an accepted order mean its notification is complete?";
  return (
    <>
      <header className="lesson-heading">
        <div>
          <div className="eyebrow">A CONNECTED SYSTEM JOURNEY</div>
          <h1>Build a system.</h1>
          <p>
            Introduce a mechanism. Follow one operation. Observe the trade-off.
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
              setSelected(null);
              setStage(i);
            }}
          >
            <span>{i + 1}</span>
            {s.title}
          </button>
        ))}
      </nav>
      <section className="canvas-card journey-canvas">
        <div className="canvas-heading">
          <div>
            <div className="eyebrow">{info.title}</div>
            <h2>{question}</h2>
          </div>
        </div>
        <div className="journey-workload">
          <label>
            Operation
            <select
              aria-label="Operation"
              value={operation}
              onChange={(e) => {
                reset();
                setSelected(null);
                setOperation(e.target.value as Operation);
              }}
            >
              <option value="read">Product read</option>
              <option value="order">Order placement</option>
              <option value="notification">Asynchronous notification</option>
            </select>
          </label>
        </div>
        <details className="journey-settings">
          <summary>
            Workload and failures{" "}
            <span>
              {operation === "read"
                ? `${stage >= 1 ? `${options.cache} cache · ` : ""}${options.source === "healthy" ? "source available" : "source unavailable"}`
                : `${stage >= 3 ? `${options.worker === "healthy" ? "worker running" : options.worker === "stopped" ? "worker stopped" : "worker restarts at 10s"} · ` : ""}${options.processing === "healthy" ? "delivery succeeds" : options.processing === "failing" ? "delivery fails" : "repair at 16s"}${options.redriveAt !== null && stage >= 4 ? ` · redrive at ${options.redriveAt}s` : ""}`}
            </span>
          </summary>
          <div className="journey-workload">
            {operation === "read" && stage >= 1 && (
              <label>
                Product cache
                <select
                  aria-label="Product cache"
                  value={options.cache}
                  onChange={(e) =>
                    update("cache", e.target.value as JourneyOptions["cache"])
                  }
                >
                  <option value="cold">Cold · no entry</option>
                  <option value="warm">Warm · valid until 20s</option>
                  <option value="expired">Expired · expires at 1s</option>
                </select>
              </label>
            )}
            {operation !== "notification" && (
              <label>
                {operation === "read" ? "Read source" : "Order writer"}
                <select
                  aria-label="Source availability"
                  value={options.source}
                  onChange={(e) =>
                    update("source", e.target.value as JourneyOptions["source"])
                  }
                >
                  <option value="healthy">Available</option>
                  <option value="unavailable">Unavailable</option>
                </select>
              </label>
            )}
            {operation !== "read" && stage >= 3 && (
              <label>
                Worker
                <select
                  aria-label="Worker availability"
                  value={options.worker}
                  onChange={(e) =>
                    update("worker", e.target.value as JourneyOptions["worker"])
                  }
                >
                  <option value="healthy">Running</option>
                  <option value="stopped">Stopped through 32s</option>
                  <option value="recover">Stopped · restart at 10s</option>
                </select>
              </label>
            )}
            {operation !== "read" && (
              <label>
                Notification processing
                <select
                  aria-label="Notification processing"
                  value={options.processing}
                  onChange={(e) =>
                    update(
                      "processing",
                      e.target.value as JourneyOptions["processing"],
                    )
                  }
                >
                  <option value="healthy">Succeeds</option>
                  <option value="failing">Fails throughout</option>
                  <option value="repair">Fails · repaired at 16s</option>
                </select>
              </label>
            )}
          </div>
          {operation !== "read" && stage >= 4 && (
            <div className="journey-redrive">
              <label>
                <input
                  type="checkbox"
                  checked={options.redriveAt !== null}
                  onChange={(e) =>
                    update("redriveAt", e.target.checked ? 20 : null)
                  }
                />{" "}
                Schedule an explicit DLQ redrive
              </label>
              {options.redriveAt !== null && (
                <label>
                  Redrive at (s)
                  <input
                    aria-label="Redrive at seconds"
                    type="number"
                    min={1}
                    max={32}
                    value={options.redriveAt}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      if (Number.isInteger(value) && value >= 1 && value <= 32)
                        update("redriveAt", value);
                    }}
                  />
                </label>
              )}
              <small>
                Repair changes processing. Redrive moves isolated work back into
                the queue.
              </small>
            </div>
          )}
        </details>
        <div className="playback">
          <div className="playback-buttons">
            <button
              className="button primary"
              onClick={() => {
                if (cursor === trace.length - 1) setCursor(0);
                setPlaying(!playing);
              }}
            >
              {playing ? <Pause size={17} /> : <Play size={17} />}
              {playing
                ? "Pause journey"
                : cursor === trace.length - 1
                  ? "Replay operation"
                  : "Follow operation"}
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
          <div className="segmented">
            <button aria-pressed={!full} onClick={() => setFull(false)}>
              This operation
            </button>
            <button aria-pressed={full} onClick={() => setFull(true)}>
              Full architecture
            </button>
          </div>
        </div>
        <div className="journey-diagram-tools">
          <span>
            {full
              ? "All introduced components"
              : "Only components relevant to this operation"}{" "}
            · select a component to inspect
          </span>
          <label>
            <input
              type="checkbox"
              checked={aws}
              onChange={(e) => setAws(e.target.checked)}
            />{" "}
            AWS labels
          </label>
        </div>
        <div className="journey-topology">
          <svg
            viewBox={`0 0 690 ${rows * 105 + 15}`}
            role="img"
            aria-label={`${full ? "Full architecture" : "Connected operation architecture"}: ${visible.map((n) => n.label).join(", ")}`}
          >
            <defs>
              <marker
                id="journey-arrow"
                markerUnits="userSpaceOnUse"
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
              </marker>
            </defs>
            {edges.map(([a, b]) => {
              const from = positions[a],
                to = positions[b];
              const active = current.path.some(
                (id, i) =>
                  (id === a && current.path[i + 1] === b) ||
                  (id === b && current.path[i + 1] === a),
              );
              const dx = to.x - from.x,
                dy = to.y - from.y;
              const scale = Math.max(Math.abs(dx) / 97, Math.abs(dy) / 36);
              return (
                <line
                  key={`${a}-${b}`}
                  x1={from.x + dx / scale}
                  y1={from.y + dy / scale}
                  x2={to.x - dx / scale}
                  y2={to.y - dy / scale}
                  className={active ? "active-edge" : ""}
                  markerEnd="url(#journey-arrow)"
                />
              );
            })}
            {visible.map((node) => {
              const point = positions[node.id];
              const active = current.path.includes(node.id);
              return (
                <g
                  key={node.id}
                  transform={`translate(${point.x - 90} ${point.y - 30})`}
                  className={active ? "on-path" : ""}
                  role="button"
                  tabIndex={0}
                  aria-label={`Inspect ${node.label}`}
                  onClick={() => setSelected(node.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(node.id);
                    }
                  }}
                >
                  <rect width="180" height="60" rx="8" />
                  <text x="90" y="25" textAnchor="middle">
                    {aws ? node.aws : node.label}
                  </text>
                  <text
                    x="90"
                    y="45"
                    textAnchor="middle"
                    className="journey-node-caption"
                  >
                    {node.id === "breaker"
                      ? current.circuit || "closed"
                      : active
                        ? "Active in this event"
                        : "Connected, not active"}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <div
          className="journey-mobile-path journey-topology"
          aria-label="Focused operation architecture"
        >
          <svg
            viewBox={`0 0 320 ${visible.length * 86 + 10}`}
            role="img"
            aria-label="Connected mobile architecture"
          >
            <defs>
              <marker
                id="journey-mobile-arrow"
                markerUnits="userSpaceOnUse"
                markerWidth="8"
                markerHeight="8"
                refX="7"
                refY="4"
                orient="auto-start-reverse"
              >
                <path d="M0,0 L8,4 L0,8 z" fill="currentColor" />
              </marker>
            </defs>
            {edges.map(([a, b], i) => {
              const from = visible.findIndex((n) => n.id === a),
                to = visible.findIndex((n) => n.id === b);
              const adjacent = to === from + 1;
              const x = 288 + (i % 3) * 8;
              const active = current.path.some(
                (id, j) =>
                  (id === a && current.path[j + 1] === b) ||
                  (id === b && current.path[j + 1] === a),
              );
              return (
                <path
                  key={`${a}-${b}`}
                  d={
                    adjacent
                      ? `M155 ${from * 86 + 70} V${to * 86 + 8}`
                      : `M272 ${from * 86 + 40} H${x} V${to * 86 + 40} H276`
                  }
                  fill="none"
                  className={active ? "active-edge" : ""}
                  markerEnd="url(#journey-mobile-arrow)"
                />
              );
            })}
            {visible.map((node, i) => (
              <g
                key={node.id}
                transform={`translate(35 ${i * 86 + 10})`}
                className={current.path.includes(node.id) ? "on-path" : ""}
                role="button"
                tabIndex={0}
                aria-label={`Inspect ${node.label}`}
                onClick={() => setSelected(node.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected(node.id);
                  }
                }}
              >
                <rect width="237" height="60" rx="8" />
                <text x="118" y="25" textAnchor="middle">
                  {aws ? node.aws : node.label}
                </text>
                <text
                  x="118"
                  y="45"
                  textAnchor="middle"
                  className="journey-node-caption"
                >
                  {node.id === "breaker"
                    ? current.circuit || "closed"
                    : current.path.includes(node.id)
                      ? "Active in this event"
                      : "Connected, not active"}
                </text>
              </g>
            ))}
          </svg>
        </div>
        <div className="operation-path" aria-label="Active operation path">
          {current.path.map((id, i) => (
            <span key={`${id}-${i}`}>
              {i > 0 && <ArrowRight size={16} />}
              {nodes.find((n) => n.id === id)?.label}
            </span>
          ))}
        </div>
        <section
          className={`event-explanation journey-evidence state-${current.health}`}
          aria-live="polite"
        >
          <div className="event-time">{current.time}s</div>
          <div>
            <h2>{current.title}</h2>
            <p>{current.why}</p>
            {current.detail && <p className="model-note">{current.detail}</p>}
            {current.evidence && (
              <small>
                Evidence: {getConcept(current.evidence.lesson)?.title} engine ·
                event {current.evidence.event + 1} · {current.evidence.type}
              </small>
            )}
          </div>
        </section>
        <div className="journey-outcomes" aria-label="Operation outcomes">
          <span>
            Accepted <strong>{current.accepted}</strong>
          </span>
          <span>
            Completed <strong>{current.completed}</strong>
          </span>
          <span>
            Pending <strong>{current.pending}</strong>
          </span>
          <span>
            In DLQ <strong>{current.dead}</strong>
          </span>
          <b>{current.state}</b>
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
      </section>
      <details className="journey-problem">
        <summary>Why add this component?</summary>
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
      </details>
      <p className="model-note">
        One product or one notification is followed. Reads reuse the cache
        lesson’s expiry and source rules. Queued delivery reuses the queue/DLQ
        lifecycle with one worker. Stages with a DLQ permit at most three
        receives per redrive. Source, worker, and processing failures are
        separate.{" "}
        {stage >= 5 &&
          "The shared breaker policy opens after two failed calls, waits 4s, then allows one probe. "}
        The writer/outbox transaction and provider idempotency are explicit
        assumptions. Times are simulated seconds, not AWS measurements.
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
            setSelected(null);
            setStage(stage + 1);
          }}
        >
          Next: {journeyStages[stage + 1].title}
          <ArrowRight size={16} />
        </button>
      )}
      <dialog
        ref={dialog}
        className="inspector"
        aria-labelledby="journey-inspector-title"
        onClose={() => setSelected(null)}
      >
        <div className="inspector-heading">
          <h2 id="journey-inspector-title">
            {nodes.find((n) => n.id === selected)?.label}
          </h2>
          <button
            className="icon-button"
            aria-label="Close inspector"
            onClick={() => setSelected(null)}
          >
            <X size={20} />
          </button>
        </div>
        <p>
          {current.path.includes(selected || "")
            ? "This component participates in the selected event."
            : "This component is connected to the system but is not used in this event."}
        </p>
        <h3>What this means</h3>
        <p>{inspection[selected || ""]}</p>
        <h3>Current evidence</h3>
        <p>{current.title}</p>
        <p>{current.why}</p>
        {current.detail && <p>{current.detail}</p>}
        <p className="model-note">
          Showing the selected timeline event at {current.time}s. Inspect other
          events with the operation timeline.
        </p>
      </dialog>
    </>
  );
}
