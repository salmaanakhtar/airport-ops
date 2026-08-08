import { World } from "../src/sim/world";

const w = new World(7);
const step = 1 / 30;
const lastPhase = new Map<number, string>();
const events: string[] = [];

for (let t = 0; t < 30000; t += step) {
  w.tick(step);
  for (const ac of w.aircraft.values()) {
    const p = ac.phase;
    if (lastPhase.get(ac.flight.id) !== p) {
      lastPhase.set(ac.flight.id, p);
      if (p === "landing" || p === "final" || p === "taxiIn" || ac.goaroundMode !== "none") {
        events.push(`t=${t.toFixed(0)} ${ac.flight.flightNo} ${p}${ac.goaroundMode !== "none" ? " GOAROUND" : ""}`);
      }
    }
  }
}
console.log(events.filter((e) => e.includes("GOAROUND") || e.includes("landing") || e.includes("final")).slice(-50).join("\n"));
console.log("---");
console.log(events.filter((e) => e.includes("GOAROUND")).slice(0, 12).join("\n"));

