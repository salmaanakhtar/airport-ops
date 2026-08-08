import { World } from "../src/sim/world";

const w = new World(42);
const step = 1 / 30;
function ff(seconds: number) {
  let remaining = seconds;
  let guard = 0;
  while (remaining > 0 && guard++ < seconds * 60) {
    w.tick(step);
    remaining -= step;
  }
}
ff(5);
console.log("after 5s:", w.aircraft.size, [...w.stats.flights.values()].reduce((s, x) => s + x, 0));
ff(200);
console.log("after 205s:", w.aircraft.size, "ops", w.stats.ops, "flights", [...w.stats.flights.values()].reduce((s, x) => s + x, 0));
ff(60);
console.log("after 265s:", w.aircraft.size, "ops", w.stats.ops, "flights", [...w.stats.flights.values()].reduce((s, x) => s + x, 0), [...w.aircraft.values()].map(a => a.phase).join(","));
ff(900);
console.log("after 1165s:", w.aircraft.size, "ops", w.stats.ops, "flights", [...w.stats.flights.values()].reduce((s, x) => s + x, 0), [...w.aircraft.values()].map(a => a.phase).join(","));
console.log("flights map:", JSON.stringify([...w.stats.flights]));
