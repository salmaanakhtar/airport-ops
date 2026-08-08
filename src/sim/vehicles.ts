import { Mover } from "./mover";
import type { Network } from "./network";
import type { VehicleState } from "../game/types";

/**
 * Ground vehicle: moves on the same taxiway graph with vehicle priority
 * (yields to aircraft), serves jobs at stands, returns to depot.
 */
export class VehicleSim {
  mover: Mover;
  state: VehicleState;
  /** job progress while working */
  workTimer = 0;
  workTotal = 1;
  /** current leg: driving to job / driving home */
  leg: "idle" | "toJob" | "working" | "toBelt" | "home" = "idle";
  displayHeading = 0;
  atJobNode = false;
  /** baggage offload stage: after belt unload this is true */
  beltStage = false;
  /** current parking target node (for rerouting) */
  parkTarget = -1;

  constructor(
    private net: Network,
    sv: VehicleState,
    maxSpeed: number
  ) {
    this.mover = new Mover(net, { maxSpeed, len: 7, prio: "vehicle" });
    this.mover.id = sv.id;
    this.state = sv;
    const home = net.node(sv.homeNode);
    this.mover.pos = { x: home.x, y: home.y };
    this.state.pos = { ...this.mover.pos };
    this.displayHeading = this.state.heading;
    this.mover.setPath([sv.homeNode]);
    this.state.path = [];
  }

  tick(dt: number): void {
    const s = this.state;
    if (this.leg === "idle") {
      this.mover.speed = 0;
    } else if (this.leg === "working") {
      this.mover.speed = 0;
      this.workTimer += dt;
      if (this.workTimer >= this.workTotal) {
        this.workTimer = 0;
        this.leg = this.state.kind === "baggage" && s.job && s.job.kind === "bagoff" ? "toBelt" : "home";
      }
    } else {
      this.mover.step(dt, this.traffic, this.desiredSpeed());
      this.sync();
      if (this.mover.done) {
        if (this.leg === "toJob") {
          this.leg = "working";
          this.atJobNode = true;
        } else {
          this.leg = "idle";
          this.atJobNode = false;
        }
      }
    }
    // smooth display heading
    let d = this.mover.heading - this.displayHeading;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const rate = 4 * dt;
    if (Math.abs(d) <= rate) this.displayHeading = this.mover.heading;
    else this.displayHeading += Math.sign(d) * rate;
    s.heading = this.displayHeading;
    s.pos = { ...this.mover.pos };
  }

  private sync() {
    this.state.pos = { ...this.mover.pos };
    this.state.heading = this.displayHeading;
  }

  private desiredSpeed(): number {
    return this.state.speed || 8;
  }

  traffic: any = null;

  setTraffic(t: any) {
    this.traffic = t;
  }
}
