"use client";

import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { KINDS, settingsOf, type Issue, type PartDoc, type PartKind, type SystemDoc } from "@/lib/system/doc";
import { addPart, canAdd, flowOrder } from "@/lib/system/edit";

// A part's settings load the first time one is opened.
const PartEditor = lazy(() => import("./part-editor").then((m) => ({ default: m.PartEditor })));

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
            {open === p.id && (
              <Suspense fallback={<div className="sys-part-body" aria-busy="true" />}>
                <PartEditor doc={doc} p={p} onChange={onChange} onRemoved={() => setOpen(null)} />
              </Suspense>
            )}
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
