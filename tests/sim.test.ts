import { describe, it, expect, beforeAll } from "vitest";
import { World } from "../src/sim/world";
import { findPath, nearestNode } from "../src/sim/pathfind";

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

  it("player-built stands are fully functional (regression: unregistered edges deadlocked movers)", () => {
    const w2 = new World(42);
    let ac: any = undefined;
    for (let i = 0; i < 90000 && !ac; i++) {
      w2.tick(1 / 30);
      ac = [...w2.aircraft.values()].find((a) => a.phase === "taxiIn" || a.phase === "turnaround" || a.phase === "pushback");
    }
    expect(ac).toBeDefined();
    const sd = w2.addStandAt(1290, -205, ["small", "medium"], "S7", 0);
    expect(sd).not.toBeNull();
    const startNode = nearestNode(w2.net, ac.pos.x, ac.pos.y, undefined, 400);
    expect(startNode).not.toBeNull();
    w2.standOcc.set(sd!.id, ac.flight.id);
    ac.targetStand = sd!.id;
    ac.flight.standId = sd!.id;
    ac.standNode = sd!.node;
    ac.standHeading = sd!.heading;
    ac.standLeadNode = sd!.leadNode;
    const path = findPath(w2.net, startNode!, sd!.node, { aircraft: true, onlyStand: sd!.id });
    expect(path).not.toBeNull();
    ac.setTaxiPath(path!);
    ac.flight.phase = "taxiIn";
    let settled = false;
    for (let i = 0; i < 40000 && !settled; i++) {
      w2.tick(1 / 30);
      settled = ac.phase === "turnaround";
    }
    expect(settled, "aircraft should reach the player-built stand").toBe(true);
    expect(ac.mover.blockedSince).toBeLessThan(10);
  });

  it("no starvation deadlock: airport keeps processing past 4.5h (regression: unassigned aircraft froze on the taxiway and canEnterFinal closed forever)", () => {
    const w3 = new World(42);
    const step = 1 / 30;
    let guard = 0;
    while (w3.time < 16500 && guard++ < 16500 * 60) w3.tick(step);
    expect(w3.stats.arrivals, "arrivals should keep coming in, not stall at ~53").toBeGreaterThan(60);
    const frozen = [...w3.aircraft.values()].filter((a) => a.phase === "taxiIn" && a.waitingStand && a.targetStand < 0 && a.mover.s < 1);
    expect(frozen.length, "waiting aircraft must keep taxiing to the holding bay, not freeze").toBeLessThan(2);
  });

  it("money is spent on staff but still solvent", () => {
    expect(w.money).toBeGreaterThan(0);
  });
});
