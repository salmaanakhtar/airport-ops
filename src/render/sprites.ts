import type { AircraftTypeDef } from "../game/types";

/**
 * Parametric top-down aircraft art. Each type is rasterized once (nose pointing
 * +x, at SPRITE_PPM px/m) into an offscreen canvas; the renderer rotates and
 * scales it per frame. Proportions follow real airframes; liveries are simple
 * stripe schemes per airline.
 */
const SPRITE_PPM = 9;

export interface AircraftSprite {
  canvas: HTMLCanvasElement;
  len: number; // meters (for scaling)
  ppmm: number;
}

const cache = new Map<string, AircraftSprite>();

export function aircraftSprite(def: AircraftTypeDef, livery: { color: string; color2: string; pattern: string }): AircraftSprite {
  const key = `${def.code}|${livery.color}|${livery.pattern}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const len = def.len;
  const span = def.span;
  const wPx = Math.ceil((span + 8) * SPRITE_PPM);
  const hPx = Math.ceil((len + 10) * SPRITE_PPM);
  const c = document.createElement("canvas");
  c.width = wPx;
  c.height = hPx;
  const g = c.getContext("2d")!;
  // world: nose at (0,0), body along -y in sprite space (screen: x right, y down)
  // We draw nose pointing "up" in sprite (y up) so rotation math stays simple:
  // sprite local: nose at (w/2, h/2 - len/2 - 5), tail at (w/2, h/2 + len/2 + 5)
  const cx = wPx / 2;
  const cy = hPx / 2;
  const m = SPRITE_PPM;
  const halfSpan = (span / 2) * m;
  const fusW = Math.max(1.1, Math.sqrt(def.len) * 0.62) * m; // fuselage width

  // --- shadow -----------------------------------------------------------
  g.save();
  g.translate(cx + 6 * m, cy + 7 * m);
  g.rotate(0.06);
  g.fillStyle = "rgba(0,0,0,0.28)";
  rounded(g, -fusW * 1.1, -(len / 2) * m, fusW * 2.2, len * m, fusW * 0.9);
  g.fill();
  g.restore();

  const bodyTop = -(len / 2) * m - 3;
  const bodyBot = (len / 2) * m + 3;

  // --- wings ---------------------------------------------------------------
  const wingChord = Math.max(1.6, def.span * 0.09) * m;
  const wingY = -4 * m; // wings slightly ahead of center
  const wingSweep = 0.16 * m;
  g.fillStyle = "#d8dde3";
  // wing (behind fuselage in z-order: draw first)
  wingShape(g, cx, wingY, halfSpan, wingChord, wingSweep, true);
  g.fill();
  g.fillStyle = "#c3cad2";
  wingShape(g, cx, wingY, halfSpan, wingChord, wingSweep, false);
  g.fill();

  // horizontal stabilizer
  const hstab = halfSpan * 0.34;
  g.fillStyle = "#d8dde3";
  wingShape(g, cx, bodyBot - 6 * m, hstab, wingChord * 0.7, wingSweep * 0.5, true);
  g.fill();

  // --- engines --------------------------------------------------------------
  const engLen = Math.max(1.6, def.len * 0.075) * m;
  const engW = Math.max(0.85, fusW * 0.5);
  const engY = wingY + 1.2 * m;
  const engN = def.engines;
  const engXs: number[] = [];
  if (engN === 1 && def.enginePos === "tail") {
    // tail-mounted single engine (C172 style: actually nose... approximate)
    engXs.push(-(len / 2) * m * 0.55);
  } else if (engN === 2) {
    engXs.push(-halfSpan * 0.28, -halfSpan * 0.62);
  } else if (engN === 3) {
    engXs.push(-halfSpan * 0.3, -halfSpan * 0.65);
  } else if (engN === 4) {
    engXs.push(-halfSpan * 0.26, -halfSpan * 0.58, -halfSpan * 0.78);
  }
  for (const ex of engXs) {
    g.save();
    g.translate(cx + ex, cy + engY);
    const nac = g.createLinearGradient(-engW, 0, engW, 0);
    nac.addColorStop(0, "#9aa4ad");
    nac.addColorStop(0.5, "#e8ecf0");
    nac.addColorStop(1, "#9aa4ad");
    g.fillStyle = nac;
    rounded(g, -engW / 2, -engLen, engW, engLen, engW / 2);
    g.fill();
    g.fillStyle = "#4a525c";
    g.beginPath();
    g.arc(0, -engLen * 0.82, engW * 0.42, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // --- fuselage ---------------------------------------------------------------
  const bodyGrad = g.createLinearGradient(cx - fusW / 2, 0, cx + fusW / 2, 0);
  bodyGrad.addColorStop(0, "#dfe4e9");
  bodyGrad.addColorStop(0.42, "#f7f9fb");
  bodyGrad.addColorStop(0.58, "#eef1f4");
  bodyGrad.addColorStop(1, "#c2c9d0");
  g.fillStyle = bodyGrad;
  fuselageShape(g, cx, bodyTop, bodyBot, fusW);
  g.fill();

  // livery stripes
  const stripeW = Math.max(1.1, fusW * 0.42);
  g.save();
  g.beginPath();
  fuselageShape(g, cx, bodyTop, bodyBot, fusW);
  g.clip();
  if (livery.pattern === "full" || livery.pattern === "stripe") {
    g.fillStyle = livery.color;
    g.fillRect(cx - fusW, bodyTop + (len * m * 0.16), fusW * 2, stripeW);
  }
  if (livery.pattern === "tail") {
    // tail band
    g.fillStyle = livery.color;
    g.beginPath();
    g.moveTo(cx - fusW, bodyBot - 10 * m);
    g.lineTo(cx + fusW, bodyBot - 10 * m);
    g.lineTo(cx + fusW, bodyBot);
    g.lineTo(cx - fusW, bodyBot);
    g.fill();
  }
  // cockpit windows
  g.fillStyle = "#2e3440";
  rounded(g, cx - fusW * 0.42, bodyTop + 0.6 * m, fusW * 0.84, 2.2 * m, 1.1 * m);
  g.fill();
  // side windows dots
  g.fillStyle = "#3d4a5c";
  for (let i = 0; i < 18; i++) {
    const y = bodyTop + (4 + i * ((len * m - 14) / 18)) * 1;
    g.fillRect(cx - fusW * 0.78, y + 3, fusW * 0.32, 1.5);
    g.fillRect(cx + fusW * 0.46, y + 3, fusW * 0.32, 1.5);
  }
  g.restore();

  // --- vertical tail ----------------------------------------------------------
  g.save();
  g.translate(cx, bodyBot - 4 * m);
  g.fillStyle = livery.color;
  g.beginPath();
  g.moveTo(-fusW * 0.52, 0);
  g.lineTo(fusW * 0.52, 0);
  g.lineTo(fusW * 0.6, -8.5 * m);
  g.lineTo(-fusW * 0.5, -8.5 * m);
  g.quadraticCurveTo(-fusW * 0.55, -2 * m, -fusW * 0.52, 0);
  g.fill();
  if (livery.pattern !== "tail") {
    g.fillStyle = "rgba(255,255,255,0.85)";
    g.beginPath();
    g.moveTo(-fusW * 0.4, -8.4 * m);
    g.lineTo(fusW * 0.42, -8.4 * m);
    g.lineTo(fusW * 0.34, -5 * m);
    g.lineTo(-fusW * 0.32, -5 * m);
    g.fill();
  }
  g.restore();

  // nose tip accent
  g.fillStyle = "#6b7681";
  g.beginPath();
  g.moveTo(cx - fusW * 0.3, bodyTop);
  g.lineTo(cx + fusW * 0.3, bodyTop);
  g.lineTo(cx + fusW * 0.02, bodyTop - 2.4 * m);
  g.fill();

  const sprite: AircraftSprite = { canvas: c, len: len + 10, ppmm: SPRITE_PPM };
  cache.set(key, sprite);
  return sprite;
}

function fuselageShape(g: CanvasRenderingContext2D, cx: number, top: number, bot: number, w: number) {
  g.beginPath();
  g.moveTo(cx - w / 2, top + w * 0.7);
  g.quadraticCurveTo(cx - w / 2 - w * 0.2, top + w * 1.5, cx, top - w * 0.5);
  g.quadraticCurveTo(cx + w / 2 + w * 0.2, top + w * 1.5, cx + w / 2, top + w * 0.7);
  g.lineTo(cx + w / 2, bot - w * 0.9);
  g.quadraticCurveTo(cx + w / 2, bot + w * 0.3, cx, bot - w * 0.1);
  g.quadraticCurveTo(cx - w / 2, bot + w * 0.3, cx - w / 2, bot - w * 0.9);
  g.closePath();
}

function wingShape(g: CanvasRenderingContext2D, cx: number, y: number, halfSpan: number, chord: number, sweep: number, left: boolean) {
  const dir = left ? -1 : 1;
  g.beginPath();
  g.moveTo(cx, y - chord / 2);
  g.lineTo(cx + dir * halfSpan, y + chord / 2 - sweep);
  g.lineTo(cx + dir * halfSpan, y + chord / 2 + 0.4);
  g.lineTo(cx, y + chord / 2);
  g.closePath();
}

function rounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}
