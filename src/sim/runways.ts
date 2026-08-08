import type { Network } from "./network";
import type { Runway } from "../game/types";
import type { Traffic } from "./traffic";
import type { AircraftSim } from "./aircraft";

/**
 * Runway operations controller. Owns the runway (all lane edges claimed
 * wholesale) and sequences landing vs departure operations.
 *
 * The world decides when to start operations (commit distances, go-arounds,
 * queue priority); the controller just manages the runway ownership state
 * machine and the spacing timer.
 */
export class RunwayController {
  state: "clear" | "landing" | "lineup" | "departure" = "clear";
  holder: AircraftSim | null = null;
  private releaseTimer = 0;

  constructor(
    public rwy: Runway,
    private net: Network,
    private traffic: Traffic
  ) {}

  get busy(): boolean {
    return this.state !== "clear";
  }

  tick(dt: number): void {
    if (this.releaseTimer > 0) this.releaseTimer -= dt;
    // if the holder vanished (abort), free the runway
    if (this.busy && (!this.holder || this.holder.phase === "gone")) {
      this.finishOperation();
    }
  }

  tryStartLanding(ac: AircraftSim): boolean {
    if (this.state !== "clear") return false;
    if (this.releaseTimer > 0) return false;
    if (!this.traffic.claimWhole(this.rwy.laneEdges[0], -1)) return false;
    for (let i = 1; i < this.rwy.laneEdges.length; i++) this.traffic.claimWhole(this.rwy.laneEdges[i], -1);
    this.state = "landing";
    this.holder = ac;
    ac.phase = "landing";
    return true;
  }

  tryStartLineup(ac: AircraftSim): boolean {
    if (this.state !== "clear") return false;
    if (this.releaseTimer > 0) return false;
    if (!this.traffic.claimWhole(this.rwy.laneEdges[0], -1)) return false;
    for (let i = 1; i < this.rwy.laneEdges.length; i++) this.traffic.claimWhole(this.rwy.laneEdges[i], -1);
    this.state = "lineup";
    this.holder = ac;
    return true;
  }

  /** once the holder has rotated and is rolling */
  commitTakeoff(ac: AircraftSim) {
    if (this.holder === ac && this.state === "lineup") this.state = "departure";
  }

  finishOperation() {
    this.state = "clear";
    this.holder = null;
    this.releaseTimer = 3;
    for (const e of this.rwy.laneEdges) this.traffic.releaseWhole(e, -1);
  }
}
