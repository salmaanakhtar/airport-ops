# Simulation model

## Traffic control (block reservation)

Every graph edge is split into `ceil(length / 28m)` blocks. A mover claims a
contiguous span of blocks ahead of its nose (lookahead scales with speed,
shrinking to 2 blocks when stopped) plus the junction nodes it approaches.

- Aircraft always evict vehicles from a block/node claim.
- Same-priority conflicts resolve first-come-first-served (a monotonic `seq`).
- `claimWhole` gives the runway controller exclusive ownership of all lane blocks.
- A denied claim inside the braking envelope forces the mover to stop; claims
  are released once the mover's tail passes them.

This gives Factorio-train-like correctness (no overtaking, no corner cutting)
with junction mutual exclusion, at the cost of needing the deadlock reroute
(see AGENTS.md rule 5).

## Aircraft lifecycle

```
cruise (invisible) → final (approach, 52 m/s, speed-controlled to 30 when
busy) → landing (touchdown at threshold+420m, 3.4 m/s² decel, exits at
≤10.5 m/s) → taxiIn (mover) → turnaround (deplane → services: bagoff, fuel,
catering in parallel; board; bagon; push) → pushback (tug-driven, nose moves
south along the stand centerline) → taxiOut → holding (depHold) → takeoff
(lineup turn, roll, climb, runway released at rotation+climb) → gone
```

Key constants: touchdown point, exit speeds, acceleration profiles,
go-around threshold (250 m), commit distance (1200 m), departure grant
window (no arrival within 3200 m) all live in `world.ts`/`aircraft.ts`.

## Turnaround model

Parallel tracks, all must complete before pushback:

| track | driver | duration |
|---|---|---|
| deplane → board | passenger batch progress | pax / paxPerMin |
| bagoff → bagon | baggage vehicle jobs (+ belt round trip) | bags / 24 kg·s⁻¹ |
| fuel | fuel truck job | fuelKg / 180 kg·s⁻¹ |
| catering | catering truck job | 10 s |
| push | pushback tug | attach + 15 s push |

Aircraft arrive with a fuel need (0.35–0.5 × MTOW × 0.21); the airport buys
fuel at `ECO.fuelCostPerKg` and sells at `ECO.fuelPerKg`.

## Scheduling & demand

`Scheduler.generate` emits arrivals at `60 × (2.6 − 0.38 × level)` s intervals;
entries are absolute times, spawned 70 s early (cruise → final at +18 s).
Demand is flat at fixed level; level grows with stand count / runways.
Waiting aircraft hold in the east bay; `canEnterFinal` caps the stand queue at 3.

## Economy

- arrival: pax × (5.5 + 4.2) × satisfaction factor
- departure: pax × (6.5 + 4.2) × satisfaction + fuel margin
- staff: `(0.6 + 0.12 × stands) × staffDaily / 1440` per second
- satisfaction ≈ `clamp(1 − delay/1500)`, blended with exponential moving average

## Stress numbers (level 1, unplayed, 5h)

~145 ops, ~50 departures, OTP 100%, 0 stuck movers, 0-1 go-arounds with the
approach-speed-control + hold-bay system. Stand capacity and vehicle fleet are
the binding constraints at level 1 — this is the growth pressure the player
relieves by building.
