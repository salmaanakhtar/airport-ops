import { World } from "../src/sim/world";

const w = new World(7);
const step = 1 / 30;
const HOUR = 3600;

let maxStuck = 0;
let goarounds = 0;
let lastLog = 0;

for (let t = 0; t < 5 * HOUR; t += step) {
  w.tick(step);
  // periodic checks
  if (t - lastLog > 60) {
    lastLog = t;
    for (const a of w.aircraft.values()) {
      if (a.mover.blockedSince > 90 && (a.phase === "taxiIn" || a.phase === "taxiOut")) {
        maxStuck = Math.max(maxStuck, a.mover.blockedSince);
      }
    }
    goarounds = Math.max(goarounds, w.stats.goArounds);
  }
}

const totalFlights = [...w.stats.flights.values()].reduce((s, x) => s + x, 0);
const phases: Record<string, number> = {};
for (const a of w.aircraft.values()) phases[a.phase] = (phases[a.phase] ?? 0) + 1;

console.log(`=== 5h stress (level ${w.level}) ===`);
console.log(`ops=${w.stats.ops} departures=${totalFlights} goarounds=${w.stats.goArounds} OTP=${w.onTimePct.toFixed(0)}% money=${Math.round(w.money)}`);
console.log(`maxStuckBlocked=${maxStuck.toFixed(0)}s liveAircraft=${w.aircraft.size}`);
console.log("phases:", JSON.stringify(phases));
console.log("stands:", w.standCount, "queue:", JSON.stringify(w.queueLengths));
const tacs = [...w.aircraft.values()].filter((a) => a.phase === "turnaround");
for (const a of tacs) {
  const tr = (w as any).turnaround.get(a.flight.id);
  console.log(
    `  TURN ${a.flight.flightNo} age=${a.turnaround.toFixed(0)}s depl=${tr.deplaneDone} brd=${tr.boardDone} boff=${tr.bagoffDone} bon=${tr.bagonDone} fuel=${tr.fuelDone} cat=${tr.caterDone} push=${tr.pushDone}`
  );
}
console.log("vehicles:", w.vehicles.map((v) => `${v.state.kind}${v.state.id}=${v.leg}${v.state.job ? "+" + v.state.job.kind : ""}`).join(" "));
console.log("veh detail:", w.vehicles.map((v) => `${v.state.kind}${v.state.id} done=${v.mover.done} blocked=${v.mover.blockedSince.toFixed(0)}s spd=${v.mover.speed.toFixed(1)} pathLen=${v.mover.path.length} at=${v.mover.pos.x.toFixed(0)},${v.mover.pos.y.toFixed(0)}`).join(" | "));
console.log("taxiIn:", [...w.aircraft.values()].filter((a) => a.phase === "taxiIn").map((a) => `${a.flight.flightNo} at=${a.pos.x.toFixed(0)},${a.pos.y.toFixed(0)} blocked=${a.mover.blockedSince.toFixed(0)}s path=${a.mover.path.map((n) => n).join(">")}`).join(" | "));
const net = w.net;
const edgeA = net.edges.find((e) => {
  const A = net.node(e.a);
  const B = net.node(e.b);
  return Math.hypot(A.x - 560, A.y - -140) < 10 && Math.hypot(B.x - 573, B.y - -203) < 10;
});
if (edgeA) {
  const blocks = (w.traffic as any).blocks.get(edgeA.id) ?? [];
  console.log("apron-svc edge blocks:", blocks.map((b: any) => (b ? `${b.prio}/${b.agent}` : "free")).join(","));
  const svcNode = edgeA.b;
  console.log("svc node owner:", JSON.stringify((w.traffic as any).nodes.get(svcNode)));
}
const v2 = w.vehicles.find((v) => v.state.id === 2);
if (v2) {
  console.log("veh2 path:", v2.mover.path.join(">"));
  const own = [...v2.mover["claimedNodes"]];
  console.log("veh2 claimedNodes:", own.join(","), own.map((n) => JSON.stringify((w.traffic as any).nodes.get(n))).join(" | "));
}
console.log("jobs:", w.jobs.map((j) => `${j.kind}:${j.phase}`).join(" "));
