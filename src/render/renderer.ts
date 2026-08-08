import type { World } from "../sim/world";
import type { Camera } from "./camera";
import { AirfieldPainter } from "./paint";
import { aircraftSprite } from "./sprites";
import { AIRLINES } from "../game/config";

/**
 * Composes the frame: static airfield layer + dynamic agents
 * (aircraft, vehicles) + night overlay + lights. Aircraft sprites are
 * pre-rendered rasters rotated per frame; draw order is y-sorted.
 */
export class Renderer {
  private painter: AirfieldPainter;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private world: World,
    private cam: Camera
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.painter = new AirfieldPainter(world);
  }

  markDirty() {
    this.painter.markDirty();
  }

  resize(w: number, h: number) {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.cam.resize(w, h);
    this.cam.setZoom(this.cam.zoom);
  }

  render(night: boolean) {
    const g = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);

    this.painter.draw(g, this.cam);

    // dynamic agents
    this.drawAgents(g, night);

    if (night) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.fillStyle = "rgba(8,10,26,0.66)";
      g.fillRect(0, 0, this.canvas.width, this.canvas.height);
      // light glows
      this.drawLightsScreen(g);
    }
  }

  private drawLightsScreen(g: CanvasRenderingContext2D) {
    const cam = this.cam;
    const w = this.world;
    const net = w.net;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const glow = (x: number, y: number, r: number, color: string) => {
      const sx = (x - cam.x) * cam.ppm + cam.viewW / 2;
      const sy = (y - cam.y) * cam.ppm + cam.viewH / 2;
      if (sx < -r || sx > cam.viewW + r || sy < -r || sy > cam.viewH + r) return;
      const grad = g.createRadialGradient(sx, sy, 0, sx, sy, r);
      grad.addColorStop(0, color);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(sx, sy, r, 0, Math.PI * 2);
      g.fill();
    };
    for (const r of net.runways) {
      const a = net.node(r.thresholdNode[0]);
      const b = net.node(r.thresholdNode[1]);
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const dx = (b.x - a.x) / L;
      const dy = (b.y - a.y) / L;
      const hw = r.width / 2;
      const px = -dy;
      const py = dx;
      for (let t = 0.02; t < 1; t += 0.04) {
        const x = a.x + dx * L * t;
        const y = a.y + dy * L * t;
        const white = t > 0.55;
        glow(x + px * hw, y + py * hw, 9, white ? "rgba(255,255,235,0.9)" : "rgba(255,200,90,0.9)");
        glow(x - px * hw, y - py * hw, 9, white ? "rgba(255,255,235,0.9)" : "rgba(255,200,90,0.9)");
      }
    }
    // apron floodlights
    for (const n of net.nodes) {
      if (n.kind === "taxiway" && n.y === -140) {
        glow(n.x, n.y - 55, 40, "rgba(255,240,200,0.10)");
      }
    }
    // taxiway blue edge lights
    const seen = new Set<string>();
    for (const e of net.edges) {
      if (e.kind !== "taxiway") continue;
      const key = `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const A = net.node(e.a);
      const B = net.node(e.b);
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const L = Math.hypot(dx, dy) || 1;
      const px = -dy / L;
      const py = dx / L;
      for (let t = 0.1; t < 1; t += 0.12) {
        const x = A.x + dx * t;
        const y = A.y + dy * t;
        glow(x + px * 12, y + py * 12, 5, "rgba(120,200,255,0.8)");
        glow(x - px * 12, y - py * 12, 5, "rgba(120,200,255,0.8)");
      }
    }

  }

  private drawAgents(g: CanvasRenderingContext2D, night: boolean) {
    const cam = this.cam;
    const world = this.world;
    const items: { y: number; draw: () => void }[] = [];

    const push = (y: number, draw: () => void) => items.push({ y, draw });

    // vehicles
    for (const v of world.vehicles) {
      const sv = v.state;
      push(sv.pos.y, () => drawVehicle(g, v, cam, world));
    }
    // aircraft
    for (const ac of world.aircraft.values()) {
      const f = ac.flight;
      if (f.phase === "cruise") continue;
      if (f.phase === "gone") continue;
      const p = ac.pos;
      push(p.y, () => drawAircraft(g, ac, cam, night));
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    // labels on top
    const zoomed = cam.ppm > 1.6;
    if (zoomed) {
      g.setTransform(cam.ppm, 0, 0, cam.ppm, cam.viewW / 2 - cam.x * cam.ppm, cam.viewH / 2 - cam.y * cam.ppm);
      g.font = "5px monospace";
      for (const ac of world.aircraft.values()) {
        const f = ac.flight;
        if (f.phase === "cruise" || f.phase === "gone" || f.phase === "landing" || f.phase === "takeoff") continue;
        const p = ac.pos;
        g.fillStyle = "rgba(10,12,16,0.65)";
        const label = `${f.flightNo}`;
        const tw = g.measureText(label).width;
        g.fillRect(p.x - tw / 2 - 1.5, p.y + 8, tw + 3, 6.5);
        g.fillStyle = "#e8f0f8";
        g.fillText(label, p.x - tw / 2, p.y + 13);
      }
    }
  }
}

function drawAircraft(g: CanvasRenderingContext2D, ac: any, cam: Camera, night: boolean) {
  const f = ac.flight;
  const def = f.acTypeDef;
  const airline = AIRLINES[f.airlineIdx] ?? AIRLINES[0];
  const spr = aircraftSprite(def, { color: airline.color, color2: airline.color2, pattern: airline.pattern });
  const scale = cam.ppm / spr.ppmm;
  const p = ac.pos;
  const x = (p.x - cam.x) * cam.ppm + cam.viewW / 2;
  const y = (p.y - cam.y) * cam.ppm + cam.viewH / 2;
  g.setTransform(scale, 0, 0, scale, x, y);
  g.rotate(ac.heading + Math.PI / 2);
  g.drawImage(spr.canvas, -spr.canvas.width / 2, -spr.canvas.height / 2);
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (night && (f.phase === "final" || f.phase === "landing")) {
    // landing light glow at nose
    g.setTransform(1, 0, 0, 1, x, y);
    const dirx = Math.cos(ac.heading);
    const diry = Math.sin(ac.heading);
    const nx = dirx * (def.len / 2) * cam.ppm;
    const ny = diry * (def.len / 2) * cam.ppm;
    g.fillStyle = "rgba(255,255,220,0.35)";
    g.beginPath();
    g.arc(nx, ny, 3 * cam.ppm, 0, Math.PI * 2);
    g.fill();
  }
}

function drawVehicle(g: CanvasRenderingContext2D, v: any, cam: Camera, world: World) {
  const sv = v.state;
  const scale = cam.ppm / 8;
  const p = sv.pos;
  const x = (p.x - cam.x) * cam.ppm + cam.viewW / 2;
  const y = (p.y - cam.y) * cam.ppm + cam.viewH / 2;
  g.setTransform(scale, 0, 0, scale, x, y);
  g.rotate(sv.heading + Math.PI / 2);
  drawVehicleShape(g, sv.kind, sv.carts, sv.label);
  g.setTransform(1, 0, 0, 1, 0, 0);
}

function drawVehicleShape(g: CanvasRenderingContext2D, kind: string, carts: number, label: string) {
  // sprite space: nose up, units = px at 8 ppm (1 unit ≈ 0.125 m)
  const body = (len: number, wid: number, color: string, cab = false) => {
    g.save();
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.fillRect(-wid / 2 - 1, 1, wid, len - 2);
    g.fillStyle = color;
    g.fillRect(-wid / 2, 0, wid, len);
    if (cab) {
      g.fillStyle = "rgba(40,44,50,0.9)";
      g.fillRect(-wid / 2, 0, wid, len * 0.32);
      g.fillStyle = "rgba(160,190,215,0.8)";
      g.fillRect(-wid * 0.34, 1, wid * 0.68, len * 0.16);
    }
    g.restore();
  };
  switch (kind) {
    case "fuel": {
      body(28, 10, "#c9a32f", true);
      g.fillStyle = "#8a6d1c";
      g.fillRect(-7, 6, 14, 16);
      g.fillStyle = "rgba(255,255,255,0.5)";
      g.fillRect(-4, 8, 8, 12);
      break;
    }
    case "catering": {
      body(34, 10, "#4a90d9", true);
      g.fillStyle = "#2f5f95";
      g.fillRect(-8, 9, 16, 18);
      g.fillStyle = "rgba(255,255,255,0.7)";
      g.fillRect(-7, 11, 14, 3);
      g.fillRect(-7, 17, 14, 3);
      break;
    }
    case "baggage": {
      body(18, 8, "#a3842f", true);
      g.fillStyle = "#6d5a20";
      for (let i = 0; i < carts; i++) {
        g.fillRect(-9, 20 + i * 12, 18, 10);
        g.fillStyle = "#7a6726";
        g.fillRect(-7, 22 + i * 12, 14, 6);
        g.fillStyle = "#6d5a20";
      }
      break;
    }
    case "push": {
      body(14, 9, "#b23a48", false);
      g.fillStyle = "#8c2d38";
      g.fillRect(-4, 6, 8, 5);
      break;
    }
    case "bus": {
      body(52, 11, "#4c8c4a", false);
      g.fillStyle = "rgba(150,200,170,0.85)";
      for (let i = 0; i < 7; i++) g.fillRect(-8, 4 + i * 6.5, 16, 4);
      break;
    }
  }
}
