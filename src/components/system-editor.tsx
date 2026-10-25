"use client";

import { useEffect, useRef, useState } from "react";
import { KINDS, settingsOf, type Issue, type PartDoc, type PartKind, type Settings, type SystemDoc } from "@/lib/system/doc";
import { addPart, canAdd, flowOrder, removePart, targetsFor, toggleLink, updatePart } from "@/lib/system/edit";

/** Kinds whose copies can be counted. */
const COUNTED: PartKind[] = ["service", "worker", "cache", "cdn"];
/** The order of the add menu: the usual parts first. */
const MENU: PartKind[] = ["service", "database", "cache", "queue", "balancer", "external", "topic", "worker", "limiter", "cdn", "dns", "users", "bots"];

const msText = (v: number) => (v < 1000 ? `${Math.round(v)} ms` : `${+(v / 1000).toFixed(1)} s`);

/** A part's setup in a few words, for its row while folded: "×3 · 4 workers · 40 ms". */
function summaryOf(p: PartDoc): string {
  const s = settingsOf(p);
  const copies = (p.count ?? 1) > 1 ? `×${p.count} · ` : "";
  switch (p.kind) {
    case "users":
    case "bots":
      return `${s.rate} a second${p.kind === "users" && s.writes ? ` · ${Math.round(s.writes * 100)}% writes` : ""}`;
    case "service":
    case "worker":
    case "external":
      return `${copies}${s.workers} workers · ${msText(s.ms)}`;
    case "database":
      return `${s.workers} workers · ${msText(s.ms)}${s.shards > 1 ? ` · ${s.shards} shards` : s.replicas ? ` · ${s.replicas} ${s.replicas === 1 ? "copy" : "copies"}${s.failover ? ", failover" : ""}` : ""}`;
    case "cache":
    case "cdn":
      return `${copies}${s.capacity} answers · ${msText(s.ttlMs)}`;
    case "queue":
      return s.ack ? `kept until done${s.deadLetter ? " · dead letters" : ""}` : "handed out once";
    case "balancer":
      return `${s.algo === "sticky" ? "sticky" : s.algo === "least" ? "least busy" : "in turn"}${s.health ? " · health checks" : ""}`;
    case "limiter":
      return `${s.rps} a second each`;
    default:
      return KINDS[p.kind].says;
  }
}

/**
 * The system, part by part in the order a request meets them: each row folds open to its few settings and the parts it
 * sends to. Below, a menu adds a part where it usually goes, and the targets say what "working" means.
 */
