import { Network } from "./network";
import { Traffic } from "./traffic";
import { buildStarterAirport, type AirportBuilt } from "./airport";
import { RunwayController } from "./runways";
import { AircraftSim } from "./aircraft";
import { VehicleSim } from "./vehicles";
import { findPath, nearestNode } from "./pathfind";
import { Scheduler } from "./schedule";
import { Rng } from "../game/rng";
import { AIRLINES, AC_BY_CODE, ECO, VEHICLE_BY_KIND, SIM } from "../game/config";
import type {
  Flight,
  PassengerBatch,
  ScheduleEntry,
  ServiceJob,
  StandDef,
  VehicleState,
} from "../game/types";

interface TurnaroundState {
  deplaneDone: boolean;
  boardDone: boolean;
  bagoffDone: boolean;
  bagonDone: boolean;
  fuelDone: boolean;
  caterDone: boolean;
  pushDone: boolean;
  depPax: number;
  arrBatch?: PassengerBatch;
  depBatch?: PassengerBatch;
  turnTime: number;
}

export interface WorldStats {
  ops: number;
  arrivals: number;
  departures: number;
  onTime: number;
  pax: number;
  goArounds: number;
  avgDelay: number;
  sat: number;
  staff: number;
  flights: Map<string, number>;
}

export interface LogEntry {
  time: number;
  text: string;
  kind: "info" | "warn" | "bad" | "good";
}

export class World {
  net: Network;
  traffic: Traffic;
  airport: AirportBuilt;
  rwys: RunwayController[] = [];
  aircraft = new Map<number, AircraftSim>();
  vehicles: VehicleSim[] = [];
  jobs: ServiceJob[] = [];
  paxBatches: PassengerBatch[] = [];
  logs: LogEntry[] = [];
  time = 0;
  money = ECO.baseCapital;
  stats: WorldStats = { ops: 0, arrivals: 0, departures: 0, onTime: 0, pax: 0, goArounds: 0, avgDelay: 0, sat: 0.85, staff: 0, flights: new Map() };
  level = 1;
  rng: Rng;
  paused = false;
  private scheduler: Scheduler;
  private schedQueue: ScheduleEntry[] = [];
  private jobId = 1;
  private vehicleId = 1;
  private standOcc = new Map<number, number>();
  private turnaround = new Map<number, TurnaroundState>();
  private finals: AircraftSim[][] = [];
  private depQueues: AircraftSim[][] = [];
  private depReleased: boolean[] = [];
  private depClimb: (AircraftSim | null)[] = [];
  private nextRwy = 0;
  get rwy(): RunwayController {
    return this.rwys[0];
  }
  private goarounds = 0;
  private satAccum = 0;
  private satCount = 0;
  private queueSpawnDelay = 0;
  private buildLock = false;
  private lastOpTime = 0;
  /** nearest apron node for parking when no stand is free */
  private apronPark: number[] = [];

  constructor(seed = 42) {
    this.rng = new Rng(seed);
    this.airport = buildStarterAirport();
    this.net = this.airport.net;
    this.traffic = new Traffic(this.net);
    this.rwys = [new RunwayController(this.net.runways[0], this.net, this.traffic)];
    this.finals = this.rwys.map(() => []);
    this.depQueues = this.rwys.map(() => []);
    this.depReleased = this.rwys.map(() => true);
    this.depClimb = this.rwys.map(() => null);
    this.scheduler = new Scheduler(seed + 1);
    // pre-generate schedule
    this.topUpSchedule();
    this.spawnVehicles();
    // apron park nodes: collect apron taxiway nodes
    for (const n of this.net.nodes) if (n.kind === "taxiway" && n.y === -140) this.apronPark.push(n.id);
  }

  get flightCount(): number {
    return this.aircraft.size;
  }

  get standCount(): number {
    return this.airport.stands.length;
  }

  private topUpSchedule() {
    if (this.schedQueue.length < 16) {
      // only generate entries strictly AFTER the queue's last entry, otherwise
      // overlapping windows double the arrival rate in bursts
      const last = this.schedQueue[this.schedQueue.length - 1];
      const from = last ? last.time + 60 : this.time;
      const more = this.scheduler.generate(from, 7200, this.level);
      this.schedQueue.push(...more);
      this.schedQueue.sort((a, b) => a.time - b.time);
    }
  }

  private spawnVehicles() {
    const vehDefs = [
      { kind: "fuel", n: 2 },
      { kind: "baggage", n: 3 },
      { kind: "catering", n: 1 },
      { kind: "push", n: 2 },
    ] as const;
    for (const vd of vehDefs) {
      for (let i = 0; i < vd.n; i++) this.spawnVehicle(vd.kind);
    }
  }

  /** construct one ground vehicle of the given kind and park it at its depot */
  private spawnVehicle(kind: string): VehicleSim | null {
    if (!VEHICLE_BY_KIND.has(kind)) return null;
    const vid = this.vehicleId++;
    const home = kind === "fuel" ? this.airport.depots.fuel : this.airport.depots.vehicle;
    const sv: VehicleState = {
      id: vid,
      kind: kind as VehicleState["kind"],
      label: `${kind}-${this.vehicles.filter((v) => v.state.kind === kind).length + 1}`,
      path: [],
      progress: 0,
      pos: { ...this.net.node(home) },
      heading: 0,
      job: null,
      homeNode: home,
      speed: 8,
      carts: kind === "baggage" ? 2 : 0,
      loading: 0,
      retrying: false,
    };
    const v = new VehicleSim(this.net, sv, kind === "baggage" ? 9 : 8);
    v.setTraffic(this.traffic);
    this.vehicles.push(v);
    return v;
  }

