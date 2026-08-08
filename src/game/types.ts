/** Shared simulation types. World coordinates are meters; +Y is down on screen. */

export type Vec = { x: number; y: number };

export type AircraftClass = "small" | "medium" | "heavy";

export type NodeKind = "runway" | "taxiway" | "stand" | "hold" | "service" | "threshold";

export interface NetNode {
  id: number;
  x: number;
  y: number;
  kind: NodeKind;
  /** if kind === 'stand': heading the aircraft must finish aligned to (radians) */
  heading?: number;
  /** if kind === 'stand': aircraft classes allowed here */
  capacity?: AircraftClass;
  /** if kind === 'runway' or 'threshold': which runway id */
  rwyId?: number;
  /** if kind === 'threshold': true when this end is used for departures toward heading */
  label?: string;
  /** if kind === 'service': what kind of service facility (fuel, cart-park) */
  service?: string;
}

export interface NetEdge {
  id: number;
  a: number;
  b: number;
  /** movement along edge from a to b (may be reversed by path) */
  kind: "runway" | "taxiway" | "stand";
  length: number;
  maxSpeed: number; // m/s
  aircraft: boolean; // aircraft allowed
  vehicles: boolean; // ground vehicles allowed
  oneWay: boolean;
  /** runway edges only: id of runway they belong to */
  rwyId?: number;
  /** stand edges only */
  standId?: number;
  /** geometric waypoints between a and b for the lane centerline (optional) */
  pts?: Vec[];
}

export interface Runway {
  id: number;
  name: string; // "09/27"
  ends: { x: number; y: number }[]; // index 0 = west/south (smaller bearing), 1 = other
  headings: number[]; // direction of travel for departure/landing at each end
  thresholdNode: number[]; // net node id per end (on the runway)
  exitNode: number[]; // hold node near each end
  /** lane edge ids, ordered from end0 to end1 (the runway is a chain) */
  laneEdges: number[];
  /** index into laneEdges of the edge departing end0 uses for its roll */
  width: number;
  /** mid exits: distance from end0, on-node, off-node */
  exits: { s: number; on: number; off: number }[];
  /** departure hold node (near end0, off the runway) */
  depHold: number;
  /** edge from depHold onto the runway (line-up) */
  lineupEdge: number;
  /** edge from the far end of the runway to the off-runway node (roll-out exit) */
  rolloutEdge: number;
  activeEnd: number; // 0 = depart end0 / land toward end1
}

export interface StandDef {
  id: number;
  x: number;
  y: number;
  heading: number; // resting heading of aircraft (nose at x,y, body extends +y)
  classes: AircraftClass[];
  node: number;
  /** lead-in node (on the stand centerline, south of the nose) */
  leadNode: number;
  /** service node beside the nose where ground vehicles park */
  serviceNode: number;
  /** walk-off ramp (jetbridge) length in m, 0 = remote stand */
  bridge: number;
  label: string;
}

export type FlightPhase =
  | "cruise"
  | "final"
  | "landing"
  | "exit"
  | "taxiIn"
  | "docking"
  | "turnaround"
  | "pushback"
  | "taxiOut"
  | "holding"
  | "takeoff"
  | "gone";

export interface AircraftTypeDef {
  code: string;
  name: string;
  cls: AircraftClass;
  len: number;
  span: number;
  mtoW: number; // tonnes
  engines: 1 | 2 | 3 | 4;
  enginePos: "wing" | "tail";
  seats: number;
  cruiseKmh: number;
  minRwy: number;
  cat: string;
  freq: number;
  turnMin: number;
  paxPerMin: number;
}

export interface Flight {
  id: number;
  airline: string;
  flightNo: string;
  acType: string;
  acTypeDef: AircraftTypeDef;
  dir: "arr" | "dep";
  /** scheduled time of arrival/departure in game seconds */
  schedTime: number;
  spawnTime: number;
  origin?: string;
  dest?: string;
  pax: number;
  depPax: number;
  bags: number;
  rwyEnd: number;
  standId?: number;
  phase: FlightPhase;
  gate?: number;
  delay: number;
  progress: number;
  fuelNeed: number;
  fuelKg: number;
  cargoKg?: number;
  revenue?: number;
  airlineIdx: number;
  spd: number;
  pos: Vec;
  heading: number;
  path: number[];
  pathProgress: number;
  destNode: number;
  waitingTug: boolean;
  waitedFuel: number;
  waitedCatering: number;
  waitedBag: number;
  boardingDone: boolean;
  deplaned: boolean;
  cancelReason?: string;
  aborted: boolean;
}

export interface AirlineDef {
  icao: string;
  name: string;
  color: string;
  color2: string;
}

export type ServiceKind = "fuel" | "catering" | "bagoff" | "bagon" | "push" | "bus" | "pax";

export interface ServiceJob {
  id: number;
  kind: ServiceKind;
  flightId: number;
  standId: number;
  done: boolean;
  started: boolean;
  phase: "queued" | "driving" | "working" | "returning" | "done";
  targetNode: number;
}

export type VehicleKind =
  | "fuel"
  | "catering"
  | "baggage"
  | "push"
  | "bus";

export interface VehicleState {
  id: number;
  kind: VehicleKind;
  label: string;
  /** path of node ids from home to job target */
  path: number[];
  progress: number;
  pos: Vec;
  heading: number;
  job: ServiceJob | null;
  homeNode: number;
  speed: number;
  /** visual: baggage cart train length */
  carts: number;
  loading: number; // 0..1
  retrying: boolean;
}

export interface PassengerBatch {
  id: number;
  flightId: number;
  dir: "arr" | "dep";
  count: number;
  /** visual position walking in terminal (not physical) */
  progress: number; // 0..1
  done: boolean;
  satisfaction: number; // 0..1
}

export interface ScheduleEntry {
  time: number; // seconds of day
  dir: "arr" | "dep";
  airlineIdx: number;
  acType: string;
  from: string;
  to: string;
  pax: number;
}
