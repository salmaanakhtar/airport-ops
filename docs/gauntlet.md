# The Gauntlet

The bar this game is judged against. A fresh critic (vision agent + fresh
context) must be able to run these checks and report the single biggest gap.

## 1. Believability (MSFS bar, max zoom)

- Screenshot at `?bench=300`, zoom 6 px/m, over the apron:
  aircraft proportions/span/lengths must read correctly per type; liveries
  visible; shadows consistent; no sprite jaggies or popping.
- Runway markings match ICAO spacing (threshold stripes, centerline dashes,
  touchdown zone, edge lights green/white, taxiway blue).
- Night mode (`N`): lights glow, aircraft nav lights visible, ground dark.
- Traffic looks like an airport: convoys on taxiways, vehicles at stands
  beside noses, pushback with tug, climb-outs.

## 2. Legibility (Factorio bar)

- At a glance: which stands are busy, which flights are late, where the
  queues are (flight board + alerts + visual labels).
- Overload must be readable as *cause*: runway busy vs stand shortage vs
  vehicle shortage must each have distinct visual signatures.
- No hidden state: every KPI is either visible or one hover away.

## 3. Manipulation (Mini Motorways bar)

- Draw a taxiway in < 3 seconds; connect a stand in 1 click; costs are shown
  before committing; wrong clicks are cancellable (Esc).
- Building into a live airport must not corrupt the sim (register edges,
  no crashes, no ghosts).

## 4. Sim honesty

- No teleporting, no clipping through vehicles/aircraft, no runway taxiing.
- 5h stress: no mover stuck > 60 s; go-arounds < 2% of ops at level 1-2.
- Deterministic per seed: same seed + same inputs = same outcome.

## Loop

Critic → find biggest gap → builder fixes it → run `npm test` + stress +
screenshots → critic again (fresh context, blind A/B where possible).
