import { World } from "../src/sim/world";

const w = new World(42);
const step = 1 / 30;
let i = 0;
for (let t = 0; t < 3000; t += step) {
  w.tick(step);
  i++;
  if (i % 300 !== 0) continue;
  const ac = [...w.aircraft.values()][0];
  if (!ac) continue;
  console.log(`t=${t.toFixed(0)} ac=${ac.flight.flightNo}:${ac.phase}@${ac.pos.x.toFixed(0)},${ac.pos.y.toFixed(0)} rwy=${w.rwy.state} n=${w.aircraft.size}`);
}
