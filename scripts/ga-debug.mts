import { World } from "../src/sim/world";

const w = new World(7);
const step = 1 / 30;
const HOUR = 3600;

let lastGA = 0;
const gaLog: string[] = [];
const stuckLog: { t: number; no: string; phase: string; pos: string; path: string; blocked: number }[] = [];

for (let t = 0; t < 5 * HOUR; t += step) {
  w.tick(step);
  if (w.stats.goArounds > lastGA) {
    lastGA = w.stats.goArounds;
    const rwy = w.rwy;
    gaLog.push(
      `t=${(t / 60).toFixed(0)}m GA#${lastGA} rwyState=${rwy.state} holder=${rwy.holder ? rwy.holder.flight.flightNo + "@" + rwy.holder.flight.pos.x.toFixed(0) : "none"} final=[${w.finalApproach
        .map((a) => `${a.flight.flightNo}@${a.flight.pos.x.toFixed(0)}`)
        .join(",")}] depQ=${w.depQueue.length}`
    );
  }
  if (t % 5 < step) {
    for (const a of w.aircraft.values()) {
      if (a.mover.blockedSince > 90 && (a.phase === "taxiIn" || a.phase === "taxiOut")) {
        stuckLog.push({
          t: Math.round(t / 60),
          no: a.flight.flightNo,
          phase: a.phase,
          pos: `${a.pos.x.toFixed(0)},${a.pos.y.toFixed(0)}`,
          path: a.mover.path.join(">"),
          blocked: a.mover.blockedSince,
        });
      }
    }
  }
}

console.log("=== GO-AROUNDS ===");
for (const g of gaLog.slice(0, 40)) console.log(" ", g);
console.log(`total GAs logged: ${gaLog.length}`);
console.log("=== STUCK > 90s ===");
const seen = new Map<string, string[]>();
for (const s of stuckLog) {
  const k = `${s.no}|${s.pos}`;
  if (!seen.has(k)) seen.set(k, []);
  seen.get(k)!.push(`t=${s.t}m ph=${s.phase} path=${s.path} blocked=${s.blocked}`);
}
for (const [k, v] of seen) {
  console.log(` ${k}`);
  for (const l of v.slice(0, 6)) console.log(`    ${l}`);
}
