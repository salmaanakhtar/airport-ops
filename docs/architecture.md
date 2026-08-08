# Architecture

AIRPORT // OPS is a framework-free TypeScript web game. The simulation is
100% decoupled from rendering and runs headless in Node (vitest/tsx).

```
main.ts ──> Engine ──> World (sim) ──> Network, Traffic, Movers, AircraftSim, VehicleSim, RunwayController
                 │
                 ├──> Camera ──> Renderer ──> AirfieldPainter (static layer), agent sprites
                 └──> UI (DOM overlay) <── InputController (pan/zoom/build tools)
```

## Layering

- **Simulation** (`src/sim/`) — pure logic, no DOM, no rAF. Deterministic given
  a seed (mulberry32 in `src/game/rng.ts`). Owns all state; the renderer only reads.
- **Rendering** (`src/render/`) — reads world state every frame; static airport
  geometry is replayed as cached Path2D under a camera transform. Aircraft are
  parametric raster sprites (nose-up), rotated by `heading + π/2`.
- **UI** (`src/ui/`) — DOM overlay updated ~10×/s; tools call into `World.build*`.
- **Engine** (`src/engine.ts`) — fixed 30 Hz sim step on a visibility-independent
  `setInterval`; rAF only renders. Background tabs are frozen in the dev
  environment, so the sim must not depend on rAF.

## Data flow

`World.tick(dt)` (called at 30 Hz):
1. advance clock, top up the flight schedule, spawn arrivals
2. `stepAircraft` — phase machine (cruise → final → landing → taxiIn → turnaround
   → pushback → taxiOut → holding → takeoff → gone)
3. `stepRunway` — RunwayController state machine + landing/takeoff driving
4. `stepTurnaround` — passenger/deplane/board progress, service job queueing
5. `stepVehicles` — job dispatch, driving, working, parking
6. economy tick (staff cost, satisfaction decay)

## Key invariants

- One aircraft per block span per priority class (aircraft > vehicle), FCFS.
- The runway lane is owned wholesale by RunwayController (agent id `-1`);
  taxiing traffic is forbidden from runway edges by pathfinding.
- Stands release only at `beginTaxiOut`; `assignStand` sets
  `ac.targetStand`, `flight.standId`, `standNode`, `standLeadNode` together.
- Vehicles park on the apron between jobs (never return to the depot) to keep
  service latency low.

## Build tools (Mini Motorways-style)

`InputController` (pan / taxiway / stand / fuel / delete) commits geometry
through `World.addTaxiwayNodeAt`/`addStandAt`; new edges are registered with
`Traffic.registerEdge` (block arrays are created lazily for new edges).
