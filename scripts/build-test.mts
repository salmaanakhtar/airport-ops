import { World } from "../src/sim/world";
import { findPath, nearestNode } from "../src/sim/pathfind";

const w = new World(42);
const step = 1 / 30;

// run until an aircraft exists
let ac: any = null;
for (let i = 0; i < 30000; i++) {
  w.tick(step);
  ac = [...w.aircraft.values()].find((a) => a.phase === "turnaround" || a.phase === "taxiIn");
  if (ac) break;
}
if (!ac) {
  console.log("FAIL: no aircraft");
  process.exit(1);
}

// build a new stand via the public build API (the critic's deadlock scenario)
const sd = w.addStandAt(1290, -205, ["small", "medium"], "S7", 0);
if (!sd) {
  console.log("FAIL: addStandAt returned null");
  process.exit(1);
}

// force-assign the aircraft to the new stand
w.standOcc.set(sd.id, ac.flight.id);
ac.targetStand = sd.id;
ac.flight.standId = sd.id;
ac.standNode = sd.node;
ac.standHeading = sd.heading;
ac.standLeadNode = sd.leadNode;
const path = findPath(w.net, nearestNode(w.net, ac.pos.x, ac.pos.y, undefined, 200), sd.node, { aircraft: true, onlyStand: sd.id });
if (!path) {
  console.log("FAIL: no path to new stand");
  process.exit(1);
}
ac.setTaxiPath(path);
ac.flight.phase = "taxiIn";

let settled = false;
let maxBlocked = 0;
for (let i = 0; i < 40000 && !settled; i++) {
  w.tick(step);
  settled = ac.phase === "turnaround";
  maxBlocked = Math.max(maxBlocked, ac.mover.blockedSince);
}

console.log(`pathLen=${path.length} settled=${settled} phase=${ac.phase} blocked=${ac.mover.blockedSince.toFixed(0)}s maxBlocked=${maxBlocked.toFixed(0)}s`);
console.log(settled ? "PASS: player-built stand works end-to-end" : "FAIL: aircraft stuck approaching player-built stand");
