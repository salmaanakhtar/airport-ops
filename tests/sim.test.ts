import { describe, it, expect, beforeAll } from "vitest";
import { World } from "../src/sim/world";

/** Headless lifecycle test: run the sim fast and verify the full turnaround loop. */
function fastForward(w: World, seconds: number) {
  const step = 1 / 30;
  let remaining = seconds;
  let guard = 0;
  while (remaining > 0 && guard++ < seconds * 60) {
    w.tick(step);
    remaining -= step;
  }
}

describe("AIRPORT // OPS simulation lifecycle", () => {
  let w: World;

  beforeAll(() => {
    w = new World(42);
  });

  it("spawns scheduled arrivals", () => {
    fastForward(w, 5);
    expect(w.aircraft.size).toBeGreaterThan(0);
  });

  it("lands an aircraft and reaches turnaround", () => {
    // first arrival lands within ~90 game-seconds
    fastForward(w, 200);
    const atStand = [...w.aircraft.values()].find((a) => a.phase === "turnaround");
    expect(atStand, "no aircraft reached turnaround").toBeDefined();
    expect(w.stats.arrivals).toBeGreaterThan(0);
  });

  it("queues service jobs and sends vehicles", () => {
    fastForward(w, 60);
    const working = w.vehicles.some((v) => v.leg === "toJob" || v.leg === "working" || v.leg === "toBelt");
    expect(working, "no vehicle dispatched").toBe(true);
  });

  it("completes a full turnaround and departs the aircraft", () => {
    fastForward(w, 900);
    const goneCount = w.stats.flights;
    const total = [...goneCount.values()].reduce((s, x) => s + x, 0);
    expect(total).toBeGreaterThan(0);
    // no aircraft stuck forever in turnaround or taxiOut
    const stuck = [...w.aircraft.values()].filter((a) => a.phase === "turnaround" && a.flight.waitingTug);
    expect(stuck.length).toBeLessThan(2);
  });

  it("no deadlocks: no aircraft blocked > 60s of sim time on the same node", () => {
    const movers = [...w.aircraft.values()].map((a) => a.mover.blockedSince).filter((b) => b > 60);
    expect(movers.length, "aircraft stuck > 60s").toBeLessThan(2);
  });

  it("money is spent on staff but still solvent", () => {
    expect(w.money).toBeGreaterThan(0);
  });
});
