import type { Network } from "./network";
import { BLOCK_LEN, LOOKAHEAD_BLOCKS } from "../game/config";

/**
 * Block-reservation traffic control, Factorio-train style.
 *
 * Every edge is split into fixed-length blocks. Each mover claims a span of
 * blocks along its upcoming path; a claim is denied if any higher-or-equal
 * priority mover already owns those blocks (aircraft > vehicles). Junction
 * nodes are claimed separately while a mover approaches, which prevents
 * crossing collisions at intersections. Runways are owned wholesale by the
 * runway controller. Same-priority conflicts resolve first-come-first-served.
 */
export type Priority = "aircraft" | "vehicle";

export interface BlockOwner {
  prio: Priority;
  agent: number; // mover id (or -1 for runway controller)
  seq: number; // FCFS ordering
}

export class Traffic {
  private blocks = new Map<number, (BlockOwner | null)[]>(); // edgeId -> owners per block
  private nodes = new Map<number, BlockOwner | null>(); // nodeId -> owner
  private seq = 1;

  constructor(private net: Network) {
    for (const e of net.edges) {
      this.blocks.set(e.id, new Array(net.edgeBlocks(e)).fill(null));
    }
    for (const n of net.nodes) this.nodes.set(n.id, null);
  }

  /** register a newly built edge so its blocks exist */
  registerEdge(edgeId: number, blockCount: number) {
    if (!this.blocks.has(edgeId)) this.blocks.set(edgeId, new Array(Math.max(1, blockCount)).fill(null));
  }

  /** register a newly added node */
  registerNode(nodeId: number) {
    if (!this.nodes.has(nodeId)) this.nodes.set(nodeId, null);
  }

  blockOwner(edgeId: number, blockIdx: number): BlockOwner | null {
    return this.blocks.get(edgeId)?.[blockIdx] ?? null;
  }

  nodeOwner(nodeId: number): BlockOwner | null {
    return this.nodes.get(nodeId) ?? null;
  }

  /** how many blocks of an edge are owned (for congestion cost) */
  occupied(edgeId: number): number {
    const arr = this.blocks.get(edgeId);
    if (!arr) return 0;
    let c = 0;
    for (const o of arr) if (o) c++;
    return c;
  }

  claimBlock(edgeId: number, blockIdx: number, prio: Priority, agent: number): boolean {
    const arr = this.blocks.get(edgeId);
    if (!arr || blockIdx < 0 || blockIdx >= arr.length) return false;
    const cur = arr[blockIdx];
    if (cur && (cur.prio === prio ? cur.agent !== agent : true)) {
      // same agent may re-claim (idempotent)
      if (cur.agent === agent && cur.prio === prio) return true;
      // aircraft always wins over vehicle; FCFS within same priority
      if (cur.prio === "aircraft" && prio === "vehicle") return false;
      if (cur.prio === prio) return false;
      // we are aircraft and they are vehicle: evict them
      if (cur.prio === "vehicle") {
        arr[blockIdx] = { prio, agent, seq: this.seq++ };
        return true;
      }
    }
    arr[blockIdx] = { prio, agent, seq: this.seq++ };
    return true;
  }

  releaseBlock(edgeId: number, blockIdx: number, agent: number) {
    const arr = this.blocks.get(edgeId);
    if (!arr) return;
    const cur = arr[blockIdx];
    if (cur && cur.agent === agent) arr[blockIdx] = null;
  }

  claimNode(nodeId: number, prio: Priority, agent: number): boolean {
    const cur = this.nodes.get(nodeId) ?? null;
    if (!cur) {
      this.nodes.set(nodeId, { prio, agent, seq: this.seq++ });
      return true;
    }
    if (cur.agent === agent) return true;
    if (cur.prio === "aircraft" && prio === "vehicle") return false;
    if (cur.prio === prio) return false;
    if (cur.prio === "vehicle") {
      this.nodes.set(nodeId, { prio, agent, seq: this.seq++ });
      return true;
    }
    return false;
  }

  releaseNode(nodeId: number, agent: number) {
    const cur = this.nodes.get(nodeId);
    if (cur && cur.agent === agent) this.nodes.set(nodeId, null);
  }

  /** claim the entire edge (runway controller) */
  claimWhole(edgeId: number, agent: number, prio: Priority = "aircraft") {
    const arr = this.blocks.get(edgeId);
    if (!arr) return true;
    let ok = true;
    for (let i = 0; i < arr.length; i++) {
      const cur = arr[i];
      if (cur && cur.prio === prio && cur.agent !== agent) {
        ok = false;
        break;
      }
      if (cur && cur.prio === "aircraft" && prio === "vehicle") {
        ok = false;
        break;
      }
    }
    if (!ok) return false;
    for (let i = 0; i < arr.length; i++) {
      const cur = arr[i];
      if (cur && cur.prio === "vehicle") {
        // evict lower priority
        arr[i] = { prio, agent, seq: this.seq++ };
      } else if (!cur) {
        arr[i] = { prio, agent, seq: this.seq++ };
      }
    }
    return true;
  }

  releaseWhole(edgeId: number, agent: number) {
    const arr = this.blocks.get(edgeId);
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) {
      const cur = arr[i];
      if (cur && cur.agent === agent) arr[i] = null;
    }
  }
}

/** cumulative distance of blocks along an edge */
export function edgeCumBlocks(e: { length: number }): number {
  return Math.max(1, Math.ceil(e.length / BLOCK_LEN));
}

export function lookaheadBlocks(speed: number): number {
  return Math.max(2, Math.min(LOOKAHEAD_BLOCKS, Math.ceil((speed * 25) / BLOCK_LEN)));
}
