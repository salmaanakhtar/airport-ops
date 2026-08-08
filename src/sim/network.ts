import type { NetEdge, NetNode, Runway, StandDef } from "../game/types";
import { BLOCK_LEN } from "../game/config";

/**
 * The airport ground network: a directed-ish graph of nodes (junctions, stands,
 * thresholds) and edges (taxiway / runway / stand lane segments).
 * One-way edges are marked; most are two-way.
 */
export class Network {
  nodes: NetNode[] = [];
  edges: NetEdge[] = [];
  runways: Runway[] = [];
  stands: StandDef[] = [];

  private nodeId = 0;
  private edgeId = 0;

  addNode(x: number, y: number, kind: NetNode["kind"], extra?: Partial<NetNode>): number {
    const n: NetNode = { id: this.nodeId++, x, y, kind, ...extra };
    this.nodes.push(n);
    return n.id;
  }

  addEdge(a: number, b: number, extra?: Partial<NetEdge>): number {
    const A = this.nodes[a];
    const B = this.nodes[b];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len = Math.hypot(dx, dy);
    const e: NetEdge = {
      id: this.edgeId++,
      a,
      b,
      kind: extra?.kind ?? "taxiway",
      maxSpeed: extra?.maxSpeed ?? 8,
      aircraft: extra?.aircraft ?? true,
      vehicles: extra?.vehicles ?? true,
      oneWay: extra?.oneWay ?? false,
      ...extra,
      length: len,
    };
    this.edges.push(e);
    return e.id;
  }

  node(id: number): NetNode {
    return this.nodes[id];
  }

  edge(id: number): NetEdge {
    return this.edges[id];
  }

  /** neighbors reachable from node n: [nodeId, edgeId] pairs respecting one-way rules */
  neighbors(n: number, opts: { aircraft?: boolean; vehicles?: boolean } = {}): { to: number; edge: NetEdge; rev: boolean }[] {
    const out: { to: number; edge: NetEdge; rev: boolean }[] = [];
    for (const e of this.edges) {
      if (opts.aircraft && !e.aircraft) continue;
      if (opts.vehicles && !e.vehicles) continue;
      if (e.a === n && !e.oneWay) out.push({ to: e.b, edge: e, rev: false });
      else if (e.b === n) out.push({ to: e.a, edge: e, rev: true });
    }
    return out;
  }

  edgeBetween(a: number, b: number): NetEdge | null {
    for (const e of this.edges) {
      if ((e.a === a && e.b === b) || (e.b === a && e.a === b)) return e;
    }
    return null;
  }

  /** number of blocks an edge occupies */
  edgeBlocks(e: NetEdge): number {
    return Math.max(1, Math.ceil(e.length / BLOCK_LEN));
  }

  /** cumulative polyline point list from a to b across edge (for drawing/geometry) */
  edgePts(e: NetEdge): { x: number; y: number }[] {
    return [this.nodes[e.a], ...(e.pts ?? []), this.nodes[e.b]];
  }

  /** total length of polyline of edge */
  edgeGeomLength(e: NetEdge): number {
    let l = 0;
    const pts = this.edgePts(e);
    for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return l;
  }

  addRunway(x1: number, y: number, x2: number, y2: number, name: string): Runway {
    const id = this.runways.length;
    const dir = Math.atan2(y2 - y, x2 - x1);
    const end0 = { x: x1, y };
    const end1 = { x: x2, y: y2 };
    const t0 = this.addNode(x1, y, "threshold", { rwyId: id, label: name.split("/")[0] });
    const t1 = this.addNode(x2, y2, "threshold", { rwyId: id, label: name.split("/")[1] });
    const lane = this.addEdge(t0, t1, { kind: "runway", maxSpeed: 24, rwyId: id, oneWay: false });
    // holding point nodes adjacent to each threshold, north side
    const exit0 = this.addNode(x1 + 120, y - 55, "hold", { rwyId: id, label: name.split("/")[0] });
    const exit1 = this.addNode(x2 - 120, y2 - 55, "hold", { rwyId: id, label: name.split("/")[1] });
    const rwy: Runway = {
      id,
      name,
      ends: [end0, end1],
      headings: [dir, dir + Math.PI],
      thresholdNode: [t0, t1],
      exitNode: [exit0, exit1],
      laneEdges: [lane],
      width: 45,
      exits: [],
      depHold: exit0,
      lineupEdge: -1,
      rolloutEdge: -1,
      activeEnd: 0,
    };
    this.runways.push(rwy);
    return rwy;
  }

  addStand(x: number, y: number, heading: number, classes: string[], opts?: { bridge?: number; label?: string }): StandDef {
    const standNode = this.addNode(x, y, "stand", { heading, capacity: classes[0] as never });
    const sd: StandDef = {
      id: this.stands.length,
      x,
      y,
      heading,
      classes: classes as never,
      node: standNode,
      leadNode: -1,
      serviceNode: -1,
      bridge: opts?.bridge ?? 0,
      label: opts?.label ?? `S${this.stands.length + 1}`,
    };
    this.stands.push(sd);
    return sd;
  }

  /**
   * Connect a stand to the apron with a lead-in lane (aircraft only) and a
   * service node beside the nose (vehicles). Returns the lead node id.
   * Geometry: nose at stand node; lead 28m south of nose on the centerline;
   * service node offset 13m east beside the nose.
   */
  connectStand(stand: StandDef, apronNode: number, offsetX: number): number {
    const lead = this.addNode(stand.x + offsetX, stand.y + 28, "taxiway");
    const svc = this.addNode(stand.x + offsetX + 13, stand.y + 2, "taxiway");
    this.addEdge(apronNode, lead, { kind: "taxiway", maxSpeed: 6 });
    this.addEdge(apronNode, svc, { kind: "taxiway", maxSpeed: 6 });
    this.addEdge(lead, stand.node, { kind: "stand", maxSpeed: 4, standId: stand.id, vehicles: false });
    stand.leadNode = lead;
    stand.serviceNode = svc;
    return lead;
  }
}
