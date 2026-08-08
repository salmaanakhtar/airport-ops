import { Rng } from "../game/rng";
import { AIRLINES, AC_BY_CODE, AIRCRAFT, CITIES, SIM } from "../game/config";
import type { ScheduleEntry } from "../game/types";

/**
 * Procedural flight schedule. Demand scales with airport level (stands).
 * Generates a rolling window of scheduled movements.
 */
export class Scheduler {
  private rng: Rng;
  private nextId = 1;
  private fleet = new Map<string, number>(); // ac code -> next flight index

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  nextFlightId(): number {
    return this.nextId++;
  }

  /** generate flights between now and now+window (game seconds) */
  generate(now: number, window: number, level: number): ScheduleEntry[] {
    const out: ScheduleEntry[] = [];
    const base = 60 * (2.6 - level * 0.38); // seconds between movements
    const n = Math.max(1, Math.ceil(window / base));
    let t = now + this.rng.range(10, 40);
    for (let i = 0; i < n; i++) {
      if (t > now + window) break;
      const ac = this.pickAc(level);
      const def = AC_BY_CODE.get(ac)!;
      const airline = this.rng.pick(AIRLINES);
      const pax = Math.min(def.seats, Math.round(def.seats * this.rng.range(0.35, 0.95)));
      const from = this.rng.pick(CITIES);
      out.push({
        time: Math.round(t),
        dir: "arr",
        airlineIdx: AIRLINES.indexOf(airline),
        acType: ac,
        from,
        to: "GLR",
        pax,
      });
      t += this.rng.range(base * 0.55, base * 1.5);
    }
    return out;
  }

  private pickAc(level: number): string {
    const pool = AIRCRAFT.filter((a) => {
      if (level >= 4) return true;
      if (level >= 3) return a.cls !== "small";
      if (level >= 2) return a.cls !== "heavy" || a.code === "B767" || a.code === "A330";
      return a.cls === "small" || a.code === "B737" || a.code === "A320";
    });
    const w = pool.map((a) => a.freq);
    const total = w.reduce((s, x) => s + x, 0);
    let r = this.rng.next() * total;
    for (let i = 0; i < pool.length; i++) {
      r -= w[i];
      if (r <= 0) return pool[i].code;
    }
    return pool[pool.length - 1].code;
  }

  flightNo(airlineIcao: string): string {
    const idx = this.fleet.get(airlineIcao) ?? 1;
    this.fleet.set(airlineIcao, idx + 1);
    return `${airlineIcao}${100 + (idx % 890)}`;
  }
}