  /** purchase a new ground vehicle; returns false if unaffordable */
  buyVehicle(kind: string): boolean {
    if (this.money < ECO.vehicleCost) return false;
    if (!this.spawnVehicle(kind)) return false;
    this.money -= ECO.vehicleCost;
    this.log(`Purchased ${VEHICLE_BY_KIND.get(kind)?.label ?? kind}`, "good");
    return true;
  }

  vehicleCount(kind: string): number {
    return this.vehicles.filter((v) => v.state.kind === kind).length;
  }

  // ------------------------------------------------------------------ main

  tick(dt: number) {
    if (this.paused) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.topUpSchedule();
    this.spawnFromSchedule();
    this.updateLevel();

    // economy: staff cost
    this.money -= (ECO.staffDaily / 1440) * dt * this.staffCostMult();

    // --- aircraft ---------------------------------------------------------
    for (const ac of [...this.aircraft.values()]) {
      this.stepAircraft(ac, dt);
    }
    // remove gone
    for (const [id, ac] of [...this.aircraft]) {
      if (ac.phase === "gone") {
        this.aircraft.delete(id);
        this.finalizeGone(ac);
      }
    }

    // --- runway ops ---------------------------------------------------------
    this.stepRunway(dt);

    // --- turnaround & jobs --------------------------------------------------
    for (const ac of this.aircraft.values()) {
      if (ac.phase === "turnaround") this.stepTurnaround(ac, dt);
      if (ac.phase === "pushback") {
        if (ac.stepPushback(dt)) {
          const tr = this.turnaround.get(ac.flight.id)!;
          tr.pushDone = true;
          this.beginTaxiOut(ac);
        }
      }
    }
    this.stepVehicles(dt);
    this.stepPax(dt);
    this.pruneJobs();
  }

  private staffCostMult(): number {
    return 0.6 + this.standCount * 0.12;
  }

  // ------------------------------------------------------------------ spawn

  private spawnFromSchedule() {
    while (this.schedQueue.length > 0 && this.schedQueue[0].time - 70 <= this.time) {
      const e = this.schedQueue.shift()!;
      this.spawnArrival(e);
    }
  }

  private spawnArrival(e: ScheduleEntry) {
    const def = AC_BY_CODE.get(e.acType);
    if (!def) return;
    const airline = AIRLINES[e.airlineIdx] ?? AIRLINES[0];
    const id = this.scheduler.nextFlightId();
    // round-robin across runways so a second runway actually carries traffic
    const rwyIdx = this.nextRwy++ % this.rwys.length;
    const rwy = this.rwys[rwyIdx].rwy;
    const flight: Flight = {
      id,
      airline: airline.icao,
      flightNo: this.scheduler.flightNo(airline.icao),
      acType: def.code,
      acTypeDef: def,
      dir: "arr",
      schedTime: e.time,
      spawnTime: e.time - 70,
      origin: e.from,
      dest: "GLR",
      pax: e.pax,
      depPax: 0,
      bags: Math.round(e.pax * 0.85),
      rwyEnd: rwyIdx,
      phase: "cruise",
      delay: 0,
      progress: 0,
      phaseStart: 0,
      fuelNeed: 0,
      fuelKg: 0,
      airlineIdx: e.airlineIdx,
      spd: 0,
      pos: { x: rwy.ends[0].x - 2200, y: rwy.ends[0].y },
      heading: 0,
      path: [],
      pathProgress: 0,
      destNode: -1,
      waitingTug: false,
      waitedFuel: 0,
      waitedCatering: 0,
      waitedBag: 0,
      boardingDone: false,
      deplaned: false,
      aborted: false,
    };
    const ac = new AircraftSim(flight, this.net, 9);
    ac.rwyIdx = rwyIdx;
    ac.goaroundX = rwy.ends[0].x - 1750;
    this.aircraft.set(flight.id, ac);
  }

  // ------------------------------------------------------------------ sim

