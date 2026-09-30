"use client";
import { useRef, useState } from "react";
import {
  ArrowRight,
  Box,
  Database,
  Server,
  ShieldCheck,
  X,
} from "lucide-react";
import type { Frame, Entity, Node } from "@/lib/engine";
import type { Lesson } from "@/lib/lessons";
import type { RingPoint } from "@/lib/engine/data";

export function Architecture({
  lesson,
  frame,
  aws,
  onInspect,
}: {
  lesson: Lesson;
  frame: Frame;
  aws: boolean;
  onInspect: () => void;
}) {
  const [selected, setSelected] = useState<Entity | Node | null>(null),
    dialog = useRef<HTMLDialogElement>(null);
  const { world: w, event } = frame;
  const inspect = (value: Entity | Node) => {
    onInspect();
    setSelected(value);
    dialog.current?.showModal();
  };
  const component = (n: Node) => (
    <button
      key={n.id}
      className={`component ${event.path.includes(n.id) ? "active" : ""}`}
      onClick={() => inspect(n)}
      aria-label={`Inspect ${n.label}`}
    >
      <Server size={22} />
      <strong>{aws ? n.aws : n.label}</strong>
      {aws && <span>{n.label}</span>}
      <span
        className={`state-tag ${["unavailable", "denied", "disconnected", "error"].includes(n.status) ? "bad" : ""}`}
      >
        {n.status}
      </span>
      <small>{n.detail}</small>
    </button>
  );
  const chip = (e: Entity) => (
    <button
      className={`entity-chip ${event.entity === e.id ? "selected" : ""}`}
      key={e.id}
      onClick={() => inspect(e)}
    >
      <Box size={14} />
      <span>{e.id}</span>
      {e.version !== undefined && <small>v{e.version}</small>}
    </button>
  );
  return (
    <div
      className={`state-bench family-${lesson.family}`}
      data-testid="state-bench"
    >
      <div className="bench-caption">
        <span>
          STATE AT <b>{w.time}s</b>
        </span>
        <span>Click a component or item to inspect</span>
      </div>
      {lesson.family === "cache" && (
        <>
          <div className="cache-source">
            <span>
              <Database size={20} />
              Source v{String(w.fields.sourceVersion)}
            </span>
            <span>{w.nodes.find((n) => n.id === "origin")?.status}</span>
            <span>{String(w.fields.lastRead || "No reads yet")}</span>
          </div>
          <div className="cache-slots">
            {w.entities.length ? (
              w.entities.map((e) => (
                <button
                  key={e.id}
                  className="cache-entry"
                  onClick={() => inspect(e)}
                >
                  <strong>{e.id}</strong>
                  <span>
                    {String(e.value)} · v{e.version}
                  </span>
                  <span className="ttl">
                    {Math.max(0, (e.expires || 0) - w.time)}s until expiry
                  </span>
                  <small>
                    Last used {e.last}s · {e.hits} reads
                  </small>
                </button>
              ))
            ) : (
              <div className="state-empty">
                The cache is empty. The first reusable read must fetch from the
                source.
              </div>
            )}
          </div>
          <div className="bench-foot">
            <span>
              Hits {w.counters.hits || 0} / misses {w.counters.misses || 0}
            </span>
            <span>
              Evictions {w.counters.evictions || 0} · expirations{" "}
              {w.counters.expired || 0}
            </span>
          </div>
        </>
      )}
      {lesson.family === "queue" && (
        <div className="queue-lanes">
          {[
            ["ready", "Ready"],
            ["in flight", "In flight"],
            [
              lesson.id === "event-streams" ? "consumed" : "completed",
              lesson.id === "event-streams"
                ? "Consumed, retained"
                : "Completed",
            ],
            ...(lesson.id === "dead-letter"
              ? [["dead letter", "Dead letter"]]
              : []),
          ].map(([state, label]) => {
            const list = w.entities.filter((e) => e.state === state);
            return (
              <section
                className={`queue-lane lane-${state.replaceAll(" ", "-")}`}
                key={state}
              >
                <h3>
                  {label}
                  <span>{list.length}</span>
                </h3>
                <div>
                  {list.slice(-8).map(chip)}
                  {list.length > 8 && (
                    <small>{list.length - 8} more in the item inspector.</small>
                  )}
                  {!list.length && (
                    <span className="lane-empty">No messages</span>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {lesson.family === "fleet" && (
        <>
          <div className="fleet-boundary">
            {component(w.nodes[0])}
            <ArrowRight className="flow-arrow" aria-hidden="true" />
            <div className="fleet-grid">{w.nodes.slice(1).map(component)}</div>
          </div>
          <div className="bench-foot">
            <span>
              Capacity: {String(w.fields.capacity || "waiting to run")}
            </span>
            <span>Ready: {String(w.fields.ready ?? 0)}</span>
          </div>
        </>
      )}
      {lesson.family === "replica" && (
        <div className="replica-ledger">
          {w.entities.map((e) => (
            <button
              key={e.id}
              className={`replica-card ${e.state === "stale" ? "stale" : ""}`}
              onClick={() => inspect(e)}
            >
              <Database size={24} />
              <strong>
                {aws
                  ? w.nodes.find((n) => n.id === e.location)?.aws
                  : w.nodes.find((n) => n.id === e.location)?.label}
              </strong>
              <b>v{e.version}</b>
              <span>{String(e.value)}</span>
              <span className="state-tag">
                {e.state} · {w.nodes.find((n) => n.id === e.location)?.status}
              </span>
            </button>
          ))}
        </div>
      )}
      {lesson.family === "circuit" && (
        <div className="circuit-bench">
          <div className="circuit-states">
            {["closed", "open", "half-open"].map((s) => (
              <div key={s} className={w.fields.circuit === s ? "current" : ""}>
                <ShieldCheck size={28} />
                <strong>{s}</strong>
                <span>
                  {s === "closed"
                    ? "Calls pass through"
                    : s === "open"
                      ? "Calls rejected locally"
                      : "One bounded probe"}
                </span>
              </div>
            ))}
          </div>
          <div className="bench-foot">
            <span>
              Consecutive failures: {String(w.fields.consecutiveFailures || 0)}
            </span>
            <span>Dependency: {w.failed ? "unavailable" : "available"}</span>
          </div>
        </div>
      )}
      {lesson.family === "hash" && lesson.id === "consistent-hashing" && (
        <div className="hash-layout">
          <svg
            className="hash-ring"
            viewBox="0 0 360 360"
            role="img"
            aria-label={`Hash ring with ${w.nodes.length} nodes; ${w.counters.moved || 0} keys moved`}
          >
            <circle
              cx="180"
              cy="180"
              r="124"
              fill="none"
              stroke="var(--line)"
              strokeWidth="2"
            />
            <text x="180" y="170" textAnchor="middle">
              Clockwise ownership
            </text>
            <text x="180" y="196" textAnchor="middle">
              {w.nodes.length} nodes · 24 keys
            </text>
            {(
              JSON.parse(String(w.fields.positions || "[]")) as RingPoint[]
            ).map((p, i) => {
              const a = ((p.position - 90) * Math.PI) / 180;
              return (
                <g key={`${p.owner}-${i}`}>
                  <circle
                    cx={180 + 124 * Math.cos(a)}
                    cy={180 + 124 * Math.sin(a)}
                    r="7"
                    fill="var(--blue)"
                  />
                  <title>
                    {p.owner} at {p.position} degrees
                  </title>
                </g>
              );
            })}
            {w.entities.map((e) => {
              const a = ((e.position! - 90) * Math.PI) / 180;
              return (
                <circle
                  key={e.id}
                  cx={180 + 105 * Math.cos(a)}
                  cy={180 + 105 * Math.sin(a)}
                  r={e.state === "moved" ? 5 : 3}
                  fill={e.state === "moved" ? "var(--amber)" : "var(--teal)"}
                >
                  <title>
                    {e.id}: {e.owner}, {e.state}
                  </title>
                </circle>
              );
            })}
          </svg>
          <div className="hash-owners">
            {w.nodes.map((n) => (
              <div key={n.id}>
                <button className="text-button" onClick={() => inspect(n)}>
                  {n.label} ·{" "}
                  {w.entities.filter((e) => e.owner === n.id).length} keys
                </button>
                <div>
                  {w.entities
                    .filter((e) => e.owner === n.id)
                    .slice(0, 5)
                    .map(chip)}
                </div>
              </div>
            ))}
          </div>
          <p className="figure-note">
            Small dots: keys. Large dots: virtual positions. Larger amber keys
            moved. Inspect every exact owner below.
          </p>
        </div>
      )}
      {lesson.id === "sharding" && (
        <div className="partition-buckets">
          {w.nodes.map((n) => (
            <section key={n.id}>
              {component(n)}
              <div>{w.entities.filter((e) => e.owner === n.id).map(chip)}</div>
            </section>
          ))}
        </div>
      )}
      {lesson.family === "network" && (
        <div className="network-zones">
          {w.nodes.map((n, i) => (
            <section
              key={n.id}
              className={`network-zone ${i ? "private-zone" : "public-zone"}`}
            >
              <span>{i ? "CONTROLLED BOUNDARY" : "PUBLIC SOURCE"}</span>
              {component(n)}
              {w.entities.filter((e) => e.location === n.id).map(chip)}
            </section>
          ))}
        </div>
      )}
      {lesson.family === "identity" && (
        <>
          <div className="policy-title">
            <ShieldCheck size={24} />
            <span>{event.title}</span>
          </div>
          <div className="identity-records">
            {w.entities.length ? (
              w.entities.map((e) => (
                <button key={e.id} onClick={() => inspect(e)}>
                  <strong>{e.id}</strong>
                  <span>{String(e.value)}</span>
                  <span>
                    {e.version !== undefined ? `Version ${e.version} · ` : ""}
                    {e.state}
                  </span>
                </button>
              ))
            ) : (
              <p>Run a request to inspect its identity and policy decision.</p>
            )}
          </div>
        </>
      )}
      {(lesson.family === "record" || lesson.family === "workflow") && (
        <>
          <div className="record-components">{w.nodes.map(component)}</div>
          <div className="field-grid">
            {Object.entries(w.fields).map(([key, value]) => (
              <div key={key}>
                <span>{key.replace(/([A-Z])/g, " $1")}</span>
                <strong>{String(value)}</strong>
              </div>
            ))}
          </div>
          <div className="record-items">
            {w.entities.slice(-12).map((e) => (
              <button key={e.id} onClick={() => inspect(e)}>
                <strong>{e.id}</strong>
                <span>{String(e.value)}</span>
                <small>
                  {e.state}
                  {e.version !== undefined ? ` · v${e.version}` : ""}
                </small>
              </button>
            ))}
          </div>
        </>
      )}
      {aws && (
        <div className="aws-mapping">
          <strong>Example AWS implementation</strong>
          {w.nodes.map((n) => (
            <span key={n.id}>
              {n.label} → {n.aws}
            </span>
          ))}
        </div>
      )}
      <details className="topology-details">
        <summary>Architecture & item inspector</summary>
        <p>
          Edges are explicit for this lesson.{" "}
          {aws
            ? "AWS labels are example mappings, not running resources."
            : "AWS view shows optional service mappings."}
        </p>
        <div className="topology-components">{w.nodes.map(component)}</div>
        <ul className="edge-list">
          {w.edges.map(([a, b], i) => (
            <li key={`${a}-${b}-${i}`}>
              {w.nodes.find((n) => n.id === a)?.label}
              <ArrowRight size={15} />
              {w.nodes.find((n) => n.id === b)?.label}
            </li>
          ))}
        </ul>
        {w.entities.length > 0 && (
          <label className="item-selector">
            Inspect any item
            <select
              value=""
              onChange={(e) => {
                const item = w.entities.find((x) => x.id === e.target.value);
                if (item) inspect(item);
              }}
            >
              <option value="">Choose from {w.entities.length} items</option>
              {w.entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.id} · {e.state}
                </option>
              ))}
            </select>
          </label>
        )}
      </details>
      <dialog
        ref={dialog}
        className="detail-dialog"
        aria-labelledby="inspect-title"
      >
        <div className="dialog-heading">
          <h2 id="inspect-title">
            {selected && "label" in selected
              ? selected.label
              : selected?.id || "Item details"}
          </h2>
          <button
            className="icon-button"
            onClick={() => dialog.current?.close()}
            aria-label="Close inspector"
          >
            <X />
          </button>
        </div>
        <dl>
          {Object.entries(selected || {}).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
        <p>Snapshot at {w.time}s. Close this inspector to continue.</p>
      </dialog>
    </div>
  );
}
