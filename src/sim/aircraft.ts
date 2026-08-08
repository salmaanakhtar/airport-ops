import { Mover } from "./mover";
import type { Network } from "./network";
import type { Flight, Runway, Vec } from "../game/types";
import type { AircraftTypeDef } from "../game/types";
import type { RunwayController } from "./runways";

/**
 * AircraftSim wraps a Flight with locomotion + runway driving.
 * Taxi phases use the Mover (block reservations); approach / landing roll /
 * takeoff roll are driven directly (the runway controller owns the runway).
 * Heading is smoothed so turns at junctions look natural.
 */
export class AircraftSim {
  mover: Mover;
  displayHeading: number;
  phase: Flight["phase"] = "cruise";
  standLeadNode = -1;
  standNode = -1;
  standHeading = -Math.PI / 2;
  targetStand = -1;
  waitingStand = false;
  /** which RunwayController this aircraft uses (set at spawn) */
  rwyIdx = 0;
  private touchdownX = 0;
  private landingSub: "approach" | "roll" | "exit" | "endExit" = "approach";
  private exitTarget: Vec = { x: 0, y: 0 };
  private exitHeading = 0;
  private exitOffNode = -1;
  private turnRate = 1.6;
  private lineupHeading = 0;
  private takeoffSub: "turn" | "roll" | "climb" = "turn";
  private vr = 0;
  /** go-around state */
  goaroundX = -1600;
  goaroundDir = 1;
  goaroundMode: "none" | "hold" | "circle" = "none";
  turnaround = 0;
  arrivalTime = 0;
  /** per-phase stats */
  touchedDown = false;
  pushbackDone = false;
  pushbackStarted = false;

  constructor(
    public flight: Flight,
    private net: Network,
    maxSpeed = 9
  ) {
    this.mover = new Mover(net, { maxSpeed, len: 46, prio: "aircraft" });
    this.mover.id = flight.id + 100000;
    this.displayHeading = flight.heading;
  }

  get pos(): Vec {
    if (this.phase === "taxiIn" || this.phase === "taxiOut" || this.phase === "holding" || this.phase === "docking") {
      return this.mover.pos;
    }
    return this.flight.pos;
  }

  get heading(): number {
    return this.displayHeading;
  }

  get speed(): number {
    if (this.phase === "taxiIn" || this.phase === "taxiOut" || this.phase === "holding" || this.phase === "docking") return this.mover.speed;
    return this.flight.spd;
  }

  setTaxiPath(path: number[]) {
    this.mover.setPath(path);
  }

  /** smooth heading toward target; on-the-spot when stationary */
  private turnToward(target: number, dt: number, speed: number): boolean {
    let d = target - this.displayHeading;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const rate = Math.min(this.turnRate, 0.7 + speed * 0.12);
    if (Math.abs(d) <= rate * dt) {
      this.displayHeading = target;
      return true;
    }
    this.displayHeading += Math.sign(d) * rate * dt;
    return false;
  }

  /** approach: fly toward the threshold on the centerline, accelerating to cruise */
  stepApproach(dt: number, tx: number): boolean {
    this.touchdownX = tx;
    this.phase = "final";
    const f = this.flight;
    f.spd = Math.min(52, f.spd + 2.2 * dt);
    f.pos.x += f.spd * dt;
    f.pos.y += (0 - f.pos.y) * Math.min(1, 2.5 * dt);
    f.heading = 0;
    this.displayHeading = 0;
    return f.pos.x >= tx - 40;
  }

  /** speed control on approach: hold a slower IAS while the runway is busy */
  stepApproachSlow(dt: number, targetSpeed: number): boolean {
    this.phase = "final";
    const f = this.flight;
    f.spd += (targetSpeed - f.spd) * Math.min(1, 0.8 * dt);
    f.pos.x += f.spd * dt;
    f.pos.y += (0 - f.pos.y) * Math.min(1, 2.5 * dt);
    f.heading = 0;
    this.displayHeading = 0;
    return false;
  }

  get isClimbing(): boolean {
    return this.takeoffSub === "climb";
  }

  /**
   * Go around: fly a racetrack west of the field, then rejoin the approach
   * when the runway clears. Returns true when rejoining (heading reset east).
   */
  stepGoaround(dt: number, clear: boolean): boolean {
    this.phase = "final";
    const f = this.flight;
    f.spd = Math.max(40, f.spd - 6 * dt);
    f.pos.x -= this.goaroundDir * f.spd * dt;
    f.heading = this.goaroundDir > 0 ? Math.PI : 0;
    this.displayHeading = f.heading;
    if (this.goaroundDir > 0 && f.pos.x <= this.goaroundX) {
      if (clear) {
        f.pos.x = this.goaroundX;
        f.heading = 0;
        this.displayHeading = 0;
        f.spd = 42;
        return true;
      }
      this.goaroundDir = -1;
      this.goaroundX = -2550;
      return false;
    }
    if (this.goaroundDir < 0 && f.pos.x >= this.goaroundX) {
      if (clear) {
        f.heading = 0;
        this.displayHeading = 0;
        f.spd = 42;
        return true;
      }
      this.goaroundDir = 1;
      this.goaroundX = -1600;
      return false;
    }
    return false;
  }

