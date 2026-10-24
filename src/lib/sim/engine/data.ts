import type { NodeRt, Req } from "./model";
import { Sim } from "./sim";

/** Databases: writes and reads against the global write sequence, replication to replicas and peers, and partitions. */
const data: Partial<Sim> & ThisType<Sim> = {
  setPartition(on: boolean) {
    if (this.partitioned === on) return;
    this.partitioned = on;
    if (on) {
      this.writtenIn.clear();
      return;
    }
    const sides = [...this.writtenIn.values()];
    if (sides.length > 1) {
      const [a, ...rest] = sides;
      for (const k of a) if (rest.some((s) => s.has(k))) this.conflicts++;
    }
    this.writtenIn.clear();
    const msgs = this.blocked;
    this.blocked = [];
    for (const r of msgs) this.sendRepl(r, this.nodes.get(r.to));
  },

  dbDone(n: NodeRt, r: Req) {
    if (r.op === "write") {
      // An idempotent database applies a write once per logical message, and replays its result for a repeat.
      const note = n.spec.idempotent ? n.done.get(this.noteOf(r)) : undefined;
      if (note) {
        this.effect("dupe", n.spec.id);
        return this.respond(r, note.result);
      }
      this.remember(n, r, "ok");
      if (n.spec.outbox) n.outbox.push({ id: r.logicalId, key: r.key, tag: r.tag, t: this.t, sentAt: -Infinity });
      const seq = ++this.seq;
      this.truth.set(r.key, seq);
      n.data.set(r.key, seq);
      r.seq = seq;
      if (this.partitioned && n.spec.region) {
        const s = this.writtenIn.get(n.spec.region) ?? new Set<number>();
        s.add(r.key);
        this.writtenIn.set(n.spec.region, s);
      }
      for (const peer of this.list) {
        if (peer.spec.replicaOf === n.spec.id || n.spec.peer === peer.spec.id) {
          const m = this.make(n.spec.id, "repl", r.key, "repl");
          m.seq = seq;
          m.detached = true;
          m.at = n.spec.id;
          m.to = peer.spec.id;
          if (this.cut(n, peer)) {
            m.phase = "parked";
            this.blocked.push(m);
          } else this.sendRepl(m, peer);
        }
      }
    } else {
      r.seq = n.data.get(r.key) ?? 0;
      r.stale = r.seq < (this.truth.get(r.key) ?? 0);
    }
    this.respond(r, "ok");
  },

  sendRepl(m: Req, peer: NodeRt | undefined) {
    if (!peer) {
      m.phase = "gone";
      return;
    }
    this.send(m, peer.spec.id, peer.spec.lagMs ?? this.latency(m.at, peer.spec.id));
  },

  applyRepl(n: NodeRt, r: Req) {
    if ((n.data.get(r.key) ?? 0) < r.seq) n.data.set(r.key, r.seq);
    r.phase = "gone";
  },

  cut(a: NodeRt, b: NodeRt) {
    return this.partitioned && !!a.spec.region && !!b.spec.region && a.spec.region !== b.spec.region;
  },
};

Object.assign(Sim.prototype, data);
