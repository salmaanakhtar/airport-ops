import type { AircraftTypeDef } from "../game/types";

/**
 * Parametric top-down aircraft art. Each type is rasterized once (nose pointing
 * +x, at SPRITE_PPM px/m) into an offscreen canvas; the renderer rotates and
 * scales it per frame. Proportions follow real airframes; liveries are simple
 * stripe schemes per airline.
 *
 * NOTE: everything is drawn in CENTER-RELATIVE coordinates after a single
 * translate(cx, cy). Mixing absolute and relative coordinates here once made
 * wings render off-canvas and the fuselage clip its nose.
 */
const SPRITE_PPM = 14;

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
  // center-relative coordinate system: nose points up (-y)
  g.translate(wPx / 2, hPx / 2);

  const m = SPRITE_PPM;
  const halfSpan = (span / 2) * m;
  const fusW = Math.max(1.1, Math.sqrt(def.len) * 0.58) * m; // fuselage width
  const bodyTop = -(len / 2) * m - 3;
  const bodyBot = (len / 2) * m + 3;

  // --- shadow (soft, offset down-right, sun from upper-left) --------------
  g.save();
  g.translate(4 * m, 5 * m);
  g.fillStyle = "rgba(0,0,0,0.20)";
  rounded(g, -fusW * 1.15, -(len / 2) * m, fusW * 2.3, len * m, fusW);
  g.fill();
  // wing shadow
  g.fillStyle = "rgba(0,0,0,0.15)";
  g.beginPath();
  g.moveTo(0, -4.5 * m);
  g.lineTo(-halfSpan * 1.02, -2 * m);
  g.lineTo(-halfSpan * 1.02, -0.6 * m);
  g.lineTo(0, -3 * m);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(0, -4.5 * m);
  g.lineTo(halfSpan * 1.02, -2 * m);
  g.lineTo(halfSpan * 1.02, -0.6 * m);
  g.lineTo(0, -3 * m);
  g.closePath();
  g.fill();
  g.restore();

  // --- wings ---------------------------------------------------------------
  const wingChord = Math.max(1.8, def.span * 0.1) * m;
  const wingY = -4 * m; // wings slightly ahead of center
  const wingSweep = 0.16 * m;
  // wingtip accents (upturned tips read better top-down)
  const wingtip = (left: boolean) => {
    const dir = left ? -1 : 1;
    g.fillStyle = "#b6bdc6";
    g.beginPath();
    g.moveTo(dir * halfSpan * 0.98, wingY + 1.6 * m);
    g.lineTo(dir * halfSpan * 1.08, wingY + 2.2 * m);
    g.lineTo(dir * halfSpan * 1.05, wingY - 0.4 * m);
    g.lineTo(dir * halfSpan * 0.94, wingY - 0.6 * m);
    g.closePath();
    g.fill();
  };
  g.fillStyle = "#d8dde3";
  wingShape(g, 0, wingY, halfSpan, wingChord, wingSweep, true);
  g.fill();
  g.fillStyle = "#c3cad2";
  wingShape(g, 0, wingY, halfSpan, wingChord, wingSweep, false);
  g.fill();
  wingtip(true);
  wingtip(false);
  // aileron/flap lines
  g.strokeStyle = "rgba(120,128,138,0.8)";
  g.lineWidth = 0.5;
  for (const dir of [-1, 1]) {
    g.beginPath();
    g.moveTo(dir * halfSpan * 0.95, wingY + 2.2 * m);
    g.lineTo(dir * halfSpan * 0.12, wingY - 2.6 * m);
    g.stroke();
  }

  // horizontal stabilizer
  const hstab = halfSpan * 0.34;
  g.fillStyle = "#d8dde3";
  wingShape(g, 0, bodyBot - 6 * m, hstab, wingChord * 0.7, wingSweep * 0.5, true);
  g.fill();
  g.fillStyle = "#c3cad2";
  wingShape(g, 0, bodyBot - 6 * m, hstab, wingChord * 0.7, wingSweep * 0.5, false);
  g.fill();

  // --- engines (symmetric about the centerline) -----------------------------
  const engLen = Math.max(1.6, def.len * 0.08) * m;
  const engW = Math.max(1.0, fusW * 0.62);
  const engY = wingY + 1.2 * m;
  const engN = def.engines;
  const engXs: number[] = [];
  if (engN === 2) {
    engXs.push(-halfSpan * 0.62, -halfSpan * 0.28, halfSpan * 0.28, halfSpan * 0.62);
  } else if (engN === 3) {
    engXs.push(-halfSpan * 0.65, 0, halfSpan * 0.65);
  } else if (engN === 4) {
    engXs.push(-halfSpan * 0.78, -halfSpan * 0.26, halfSpan * 0.26, halfSpan * 0.78);
  } else {
    engXs.push(0); // single (nose) engine
  }
  for (const ex of engXs) {
    g.save();
    g.translate(ex, engY);
    const nac = g.createLinearGradient(-engW, 0, engW, 0);
    nac.addColorStop(0, "#9aa4ad");
    nac.addColorStop(0.5, "#e8ecf0");
    nac.addColorStop(1, "#9aa4ad");
    g.fillStyle = nac;
    rounded(g, -engW / 2, -engLen, engW, engLen, engW / 2);
    g.fill();
    // pylon connecting to the wing
    g.fillStyle = "#8a939c";
    g.fillRect(-engW * 0.22, -engLen - 1.6 * m, engW * 0.44, 1.6 * m);
    // fan face (dark intake + light spinner)
    g.fillStyle = "#2f343b";
    g.beginPath();
    g.arc(0, -engLen * 0.8, engW * 0.44, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#c9ced4";
    g.beginPath();
    g.arc(0, -engLen * 0.8, engW * 0.2, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // --- fuselage ---------------------------------------------------------------
  const bodyGrad = g.createLinearGradient(-fusW / 2, 0, fusW / 2, 0);
  bodyGrad.addColorStop(0, "#dfe4e9");
  bodyGrad.addColorStop(0.42, "#f7f9fb");
  bodyGrad.addColorStop(0.58, "#eef1f4");
  bodyGrad.addColorStop(1, "#c2c9d0");
  g.fillStyle = bodyGrad;
  fuselageShape(g, 0, bodyTop, bodyBot, fusW);
  g.fill();

  // livery stripes
  const stripeW = Math.max(1.1, fusW * 0.42);
  g.save();
  g.beginPath();
  fuselageShape(g, 0, bodyTop, bodyBot, fusW);
  g.clip();
  if (livery.pattern === "full" || livery.pattern === "stripe") {
    g.fillStyle = livery.color;
    g.fillRect(-fusW, bodyTop + len * m * 0.16, fusW * 2, stripeW);
  }
  if (livery.pattern === "tail") {
    // tail band
    g.fillStyle = livery.color;
    g.beginPath();
    g.moveTo(-fusW, bodyBot - 10 * m);
    g.lineTo(fusW, bodyBot - 10 * m);
    g.lineTo(fusW, bodyBot);
    g.lineTo(-fusW, bodyBot);
    g.fill();
  }
  // cockpit windows (wraparound band + two windshield panels with center frame)
  g.fillStyle = "#1c222b";
  rounded(g, -fusW * 0.6, bodyTop - 0.8 * m, fusW * 1.2, 3.6 * m, 1.5 * m);
  g.fill();
  g.fillStyle = "#33414f";
  rounded(g, -fusW * 0.42, bodyTop + 0.2 * m, fusW * 0.34, 2.6 * m, 1.2 * m);
  g.fill();
  rounded(g, fusW * 0.08, bodyTop + 0.2 * m, fusW * 0.34, 2.6 * m, 1.2 * m);
  g.fill();
  g.fillStyle = "#1c222b";
  g.fillRect(-fusW * 0.05, bodyTop - 0.4 * m, fusW * 0.1, 3.2 * m);
  // cabin window strip (continuous dark band reads better at scale)
  g.fillStyle = "rgba(35,45,58,0.85)";
  const winTop = bodyTop + 5.5 * m;
  g.fillRect(-fusW * 0.72, winTop, fusW * 0.34, 1.8 * m);
  g.fillRect(fusW * 0.38, winTop, fusW * 0.34, 1.8 * m);
  g.fillStyle = "rgba(45,58,74,0.6)";
  for (let i = 0; i < 14; i++) {
    const y = winTop + (2.5 + i * ((len * m - 22) / 14)) * 1;
    g.fillRect(-fusW * 0.72, y, fusW * 0.34, 1.5);
    g.fillRect(fusW * 0.38, y, fusW * 0.34, 1.5);
  }
  g.restore();

  // --- vertical tail ----------------------------------------------------------
  g.save();
  g.translate(0, bodyBot - 4 * m);
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
  g.moveTo(-fusW * 0.3, bodyTop);
  g.lineTo(fusW * 0.3, bodyTop);
  g.lineTo(fusW * 0.02, bodyTop - 2.4 * m);
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

