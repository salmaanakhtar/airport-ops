import { Network } from "./network";
import { Traffic } from "./traffic";
import { buildStarterAirport, type AirportBuilt } from "./airport";
import { RunwayController } from "./runways";
import { AircraftSim } from "./aircraft";
import { VehicleSim } from "./vehicles";
import { findPath, nearestNode } from "./pathfind";
import { Scheduler } from "./schedule";
import { Rng } from "../game/rng";
import { AIRLINES, AC_BY_CODE, ECO, SIM } from "../game/config";
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
  rwy: RunwayController;
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
  private standOcc = new Map<number, number>();
  private turnaround = new Map<number, TurnaroundState>();
  private finalApproach: AircraftSim[] = [];
  private depQueue: AircraftSim[] = [];
  private depReleased = true;
  private depClimb: AircraftSim | null = null;
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
    this.rwy = new RunwayController(this.net.runways[0], this.net, this.traffic);
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
      const more = this.scheduler.generate(this.time, 7200, this.level);
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
    let vid = 1;
    for (const vd of vehDefs) {
      for (let i = 0; i < vd.n; i++) {
        const home = vd.kind === "fuel" ? this.airport.depots.fuel : this.airport.depots.vehicle;
        const sv: VehicleState = {
          id: vid++,
          kind: vd.kind,
          label: `${vd.kind}-${i + 1}`,
          path: [],
          progress: 0,
          pos: { ...this.net.node(home) },
          heading: 0,
          job: null,
          homeNode: home,
          speed: 8,
          carts: vd.kind === "baggage" ? 2 : 0,
          loading: 0,
          retrying: false,
        };
        const v = new VehicleSim(this.net, sv, vd.kind === "baggage" ? 9 : 8);
        v.setTraffic(this.traffic);
        this.vehicles.push(v);
      }
    }
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
      rwyEnd: 0,
      phase: "cruise",
      delay: 0,
      progress: 0,
      fuelNeed: 0,
      fuelKg: 0,
      airlineIdx: e.airlineIdx,
      spd: 0,
      pos: { x: this.rwy.rwy.ends[0].x - 2200, y: 0 },
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
    ac.goaroundX = this.rwy.rwy.ends[0].x - 1750;
    this.aircraft.set(flight.id, ac);
  }

  // ------------------------------------------------------------------ sim

  private stepAircraft(ac: AircraftSim, dt: number) {
    const f = ac.flight;
    switch (ac.phase) {
      case "cruise": {
        if (this.time >= f.spawnTime + 18 && this.canEnterFinal()) {
          ac.phase = "final";
          this.finalApproach.push(ac);
          f.spd = 40;
        }
        break;
      }
      case "final": {
        const tx = this.rwy.rwy.ends[0].x + 420;
        const busy = this.rwy.busy;
        const dist = this.rwy.rwy.ends[0].x - f.pos.x;
        if (busy && dist < 250) {
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
        if (ac.standLeadNode < 0 || ac.targetStand < 0) {
          // not assigned yet: hold at current node
          ac.mover.speed = 0;
          break;
        }
        const blocked = ac.mover.step(dt, this.traffic, 8);
        if (blocked && ac.mover.blockedSince > 12) {
          const stand = this.airport.stands[ac.targetStand];
          if (stand) this.rerouteAircraft(ac, stand.node);
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
        if (blocked && ac.mover.blockedSince > 12) this.rerouteAircraft(ac, this.rwy.rwy.depHold);
        if (ac.mover.done && ac.phase === "taxiOut") {
          ac.phase = "holding";
          this.depQueue.push(ac);
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
    // stand-holding queue explode (the holding bay is small)
    const last = this.finalApproach[this.finalApproach.length - 1];
    if (last && this.time - last.flight.spawnTime < 26) return false;
    if (this.finalApproach.length >= 3) return false;
    let waiting = 0;
    for (const ac of this.aircraft.values()) if (ac.waitingStand) waiting++;
    return waiting < 3;
  }

  private isAtStand(ac: AircraftSim): boolean {
    return ac.standLeadNode >= 0 && ac.targetStand >= 0;
  }

  private stepRunway(dt: number) {
    const c = this.rwy;
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
        if (!this.depReleased) c.finishOperation();
      } else if (ac.isClimbing && !this.depReleased) {
        // airborne over the far end: runway is free for the next op
        this.depReleased = true;
        this.depClimb = ac;
        c.finishOperation();
      }
    } else if (c.state === "clear" && this.depClimb) {
      // keep driving the climb-out visual until it leaves the field
      if (this.depClimb.stepTakeoff(dt, c)) {
        this.depClimb.phase = "gone";
        this.depClimb = null;
      }
    } else if (c.state === "clear") {
      // decide next operation
      const closest = this.closestFinalDist();
      if (closest < 1200) {
        const ac = this.nextLandingCandidate();
        if (ac && c.tryStartLanding(ac)) {
          this.finalApproach.splice(this.finalApproach.indexOf(ac), 1);
        }
      } else if (this.depQueue.length > 0 && closest > 3200) {
        const ac = this.depQueue[0];
        if (c.tryStartLineup(ac)) {
          this.depQueue.shift();
          ac.phase = "takeoff";
          this.depReleased = false;
        }
      }
    }
  }

  private closestFinalDist(): number {
    let best = Infinity;
    const t = this.rwy.rwy.ends[0].x;
    for (const ac of this.finalApproach) {
      if (ac.goaroundMode !== "none") continue;
      const d = t - ac.flight.pos.x;
      if (d < best) best = d;
    }
    return best;
  }

  private nextLandingCandidate(): AircraftSim | null {
    let best: AircraftSim | null = null;
    let bd = Infinity;
    const t = this.rwy.rwy.ends[0].x;
    for (const ac of this.finalApproach) {
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
    const path = findPath(this.net, ac.standLeadNode, this.rwy.rwy.depHold, { aircraft: true });
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

  /** deadlock resolution: reroute a blocked vehicle around congestion */
  private rerouteVehicle(v: VehicleSim, target: number) {
    const from = nearestNode(this.net, v.mover.pos.x, v.mover.pos.y, undefined, 150) ?? v.state.homeNode;
    const path = findPath(this.net, from, target, {
      vehicles: true,
      trafficCost: (edgeId) => this.traffic.occupied(edgeId) * 35,
      maxNodes: 3000,
    });
    if (path && path.length > 1) v.mover.setPath(path);
  }

  /** deadlock resolution for taxiing aircraft */
  private rerouteAircraft(ac: AircraftSim, target: number) {
    const from = nearestNode(this.net, ac.pos.x, ac.pos.y, undefined, 150) ?? this.startNode(ac);
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
    return { stand: waiting, dep: this.depQueue.length, jobs: this.jobs.length };
  }

  /** build API (used by tools) */
  addStandAt(x: number, y: number, cls: string[], label: string, bridge: number) {
    const sd = this.net.addStand(x, y, -Math.PI / 2, cls, { bridge, label });
    const apron = nearestNode(this.net, x, y + 35, ["taxiway"], 80);
    if (apron == null) return null;
    this.net.connectStand(sd, apron, 0);
    this.airport.stands.push(sd);
    this.standOcc.set(sd.id, -1);
    return sd;
  }

  addTaxiwayNodeAt(x: number, y: number, connectTo?: number) {
    const n = this.net.addNode(x, y, "taxiway");
    if (connectTo !== undefined) {
      const existing = this.net.edgeBetween(n, connectTo);
      if (!existing) this.net.addEdge(n, connectTo, { kind: "taxiway", maxSpeed: 8 });
    }
    return n;
  }
}

function jobTarget(v: VehicleSim): number {
  return v.state.job?.targetNode ?? v.state.homeNode;
}

function fmtDelay(sec: number): string {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60}m` : `${m}m`;
}


