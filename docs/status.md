# Status

Last updated: 2026-08-09 (v0.1.0)

## What exists

- **Simulation core**: full aircraft lifecycle (approach → landing → taxi →
  turnaround with pax/baggage/fuel/catering/pushback → taxi-out → takeoff),
  block-reservation traffic control with deadlock reroutes, runway sequencing
  with go-around + approach speed control, stand occupancy, procedural
  schedule, economy with satisfaction/OTP.
- **Rendering**: camera (pan/zoom), parametric aircraft sprites (12 real types,
  8 airline liveries), vehicle sprites, airfield painter (runway/taxiway
  markings, edge lights, terminal, jetbridges, depots), night mode with
  light glows, flight-number labels at zoom.
- **Gameplay slice**: Mini-Motorways-style build tools (taxiway drag, stand,
  fuel depot, delete), pause/speed controls, flight board, alerts, toasts.
- **QA**: headless lifecycle tests (`npm test`, 6 passing), 5h stress harness,
  browser dev hooks (`window.__ff`, `?bench=`).

## Known gaps (biggest first)

1. **Visual believability** — the scene is functional but not yet MSFS-grade:
   ground texture, apron shading, tire marks, terminal detail, and lighting
   all need a pass (use `?bench=300` screenshots to compare).
2. **Building tools incomplete** — no runway tool, no terminal expansion, no
   vehicle purchases, no upgrade system (level demand, reputation → schedule).
3. **Passengers are abstract** — no visible pax, no terminal interior, no
   walking/baggage-claim scenes.
4. **No persistence** — no save/load, no scenarios, no economy balance pass.
5. **Only one runway direction** (west arrivals / east departures); no wind,
   no dual-runway ops, no heavy-traffic ATC edge cases.
6. **UI polish** — toolbar costs static, no build preview rendering, no
   overlay modes (delay heat map, traffic density).

## Verification commands

```
npm run typecheck   # clean
npm test            # 6/6 passing
npx tsx scripts/stress.mts   # no stuck movers, ~50 deps/5h at level 1
```
