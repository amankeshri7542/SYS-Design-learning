import type { NodeRt, Req } from "./model";
import { Sim, attach } from "./sim";

/** Locks with leases, bookings that read before they write (and compare-and-set), and sagas that undo what they did. */
const bookings: Partial<Sim> & ThisType<Sim> = {
  // ------------------------------------------------------------------------------------------------ locks and bookings

  /**
   * A request for a key: it takes the lock and goes on if the key is free (a lease that ran out frees it), and waits at
   * the back of the line if the key is held or others are already waiting for it.
   */
  acquire(n: NodeRt, r: Req) {
    const h = n.locks.get(r.key);
    if (h && h.until <= this.t) n.locks.delete(r.key);
    const held = n.locks.has(r.key);
    let line = n.waiters.get(r.key);
    if (!held && !line?.length) return this.grant(n, r);
    if (!line) n.waiters.set(r.key, (line = []));
    line.push(r);
    r.phase = "parked";
    if (!held) this.wake(n, r.key);
  },

  /** The key's lock goes to `r`, for one lease, and `r` goes on. */
  grant(n: NodeRt, r: Req) {
    n.locks.set(r.key, { holder: r.id, until: this.t + n.spec.lock!.leaseMs });
    this.send(r, this.resolve(n, n.spec.to![0]));
  },

  /** The next live request waiting for a key takes its lock. */
  wake(n: NodeRt, key: number) {
    const w = n.waiters.get(key);
    while (w && w.length) {
      const next = w.shift()!;
      // Given up on by its client, and by every server on its way: nobody wants the key for it now.
      if ((next.abandoned && !this.stillHeld(next)) || next.phase !== "parked") {
        if (next.phase === "parked") next.phase = "gone";
        continue;
      }
      this.grant(n, next);
      break;
    }
    if (w && !w.length) n.waiters.delete(key);
  },

  /** The holder's answer passes back through the lock: the key is free, and the next in line takes it. */
  unlock(n: NodeRt, r: Req) {
    const h = n.locks.get(r.key);
    if (h?.holder !== r.id) return;
    n.locks.delete(r.key);
    this.wake(n, r.key);
  },

  /** Every 10 ms at a lock: a lease that ran out frees its key, though its holder may still be at work (no fencing). */
  expireLocks(n: NodeRt) {
    for (const [key, h] of [...n.locks]) {
      if (h.until > this.t) continue;
      n.locks.delete(key);
      this.wake(n, key);
    }
  },

  /** A booking's answer comes back to its server: after the read, a taken key turns it away and a free one is written; after the write, it is done. */
  reserveBack(n: NodeRt, r: Req) {
    const held = n.held.indexOf(r);
    if (held >= 0) n.held.splice(held, 1);
    if (r.reserving === 1 && r.result !== "error") {
      r.op = "write";
      if (r.seq > 0) {
        // Taken already: sold out, turned away.
        r.reserving = 0;
        r.result = "rejected";
        return this.respond(r);
      }
      r.expect = r.seq;
      r.reserving = 2;
      return this.call(n, r, [n.spec.reserve!.db]);
    }
    r.op = "write";
    r.reserving = 0;
    this.respond(r);
  },

  /**
   * A saga's step came back. Failed after earlier steps succeeded, the done steps are undone in reverse; once the last
   * undo is back, the request is turned away (cancelled, cleanly). True when the saga took it over.
   */
  sagaBack(n: NodeRt, r: Req) {
    const frame = r.stack[r.stack.length - 1];
    if (r.undoing) {
      if (frame.calls.length) {
        this.call(n, r, frame.calls);
        return true;
      }
      r.undoing = false;
      r.result = "rejected";
      this.respond(r);
      return true;
    }
    if (r.result !== "error" && r.result !== "rejected") return false;
    const steps = n.spec.calls?.[r.op === "write" ? "write" : "read"] ?? n.spec.to ?? [];
    const done = steps.length - frame.calls.length - 1;
    if (done <= 0) return false;
    r.undoing = true;
    this.call(n, r, n.spec.saga!.undo.slice(0, done).reverse());
    return true;
  },
};

attach("bookings", bookings);
