import type { Network } from "./network";
import type { Traffic, Priority } from "./traffic";
import { lookaheadBlocks } from "./traffic";
import { BLOCK_LEN } from "../game/config";
import type { Vec } from "../game/types";

/**
 * Mover: graph-following locomotion with block reservation and
 * collision-free speed control. Used by aircraft and ground vehicles.
 *
 * A mover travels node-to-node along its `path`. Positions are computed from
 * path-distance `s` (meters from path[0]). Blocks are per-edge; a claim maps
 * a block to the path-distance where it starts, so release logic is exact.
 */
export class Mover {
  id = 0;
  pos: Vec = { x: 0, y: 0 };
  heading = 0;
  speed = 0;
  maxSpeed: number;
  len: number;
  prio: Priority;
  accel = 2.2;
  decel = 2.6;

  path: number[] = [];
  private perEdgeLen: number[] = [];
  private cumLen: number[] = [];
  private pathLen = 0;
  private claims = new Map<number, number>(); // blockKey -> pathStart of block
  private claimedNodes = new Set<number>();
  stoppedBy: "none" | "traffic" | "target" = "none";
  private sinceBlocked = 0;
  /** set by world; used for head-on resolution */
  onRerouteRequest: (() => void) | null = null;

  constructor(
    private net: Network,
    opts: { maxSpeed?: number; len: number; prio: Priority }
  ) {
    this.maxSpeed = opts.maxSpeed ?? 8;
    this.len = opts.len;
    this.prio = opts.prio;
  }

  setPath(path: number[]) {
    this.releaseAll();
    this.path = path.slice();
    this.edgeIdx = 0;
    this.distInEdge = 0;
    this.speed = 0;
    this.sinceBlocked = 0;
    this.perEdgeLen = [];
    this.cumLen = [];
    let acc = 0;
    for (let i = 0; i < this.path.length - 1; i++) {
      const e = this.edgeBetween(this.path[i], this.path[i + 1]);
      const l = e ? e.length : 0;
      this.perEdgeLen.push(l);
      acc += l;
      this.cumLen.push(acc);
    }
    this.pathLen = acc;
    if (this.path.length >= 2) this.pos = this.pointAt(0);
  }

  edgeBetween(a: number, b: number) {
    return this.net.edgeBetween(a, b);
  }

  get s(): number {
    let s = 0;
    for (let i = 0; i < this.edgeIdx; i++) s += this.perEdgeLen[i] ?? 0;
    return s + this.distInEdge;
  }

  get totalPathLen(): number {
    return this.pathLen;
  }

  get done(): boolean {
    return this.path.length < 2 || this.s >= this.pathLen - 0.4;
  }

  edgeIdx = 0;
  distInEdge = 0;

