import type { Op } from "../types";
import type { NodeRt, Req } from "./model";
import { Sim, attach } from "./sim";

/** Elections: a cluster's terms and votes, its leader's beats, and the commit of a write a majority has. */
const elections: Partial<Sim> & ThisType<Sim> = {
  // ------------------------------------------------------------------------------------------------ elections

  /** Every 10 ms at a cluster member: a leader beats; a member that has heard no leader for its timeout stands for election. */
  raftTick(n: NodeRt) {
    const c = n.spec.cluster!;
    const s = n.raft;
    if (n.spec.id === c.group[0]) {
      this.leaderSamples.add(this.t);
      if (!c.group.some((id) => this.nodes.get(id)?.up && this.nodes.get(id)!.raft.role === "leader")) this.leaderless.add(this.t);
    }
    if (!n.up) return;
    if (!s.timeout) s.timeout = c.electionMs[0] + n.rng() * (c.electionMs[1] - c.electionMs[0]);
    if (s.role === "leader") {
      if (this.t < s.nextBeat) return;
      s.nextBeat = this.t + c.heartbeatMs;
      for (const id of c.group) if (id !== n.spec.id) this.raftSend(n, id, "beat");
      return;
    }
    if (this.t - s.lastBeat < s.timeout) return;
    // Silence: a new term, and this member stands for it.
    s.term++;
    s.role = "candidate";
    s.votedFor = n.spec.id;
    s.votes = new Set([n.spec.id]);
    s.lastBeat = this.t;
    s.timeout = c.electionMs[0] + n.rng() * (c.electionMs[1] - c.electionMs[0]);
    if (c.majority === false || c.group.length === 1) return this.lead(n);
    for (const id of c.group) if (id !== n.spec.id) this.raftSend(n, id, "vote");
  },

  /** A beat or a request for votes reaches a member. A later term makes it a follower of that term; one vote per term, to the first who asks. */
  raftMessage(n: NodeRt, r: Req) {
    const s = n.raft;
    if (!n.up || !n.spec.cluster) {
      r.phase = "gone";
      return;
    }
    if (r.term > s.term) {
      s.term = r.term;
      s.votedFor = "";
      s.role = "follower";
    }
    if (r.op === "beat") {
      if (r.term >= s.term) {
        s.role = "follower";
        s.leader = r.client;
        s.lastBeat = this.t;
      }
      r.phase = "gone";
      return;
    }
    const grant = r.term >= s.term && (s.votedFor === "" || s.votedFor === r.client);
    if (grant) {
      s.votedFor = r.client;
      s.lastBeat = this.t;
    }
    this.respond(r, grant ? "ok" : "rejected");
  },

  /** A vote comes back to its candidate: a majority of the group makes it leader. */
  raftReply(n: NodeRt, r: Req) {
    r.phase = "gone";
    const s = n.raft;
    if (s.role !== "candidate" || r.term !== s.term || r.result !== "ok") return;
    s.votes.add(r.from);
    if (s.votes.size > n.spec.cluster!.group.length / 2) this.lead(n);
  },

  /** The leader this member would pass a write to: one it knows of, up, and not cut off from it. */
  leaderOf(n: NodeRt) {
    const id = n.raft.leader;
    const m = id && id !== n.spec.id ? this.nodes.get(id) : undefined;
    return m && m.up && m.raft.role === "leader" && !this.cut(n, m) ? m : undefined;
  },

  /** A request reaching a cluster member that doesn't lead goes on to the leader, or fails if it knows of none it can reach. True when handled. */
  clusterWrite(n: NodeRt, r: Req) {
    if (n.raft.role === "leader") return false;
    const lead = this.leaderOf(n);
    if (!lead) this.fail(n, r);
    else this.send(r, lead.spec.id);
    return true;
  },

  /** A member becomes leader of its term, and beats at once. */
  lead(n: NodeRt) {
    const s = n.raft;
    s.role = "leader";
    s.leader = n.spec.id;
    s.nextBeat = this.t;
    this.effect("elect", n.spec.id);
    this.note(`${n.spec.label} elected leader`);
  },

  /** A beat or a request for votes to another member (not across a partition). */
  raftSend(n: NodeRt, to: string, op: Op) {
    const peer = this.nodes.get(to);
    if (!peer || this.cut(n, peer)) return;
    const m = this.make(n.spec.id, op, 0, op);
    m.detached = true;
    m.term = n.raft.term;
    m.logicalId = (Math.imul(n.raft.term + 1, 0x9e3779b1) ^ Math.imul(this.t + 1, 0x85ebca6b)) >>> 0;
    m.stack = [{ id: n.spec.id, calls: [] }];
    m.at = n.spec.id;
    this.send(m, to);
  },

  /** A committed write is applied at the leader (the followers applied their copies), and counted where it landed. */
  commit(n: NodeRt, r: Req) {
    this.truth.set(r.key, r.seq);
    n.data.set(r.key, r.seq);
    if (this.partitioned && n.spec.region) {
      const s = this.writtenIn.get(n.spec.region) ?? new Set<number>();
      s.add(r.key);
      this.writtenIn.set(n.spec.region, s);
    }
  },
};

attach("elections", elections);