  private stepAircraft(ac: AircraftSim, dt: number) {
    const f = ac.flight;
    switch (ac.phase) {
      case "cruise": {
        if (this.time >= f.spawnTime + 18 && this.canEnterFinal()) {
          ac.phase = "final";
          f.phaseStart = this.time;
          this.finals[ac.rwyIdx].push(ac);
          f.spd = 40;
        }
        break;
      }
      case "final": {
        const c = this.rwys[ac.rwyIdx];
        const tx = c.rwy.ends[0].x + 420;
        const busy = c.busy;
        const dist = c.rwy.ends[0].x - f.pos.x;
        // go around EARLY (1400m out) instead of crawling to the threshold:
        // the racetrack west of the field is the holding stack
        if (busy && dist < 1400) {
          if (ac.goaroundMode === "none") {
            this.stats.goArounds++;
            this.log("Go-around: " + f.flightNo + " rejected for runway congestion", "warn");
            ac.goaroundMode = "hold";
          }
          ac.stepGoaround(dt, false);
        } else if (ac.goaroundMode !== "none") {
          const rejoin = ac.stepGoaround(dt, !busy);
          if (rejoin) ac.goaroundMode = "none";
        } else if (busy) {
          // vector for spacing: slow down instead of flying go-arounds
          ac.stepApproachSlow(dt, 30);
        } else {
          ac.stepApproach(dt, tx);
        }
        break;
      }
      case "landing": {
        // driven by runway step
        break;
      }
      case "taxiIn": {
        // Holding-bay aircraft (no stand yet) must still drive their park
        // path. Freezing every unassigned aircraft on the taxiway strands
        // them (mover.done never fires, so the re-assignment branch below is
        // unreachable), waitingStand never drains, and canEnterFinal stays
        // closed forever -> the airport starves.
        if (ac.mover.path.length < 2) {
          // no path yet: hold at current node
          ac.mover.speed = 0;
          break;
        }
        const blocked = ac.mover.step(dt, this.traffic, 8);
        if (blocked && ac.mover.blockedSince > 12) {
          const stand = this.airport.stands[ac.targetStand];
          if (stand) {
            this.rerouteAircraft(ac, stand.node);
          } else {
            const park = ac.mover.path[ac.mover.path.length - 1];
            if (park !== undefined) this.rerouteAircraft(ac, park);
          }
        }
        if (ac.mover.done) {
          if (this.isAtStand(ac)) {
            this.settle(ac);
          } else if (ac.waitingStand) {
            const stand = this.assignStand(ac);
            if (stand) this.pathToStand(ac, stand);
          }
        }
        break;
      }
      case "taxiOut": {
        const blocked = ac.mover.step(dt, this.traffic, 8);
        if (blocked && ac.mover.blockedSince > 12) this.rerouteAircraft(ac, this.rwys[ac.rwyIdx].rwy.depHold);
        if (ac.mover.done && ac.phase === "taxiOut") {
          ac.phase = "holding";
          this.depQueues[ac.rwyIdx].push(ac);
        }
        break;
      }
      case "holding": {
        ac.mover.speed = 0;
        break;
      }
    }
  }

  private canEnterFinal(): boolean {
    // don't stack approaches too close behind each other, and don't let the
    // stand-holding queue explode (the holding bay is small).
    // Spacing is measured from ACTUAL final entry (not scheduled spawn time)
    // and must cover the full runway cycle, otherwise the trailer reaches the
    // threshold while the runway is still busy and is forced into a go-around.
    let total = 0;
    for (const q of this.finals) {
      const last = q[q.length - 1];
      if (last && this.time - last.flight.phaseStart < 60) return false;
      total += q.length;
    }
    if (total >= 3 * this.finals.length) return false;
    let waiting = 0;
    for (const ac of this.aircraft.values()) if (ac.waitingStand) waiting++;
    return waiting < 3;
  }

  private isAtStand(ac: AircraftSim): boolean {
    return ac.standLeadNode >= 0 && ac.targetStand >= 0;
  }

  private stepRunway(dt: number) {
    for (let ri = 0; ri < this.rwys.length; ri++) {
      const c = this.rwys[ri];
      this.stepOneRunway(c, ri, dt);
    }
  }

  private stepOneRunway(c: RunwayController, ri: number, dt: number) {
    const finals = this.finals[ri];
    const depQ = this.depQueues[ri];
    c.tick(dt);
    if (c.state === "landing" && c.holder) {
      const off = c.holder.stepLanding(dt, c.rwy);
      if (off != null && off >= 0) {
        const ac = c.holder;
        const stand = this.assignStand(ac);
        if (stand) {
          this.pathToStand(ac, stand);
        } else {
          // hold on apron until a stand frees
          ac.waitingStand = true;
          this.pathToPark(ac);
        }
        c.finishOperation();
        // arrival revenue + stats
        const f = ac.flight;
        const delay = Math.max(0, this.time - f.schedTime);
        f.delay = delay;
        if (delay > 30) this.log(`${f.flightNo} arrived ${fmtDelay(delay)} late`, "bad");
        const sat = this.satForDelay(delay);
        this.money += f.pax * (ECO.landFeePerPax + ECO.terminalRevenuePerPax) * (0.5 + 0.5 * sat);
        this.stats.pax += f.pax;
        this.accrueSat(sat);
        this.stats.arrivals++;
      }
    } else if (c.state === "lineup" && c.holder) {
      const ac = c.holder;
      if (ac.mover.path.length < 2) {
        ac.setTaxiPath([c.rwy.depHold, c.rwy.thresholdNode[0]]);
      }
      ac.mover.step(dt, this.traffic, 5);
      if (ac.mover.done) {
        ac.beginLineup(c);
        // the threshold turn happens on the runway: advance to the takeoff roll
        c.commitTakeoff(ac);
      }
    } else if (c.state === "departure" && c.holder) {
      const ac = c.holder;
      if (ac.stepTakeoff(dt, c)) {
        ac.phase = "gone";
        if (!this.depReleased[ri]) c.finishOperation();
      } else if (ac.isClimbing && !this.depReleased[ri]) {
        // airborne over the far end: runway is free for the next op
        this.depReleased[ri] = true;
        this.depClimb[ri] = ac;
        c.finishOperation();
      }
    } else if (c.state === "clear" && this.depClimb[ri]) {
      // keep driving the climb-out visual until it leaves the field
      if (this.depClimb[ri]!.stepTakeoff(dt, c)) {
        this.depClimb[ri]!.phase = "gone";
        this.depClimb[ri] = null;
      }
    } else if (c.state === "clear") {
      // decide next operation
      const closest = this.closestFinalDist(ri);
      if (closest < 1200) {
        const ac = this.nextLandingCandidate(ri);
        if (ac && c.tryStartLanding(ac)) {
          finals.splice(finals.indexOf(ac), 1);
        }
      } else if (depQ.length > 0 && closest > 3200) {
        const ac = depQ[0];
        if (c.tryStartLineup(ac)) {
          depQ.shift();
          ac.phase = "takeoff";
          this.depReleased[ri] = false;
        }
      }
    }
  }

