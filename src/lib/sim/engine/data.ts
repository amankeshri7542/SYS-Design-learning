import type { NodeRt, Req } from "./model";
import { Sim } from "./sim";

/**
 * Databases: writes and reads against the global write sequence, replication to replicas and peers (waiting for the
 * copies with `replication: "sync"`), partitions, and promoting a replica when its primary fails.
 */
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
      // A booking writes only the version it read: a key taken in between is a double booking, or (compare-and-set) refused.
      if (r.expect >= 0 && (n.data.get(r.key) ?? 0) !== r.expect) {
        this.effect("conflict", n.spec.id);
        if (n.spec.cas) return this.respond(r, "rejected");
        this.doubleBookings.add(this.t);
      }
      // A cluster leader commits a write once a majority of the group has it (itself included).
      if (n.spec.cluster && n.spec.cluster.majority !== false) {
        r.seq = ++this.seq;
        const others = n.spec.cluster.group.filter((id) => id !== n.spec.id);
        return this.scatter(n, r, others, Math.floor(n.spec.cluster.group.length / 2), "repl", true);
      }
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
      let copies = 0;
      for (const peer of this.list) {
        const replica = this.replicaOf(peer) === n.spec.id;
        if (replica || n.spec.peer === peer.spec.id) {
          const m = this.make(n.spec.id, "repl", r.key, "repl");
          m.seq = seq;
          m.detached = true;
          m.at = n.spec.id;
          m.to = peer.spec.id;
          // Synchronous replication: the write is answered once this copy is confirmed.
          if (replica && n.spec.replication === "sync") {
            m.syncFor = r.id;
            copies++;
          }
          if (this.cut(n, peer)) {
            m.phase = "parked";
            this.blocked.push(m);
          } else this.sendRepl(m, peer);
        }
      }
      if (copies) {
        r.phase = "wait";
        n.waiting.push(r);
        this.syncWait.set(r.id, { write: r, left: copies });
        return;
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
    // A part of a quorum write or a commit: a member that is down can't store it.
    if (r.parentId && !n.up) return this.respond(r, "error");
    if ((n.data.get(r.key) ?? 0) < r.seq) n.data.set(r.key, r.seq);
    // A copy its primary is waiting for goes back to confirm it.
    if (r.syncFor || r.parentId) return this.respond(r, "ok");
    r.phase = "gone";
  },

  /** Who a database copies from now: its `replicaOf`, unless a promotion changed it. */
  replicaOf(n: NodeRt) {
    return this.repoint.has(n.spec.id) ? this.repoint.get(n.spec.id) : n.spec.replicaOf;
  },

  /** A balancer that promotes sends everything to its primary (a write to a dead one fails until health checks bench it). */
  toPrimary(n: NodeRt, r: Req) {
    if (!n.primary) n.primary = this.flat(n.spec.to)[0] ?? "";
    if (!this.candidates(n, r).includes(n.primary)) return this.fail(n, r);
    this.forward(n, r, n.primary);
  },

  /**
   * Promote `id` over the balancer's primary: it takes the writes, the other replicas copy from it, and the old primary
   * comes back (when it does) as one of its replicas, with its data. Writes the old primary acknowledged that never
   * reached the new one, and aren't on their way to it, are lost.
   */
  promote(lb: NodeRt, id: string) {
    const neo = this.nodes.get(id);
    if (!neo) return;
    const old = this.nodes.get(lb.primary);
    lb.primary = id;
    if (old) {
      const coming = new Map<number, number>();
      for (const q of this.reqs) if (q.op === "repl" && q.phase === "travel" && q.dir === 1 && q.to === id) coming.set(q.key, Math.max(coming.get(q.key) ?? 0, q.seq));
      for (const [k, seq] of old.data) {
        const has = Math.max(neo.data.get(k) ?? 0, coming.get(k) ?? 0);
        if (seq <= has) continue;
        if (!this.unacked.has(seq)) this.lostAcked.add(this.t);
        this.truth.set(k, has);
      }
      old.data = new Map(neo.data);
      for (const m of this.list) if (m !== neo && m !== old && this.replicaOf(m) === old.spec.id) this.repoint.set(m.spec.id, id);
      this.repoint.set(old.spec.id, id);
    }
    this.repoint.set(id, undefined);
    this.effect("promote", id);
    this.note(`${neo.spec.label} promoted to primary`);
  },

  cut(a: NodeRt, b: NodeRt) {
    return this.partitioned && !!a.spec.region && !!b.spec.region && a.spec.region !== b.spec.region;
  },
};

Object.assign(Sim.prototype, data);