  /**
   * Landing roll driven by the runway controller.
   * Returns null while rolling, or the off-runway node id to continue taxi.
   */
  stepLanding(dt: number, rwy: Runway): number | null {
    this.phase = "landing";
    const f = this.flight;
    const dbg = (globalThis as any).__dbg;
    if (dbg) dbg(`L ${f.flightNo} sub=${this.landingSub} tx=${this.touchdownX.toFixed(0)} x=${f.pos.x.toFixed(0)} spd=${f.spd.toFixed(1)}`);
    const rolloutOff = this.net.edge(rwy.rolloutEdge).b;
    const endX = rwy.ends[1].x;
    if (this.landingSub === "approach") {
      if (f.pos.x >= this.touchdownX) {
        f.pos.x = this.touchdownX;
        this.landingSub = "roll";
        this.touchedDown = true;
      } else {
        f.pos.x += f.spd * dt;
        f.heading = 0;
        this.displayHeading = 0;
        return null;
      }
    }
    if (this.landingSub === "roll") {
      f.spd = Math.max(0, f.spd - 3.4 * dt);
      f.pos.x += f.spd * dt;
      f.heading = 0;
      this.displayHeading = 0;
      for (const ex of rwy.exits) {
        if (f.pos.x >= ex.s && f.spd <= 10.5) {
          const offN = this.net.node(ex.off);
          this.exitTarget = offN;
          this.exitHeading = Math.atan2(offN.y - f.pos.y, offN.x - f.pos.x);
          this.landingSub = "exit";
          this.exitOffNode = ex.off;
          f.spd = Math.min(f.spd, 9);
          return null;
        }
      }
      if (f.pos.x >= endX) {
        this.landingSub = "endExit";
        f.spd = Math.min(f.spd, 11);
        this.exitTarget = this.net.node(rolloutOff);
        this.exitHeading = Math.atan2(this.exitTarget.y - f.pos.y, this.exitTarget.x - f.pos.x);
        this.exitOffNode = rolloutOff;
      }
      return null;
    }
    // exit turn
    this.turnToward(this.exitHeading, dt, f.spd);
    f.pos.x += Math.cos(this.exitHeading) * f.spd * dt;
    f.pos.y += Math.sin(this.exitHeading) * f.spd * dt;
    const dx = this.exitTarget.x - f.pos.x;
    const dy = this.exitTarget.y - f.pos.y;
    if (Math.hypot(dx, dy) < 1.5) {
      f.pos = { x: this.exitTarget.x, y: this.exitTarget.y };
      return this.exitOffNode;
    }
    return null;
  }

  private isOnRwy = true;

  /** line up: face the roll heading at the threshold */
  beginLineup(controller: RunwayController) {
    this.phase = "takeoff";
    this.takeoffSub = "turn";
    const f = this.flight;
    f.pos = { ...this.net.node(controller.rwy.thresholdNode[0]) };
    this.lineupHeading = controller.rwy.headings[controller.rwy.activeEnd];
    f.spd = 0;
    this.vr = 0;
  }

  stepTakeoff(dt: number, controller: RunwayController): boolean {
    const rwy = controller.rwy;
    const f = this.flight;
    const h = rwy.headings[rwy.activeEnd];
    if (this.takeoffSub === "turn") {
      if (this.turnToward(h, dt, 0)) {
        this.takeoffSub = "roll";
        controller.commitTakeoff(this);
      }
      return false;
    }
    if (this.takeoffSub === "roll") {
      const endX = rwy.ends[1].x;
      f.spd += (2.4 + f.spd * 0.02) * dt;
      f.pos.x += Math.cos(h) * f.spd * dt;
      f.pos.y += Math.sin(h) * f.spd * dt;
      f.heading = h;
      this.displayHeading = h;
      if (this.vr === 0 && f.pos.x - rwy.ends[0].x > 0.45 * (endX - rwy.ends[0].x)) this.vr = f.spd;
      if (f.pos.x >= endX + 220) {
        this.takeoffSub = "climb";
        this.isOnRwy = false;
      }
      return false;
    }
    f.pos.x += 72 * dt;
    f.pos.y += Math.sin(h) * 72 * dt;
    f.spd = 72;
    return f.pos.x > rwy.ends[1].x + 900;
  }

  /** pushback: move backward (south) from stand node to lead node */
  stepPushback(dt: number): boolean {
    this.phase = "pushback";
    const f = this.flight;
    const lead = this.net.node(this.standLeadNode);
    const speed = 1.9;
    const dx = lead.x - f.pos.x;
    const dy = lead.y - f.pos.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.5) {
      f.pos = { x: lead.x, y: lead.y };
      this.pushbackDone = true;
      return true;
    }
    f.pos.x += (dx / d) * speed * dt;
    f.pos.y += (dy / d) * speed * dt;
    this.displayHeading = this.standHeading;
    return false;
  }

  settleAtStand() {
    this.phase = "turnaround";
    this.flight.pos = { ...this.net.node(this.standNode) };
    this.flight.heading = this.standHeading;
    this.displayHeading = this.standHeading;
    this.mover.speed = 0;
    this.arrivalTime = 0;
  }

  get acType(): AircraftTypeDef {
    return this.flight.acTypeDef;
  }
}