  private closestFinalDist(ri: number): number {
    let best = Infinity;
    const t = this.rwys[ri].rwy.ends[0].x;
    for (const ac of this.finals[ri]) {
      if (ac.goaroundMode !== "none") continue;
      const d = t - ac.flight.pos.x;
      if (d < best) best = d;
    }
    return best;
  }

  private nextLandingCandidate(ri: number): AircraftSim | null {
    let best: AircraftSim | null = null;
    let bd = Infinity;
    const t = this.rwys[ri].rwy.ends[0].x;
    for (const ac of this.finals[ri]) {
      if (ac.goaroundMode !== "none" || ac.phase !== "final") continue;
      const d = t - ac.flight.pos.x;
      if (d < bd) {
        bd = d;
        best = ac;
      }
    }
    return best;
  }

  private assignStand(ac: AircraftSim): StandDef | null {
    const cls = ac.acType.cls;
    for (const s of this.airport.stands) {
      if (this.standOcc.has(s.id)) continue;
      if (s.classes.includes(cls)) {
        this.standOcc.set(s.id, ac.flight.id);
        ac.targetStand = s.id;
        ac.flight.standId = s.id;
        ac.standNode = s.node;
        ac.standHeading = s.heading;
        ac.standLeadNode = s.leadNode;
        return s;
      }
    }
    return null;
  }

  private pathToStand(ac: AircraftSim, stand: StandDef) {
    const path = findPath(this.net, nearestNode(this.net, ac.pos.x, ac.pos.y, undefined, 100) ?? this.startNode(ac), stand.node, {
      aircraft: true,
      onlyStand: stand.id,
    });
    if (path) {
      ac.setTaxiPath(path);
      ac.waitingStand = false;
      ac.phase = "taxiIn";
    }
  }

  private pathToPark(ac: AircraftSim) {
    const start = nearestNode(this.net, ac.pos.x, ac.pos.y, undefined, 100) ?? this.startNode(ac);
    const park = this.pickParkNode();
    const path = findPath(this.net, start, park, { aircraft: true });
    if (path) {
      ac.setTaxiPath(path);
      ac.phase = "taxiIn";
    }
  }

  private pickParkNode(): number {
    // dedicated holding bay on taxiway A east of the apron (off vehicle routes)
    const bay = this.net.nodes.filter((n) => n.kind === "taxiway" && n.y === -65 && n.x > 1300);
    const cands = bay.length > 0 ? bay.map((n) => n.id) : this.apronPark;
    let best = cands[0];
    let bestCount = Infinity;
    for (const n of cands) {
      let count = 0;
      for (const ac of this.aircraft.values()) {
        if (Math.hypot(ac.pos.x - this.net.node(n).x, ac.pos.y - this.net.node(n).y) < 40) count++;
      }
      if (count < bestCount) {
        bestCount = count;
        best = n;
      }
    }
    return best;
  }

  private startNode(ac: AircraftSim): number {
    return nearestNode(this.net, ac.pos.x, ac.pos.y, undefined, 200) ?? 0;
  }

  private settle(ac: AircraftSim) {
    ac.settleAtStand();
    ac.pushbackStarted = false;
    ac.pushbackDone = false;
    const f = ac.flight;
    // fuel need
    f.fuelNeed = f.acTypeDef.cls === "small" ? 0.35 : 0.5;
    f.fuelKg = Math.round(f.fuelNeed * f.acTypeDef.mtoW * 1000 * 0.21);
    const tr: TurnaroundState = {
      deplaneDone: false,
      boardDone: false,
      bagoffDone: false,
      bagonDone: false,
      fuelDone: f.fuelKg === 0,
      caterDone: false,
      pushDone: false,
      depPax: Math.min(f.acTypeDef.seats, Math.round(f.acTypeDef.seats * (0.5 + this.level * 0.07) * this.rng.range(0.9, 1.1))),
      turnTime: 0,
    };
    this.turnaround.set(f.id, tr);
    // arrival passenger batch
    const arrBatch: PassengerBatch = {
      id: this.jobId++,
      flightId: f.id,
      dir: "arr",
      count: f.pax,
      progress: 0,
      done: false,
      satisfaction: 1,
    };
    this.paxBatches.push(arrBatch);
    tr.arrBatch = arrBatch;
    // queue jobs
    const svc = this.airport.stands[ac.targetStand]?.serviceNode ?? ac.standLeadNode;
    this.queueJob("bagoff", f.id, svc);
    if (f.fuelKg > 0) this.queueJob("fuel", f.id, svc);
    this.queueJob("catering", f.id, svc);
  }

