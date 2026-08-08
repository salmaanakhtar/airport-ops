import { Network } from "./network";
import type { Runway, StandDef } from "../game/types";

export interface AirportBuilt {
  net: Network;
  runways: Runway[];
  stands: StandDef[];
  /** service depot nodes */
  depots: Record<string, number>;
  /** terminal building rect (world coords) */
  terminal: { x: number; y: number; w: number; h: number };
  beltNode: number;
  plot: { x0: number; y0: number; x1: number; y1: number };
  name: string;
  icao: string;
  level: number;
}

const APRON_Y = -140;
const STAND_NOSE_Y = -205;
const STAND_LEAD_Y = -170;

/**
 * Builds the starter airport: GRAY LAKE REGIONAL (GLR).
 * One 1400m runway 09/27, parallel taxiway A, apron B with 6 stands,
 * small terminal, fuel depot and vehicle depot. Everything is procedural
 * geometry; the player can grow outward from here.
 */
export function buildStarterAirport(): AirportBuilt {
  const net = new Network();
  const rwy0 = net.addRunway(200, 0, 1600, 0, "09/27");

  // --- split runway lane into segments with mid exits ---------------------
  const t0 = rwy0.thresholdNode[0]; // (200,0)
  const t1 = rwy0.thresholdNode[1]; // (1600,0)
  const mid1On = net.addNode(830, 0, "runway", { rwyId: 0 });
  const mid2On = net.addNode(1180, 0, "runway", { rwyId: 0 });
  const e1 = net.addEdge(t0, mid1On, { kind: "runway", maxSpeed: 24, rwyId: 0 });
  const e2 = net.addEdge(mid1On, mid2On, { kind: "runway", maxSpeed: 24, rwyId: 0 });
  const e3 = net.addEdge(mid2On, t1, { kind: "runway", maxSpeed: 24, rwyId: 0 });
  rwy0.laneEdges = [e1, e2, e3];

  // mid exits (diagonal, 45°)
  const off1 = net.addNode(915, -65, "hold", { rwyId: 0, label: "EXIT A" });
  const off2 = net.addNode(1265, -65, "hold", { rwyId: 0, label: "EXIT B" });
  net.addEdge(mid1On, off1, { kind: "taxiway", maxSpeed: 7, rwyId: 0 });
  net.addEdge(mid2On, off2, { kind: "taxiway", maxSpeed: 7, rwyId: 0 });
  rwy0.exits = [
    { s: 630, on: mid1On, off: off1 },
    { s: 980, on: mid2On, off: off2 },
  ];

  // --- parallel taxiway A (y = -65) ---------------------------------------
  const tAx = (x: number) => net.addNode(x, -65, "taxiway");
  const aWest = tAx(280);
  const aMid1 = tAx(915);
  const aMid2 = tAx(1265);
  const aEast = tAx(1520);
  const aBypass = tAx(700);
  const aBypass2 = tAx(1100);
  const A = (a: number, b: number) => net.addEdge(a, b, { kind: "taxiway", maxSpeed: 9 });
  A(aWest, aBypass);
  A(aBypass, aMid1);
  A(aMid1, aBypass2);
  A(aBypass2, aMid2);
  A(aMid2, aEast);

  // connect exits to taxiway A
  net.addEdge(off1, aMid1, { kind: "taxiway", maxSpeed: 7 });
  net.addEdge(off2, aMid2, { kind: "taxiway", maxSpeed: 7 });

  // west connector: taxiway A -> threshold t0 (for departures / landings)
  const westConn = net.addNode(250, -65, "taxiway");
  net.addEdge(westConn, t0, { kind: "taxiway", maxSpeed: 9 });
  // east connector: t1 -> taxiway A east end (past the runway end)
  const eastConn = net.addNode(1640, -65, "taxiway");
  net.addEdge(t1, eastConn, { kind: "taxiway", maxSpeed: 9 });
  A(aEast, eastConn);

  // departure hold + lineup (departures from end0 rolling east).
  // Hold sits north of the threshold so aircraft arrive aligned with the
  // runway axis and line up by rolling straight onto it.
  const depHold = net.addNode(200, -52, "hold", { rwyId: 0, label: "HOLD 09" });
  net.addEdge(depHold, westConn, { kind: "taxiway", maxSpeed: 8 });
  const lineup = net.addEdge(depHold, t0, { kind: "taxiway", maxSpeed: 8, rwyId: 0 });
  rwy0.depHold = depHold;
  rwy0.lineupEdge = lineup;
  rwy0.rolloutEdge = net.addEdge(t1, eastConn, { kind: "taxiway", maxSpeed: 7, rwyId: 0 });
  rwy0.exitNode = [depHold, eastConn];
  rwy0.activeEnd = 0;

  // --- apron B (y = -140) --------------------------------------------------
  const bWest = net.addNode(430, APRON_Y, "taxiway");
  const bEast = net.addNode(1260, APRON_Y, "taxiway");
  const B = (a: number, b: number) => net.addEdge(a, b, { kind: "taxiway", maxSpeed: 8 });
  const apronNodes: number[] = [];
  for (let x = 480; x <= 1220; x += 74) apronNodes.push(net.addNode(x, APRON_Y, "taxiway"));
  B(bWest, apronNodes[0]);
  for (let i = 0; i < apronNodes.length - 1; i++) B(apronNodes[i], apronNodes[i + 1]);
  B(apronNodes[apronNodes.length - 1], bEast);

  // connect apron B to taxiway A (2 stubs + bypass at ends)
  const stub1 = net.addNode(700, -105, "taxiway");
  const stub2 = net.addNode(1100, -105, "taxiway");
  net.addEdge(aBypass, stub1, { kind: "taxiway", maxSpeed: 8 });
  net.addEdge(stub1, apronNodes[2], { kind: "taxiway", maxSpeed: 8 });
  net.addEdge(aBypass2, stub2, { kind: "taxiway", maxSpeed: 8 });
  net.addEdge(stub2, apronNodes[8], { kind: "taxiway", maxSpeed: 8 });
  // direct end connections
  net.addEdge(aWest, bWest, { kind: "taxiway", maxSpeed: 8 });
  net.addEdge(aEast, bEast, { kind: "taxiway", maxSpeed: 8 });

  // --- stands --------------------------------------------------------------
  const stands: StandDef[] = [];
  const standDefs: { x: number; cls: string[]; label: string; bridge: number }[] = [
    { x: 560, cls: ["small", "medium"], label: "A1", bridge: 30 },
    { x: 634, cls: ["small", "medium"], label: "A2", bridge: 30 },
    { x: 708, cls: ["small", "medium", "heavy"], label: "A3", bridge: 30 },
    { x: 1000, cls: ["small", "medium"], label: "B1", bridge: 0 },
    { x: 1074, cls: ["small", "medium"], label: "B2", bridge: 0 },
    { x: 1148, cls: ["small", "medium", "heavy"], label: "B3", bridge: 0 },
  ];
  for (const s of standDefs) {
    const sd = net.addStand(s.x, STAND_NOSE_Y, -Math.PI / 2, s.cls, { bridge: s.bridge, label: s.label });
    stands.push(sd);
  }
  // connect stands to apron nodes
  const apronForStand: number[] = [];
  for (const sd of stands) {
    // find nearest apron node
    let best = 0;
    let bd = 1e9;
    for (const an of apronNodes) {
      const d = Math.abs(net.node(an).x - sd.x);
      if (d < bd) {
        bd = d;
        best = an;
      }
    }
    const lead = net.connectStand(sd, best, 0);
    apronForStand.push(lead);
  }

  // --- depots --------------------------------------------------------------
  const fuelDepot = net.addNode(430, -200, "service", { service: "fuel" });
  const vehicleDepot = net.addNode(1330, -200, "service", { service: "vehicles" });
  net.addEdge(bWest, fuelDepot, { kind: "taxiway", maxSpeed: 7 });
  net.addEdge(bEast, vehicleDepot, { kind: "taxiway", maxSpeed: 7 });

  // --- belt -----------------------------------------------------------------
  const beltNode = net.addNode(880, -128, "service", { service: "belt" });
  net.addEdge(beltNode, apronNodes[4], { kind: "taxiway", maxSpeed: 7 });

  // --- holding bay for aircraft waiting on a stand (off the vehicle routes) ---
  const holdBayA = net.addNode(1330, -65, "taxiway");
  const holdBayB = net.addNode(1410, -65, "taxiway");
  net.addEdge(aMid2, holdBayA, { kind: "taxiway", maxSpeed: 7 });
  net.addEdge(holdBayA, holdBayB, { kind: "taxiway", maxSpeed: 7 });

  const airport: AirportBuilt = {
    net,
    runways: net.runways,
    stands,
    depots: { fuel: fuelDepot, vehicle: vehicleDepot, belt: beltNode },
    terminal: { x: 520, y: -300, w: 430, h: 50 },
    beltNode,
    plot: { x0: 100, y0: -420, x1: 1750, y1: 260 },
    name: "GRAY LAKE REGIONAL",
    icao: "GLR",
    level: 1,
  };
  return airport;
}

/** offsets used by painters for stand geometry */
export const STAND_OFFSETS = {
  noseY: STAND_NOSE_Y,
  leadY: STAND_LEAD_Y,
  apronY: APRON_Y,
};
