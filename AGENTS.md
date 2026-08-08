# AGENTS.md

Guidance for AI agents working on **AIRPORT // OPS** — a deeply simulated airport
ground-operations management game. Quality bar: believable at max zoom like
Microsoft Flight Simulator; systems as legible as Factorio; manipulation as
effortless as Mini Motorways.

## Repo layout

- `src/game/` — types, config/balance tables (`config.ts`), seeded RNG
- `src/sim/` — the simulation (framework-free, zero DOM, runs headless in Node)
  - `network.ts` — taxiway/runway/stand graph
  - `pathfind.ts` — A* with congestion costs; runway lanes are forbidden to taxiing traffic
  - `traffic.ts` — block-reservation traffic control (Factorio-train style, FCFS, aircraft > vehicles)
  - `mover.ts` — graph locomotion + reservation claims + collision-free speed control
  - `aircraft.ts` — AircraftSim (approach/landing/takeoff driving, heading smoothing)
  - `vehicles.ts` — ground vehicle agent
  - `runways.ts` — RunwayController (whole-runway ownership, landing/departure sequencing)
  - `world.ts` — orchestrator: schedule, stand assignment, turnaround state machine, jobs, economy
  - `airport.ts` — procedural starter airport (GLR: 1×1400m runway, 6 stands, 1 terminal)
- `src/render/` — camera, airfield painter (markings, lighting, night), parametric aircraft/vehicle sprites
- `src/ui/` — DOM HUD (topbar KPIs, tool palette, flight board, alerts)
- `scripts/` — headless debug/stress harnesses (`debug-sim.mts`, `stress.mts`, `phases.mts`)
- `tests/` — vitest lifecycle tests (run `npm test`)

## Commands

- `npm run dev` — Vite dev server on **port 8191** (strict; do NOT use 5173, it is occupied on this machine)
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — headless sim lifecycle tests
- `npm run build` — typecheck + production build
- `npx tsx scripts/stress.mts` — 5-hour headless soak test (prints ops/OTP/deadlock diagnostics)

## Hard-won rules (do not break)

1. **Phase source of truth:** aircraft phase lives on `AircraftSim.phase`, NOT `flight.phase`.
   Step functions set `this.phase`; the world switches on `ac.phase`. The two drifted once and
   caused aircraft in "landing" to fly go-arounds.
2. **Mover.setPath must reset `edgeIdx`/`distInEdge`/`sinceBlocked`.** Not resetting made every
   subsequent trip instantly "done" (teleport-working vehicles).
3. **Runway lanes are controller-owned.** `findPath` skips `kind === "runway"` edges entirely;
   only RunwayController drives on them. Aircraft that taxi on the runway = bug.
4. **Vehicles never enter stand edges** (`vehicles: false`); they serve at the stand's
   `serviceNode` (offset beside the nose). Job targets are service nodes.
5. **Deadlock resolution:** movers blocked > 8s (vehicles) / 12s (aircraft) reroute via
   `rerouteVehicle`/`rerouteAircraft` with `trafficCost` congestion penalties. Without this,
   junction-node claims deadlock forever.
6. **Holding bay:** aircraft with no free stand park in the dedicated bay on taxiway A
   (x > 1300, y = -65), off vehicle routes. `canEnterFinal` gates approach entry when > 3
   aircraft wait, preventing gridlock spirals.
7. **Approach speed control:** arrivals slow to 30 m/s while the runway is busy; go-arounds
   only below 250 m from threshold. This keeps go-around rates near zero at reasonable load.
8. **Stand occupancy:** `beginTaxiOut` releases via `ac.targetStand` (NOT `flight.standId`
   which was never set — that ghosted all stands forever).
9. **Engine runs the sim on `setInterval` (visibility-independent)**; rAF only renders.
   Background tabs are frozen/throttled in this environment — use `window.__ff(seconds)`
   (synchronous fast-forward) or the headless scripts for QA.
10. **The game is a real-time sim first, a game second.** Balance changes go through
    `src/game/config.ts`; verify with `npm test` + `stress.mts`.
11. **Every built edge/node must be registered with `Traffic`** (`registerEdge`/`registerNode`).
    `addStandAt`/`addTaxiwayNodeAt` do this; anything that adds geometry directly to the
    net without registering freezes every mover routed onto it (silent deadlock, proven by
    the player-built-stand regression test).
12. **The renderer must switch on `ac.phase` (AircraftSim), never `f.phase`.** `flight.phase`
    is stale after spawn; checking it made every aircraft invisible (rule 1 enforced in
    `drawAgents`, the label loop, and nav-light loop too).
13. **Reroutes start from the node AHEAD on the mover's current path** (`path[edgeIdx+1]`),
    never from an arbitrary nearby node — otherwise a blocked mover teleports backwards
    up to 150m.
14. **Vehicles park on the apron, not the depot** (fuel trucks park at the nearest
    `service === "fuel"` node). Depot round-trips destroyed service throughput.

## Dev hooks (browser)

- `window.game` — Engine instance (world, cam, renderer)
- `window.__ff(seconds)` — synchronous sim fast-forward (for screenshot QA)
- `?bench=300` — fast-forward 300 game-seconds at load

## Workflow for agents

1. Sim changes: run `npm test` and `npx tsx scripts/stress.mts` (5h soak must show no stuck movers).
2. Visual changes: run dev server, screenshot at multiple zooms, compare against the quality bar.
3. Push after every meaningful change (`git push`). Keep `docs/status.md` current.
