import type { AircraftTypeDef } from "./types";

/** Aircraft type catalogue. Dimensions in meters, based on real aircraft. */

export const AIRCRAFT: AircraftTypeDef[] = [
  { code: "C172",  name: "Cessna 172",  cls: "small",  len: 8.3,  span: 11.0, mtoW: 1.1,   engines: 1, enginePos: "wing", seats: 4,    cruiseKmh: 180, minRwy: 400,  cat: "A", freq: 0.7, turnMin: 12, paxPerMin: 8 },
  { code: "E190",  name: "Embraer 190", cls: "small",  len: 36.2, span: 28.7, mtoW: 51.7,  engines: 2, enginePos: "wing", seats: 100,  cruiseKmh: 640, minRwy: 1400, cat: "C", freq: 0.8, turnMin: 25, paxPerMin: 14 },
  { code: "A220",  name: "Airbus A220", cls: "small",  len: 35.0, span: 29.3, mtoW: 63.1,  engines: 2, enginePos: "wing", seats: 130,  cruiseKmh: 660, minRwy: 1500, cat: "C", freq: 0.7, turnMin: 30, paxPerMin: 14 },
  { code: "B737",  name: "Boeing 737-800", cls: "medium", len: 39.5, span: 35.9, mtoW: 79.0, engines: 2, enginePos: "wing", seats: 189,  cruiseKmh: 700, minRwy: 1800, cat: "C", freq: 1.0, turnMin: 40, paxPerMin: 16 },
  { code: "A320",  name: "Airbus A320neo", cls: "medium", len: 37.6, span: 35.8, mtoW: 79.0, engines: 2, enginePos: "wing", seats: 195,  cruiseKmh: 700, minRwy: 1800, cat: "C", freq: 1.0, turnMin: 40, paxPerMin: 16 },
  { code: "A321",  name: "Airbus A321XLR", cls: "medium", len: 44.5, span: 35.8, mtoW: 101.0, engines: 2, enginePos: "wing", seats: 244,  cruiseKmh: 700, minRwy: 2000, cat: "C", freq: 0.5, turnMin: 45, paxPerMin: 16 },
  { code: "B757",  name: "Boeing 757-300", cls: "medium", len: 54.4, span: 38.1, mtoW: 123.6, engines: 2, enginePos: "wing", seats: 289,  cruiseKmh: 690, minRwy: 2100, cat: "D", freq: 0.3, turnMin: 50, paxPerMin: 18 },
  { code: "B767",  name: "Boeing 767-300", cls: "heavy", len: 54.9, span: 47.6, mtoW: 186.9, engines: 2, enginePos: "wing", seats: 269,  cruiseKmh: 700, minRwy: 2400, cat: "D", freq: 0.4, turnMin: 55, paxPerMin: 18 },
  { code: "A330",  name: "Airbus A330-300", cls: "heavy", len: 63.7, span: 60.3, mtoW: 242.0, engines: 2, enginePos: "wing", seats: 293,  cruiseKmh: 700, minRwy: 2600, cat: "D", freq: 0.4, turnMin: 55, paxPerMin: 18 },
  { code: "B777",  name: "Boeing 777-300ER", cls: "heavy", len: 73.9, span: 64.8, mtoW: 351.5, engines: 2, enginePos: "wing", seats: 396,  cruiseKmh: 710, minRwy: 2800, cat: "E", freq: 0.25, turnMin: 65, paxPerMin: 20 },
  { code: "A380",  name: "Airbus A380", cls: "heavy", len: 72.7, span: 79.8, mtoW: 575.0, engines: 4, enginePos: "wing", seats: 525,  cruiseKmh: 710, minRwy: 3000, cat: "F", freq: 0.1, turnMin: 85, paxPerMin: 22 },
  { code: "B748",  name: "Boeing 747-8", cls: "heavy", len: 76.3, span: 68.4, mtoW: 447.7, engines: 4, enginePos: "wing", seats: 467,  cruiseKmh: 710, minRwy: 2900, cat: "F", freq: 0.12, turnMin: 80, paxPerMin: 22 },
];

