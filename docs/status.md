# Status

Last updated: 2026-08-09 (v0.2.0)

## What exists

- **Simulation core**: full aircraft lifecycle (approach → landing → taxi →
  turnaround with pax/baggage/fuel/catering/pushback → taxi-out → takeoff),
  block-reservation traffic control with deadlock reroutes, **multi-runway**
  runway sequencing (landing/departure queues per runway, round-robin arrival
  routing), go-around holding stacks, stand occupancy, procedural schedule,
  economy with satisfaction/OTP.
- **Rendering**: camera (pan/zoom), parametric aircraft sprites (12 real types,
  8 airline liveries, 14 px/m detail), vehicle sprites with shadows, airfield
  painter (markings, wear, panel seams, edge lights), night mode with
  floodlight pools + terminal glow + nav lights, flight labels.
- **Growth arc (v0.2)**: Mini-Motorways-style tools — taxiway drag (incl.
  node-to-open-space), **runway construction** (multi-runway ops verified:
  traffic splits, level bonus, ~1 op/60s per runway), stand, fuel depot
  (trucks re-home), delete incl. stands — plus **Fleet panel** (buy fuel /
  baggage / catering / pushback vehicles at $150k) and an economy rebalance
  (stand $360k, revenue up) so expansion is affordable.
- **QA**: headless lifecycle tests (`npm test`, 8 passing incl.
  player-built-stand regression), 5h stress (133 deps, 19 go-arounds, OTP
  100%, 0 stuck movers — runway at honest capacity, second runway relieves),
  browser dev hooks (`window.__ff`, `?bench=`).

## Critic-loop wins (fresh-context critics + vision agents)

1. Fixed invisible aircraft (renderer used stale `flight.phase`).
2. Rewrote aircraft sprites (off-canvas wings, asymmetric engines, clipping).
3. Player-built stands deadlocked the sim — now registered + regression test.
4. Reroutes start ahead of the mover's nose (no backwards teleports).
5. Fuel trucks re-home to newly built depots; flight board shows true phases;
   stands can be deleted.
6. Growth arc: vehicle purchases, runway tool, multi-runway controllers,
   schedule-burst fix (top-up windows overlapped), early go-around holds,
   final-entry spacing gates.

## Known gaps (biggest first)

1. **Passengers are abstract** — no visible pax, no terminal interior, no
   walking scenes.
2. **No persistence** — no save/load, no scenarios, no difficulty settings.
3. **Wind/runway direction** — active-end selection is static; no wind
   changes, no dual-direction ops, no approach lights at the player-built
   runway.
4. **Leveling rewards are thin** — level changes demand + aircraft types but
   there's no progression UI (reputation, airline contracts, unlock text).
5. **Perf** — long synchronous `__ff` jams the tab; large airports will need
   the static layer cached to an offscreen canvas.
6. **Balance** — go-arounds at capacity (~19/5h) are honest pressure but the
   cost of a go-around to the airline isn't visible to the player.

## Verification commands

```
npm run typecheck   # clean
npm test            # 8/8 passing
npx tsx scripts/stress.mts   # no stuck movers; runway at honest capacity
npx tsx scripts/build-test.mts  # player-built stand end-to-end
```