  private queueJob(kind: ServiceJob["kind"], flightId: number, targetNode: number) {
    const job: ServiceJob = {
      id: this.jobId++,
      kind,
      flightId,
      standId: this.aircraft.get(flightId)?.targetStand ?? -1,
      done: false,
      started: false,
      phase: "queued",
      targetNode,
    };
    this.jobs.push(job);
  }

  private stepTurnaround(ac: AircraftSim, dt: number) {
    const tr = this.turnaround.get(ac.flight.id);
    if (!tr) return;
    tr.turnTime += dt;
    const f = ac.flight;
    const svc = this.airport.stands[ac.targetStand]?.serviceNode ?? ac.standLeadNode;
    // deplane
    if (!tr.deplaneDone && tr.arrBatch) {
      const rate = 1 / Math.max(2, (f.pax / f.acTypeDef.paxPerMin) * 0.8);
      tr.arrBatch.progress += rate * dt;
      if (tr.arrBatch.progress >= 1) {
        tr.arrBatch.done = true;
        tr.deplaneDone = true;
        f.deplaned = true;
        // start boarding + bagon once deplaned and bagoff done
        tr.depPax = Math.max(tr.depPax, 10);
        const depBatch: PassengerBatch = {
          id: this.jobId++,
          flightId: f.id,
          dir: "dep",
          count: tr.depPax,
          progress: 0,
          done: false,
          satisfaction: 1,
        };
        this.paxBatches.push(depBatch);
        tr.depBatch = depBatch;
        this.queueJob("bagon", f.id, svc);
      }
    }
    // boarding
    if (tr.deplaneDone && !tr.boardDone && tr.depBatch) {
      const rate = 1 / Math.max(2, (tr.depPax / f.acTypeDef.paxPerMin) * 0.8);
      tr.depBatch.progress += rate * dt;
      if (tr.depBatch.progress >= 1) {
        tr.depBatch.done = true;
        tr.boardDone = true;
        f.boardingDone = true;
      }
    }
    // pushback ready?
    if (!tr.pushDone && tr.deplaneDone && tr.boardDone && tr.bagoffDone && tr.bagonDone && tr.fuelDone && tr.caterDone) {
      this.queueJob("push", f.id, svc);
      tr.pushDone = true; // job queued; world waits for tug arrival
      ac.flight.waitingTug = true;
    }
  }

  private beginTaxiOut(ac: AircraftSim) {
    const f = ac.flight;
    ac.phase = "taxiOut";
    const depDelay = Math.max(0, this.time - (f.schedTime + f.acTypeDef.turnMin * 60));
    f.delay = depDelay;
    const sat = this.satForDelay(depDelay);
    this.accrueSat(sat);
    this.stats.departures++;
    this.stats.onTime += depDelay <= 900 ? 1 : 0;
    if (depDelay > 900) this.log(`${f.flightNo} departed ${fmtDelay(depDelay)} late`, "bad");
    // departure revenue
    const tr = this.turnaround.get(f.id)!;
    const fuelProfit = f.fuelKg * (ECO.fuelPerKg - ECO.fuelCostPerKg);
    this.money += tr.depPax * (ECO.depFeePerPax + ECO.terminalRevenuePerPax) * (0.5 + 0.5 * sat) + fuelProfit;
    const path = findPath(this.net, ac.standLeadNode, this.rwys[ac.rwyIdx].rwy.depHold, { aircraft: true });
    if (path) ac.setTaxiPath(path);
    // release stand
    this.standOcc.delete(ac.targetStand);
    f.standId = -1;
  }

  private finalizeGone(ac: AircraftSim) {
    const f = ac.flight;
    this.turnaround.delete(f.id);
    const key = f.airline;
    this.stats.flights.set(key, (this.stats.flights.get(key) ?? 0) + 1);
  }

  // ------------------------------------------------------------------ jobs