export const AC_BY_CODE = new Map(AIRCRAFT.map((a) => [a.code, a]));

export interface AirlineDef {
  icao: string;
  name: string;
  color: string;
  color2: string;
  /** livery pattern: 'stripe' | 'tail' | 'full' */
  pattern: "stripe" | "tail" | "full";
  hub: boolean;
}

export const AIRLINES: AirlineDef[] = [
  { icao: "AO1", name: "Northwind Air", color: "#1a4fa0", color2: "#f2f5f9", pattern: "full", hub: true },
  { icao: "AO2", name: "Cascade Airlines", color: "#0e7a5f", color2: "#ffffff", pattern: "stripe", hub: true },
  { icao: "RWY", name: "Runway Red", color: "#c62828", color2: "#ffffff", pattern: "tail", hub: false },
  { icao: "SKY", name: "SkyLark", color: "#0084b4", color2: "#ffd23f", pattern: "full", hub: false },
  { icao: "VLT", name: "Violet Air", color: "#6a2f9e", color2: "#f0e6ff", pattern: "stripe", hub: false },
  { icao: "ORN", name: "Orchard Air", color: "#e8791b", color2: "#ffffff", pattern: "tail", hub: false },
  { icao: "MID", name: "Midnight Jets", color: "#2b2f3a", color2: "#ffd23f", pattern: "full", hub: false },
  { icao: "COA", name: "Coastal Express", color: "#0f6f8f", color2: "#c7ecee", pattern: "stripe", hub: false },
];

/** Placeholder city codes for schedule flavor. */
export const CITIES = ["BRK", "MIL", "DOV", "AST", "LOR", "VAN", "KEL", "SUN", "PEL", "NOV", "FAR", "GUL"];

export interface VehicleTypeDef {
  kind: string;
  speed: number;
  color: string;
  len: number;
  width: number;
  label: string;
}

export const VEHICLES: VehicleTypeDef[] = [
  { kind: "fuel", speed: 8, color: "#c8a12e", len: 7.5, width: 2.6, label: "Fuel truck" },
  { kind: "catering", speed: 8, color: "#4a90d9", len: 8.5, width: 2.6, label: "Catering truck" },
  { kind: "baggage", speed: 9, color: "#8a6f2f", len: 7.0, width: 2.4, label: "Baggage tractor" },
  { kind: "push", speed: 7, color: "#b23a48", len: 4.5, width: 2.2, label: "Pushback tug" },
  { kind: "bus", speed: 9, color: "#4c8c4a", len: 12.5, width: 2.9, label: "Passenger bus" },
];

export const VEHICLE_BY_KIND = new Map(VEHICLES.map((v) => [v.kind, v]));

/** Economy constants. Money in dollars. */
export const ECO = {
  baseCapital: 2_500_000,
  landFeePerPax: 5.5,
  depFeePerPax: 6.5,
  terminalRevenuePerPax: 4.2,
  fuelPerKg: 0.85,
  fuelCostPerKg: 0.5, // wholesale cost to the airport
  fuelDensity: 0.8, // kg per liter
  fuelMassPerPaxKm: 0.00035, // rough kg per pax per km for refuel demand
  staffDaily: 3200, // daily ops cost
  paxRevenueShare: 0.9, // terminal revenue per pax (shops, parking)
  buildingCostPerM2: 2400,
  runwayCostPerM: 900,
  taxiwayCostPerM: 400,
  standCost: 480_000,
  bridgeCost: 220_000,
};

export const SIM = {
  /** seconds between schedule ticks when generating flights */
  minArrInterval: 20,
  dt: 1 / 30,
  timeScale: 1,
  speedUp: 1,
  maxAgents: 900,
};

export const RWY_WIDTH = 45;
export const TAXIWAY_WIDTH = 23;
export const RWY_SPACING_BLOCK = 120; // aircraft separation on runway in m
export const BLOCK_LEN = 28; // reservation block length in m
export const LOOKAHEAD_BLOCKS = 12;
export const HOLD_SHORT = 15; // m before runway edge

