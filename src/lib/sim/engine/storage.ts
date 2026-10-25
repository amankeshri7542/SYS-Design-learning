import type { NodeRt, Req } from "./model";
import { Sim } from "./sim";

/**
 * Streams and durability. A stream processor counts events in windows of event time, waits a while after each window
 * ends for late ones, then writes one row per key; an event for a window already closed is dropped. A write-behind
 * cache answers a write at once and saves it later. What either holds only in memory dies with it in a crash.
 */
const storage: Partial<Sim> & ThisType<Sim> = {
  /** An event reaches a processor: counted in the window its event time falls in, or dropped if that window has closed. */
  windowIn(n: NodeRt, r: Req) {
    const w = n.spec.window!;
    this.windowed.add(this.t);
    const start = Math.floor(r.eventTime / w.sizeMs) * w.sizeMs;
    if (this.t >= start + w.sizeMs + (w.latenessMs ?? 0)) {
      this.lateDropped.add(this.t);
      this.effect("late", n.spec.id);
      return;
    }
    let pane = n.panes.get(start);
    if (!pane) n.panes.set(start, (pane = new Map()));
    pane.set(r.key, (pane.get(r.key) ?? 0) + 1);
  },

  /** Every 10 ms at a processor: a window past its end and its wait for late events writes a row per key, and closes. */
  closeWindows(n: NodeRt) {
    const w = n.spec.window!;
    for (const [start, pane] of [...n.panes]) {
      if (this.t < start + w.sizeMs + (w.latenessMs ?? 0)) continue;
      n.panes.delete(start);
      this.windowLags.push({ t: this.t, ms: this.t - start });
      for (const key of pane.keys()) {
        const m = this.make(n.spec.id, "write", key, "count");
        m.detached = true;
        this.send(m, w.to);
      }
    }
  },

  /** A write reaches a write-behind cache: it is the newest value now, kept here and answered, and saved later. */
  writeBehind(n: NodeRt, r: Req) {
    const seq = ++this.seq;
    this.truth.set(r.key, seq);
    r.seq = seq;
    n.cache.set(r.key, { seq, exp: this.t + (n.spec.ttlMs ?? Infinity), last: this.t });
    n.dirty.set(r.key, seq);
    this.effect("fill", n.spec.id);
    this.evict(n);
    this.respond(r, "ok");
  },

  /** Every `flushMs` at a write-behind cache: each unsaved key goes to the database once, however often it was written. */
  flushDirty(n: NodeRt) {
    n.nextFlush = this.t + (n.spec.flushMs ?? 0);
    if (!n.dirty.size) return;
    const origin = this.resolve(n, n.spec.to![0]);
    for (const [key, seq] of n.dirty) {
      const m = this.make(n.spec.id, "write", key, "flush");
      m.detached = true;
      m.flushed = true;
      m.seq = seq;
      this.send(m, origin);
    }
    n.dirty.clear();
  },

  /** A crash: a write-behind cache's unsaved writes and a processor's open counts (unless checkpointed) are gone. */
  lose(n: NodeRt) {
    for (let i = 0; i < n.dirty.size; i++) this.lostWrites.add(this.t);
    n.dirty.clear();
    if (n.spec.window?.checkpoint) return;
    for (const pane of n.panes.values()) for (const count of pane.values()) for (let i = 0; i < count; i++) this.lostWrites.add(this.t);
    n.panes.clear();
  },
};

Object.assign(Sim.prototype, storage);