  pointAt(s: number): Vec {
    const p = this.path;
    let rem = Math.max(0, s);
    for (let i = 0; i < p.length - 1; i++) {
      const l = this.perEdgeLen[i] ?? 0;
      if (rem <= l || i === p.length - 2) {
        const a = this.net.node(p[i]);
        const b = this.net.node(p[i + 1]);
        const t = l > 0 ? Math.min(1, rem / l) : 0;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      rem -= l;
    }
    const a = this.net.node(p[p.length - 1]);
    return { x: a.x, y: a.y };
  }

  headingAt(s: number): number {
    const p = this.path;
    let rem = Math.max(0, s);
    for (let i = 0; i < p.length - 1; i++) {
      const l = this.perEdgeLen[i] ?? 0;
      if (rem <= l || i === p.length - 2) {
        const a = this.net.node(p[i]);
        const b = this.net.node(p[i + 1]);
        return Math.atan2(b.y - a.y, b.x - a.x);
      }
      rem -= l;
    }
    return this.heading;
  }

  private blockKey(edgeId: number, idx: number): number {
    return edgeId * 100000 + idx;
  }

  /** block index + path-start for path-distance s */
  private blockAtPathS(s: number): { edgeId: number; idx: number; pathStart: number } {
    let rem = Math.max(0, s);
    let pathStart = 0;
    for (let i = 0; i < this.path.length - 1; i++) {
      const l = this.perEdgeLen[i] ?? 0;
      if (rem < l || i === this.path.length - 2) {
        const e = this.edgeBetween(this.path[i], this.path[i + 1]);
        const nBlocks = Math.max(1, Math.ceil(l / BLOCK_LEN));
        const idx = Math.min(nBlocks - 1, Math.floor(Math.max(0, rem) / BLOCK_LEN));
        return { edgeId: e ? e.id : -1, idx, pathStart: pathStart + idx * BLOCK_LEN };
      }
      rem -= l;
      pathStart += l;
    }
    return { edgeId: -1, idx: 0, pathStart: 0 };
  }

  private nodeAtPathS(s: number): number {
    let rem = Math.max(0, s);
    for (let i = 0; i < this.path.length - 1; i++) {
      const l = this.perEdgeLen[i] ?? 0;
      if (rem < l) return this.path[i + 1];
      rem -= l;
    }
    return -1;
  }

  /** path distance where node n sits (or -1) */
  private nodeDist(n: number): number {
    for (let i = 0; i < this.path.length - 1; i++) {
      if (this.path[i] === n) return this.cumLen[i] ?? 0;
    }
    return -1;
  }

  releaseAll() {
    for (const key of this.claims.keys()) {
      this.net && this.traffic?.releaseBlock(Math.floor(key / 100000), key % 100000, this.id);
    }
    for (const n of this.claimedNodes) {
      this.traffic?.releaseNode(n, this.id);
    }
    this.claims.clear();
    this.claimedNodes.clear();
  }

  traffic: Traffic | null = null;

  step(dt: number, traffic: Traffic, requestSpeed = 0): boolean {
    this.traffic = traffic;
    if (this.path.length < 2 || this.done) {
      this.speed = 0;
      this.stoppedBy = "target";
      this.releaseAll();
      return false;
    }
    const curMax = this.curEdgeMaxSpeed();
    let desired = requestSpeed > 0 ? Math.min(requestSpeed, this.maxSpeed, curMax) : Math.min(this.maxSpeed, curMax);

    // 1. release what our tail has passed
    this.releaseBehind();

    // 2. brake for denied claims
    const denyS = this.firstDeniedS();
    if (denyS >= 0) {
      const d = denyS - this.s;
      const vmax = d > 0 ? Math.sqrt(2 * this.decel * d) : 0;
      desired = Math.min(desired, vmax);
      this.sinceBlocked += dt;
    } else {
      this.sinceBlocked = 0;
    }

    // 3. accelerate
    if (this.speed < desired) this.speed = Math.min(desired, this.speed + this.accel * dt);
    else this.speed = Math.max(desired, this.speed - this.decel * dt);

    // 4. move
    let rem = this.speed * dt;
    while (rem > 0 && this.edgeIdx < this.path.length - 1) {
      const left = (this.perEdgeLen[this.edgeIdx] ?? 0) - this.distInEdge;
      if (rem < left) {
        this.distInEdge += rem;
        rem = 0;
      } else {
        rem -= left;
        this.edgeIdx++;
        this.distInEdge = 0;
        if (this.edgeIdx >= this.path.length - 1) {
          const last = this.edgeIdx - 1;
          this.edgeIdx = Math.max(0, this.path.length - 2);
          this.distInEdge = this.perEdgeLen[last] ?? 0;
          rem = 0;
        }
      }
    }
    this.syncPosHeading();

    // 5. claim ahead
    this.claimAhead();

    this.stoppedBy = this.speed < 0.05 ? "traffic" : "none";
    if (this.done) {
      this.speed = 0;
      this.stoppedBy = "target";
      this.releaseAll();
      return false;
    }
    return this.stoppedBy === "traffic";
  }

  private syncPosHeading() {
    const s = this.s;
    this.pos = this.pointAt(s);
    this.heading = this.headingAt(s);
  }

  private curEdgeMaxSpeed(): number {
    if (this.path.length < 2) return 0;
    const i = Math.min(this.edgeIdx, this.path.length - 2);
    const e = this.edgeBetween(this.path[i], this.path[i + 1]);
    return e ? e.maxSpeed : 0;
  }

  private releaseBehind() {
    const tailS = this.s - this.len;
    for (const [key, pathStart] of [...this.claims]) {
      if (pathStart + BLOCK_LEN <= tailS) {
        this.traffic!.releaseBlock(Math.floor(key / 100000), key % 100000, this.id);
        this.claims.delete(key);
      }
    }
    for (const n of [...this.claimedNodes]) {
      const nd = this.nodeDist(n);
      if (nd >= 0 && nd <= tailS) {
        this.traffic!.releaseNode(n, this.id);
        this.claimedNodes.delete(n);
      }
    }
  }

  private claimAhead() {
    const s = this.s;
    const nBlocks = lookaheadBlocks(this.speed || this.maxSpeed);
    for (let bi = 0; bi < nBlocks; bi++) {
      const bs = s + bi * BLOCK_LEN;
      if (bs >= this.pathLen - 0.4) break;
      const { edgeId, idx, pathStart } = this.blockAtPathS(bs);
      if (edgeId < 0) continue;
      const key = this.blockKey(edgeId, idx);
      if (!this.claims.has(key)) {
        if (!this.traffic!.claimBlock(edgeId, idx, this.prio, this.id)) break;
        this.claims.set(key, pathStart);
      }
      const nextNode = this.nodeAtPathS(bs + BLOCK_LEN);
      if (nextNode >= 0 && !this.claimedNodes.has(nextNode)) {
        if (!this.traffic!.claimNode(nextNode, this.prio, this.id)) break;
        this.claimedNodes.add(nextNode);
      }
    }
  }

  private firstDeniedS(): number {
    const s = this.s;
    const nBlocks = lookaheadBlocks(this.speed || this.maxSpeed);
    for (let bi = 0; bi < nBlocks; bi++) {
      const bs = s + bi * BLOCK_LEN;
      if (bs >= this.pathLen - 0.4) break;
      const { edgeId, idx } = this.blockAtPathS(bs);
      if (edgeId < 0) continue;
      const key = this.blockKey(edgeId, idx);
      if (!this.claims.has(key)) return bs;
      const nextNode = this.nodeAtPathS(bs + BLOCK_LEN);
      if (nextNode >= 0 && !this.claimedNodes.has(nextNode)) return bs + BLOCK_LEN;
    }
    return -1;
  }

  get blockedSince(): number {
    return this.sinceBlocked;
  }
}
