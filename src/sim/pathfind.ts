import type { Network } from "./network";

/**
 * A* over the airport graph. Cost = distance + traffic congestion penalty
 * + fixed penalties for runway crossings and stand lanes, so taxiing
 * aircraft naturally prefer clear, low-classification taxiways.
 */
export function findPath(
  net: Network,
  from: number,
  to: number,
  opts: {
    aircraft?: boolean;
    vehicles?: boolean;
    /** function: (edgeId) => current traffic cost delta */
    trafficCost?: (edgeId: number) => number;
    /** avoid this edge id (used to avoid dead ends after reroutes) */
    avoidEdge?: number;
    maxNodes?: number;
    /** if set, stand edges of OTHER stands are forbidden (only stand edge for `to` allowed) */
    onlyStand?: number;
  } = {}
): number[] | null {
  if (from === to) return [from];
  const o = {
    aircraft: false,
    vehicles: false,
    trafficCost: () => 0,
    ...opts,
  };
  const { nodes } = net;
  const gScore = new Map<number, number>();
  const came = new Map<number, { node: number; edge: number }>();
  const open = new Set<number>([from]);
  gScore.set(from, 0);
  const target = nodes[to];
  const h = (n: number) => {
    const nd = nodes[n];
    const dx = nd.x - target.x;
    const dy = nd.y - target.y;
    return Math.hypot(dx, dy);
  };
  const f = (n: number) => gScore.get(n)! + h(n);
  let visited = 0;
  const maxNodes = o.maxNodes ?? 4000;

  while (open.size > 0) {
    if (++visited > maxNodes) return null;
    let best = -1;
    let bestF = Infinity;
    for (const n of open) {
      const fn = f(n);
      if (fn < bestF) {
        bestF = fn;
        best = n;
      }
    }
    if (best === to) break;
    open.delete(best);
    for (const nb of net.neighbors(best, { aircraft: o.aircraft, vehicles: o.vehicles })) {
      if (o.avoidEdge === nb.edge.id) continue;
      // taxiing traffic never uses runway lanes; only the runway controller does
      if (nb.edge.kind === "runway") continue;
      if (o.onlyStand !== undefined && nb.edge.kind === "stand" && nb.edge.standId !== undefined && nb.edge.standId !== o.onlyStand) continue;
      const cost = nb.edge.length + o.trafficCost(nb.edge.id) + penalty(net, nb.edge, o.aircraft);
      const ng = gScore.get(best)! + cost;
      if (!gScore.has(nb.to) || ng < gScore.get(nb.to)!) {
        gScore.set(nb.to, ng);
        came.set(nb.to, { node: best, edge: nb.edge.id });
        open.add(nb.to);
      }
    }
  }
  if (!came.has(to)) return null;
  const path: number[] = [to];
  let cur = to;
  while (cur !== from) {
    const prev = came.get(cur)!;
    path.unshift(prev.node);
    cur = prev.node;
  }
  return path;
}

function penalty(net: Network, e: { kind: string; rwyId?: number }, aircraft: boolean): number {
  if (e.kind === "runway") return 260; // strong preference to avoid taxiing on runways
  if (e.kind === "stand") return 120;
  return 0;
}

/** nearest node to a world point (bounded search) */
export function nearestNode(net: Network, x: number, y: number, kinds?: string[], maxDist = 60): number | null {
  let best = -1;
  let bd = maxDist * maxDist;
  for (const n of net.nodes) {
    if (kinds && !kinds.includes(n.kind)) continue;
    const dx = n.x - x;
    const dy = n.y - y;
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = n.id;
    }
  }
  return best < 0 ? null : best;
}
