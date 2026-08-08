# Status

Last updated: 2026-08-09 (v0.1.x)

## What exists

- **Simulation core**: full aircraft lifecycle (approach → landing → taxi →
  turnaround with pax/baggage/fuel/catering/pushback → taxi-out → takeoff),
  block-reservation traffic control with deadlock reroutes, runway sequencing
  with go-around + approach speed control, stand occupancy, procedural
  schedule, economy with satisfaction/OTP.
- **Rendering**: camera (pan/zoom), parametric aircraft sprites (12 real types,
  8 airline liveries, 14 px/m detail: cockpit panes, fan faces, wingtips),
  vehicle sprites with shadows, airfield painter (markings, wear, panel seams,
  edge lights), night mode with floodlight pools + terminal glow + nav lights,
  flight labels at zoom.
- **Gameplay slice**: Mini-Motorways-style build tools (taxiway drag — including
  node-to-open-space drags — stand, fuel depot, delete incl. stands), pause /
  speed controls, flight board (correct phases), alerts, toasts.
- **QA**: headless lifecycle tests (`npm test`, 7 passing incl. the
  player-built-stand regression), 5h stress harness (0 stuck movers, ~54 deps,
  OTP 100% at level 1), browser dev hooks (`window.__ff`, `?bench=`).

## Critic-loop wins (fresh-context critics + vision agents)

1. Fixed invisible aircraft: renderer used stale `flight.phase` instead of
   `ac.phase` (rule 1 violation in the render layer).
2. Rewrote aircraft sprites: wings were rendering off-canvas (center-relative
   coords without translate), engines all on one side, oversized shadow.
3. Player-built stands deadlocked the sim: `connectStand` never registered its
   edges/nodes with `Traffic`. Now registered; delete tool can remove stands.
4. Reroutes start from the node ahead of a mover's nose (no backwards teleports).
5. Fuel trucks park at fuel depots (newly placed depots actually work).
6. Visual pass: terrain texture, terminal detail, ICAO dash proportions, night
   lighting (floodlight pools, terminal glow, aircraft nav lights).

## Known gaps (biggest first)

1. **Building tools incomplete** — no runway tool, no terminal expansion, no
   vehicle purchases/upgrades (buy more fuel/baggage trucks when queues grow).
2. **Passengers are abstract** — no visible pax, no terminal interior.
3. **No persistence** — no save/load, no scenarios, no difficulty/balance pass
   beyond level 1.
4. **One runway direction only** — no wind, no dual-runway ops, no second
   runway tool, no taxiway A end-of-network edge cases at scale.
5. **Growth ceiling** — no way to grow the airport past ~10 stands: stands
   require the apron; expanding the apron via tools is manual and clunky.
6. **Perf** — the long synchronous `__ff` jams the tab for seconds under load;
   large airports will need the static layer cached to an offscreen canvas.

## Verification commands

```
npm run typecheck   # clean
npm test            # 7/7 passing
npx tsx scripts/stress.mts   # no stuck movers, ~54 deps/5h at level 1
npx tsx scripts/build-test.mts  # player-built stand end-to-end
```
