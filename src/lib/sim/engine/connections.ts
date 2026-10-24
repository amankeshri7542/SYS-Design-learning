import type { Conn, Frame, NodeRt, Req } from "./model";
import { Sim } from "./sim";

/**
 * Connections and windows. A sender with `connect` opens connections to its targets (a handshake of round trips first),
 * reuses them while they stay open, and keeps a request waiting while every connection it may open is busy. A sender
 * with a `window` keeps at most that many requests in flight. Both wait in the sender's `sendq`, in order. A balancer at
 * layer 4 pins each connection to one target.
 */
const connections: Partial<Sim> & ThisType<Sim> = {
  /** Send `r` on to `to` when it can go: now, once a connection is free or open, or once its window has room. */
  dial(n: NodeRt, r: Req, to: string) {
    r.phase = "wait";
    r.at = n.spec.id;
    r.to = to;
    r.queuedAt = this.t;
    // A request sent again goes ahead of those not yet sent.
    if (r.attempt > 0) n.sendq.unshift(r);
    else n.sendq.push(r);
    this.pump(n);
  },

  /**
   * Send what can go, oldest first. A window lets nothing pass the first request it holds back (a stream goes in order);
   * a request that finds every connection to its target busy waits, and lets requests for other targets by.
   */
  pump(n: NodeRt) {
    const spec = n.spec.connect;
    const windowed = !!n.spec.client?.window;
    for (let i = 0; i < n.sendq.length; ) {
      const r = n.sendq[i];
      const f = r.stack[r.stack.length - 1];
      if (f.conn) {
        // Waiting for its connection's handshake.
        if (n.conns.find((k) => k.id === f.conn)?.ready) {
          n.sendq.splice(i, 1);
          this.goOut(n, r);
        } else i++;
        continue;
      }
      if (windowed && !r.flew) {
        if (n.flying >= this.windowOf(n)) break;
        r.flew = true;
        n.flying++;
      }
      if (spec) {
        const limit = spec.streams && spec.streams !== "one" ? Infinity : 1;
        let k = n.conns.find((c) => c.to === r.to && c.ready && c.busy < limit) ?? n.conns.find((c) => c.to === r.to && !c.ready && c.busy < limit);
        if (!k && n.conns.filter((c) => c.to === r.to).length < spec.max) k = this.openConn(n, r.to);
        if (!k) {
          i++;
          continue;
        }
        k.busy++;
        k.lastUsed = this.t;
        f.conn = k.id;
        // The wait for a connection ends here; a wait for its handshake from here is time on the wire.
        r.wait += this.t - r.queuedAt;
        this.sendWaits.push({ t: this.t, ms: this.t - r.queuedAt });
        r.queuedAt = this.t;
        if (!k.ready) {
          i++;
          continue;
        }
      }
      n.sendq.splice(i, 1);
      this.goOut(n, r);
    }
  },

  /** A request leaves its sender at last. */
  goOut(n: NodeRt, r: Req) {
    if (r.stack[r.stack.length - 1].conn) r.wire += this.t - r.queuedAt;
    else {
      r.wait += this.t - r.queuedAt;
      this.sendWaits.push({ t: this.t, ms: this.t - r.queuedAt });
    }
    r.outAt = this.t;
    const c = n.spec.client;
    const timeout = c?.timeoutMs ?? this.spec.timeoutMs;
    if (c?.window && timeout) r.deadline = this.t + timeout;
    this.send(r, r.to);
  },

  /** A request that never left its sender fails there: a client hears an error (and may retry); a server answers its caller with one. */
  abort(n: NodeRt, r: Req) {
    const f = r.stack[r.stack.length - 1];
    if (f.conn) this.hangUp(n, f);
    if (n.spec.client && r.stack.length === 1) {
      // It never went out: its place in the window frees, and says nothing about the way.
      if (r.flew) {
        r.flew = false;
        n.flying = Math.max(0, n.flying - 1);
      }
      r.result = "error";
      return this.finishAtClient(n, r);
    }
    const i = n.held.indexOf(r);
    if (i >= 0) n.held.splice(i, 1);
    this.respond(r, "error");
  },

  openConn(n: NodeRt, to: string) {
    const spec = n.spec.connect!;
    const k: Conn = { id: ++this.connSeq, to, busy: 0, lastUsed: this.t, ready: spec.handshakeRtts <= 0, rtts: spec.handshakeRtts, accepted: false, stall: { from: 0, until: 0 } };
    n.conns.push(k);
    if (!k.ready) {
      this.handshakes.add(this.t);
      this.shake(n, k);
    }
    return k;
  },

  /** One round trip of a connection's handshake: a small grey ring out to the target and back. */
  shake(n: NodeRt, k: Conn) {
    const h = this.make(n.spec.id, "probe", 0, "probe");
    h.hand = k.id;
    // A handshake that never comes back (lost, or its target hangs) fails in time.
    h.deadline = this.t + Math.max(1000, 6 * this.latency(n.spec.id, k.to));
    this.send(h, k.to);
  },

  /** A target takes a new connection if it has room for one more (`maxConns`). */
  admitConn(n: NodeRt, r: Req) {
    const k = this.nodes.get(r.client)?.conns.find((c) => c.id === r.hand);
    if (!k || k.accepted) return true;
    if (n.spec.maxConns !== undefined && n.accepted >= n.spec.maxConns) return false;
    n.accepted++;
    k.accepted = true;
    return true;
  },

  /** A handshake round trip came back: the next one goes, or the connection is open; refused, it closes. */
  shaken(n: NodeRt, r: Req) {
    r.phase = "gone";
    const k = n.conns.find((c) => c.id === r.hand);
    if (!k || r.abandoned) return;
    if (r.result !== "ok") return this.dropConn(n, k, true);
    if (--k.rtts > 0) return this.shake(n, k);
    k.ready = true;
    k.lastUsed = this.t;
    this.pump(n);
  },

  /** Close a connection. One that could not be opened (`failed`) takes the requests waiting for it down with it. */
  dropConn(n: NodeRt, k: Conn, failed: boolean) {
    const i = n.conns.indexOf(k);
    if (i < 0) return;
    n.conns.splice(i, 1);
    if (k.accepted) {
      const t = this.nodes.get(k.to);
      if (t) t.accepted = Math.max(0, t.accepted - 1);
    }
    if (!failed) return;
    for (const r of n.sendq.filter((q) => q.stack[q.stack.length - 1].conn === k.id)) {
      n.sendq.splice(n.sendq.indexOf(r), 1);
      r.stack[r.stack.length - 1].conn = undefined;
      this.abort(n, r);
    }
  },

  /**
   * An exchange on a connection is over: it is free again. A request given up on spoils a one-at-a-time connection (its
   * answer may still come down it), which closes; a connection that isn't kept alive closes once idle.
   */
  hangUp(n: NodeRt, f: Frame, abandoned = false) {
    const id = f.conn;
    if (!id) return;
    f.conn = undefined;
    const k = n.conns.find((c) => c.id === id);
    if (!k) return;
    k.busy = Math.max(0, k.busy - 1);
    k.lastUsed = this.t;
    const spec = n.spec.connect!;
    if (abandoned && (spec.streams ?? "one") === "one") this.dropConn(n, k, false);
    else if (spec.keepAliveMs <= 0 && !k.busy && k.ready) this.dropConn(n, k, false);
    this.pump(n);
  },

  /** Every 10 ms: close connections idle past their keep-alive, and fail requests that waited too long for one. */
  tidyConns(n: NodeRt) {
    const spec = n.spec.connect!;
    for (const k of [...n.conns]) if (k.ready && !k.busy && this.t - k.lastUsed >= spec.keepAliveMs) this.dropConn(n, k, false);
    if (!spec.waitMs) return;
    for (const r of [...n.sendq]) {
      if (r.stack[r.stack.length - 1].conn || this.t - r.queuedAt < spec.waitMs) continue;
      n.sendq.splice(n.sendq.indexOf(r), 1);
      this.abort(n, r);
    }
  },

  /** A node went down: every connection to it closes. Requests waiting on one's handshake look for another. */
  connsLost(id: string) {
    for (const m of this.list) {
      if (!m.conns.some((k) => k.to === id)) continue;
      const gone = new Set(m.conns.filter((k) => k.to === id).map((k) => k.id));
      m.conns = m.conns.filter((k) => k.to !== id);
      this.effect("hangup", m.spec.id);
      for (const r of m.sendq) {
        const f = r.stack[r.stack.length - 1];
        if (f.conn && gone.has(f.conn)) {
          f.conn = undefined;
          r.queuedAt = this.t;
        }
      }
      this.pump(m);
    }
  },

  /** Which connection a request travels on, for a layer 4 balancer: its client's connection, or (without one) its user. */
  connKey(r: Req) {
    const f = r.stack[0];
    return f.conn ? `${f.id}#${f.conn}` : `${f.id}:${r.key}`;
  },

  /** A crossing lost on a connection that resends: shown lost, it goes again from the start of the link, and may be lost again. */
  resend(r: Req) {
    const span = r.t1 - r.t0;
    const frac = span > 0 ? (r.lostAt - r.t0) / span : 0.5;
    this.fx.push({ t: this.t, kind: "lost", node: r.to, link: { from: r.from, to: r.to, frac } });
    const due = r.t1;
    r.resent++;
    r.t0 = Math.max(this.t, r.t0 + r.rto);
    r.t1 = r.t0 + span;
    r.lostAt = 0;
    this.lossOf(r, span);
    // On a multiplexed connection everything behind it waits: the bytes arrive in order (head-of-line blocking).
    const f = r.stack[r.stack.length - 1];
    const owner = f.conn ? this.nodes.get(f.id) : undefined;
    const k = owner?.conns.find((c) => c.id === f.conn);
    if (!owner || !k || owner.spec.connect?.streams !== "multiplex") return;
    k.stall = { from: due, until: Math.max(k.stall.until, r.t1) };
    for (const q of this.reqs) {
      if (q === r || q.phase !== "travel" || q.dir !== r.dir || q.t1 <= due || q.t1 >= k.stall.until) continue;
      const g = q.stack[q.stack.length - 1];
      if (g.id === f.id && g.conn === k.id) q.t1 = k.stall.until;
    }
  },

  /** How many requests a sender with a window may have in flight now. */
  windowOf(n: NodeRt) {
    // A fixed window is its size, even after a knob changes it; AIMD's is its own.
    const spec = n.spec.client?.window;
    const w = spec?.mode === "aimd" ? Math.floor(n.cwnd) : (spec?.size ?? Infinity);
    if (n.peerWindow > 0) return Math.min(w, n.peerWindow);
    // The receiver has no room: one request at a time, every half second, to hear when it has.
    return n.flying === 0 && this.t - n.zeroAt >= 500 ? 1 : 0;
  },

  /**
   * A windowed request is over at its client, answered (`ok`) or given up on: its place in the window frees. AIMD grows
   * the window on an answer (by one while below its slow-start mark, else by one per window) and halves it on a loss,
   * at most once a round trip.
   */
  flown(n: NodeRt, r: Req, ok: boolean) {
    if (!r.flew) return;
    r.flew = false;
    n.flying = Math.max(0, n.flying - 1);
    const w = n.spec.client?.window;
    if (ok && r.outAt) {
      const rtt = this.t - r.outAt;
      n.srtt = n.srtt ? n.srtt * 0.875 + rtt * 0.125 : rtt;
    }
    if (w?.mode === "aimd") {
      if (ok) n.cwnd = Math.min(w.max ?? Infinity, n.cwnd < n.ssthresh ? n.cwnd + 1 : n.cwnd + 1 / n.cwnd);
      else if (this.t - n.cutAt >= n.srtt) {
        n.ssthresh = Math.max(1, Math.floor(n.cwnd / 2));
        n.cwnd = n.ssthresh;
        n.cutAt = this.t;
      }
    }
    if (r.window >= 0) {
      n.peerWindow = r.window;
      if (!r.window) n.zeroAt = this.t;
    }
    this.pump(n);
  },

  /** A receiver whose full line has drained to its low mark tells each sender it turned away that it has room again. */
  updateWindows(n: NodeRt) {
    const a = n.spec.advertise!;
    if (!n.starved.size || n.queue.length > (a.low ?? 0)) return;
    const room = Math.max(0, a.high - n.queue.length);
    for (const path of n.starved) {
      const ids = path.split(">");
      if (!this.nodes.has(ids[0])) continue;
      const u = this.make(ids[0], "ack", 0, "ack");
      u.detached = true;
      u.ack = true;
      u.window = room;
      u.stack = [...ids, n.spec.id].map((id) => ({ id, calls: [] }));
      u.at = n.spec.id;
      this.respond(u, "ok");
    }
    n.starved.clear();
  },
};

Object.assign(Sim.prototype, connections);