  private stepVehicles(dt: number) {
    for (const v of this.vehicles) {
      const sv = v.state;
      if (sv.job && sv.job.done && v.leg !== "toBelt") {
        sv.job = null;
        v.leg = "home";
        v.atJobNode = false;
        this.parkVehicle(v);
      }
      if (v.leg === "idle") {
        const job = this.findJobFor(v);
        if (job) {
          sv.job = job;
          job.phase = "driving";
          const from = nearestNode(this.net, v.mover.pos.x, v.mover.pos.y, undefined, 120) ?? sv.homeNode;
          const path = findPath(this.net, from, job.targetNode, { vehicles: true });
          if (path) {
            v.mover.setPath(path);
            v.leg = "toJob";
          } else {
            job.phase = "queued";
            sv.job = null;
            sv.retrying = true;
          }
        }
      } else if (v.leg === "toJob") {
        const blocked = v.mover.step(dt, this.traffic, sv.speed || 8);
        if (blocked && v.mover.blockedSince > 8) this.rerouteVehicle(v, jobTarget(v));
        if (v.mover.done) {
          v.leg = "working";
          v.workTimer = 0;
          v.workTotal = this.workTotalFor(v);
        }
      } else if (v.leg === "working") {
        if (sv.job && sv.job.kind === "push") {
          // pushback is driven by the aircraft; tug waits at the service node
          v.workTimer += dt;
          const ac = this.aircraft.get(sv.job.flightId);
          if (ac && ac.phase === "turnaround" && ac.flight.waitingTug && !ac.pushbackStarted) {
            ac.phase = "pushback";
            ac.pushbackStarted = true;
          }
          if (ac && ac.pushbackDone) {
            sv.job.done = true;
            sv.job.phase = "done";
          }
          continue;
        }
        v.workTimer += dt;
        if (v.workTimer >= v.workTotal) {
          if (sv.job && sv.job.kind === "bagoff" && !v.beltStage) {
            v.beltStage = true;
            const tr = this.turnaround.get(sv.job.flightId);
            if (tr) tr.bagoffDone = true;
            v.leg = "toBelt";
            const from = nearestNode(this.net, v.mover.pos.x, v.mover.pos.y, undefined, 120) ?? sv.job.targetNode;
            const bp = findPath(this.net, from, this.airport.beltNode, { vehicles: true });
            if (bp) v.mover.setPath(bp);
          } else {
            this.completeJob(v);
          }
        }
      } else if (v.leg === "toBelt") {
        const blocked = v.mover.step(dt, this.traffic, sv.speed || 8);
        if (blocked && v.mover.blockedSince > 8) this.rerouteVehicle(v, this.airport.beltNode);
        if (v.mover.done) {
          v.leg = "working";
          v.workTimer = 0;
          v.workTotal = 3;
        }
      } else if (v.leg === "home") {
        const blocked = v.mover.step(dt, this.traffic, sv.speed || 8);
        if (blocked && v.mover.blockedSince > 8) this.rerouteVehicle(v, v.parkTarget);
        if (v.mover.done) {
          v.leg = "idle";
        }
      }
    }
  }

  private findJobFor(v: VehicleSim): ServiceJob | null {
    const kind = v.state.kind;
    const accept: ServiceJob["kind"][] =
      kind === "fuel" ? ["fuel"] : kind === "catering" ? ["catering"] : kind === "baggage" ? ["bagoff", "bagon"] : kind === "push" ? ["push"] : [];
    for (const j of this.jobs) {
      if (j.done || j.phase !== "queued") continue;
      if (accept.includes(j.kind)) return j;
    }
    return null;
  }

  private workTotalFor(v: VehicleSim): number {
    const j = v.state.job!;
    const f = this.aircraft.get(j.flightId);
    switch (j.kind) {
      case "fuel":
        return f ? Math.max(3, f.flight.fuelKg / 180) : 5;
      case "catering":
        return 10;
      case "bagoff":
      case "bagon":
        return f ? Math.max(2, (f.flight.bags ?? 20) / 24) : 4;
      case "push":
        return 5;
      default:
        return 5;
    }
  }

  private completeJob(v: VehicleSim) {
    const j = v.state.job;
    if (!j) {
      // safety: force the vehicle to park if the job vanished
      v.beltStage = false;
      v.leg = "home";
      this.parkVehicle(v);
      return;
    }
    j.done = true;
    j.phase = "done";
    const f = this.aircraft.get(j.flightId);
    const tr = f ? this.turnaround.get(f.flight.id) : undefined;
    switch (j.kind) {
      case "bagon":
        if (tr) tr.bagonDone = true;
        break;
      case "fuel":
        if (tr) {
          tr.fuelDone = true;
          if (f) f.flight.fuelNeed = 0;
        }
        break;
      case "catering":
        if (tr) tr.caterDone = true;
        break;
    }
    v.state.job = null;
    v.beltStage = false;
    v.leg = "home";
    this.parkVehicle(v);
  }

  /** park a vehicle at the nearest free apron node (ground crews stay on the apron) */
  private parkVehicle(v: VehicleSim) {
    const from = nearestNode(this.net, v.mover.pos.x, v.mover.pos.y, undefined, 120) ?? v.state.homeNode;
    // fuel trucks live at the fuel depot
    if (v.state.kind === "fuel") {
      const fuelNodes = this.net.nodes.filter((n) => n.service === "fuel");
      if (fuelNodes.length > 0) {
        let best = fuelNodes[0];
        let bd = 1e9;
        for (const n of fuelNodes) {
          const d = Math.hypot(n.x - v.mover.pos.x, n.y - v.mover.pos.y);
          if (d < bd) {
            bd = d;
            best = n;
          }
        }
        v.parkTarget = best.id;
        const path = findPath(this.net, from, best.id, { vehicles: true });
        if (path) v.mover.setPath(path);
        return;
      }
    }
    let park = this.apronPark[0] ?? v.state.homeNode;
    let best = Infinity;
    for (const n of this.apronPark) {
      let count = 0;
      for (const v2 of this.vehicles) {
        if (v2 === v) continue;
        if (Math.hypot(v2.mover.pos.x - this.net.node(n).x, v2.mover.pos.y - this.net.node(n).y) < 25) count++;
      }
      if (count < best) {
        best = count;
        park = n;
      }
    }
    v.parkTarget = park;
    const path = findPath(this.net, from, park, { vehicles: true });
    if (path) v.mover.setPath(path);
  }