export function SystemEditor({
  doc,
  onChange,
  open,
  setOpen,
  issues,
}: {
  doc: SystemDoc;
  onChange: (doc: SystemDoc) => void;
  open: string | null;
  setOpen: (id: string | null) => void;
  issues: Issue[];
}) {
  const parts = flowOrder(doc);
  const [adding, setAdding] = useState(false);
  const rows = useRef(new Map<string, HTMLElement>());
  // A row opened from the stage scrolls into view.
  useEffect(() => {
    if (open) rows.current.get(open)?.scrollIntoView({ block: "nearest" });
  }, [open]);
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  return (
    <div className="sys-editor">
      {errors.length > 0 && (
        <div className="sys-issues" role="alert">
          <p className="sys-issues-h">The stage shows your last working design until this is fixed:</p>
          <ul>
            {errors.map((i) => (
              <li key={i.text}>{i.text}</li>
            ))}
          </ul>
        </div>
      )}
      <ol className="sys-parts">
        {parts.map((p) => (
          <li
            key={p.id}
            ref={(el) => {
              if (el) rows.current.set(p.id, el);
              else rows.current.delete(p.id);
            }}
            className={`sys-part${open === p.id ? " open" : ""}`}
          >
            <button type="button" className="sys-part-head" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
              <span className="sys-part-name">{p.name}</span>
              <span className="sys-part-kind">{KINDS[p.kind].name}</span>
              <span className="sys-part-sum">{summaryOf(p)}</span>
            </button>
            {open === p.id && <PartEditor doc={doc} p={p} onChange={onChange} onRemoved={() => setOpen(null)} />}
            {warnings
              .filter((w) => w.part === p.id)
              .map((w) => (
                <p key={w.text} className="sys-warn">
                  {w.text}
                </p>
              ))}
          </li>
        ))}
      </ol>
      <div className="sys-add">
        <button type="button" className="btn sys-add-btn" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
          <svg viewBox="0 0 16 16" aria-hidden="true" className="stroke">
            <path d="M8 3v10M3 8h10" />
          </svg>
          Add a part
        </button>
        {adding && (
          <ul className="sys-menu" aria-label="Parts to add">
            {MENU.filter((k) => canAdd(doc, k)).map((k) => (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => {
                    const next = addPart(doc, k);
                    onChange(next.doc);
                    setOpen(next.id);
                    setAdding(false);
                  }}
                >
                  <strong>{KINDS[k].name}</strong>
                  <span>{KINDS[k].says}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <fieldset className="sys-targets">
        <legend>Working means</legend>
        <NumberField
          label="The slowest 1 in 20 within"
          unit="ms"
          value={doc.targets.p95Ms}
          min={50}
          max={10000}
          step={50}
          onChange={(v) => onChange({ ...doc, targets: { ...doc.targets, p95Ms: v } })}
        />
        <NumberField
          label="At most this many failing"
          unit="%"
          value={Math.round(doc.targets.failed * 1000) / 10}
          min={0}
          max={50}
          step={0.5}
          onChange={(v) => onChange({ ...doc, targets: { ...doc.targets, failed: v / 100 } })}
        />
      </fieldset>
    </div>
  );
}

/** One part's settings: its name, its copies, the few numbers that matter for its kind, what it sends to. */
function PartEditor({ doc, p, onChange, onRemoved }: { doc: SystemDoc; p: PartDoc; onChange: (doc: SystemDoc) => void; onRemoved: () => void }) {
  const s = settingsOf(p);
  const set = (change: Partial<Settings>) => onChange(updatePart(doc, p.id, { set: change }));
  const targets = targetsFor(doc, p.id);
  const id = `sys-${p.id}`;
  return (
    <div className="sys-part-body">
      <label className="sys-field" htmlFor={`${id}-name`}>
        <span>Name</span>
        <input id={`${id}-name`} type="text" value={p.name} maxLength={40} onChange={(e) => onChange(updatePart(doc, p.id, { name: e.target.value }))} />
      </label>
      {COUNTED.includes(p.kind) && (
        <Stepper label="Copies" value={p.count ?? 1} min={1} max={64} onChange={(v) => onChange(updatePart(doc, p.id, { count: v }))} />
      )}
      {(p.kind === "users" || p.kind === "bots") && (
        <>
          <Range label="Requests a second" id={`${id}-rate`} value={s.rate} min={1} max={400} step={1} format={(v) => `${v}/s`} onChange={(v) => set({ rate: v })} />
          {p.kind === "users" && (
            <>
              <Range label="Writes" id={`${id}-writes`} value={Math.round(s.writes * 100)} min={0} max={100} step={5} format={(v) => `${v}%`} onChange={(v) => set({ writes: v / 100 })} />
              <Choice
                label="Traffic"
                name={`${id}-shape`}
                value={s.shape}
                options={[
                  ["steady", "Steady"],
                  ["daily", "Rises and falls"],
                  ["spiky", "Bursts"],
                ]}
                onChange={(v) => set({ shape: v as Settings["shape"] })}
              />
              <Stepper label="Retries" value={s.retries} min={0} max={3} onChange={(v) => set({ retries: v })} />
            </>
          )}
        </>
      )}
      {(p.kind === "service" || p.kind === "worker" || p.kind === "external" || p.kind === "database") && (
        <>
          <Range label="Workers each" id={`${id}-workers`} value={s.workers} min={1} max={64} step={1} onChange={(v) => set({ workers: v })} />
          <Range label="Work per request" id={`${id}-ms`} value={s.ms} min={5} max={1000} step={5} format={msText} onChange={(v) => set({ ms: v })} />
        </>
      )}
      {p.kind === "service" && <Toggle label="Stop calling a failing part (breaker)" on={s.breaker} onChange={(v) => set({ breaker: v })} />}
      {p.kind === "database" && (
        <>
          <Stepper label="Read copies" value={s.replicas} min={0} max={3} onChange={(v) => set({ replicas: v, shards: 1 })} />
          {s.replicas > 0 && <Toggle label="A copy takes over if it dies" on={s.failover} onChange={(v) => set({ failover: v })} />}
          <Stepper label="Shards" value={s.shards} min={1} max={4} onChange={(v) => set({ shards: v, replicas: v > 1 ? 0 : s.replicas })} />
        </>
      )}
      {(p.kind === "cache" || p.kind === "cdn") && (
        <>
          <Range label="Answers kept" id={`${id}-cap`} value={s.capacity} min={10} max={1000} step={10} onChange={(v) => set({ capacity: v })} />
          <Range label="Fresh for" id={`${id}-ttl`} value={s.ttlMs} min={1000} max={120000} step={1000} format={msText} onChange={(v) => set({ ttlMs: v })} />
        </>
      )}
      {p.kind === "queue" && (
        <>
          <Toggle label="Keep each job until a worker finishes it" on={s.ack} onChange={(v) => set({ ack: v })} />
          {s.ack && <Toggle label="Set aside jobs that keep failing" on={s.deadLetter} onChange={(v) => set({ deadLetter: v })} />}
        </>
      )}
      {p.kind === "balancer" && (
        <>
          <Choice
            label="Picks"
            name={`${id}-algo`}
            value={s.algo}
            options={[
              ["round-robin", "In turn"],
              ["least", "Least busy"],
              ["sticky", "Same for each user"],
            ]}
            onChange={(v) => set({ algo: v as Settings["algo"] })}
          />
          <Toggle label="Check each target is healthy" on={s.health} onChange={(v) => set({ health: v })} />
        </>
      )}
      {p.kind === "limiter" && <Range label="Each sender, a second" id={`${id}-rps`} value={s.rps} min={1} max={400} step={1} format={(v) => `${v}/s`} onChange={(v) => set({ rps: v })} />}
      {targets.length > 0 && (
        <div className="sys-sends" role="group" aria-label={`${p.name} sends to`}>
          <span className="sys-sends-label">Sends to</span>
          <div className="sys-chips">
            {targets.map((q) => (
              <button key={q.id} type="button" className="sys-chip" aria-pressed={!!p.to?.includes(q.id)} onClick={() => onChange(toggleLink(doc, p.id, q.id))}>
                {q.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <button
        type="button"
        className="sys-remove"
        onClick={() => {
          onChange(removePart(doc, p.id));
          onRemoved();
        }}
      >
        Remove {p.name}
      </button>
    </div>
  );
}

/** A slider that follows the pointer at once and changes the system at most once a frame. */
function Range({ label, id, value, min, max, step, format, onChange }: { label: string; id: string; value: number; min: number; max: number; step: number; format?: (v: number) => string; onChange: (v: number) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const frame = useRef(0);
  const latest = useRef(value);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const change = (v: number) => {
    latest.current = v;
    setDrag(v);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      onChange(latest.current);
      setDrag(null);
    });
  };
  const shown = drag ?? value;
  return (
    <div className="knob knob-range">
      <label className="knob-label" htmlFor={id}>
        {label}
      </label>
      <output className="knob-value" htmlFor={id}>
        {format ? format(shown) : shown}
      </output>
      <input id={id} type="range" min={min} max={max} step={step} value={shown} onChange={(e) => change(Number(e.target.value))} />
    </div>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="stepper">
      <span className="stepper-label">{label}</span>
      <div className="stepper-ctl" role="group" aria-label={label}>
        <button type="button" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`Fewer: ${label.toLowerCase()}`}>
          −
        </button>
        <output>{value}</output>
        <button type="button" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`More: ${label.toLowerCase()}`}>
          +
        </button>
      </div>
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span className="stepper-label">{label}</span>
      <input type="checkbox" role="switch" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-ui" aria-hidden="true" />
    </label>
  );
}

function Choice({ label, name, value, options, onChange }: { label: string; name: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <fieldset className="knob knob-choice">
      <legend>{label}</legend>
      <div className="seg seg-wrap">
        {options.map(([v, text]) => (
          <label key={v}>
            <input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />
            <span>{text}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function NumberField({ label, unit, value, min, max, step, onChange }: { label: string; unit: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="sys-field sys-number">
      <span>{label}</span>
      <span className="sys-number-in">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
          }}
        />
        <span>{unit}</span>
      </span>
    </label>
  );
}