  /** deadlock resolution: reroute a blocked vehicle around congestion.
   *  Start from the node AHEAD of its nose so it never teleports backwards. */
  private rerouteVehicle(v: VehicleSim, target: number) {
    const ahead = v.mover.path[Math.min(v.mover.edgeIdx + 1, v.mover.path.length - 1)];
    const from = ahead !== undefined ? ahead : nearestNode(this.net, v.mover.pos.x, v.mover.pos.y, undefined, 60) ?? v.state.homeNode;
    const path = findPath(this.net, from, target, {
      vehicles: true,
      trafficCost: (edgeId) => this.traffic.occupied(edgeId) * 35,
      maxNodes: 3000,
    });
    if (path && path.length > 1) v.mover.setPath(path);
  }

  /** deadlock resolution for taxiing aircraft */
  private rerouteAircraft(ac: AircraftSim, target: number) {
    const ahead = ac.mover.path[Math.min(ac.mover.edgeIdx + 1, ac.mover.path.length - 1)];
    const from = ahead !== undefined ? ahead : nearestNode(this.net, ac.pos.x, ac.pos.y, undefined, 60) ?? this.startNode(ac);
    const path = findPath(this.net, from, target, {
      aircraft: true,
      trafficCost: (edgeId) => this.traffic.occupied(edgeId) * 35,
      maxNodes: 3000,
    });
    if (path && path.length > 1) ac.setTaxiPath(path);
  }

  private pruneJobs() {
    this.jobs = this.jobs.filter((j) => !j.done);
  }

  // ------------------------------------------------------------------ pax

  private stepPax(dt: number) {
    for (const b of this.paxBatches) {
      void b;
    }
  }

  // ------------------------------------------------------------------ misc

  private satForDelay(delay: number): number {
    return Math.max(0.15, 1 - delay / 1500);
  }

  private accrueSat(sat: number) {
    this.satAccum += sat;
    this.satCount++;
    this.stats.sat = this.stats.sat * 0.985 + sat * 0.015;
  }

  private updateLevel() {
    const newLevel = Math.max(1, Math.min(6, 1 + Math.floor((this.standCount - 6) / 5) + (this.net.runways.length - 1) * 2));
    if (newLevel !== this.level) {
      this.log(`Airport upgraded to LEVEL ${newLevel} — demand rising`, "good");
      this.level = newLevel;
    }
  }

  private log(text: string, kind: LogEntry["kind"]) {
    if (this.logs.length > 40) this.logs.shift();
    this.logs.push({ time: this.time, text, kind });
  }

  get onTimePct(): number {
    const total = this.stats.departures;
    return total === 0 ? 100 : (this.stats.onTime / total) * 100;
  }

  get queueLengths(): { stand: number; dep: number; jobs: number } {
    let waiting = 0;
    for (const ac of this.aircraft.values()) if (ac.waitingStand) waiting++;
    return { stand: waiting, dep: this.depQueues.reduce((s, q) => s + q.length, 0), jobs: this.jobs.length };
  }

  /** build API (used by tools) */
  addStandAt(x: number, y: number, cls: string[], label: string, bridge: number) {
    const sd = this.net.addStand(x, y, -Math.PI / 2, cls, { bridge, label });
    const apron = nearestNode(this.net, x, y + 35, ["taxiway"], 80);
    if (apron == null) return null;
    this.net.connectStand(sd, apron, 0);
    // register every new node/edge with the traffic system, or movers freeze on them
    this.traffic.registerNode(sd.node);
    this.traffic.registerNode(sd.leadNode);
    this.traffic.registerNode(sd.serviceNode);
    for (const e of this.net.edges) {
      if (e.standId === sd.id || e.a === sd.leadNode || e.b === sd.leadNode || e.a === sd.serviceNode || e.b === sd.serviceNode) {
        this.traffic.registerEdge(e.id, this.net.edgeBlocks(e));
      }
    }
    this.airport.stands.push(sd);
    this.standOcc.set(sd.id, -1);
    return sd;
  }

  addTaxiwayNodeAt(x: number, y: number, connectTo?: number) {
    const n = this.net.addNode(x, y, "taxiway");
    this.traffic.registerNode(n);
    if (connectTo !== undefined) {
      const existing = this.net.edgeBetween(n, connectTo);
      if (!existing) {
        const eid = this.net.addEdge(n, connectTo, { kind: "taxiway", maxSpeed: 8 });
        this.traffic.registerEdge(eid, this.net.edgeBlocks(this.net.edge(eid)));
      }
    }
    return n;
  }

  /** remove a stand and its edges (delete tool) */
  removeStand(standId: number) {
    const sd = this.airport.stands.find((s) => s.id === standId);
    if (!sd) return;
    this.airport.stands = this.airport.stands.filter((s) => s.id !== standId);
    this.standOcc.delete(standId);
    this.net.edges = this.net.edges.filter((e) => e.standId !== standId && e.a !== sd.leadNode && e.b !== sd.leadNode && e.a !== sd.serviceNode && e.b !== sd.serviceNode);
    this.net.nodes = this.net.nodes.filter((n) => n.id !== sd.node && n.id !== sd.leadNode && n.id !== sd.serviceNode);
  }

  /**
   * Build a player runway (must be east-west like the starter runway so the
   * approach/rollout math holds). Creates the full structure: thresholds,
   * mid exits, parallel taxiway, connectors to the existing network, hold +
   * lineup geometry, and registers everything with Traffic.
   */
  addRunwayBuilt(x1: number, y: number, x2: number): boolean {
    const lo = Math.min(x1, x2);
    const hi = Math.max(x1, x2);
    const len = hi - lo;
    if (len < 800) return false;
    // parallel separation from existing runways
    for (const r of this.net.runways) {
      const ry = r.ends[0].y;
      if (Math.abs(ry - y) < 100) return false;
    }
    const net = this.net;
    const name = x2 > x1 ? "09/27" : "27/09";
    const rwy = net.addRunway(lo, y, hi, y, name);
    const t0 = rwy.thresholdNode[0];
    const t1 = rwy.thresholdNode[1];
    // split the lane with mid exits (like the starter airport)
    const mid1On = net.addNode(lo + len * 0.45, y, "runway", { rwyId: rwy.id });
    const mid2On = net.addNode(lo + len * 0.7, y, "runway", { rwyId: rwy.id });
    rwy.laneEdges = [
      net.addEdge(t0, mid1On, { kind: "runway", maxSpeed: 24, rwyId: rwy.id }),
      net.addEdge(mid1On, mid2On, { kind: "runway", maxSpeed: 24, rwyId: rwy.id }),
      net.addEdge(mid2On, t1, { kind: "runway", maxSpeed: 24, rwyId: rwy.id }),
    ];
    const off1 = net.addNode(lo + len * 0.45 + 85, y - 65, "hold", { rwyId: rwy.id });
    const off2 = net.addNode(lo + len * 0.7 + 85, y - 65, "hold", { rwyId: rwy.id });
    net.addEdge(mid1On, off1, { kind: "taxiway", maxSpeed: 7, rwyId: rwy.id });
    net.addEdge(mid2On, off2, { kind: "taxiway", maxSpeed: 7, rwyId: rwy.id });
    rwy.exits = [
      { s: lo + len * 0.45, on: mid1On, off: off1 },
      { s: lo + len * 0.7, on: mid2On, off: off2 },
    ];
    // parallel taxiway on the north side
    const T = (x: number) => net.addNode(x, y - 65, "taxiway");
    const tw = T(lo + 80);
    const twm1 = T(lo + len * 0.45 + 85);
    const twm2 = T(lo + len * 0.7 + 85);
    const twE = T(hi - 80);
    net.addEdge(tw, twm1, { kind: "taxiway", maxSpeed: 9 });
    net.addEdge(twm1, twm2, { kind: "taxiway", maxSpeed: 9 });
    net.addEdge(twm2, twE, { kind: "taxiway", maxSpeed: 9 });
    net.addEdge(off1, twm1, { kind: "taxiway", maxSpeed: 7 });
    net.addEdge(off2, twm2, { kind: "taxiway", maxSpeed: 7 });
    // connectors from the new taxiway to the nearest existing network nodes
    const connect = (x: number): boolean => {
      const from = net.addNode(x, y - 65, "taxiway");
      const target = nearestNode(net, x, y - 65, ["taxiway", "hold"], 300);
      if (target === null || target === from) return false;
      const eid = net.addEdge(from, target, { kind: "taxiway", maxSpeed: 8 });
      this.traffic.registerEdge(eid, net.edgeBlocks(net.edge(eid)));
      return true;
    };
    const c1 = connect(lo + 80);
    const c2 = connect(hi - 80);
    if (!c1 && !c2) return false; // runway unreachable: reject
    // departure hold + lineup
    const depHold = net.addNode(lo, y - 52, "hold", { rwyId: rwy.id });
    net.addEdge(depHold, tw, { kind: "taxiway", maxSpeed: 8 });
    rwy.depHold = depHold;
    rwy.lineupEdge = net.addEdge(depHold, t0, { kind: "taxiway", maxSpeed: 8, rwyId: rwy.id });
    const eastConn = net.addNode(hi + 40, y - 65, "taxiway");
    net.addEdge(t1, eastConn, { kind: "taxiway", maxSpeed: 9 });
    net.addEdge(twE, eastConn, { kind: "taxiway", maxSpeed: 9 });
    rwy.rolloutEdge = net.addEdge(t1, eastConn, { kind: "taxiway", maxSpeed: 7, rwyId: rwy.id });
    rwy.exitNode = [depHold, eastConn];
    // register EVERYTHING new
    for (const n of net.nodes) this.traffic.registerNode(n.id);
    for (const e of net.edges) this.traffic.registerEdge(e.id, net.edgeBlocks(e));
    // new controller for this runway
    const ctrl = new RunwayController(rwy, net, this.traffic);
    this.rwys.push(ctrl);
    this.finals.push([]);
    this.depQueues.push([]);
    this.depReleased.push(true);
    this.depClimb.push(null);
    this.log(`New runway ${name} (${len.toFixed(0)}m) opened`, "good");
    return true;
  }
}

function jobTarget(v: VehicleSim): number {
  return v.state.job?.targetNode ?? v.state.homeNode;
}

function fmtDelay(sec: number): string {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60}m` : `${m}m`;
}







