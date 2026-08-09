import type { World } from "../sim/world";
import type { Camera } from "./camera";
import { AirfieldPainter } from "./paint";
import { aircraftSprite } from "./sprites";
import { AIRLINES, ECO } from "../game/config";
import { nearestNode } from "../sim/pathfind";
import type { InputController } from "../input";

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
    private cam: Camera,
    private input?: InputController
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

    this.painter.dpr = this.dpr;
    this.painter.draw(g, this.cam);

    // dynamic agents
    this.drawAgents(g, night);

    if (night) {
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      g.fillStyle = "rgba(8,10,26,0.52)";
      g.fillRect(0, 0, this.canvas.width, this.canvas.height);
      // light glows
      this.drawLightsScreen(g);
    }
    this.drawBuildOverlay(g);
  }

  /** highlight eligible build locations for the active tool (Mini-Motorways style) */
  private drawBuildOverlay(g: CanvasRenderingContext2D) {
    if (!this.input) return;
    const info = this.input.buildOverlay();
    if (info.tool === "pan" || !info.hover) return;
    const cam = this.cam;
    const dpr = this.dpr;
    const w = this.world;
    const net = w.net;
    const snap = (v: number) => Math.round(v / 5) * 5;
    const onScreen = (x: number, y: number, pad: number) => {
      const halfW = cam.viewW / (2 * cam.ppm);
      const halfH = cam.viewH / (2 * cam.ppm);
      return x > cam.x - halfW - pad && x < cam.x + halfW + pad && y > cam.y - halfH - pad && y < cam.y + halfH + pad;
    };
    const wx = info.hover.x;
    const wy = info.hover.y;

    g.setTransform(cam.ppm * dpr, 0, 0, cam.ppm * dpr, dpr * (cam.viewW / 2 - cam.x * cam.ppm), dpr * (cam.viewH / 2 - cam.y * cam.ppm));

    const zoneGlow = () => {
      // the eligible zone: every taxiway/hold edge in view, softly glowing
      g.strokeStyle = "rgba(120,225,150,0.30)";
      g.lineWidth = 8;
      g.lineCap = "round";
      const seen = new Set<string>();
      for (const e of net.edges) {
        if (e.kind !== "taxiway") continue;
        const key = `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const A = net.node(e.a);
        const B = net.node(e.b);
        if (!onScreen((A.x + B.x) / 2, (A.y + B.y) / 2, 40)) continue;
        g.beginPath();
        g.moveTo(A.x, A.y);
        g.lineTo(B.x, B.y);
        g.stroke();
      }
    };
    // does segment (p1→p2) touch any runway lane band?
    const crossesRunway = (x1: number, y1: number, x2: number, y2: number): boolean => {
      const steps = 12;
      for (const r of net.runways) {
        const ax = r.ends[0].x;
        const bx = r.ends[1].x;
        const ry = r.ends[0].y;
        const lo = Math.min(ax, bx);
        const hi = Math.max(ax, bx);
        for (let i = 0; i <= steps; i++) {
          const px = x1 + ((x2 - x1) * i) / steps;
          const py = y1 + ((y2 - y1) * i) / steps;
          if (Math.abs(py - ry) <= r.width / 2 + 1 && px > lo && px < hi) return true;
        }
      }
      return false;
    };
    const ghostStand = (x: number, y: number, valid: boolean) => {
      const col = valid ? "120,225,150" : "255,90,80";
      g.strokeStyle = `rgba(${col},0.95)`;
      g.lineWidth = 1.9;
      g.setLineDash([4.5, 3.5]);
      g.beginPath();
      g.ellipse(x, y + 8, 27, 43, 0, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = `rgba(${col},0.10)`;
      g.fill();
      g.beginPath();
      g.moveTo(x, y + 47);
      g.lineTo(x, y + 12);
      g.stroke();
      g.fillStyle = `rgba(${col},0.95)`;
      g.font = "9px monospace";
      g.fillText("STAND", x - 15, y - 10);
    };
    const ghostDepot = (x: number, y: number, valid: boolean) => {
      const col = valid ? "120,225,150" : "255,90,80";
      g.strokeStyle = `rgba(${col},0.95)`;
      g.lineWidth = 1.9;
      g.setLineDash([4.5, 3.5]);
      g.strokeRect(x - 19, y - 11, 38, 22);
      g.setLineDash([]);
      g.fillStyle = `rgba(${col},0.10)`;
      g.fillRect(x - 19, y - 11, 38, 22);
      g.fillStyle = `rgba(${col},0.95)`;
      g.beginPath();
      g.arc(x - 12, y, 5.5, 0, Math.PI * 2);
      g.arc(x + 12, y, 5.5, 0, Math.PI * 2);
      g.fill();
      g.font = "9px monospace";
      g.fillText("FUEL", x - 11, y - 16);
    };

    switch (info.tool) {
      case "taxiway": {
        // eligible anchor/connect nodes (hollow rings — distinct from the glow)
        g.strokeStyle = "rgba(120,225,150,0.9)";
        g.lineWidth = 1.3;
        for (const n of net.nodes) {
          if (n.kind !== "taxiway" && n.kind !== "hold") continue;
          if (!onScreen(n.x, n.y, 20)) continue;
          g.beginPath();
          g.arc(n.x, n.y, 4.4, 0, Math.PI * 2);
          g.stroke();
        }
        if (info.drag) {
          const from = info.drag.node >= 0 ? net.node(info.drag.node) : { x: info.drag.sx, y: info.drag.sy };
          const target = nearestNode(net, wx, wy, ["taxiway", "hold"], 14);
          const end = target !== null ? net.node(target) : { x: snap(wx), y: snap(wy) };
          const len = Math.hypot(end.x - from.x, end.y - from.y);
          const blocked = target !== null && target === info.drag.node;
          const overRwy = crossesRunway(from.x, from.y, end.x, end.y);
          const valid = !blocked && !overRwy;
          const col = valid ? "120,225,150" : "255,90,80";
          g.strokeStyle = `rgba(${col},0.95)`;
          g.lineWidth = 2.8;
          g.setLineDash([5.5, 4]);
          g.beginPath();
          g.moveTo(from.x, from.y);
          g.lineTo(end.x, end.y);
          g.stroke();
          g.setLineDash([]);
          // diamond destination marker
          g.fillStyle = `rgba(${col},1)`;
          g.beginPath();
          g.moveTo(end.x, end.y - 6.5);
          g.lineTo(end.x + 6.5, end.y);
          g.lineTo(end.x, end.y + 6.5);
          g.lineTo(end.x - 6.5, end.y);
          g.closePath();
          g.fill();
          this.buildCostLabel(g, `Taxiway ${len.toFixed(0)}m · $${Math.round((len * ECO.taxiwayCostPerM) / 1000)}k${overRwy ? " — crosses runway!" : ""}`, valid);
        }
        break;
      }
      case "stand": {
        zoneGlow();
        const nx = snap(wx);
        const ny = snap(wy);
        const valid = nearestNode(net, nx, ny + 35, ["taxiway"], 80) !== null && w.money >= ECO.standCost + ECO.bridgeCost;
        ghostStand(nx, ny, valid);
        this.buildCostLabel(g, `Stand · $${((ECO.standCost + ECO.bridgeCost) / 1000).toFixed(0)}k`, valid);
        break;
      }
      case "fuel": {
        zoneGlow();
        const nx = snap(wx);
        const ny = snap(wy);
        const valid = nearestNode(net, nx, ny, ["taxiway"], 90) !== null && w.money >= 200000;
        ghostDepot(nx, ny, valid);
        this.buildCostLabel(g, "Fuel depot · $200k", valid);
        break;
      }
      case "runway": {
        if (info.drag) {
          const lo = Math.min(info.drag.sx, wx);
          const hi = Math.max(info.drag.sx, wx);
          const ny = snap(wy);
          const len = hi - lo;
          let valid = len >= 800 && w.money >= len * ECO.runwayCostPerM;
          for (const r of net.runways) {
            if (Math.abs(r.ends[0].y - ny) < 100) valid = false;
          }
          if (valid) {
            const c1 = nearestNode(net, lo + 80, ny - 65, ["taxiway", "hold"], 300);
            const c2 = nearestNode(net, hi - 80, ny - 65, ["taxiway", "hold"], 300);
            if (c1 === null && c2 === null) valid = false;
          }
          // ghost runway
          g.strokeStyle = valid ? "rgba(120,225,150,0.95)" : "rgba(255,90,80,0.95)";
          g.fillStyle = valid ? "rgba(120,225,150,0.14)" : "rgba(255,90,80,0.14)";
          g.lineWidth = 1.2;
          g.fillRect(lo, ny - 22.5, len, 45);
          g.strokeRect(lo, ny - 22.5, len, 45);
          // connector preview
          g.setLineDash([4, 3]);
          g.lineWidth = 0.8;
          g.beginPath();
          g.moveTo(lo, ny - 22.5);
          g.lineTo(lo, ny - 65);
          g.moveTo(hi, ny - 22.5);
          g.lineTo(hi, ny - 65);
          g.stroke();
          g.setLineDash([]);
          this.buildCostLabel(g, `Runway ${(len / 1000).toFixed(2)}km · $${Math.round((len * ECO.runwayCostPerM) / 1000)}k`, valid);
        } else {
          zoneGlow();
          g.fillStyle = "rgba(120,225,150,0.5)";
          g.beginPath();
          g.arc(wx, wy, 3, 0, Math.PI * 2);
          g.fill();
          this.buildCostLabel(g, "Drag to lay a runway (min 800m)", true);
        }
        break;
      }
      case "delete": {
        const n = nearestNode(net, wx, wy, undefined, 30);
        if (n !== null) {
          const node = net.node(n);
          g.strokeStyle = "rgba(255,90,80,0.95)";
          g.lineWidth = 1.2;
          g.setLineDash([3, 2.5]);
          g.beginPath();
          g.arc(node.x, node.y, 8, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
          const stand = w.airport.stands.find((s) => s.node === n);
          const label = stand ? `Remove stand ${stand.label}` : node.kind === "taxiway" || node.kind === "hold" ? "Remove node" : "Cannot remove";
          this.buildCostLabel(g, label, node.kind === "stand" || node.kind === "taxiway" || node.kind === "hold");
        }
        break;
      }
    }
  }

  /** small cost/validity readout near the cursor (screen space) */
  private buildCostLabel(g: CanvasRenderingContext2D, text: string, valid: boolean) {
    if (!this.input) return;
    const info = this.input.buildOverlay();
    if (!info.hover) return;
    const cam = this.cam;
    const dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sx = (info.hover.x - cam.x) * cam.ppm + cam.viewW / 2;
    const sy = (info.hover.y - cam.y) * cam.ppm + cam.viewH / 2;
    g.font = "11px Consolas, monospace";
    const tw = g.measureText(text).width;
    g.fillStyle = "rgba(10,14,18,0.85)";
    g.fillRect(sx + 14, sy + 18, tw + 10, 16);
    g.fillStyle = valid ? "#7ce89a" : "#ff8a80";
    g.fillText(text, sx + 19, sy + 29);
  }

  private drawLightsScreen(g: CanvasRenderingContext2D) {
    const cam = this.cam;
    const w = this.world;
    const net = w.net;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
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
    // terminal warm glow (large soft pool behind the building)
    const t = w.airport.terminal;
    const tx = (t.x + t.w / 2 - cam.x) * cam.ppm + cam.viewW / 2;
    const ty = (t.y - 20 - cam.y) * cam.ppm + cam.viewH / 2;
    if (tx > -380 && tx < cam.viewW + 380) {
      const grad = g.createRadialGradient(tx, ty, 10, tx, ty, 380);
      grad.addColorStop(0, "rgba(255,214,150,0.42)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(tx - 380, ty - 380, 760, 760);
    }
    for (const r of net.runways) {
      const a = net.node(r.thresholdNode[0]);
      const b = net.node(r.thresholdNode[1]);
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const dx = (b.x - a.x) / L;
      const dy = (b.y - a.y) / L;
      const hw = r.width / 2;
      const px = -dy;
      const py = dx;
      for (let t2 = 0.03; t2 < 1; t2 += 0.06) {
        const x = a.x + dx * L * t2;
        const y = a.y + dy * L * t2;
        const white = t2 > 0.55;
        glow(x + px * hw, y + py * hw, 17, white ? "rgba(255,255,235,0.85)" : "rgba(255,200,90,0.85)");
        glow(x - px * hw, y - py * hw, 17, white ? "rgba(255,255,235,0.85)" : "rgba(255,200,90,0.85)");
      }
      // threshold glows
      for (const endNode of [r.thresholdNode[0], r.thresholdNode[1]]) {
        const n = net.node(endNode);
        glow(n.x, n.y, 26, endNode === r.thresholdNode[0] ? "rgba(80,255,120,0.7)" : "rgba(255,80,80,0.7)");
      }
    }
    // apron floodlight pools: large soft circles along the apron edge
    for (const n of net.nodes) {
      if (n.kind === "taxiway" && n.y === -140) {
        glow(n.x, n.y - 30, 110, "rgba(255,240,200,0.30)");
      }
    }
    // stand-area pools (brightest zones at the gates)
    for (const s of w.airport.stands) {
      glow(s.x, s.y + 8, 85, "rgba(255,236,190,0.22)");
    }
    // taxiway blue edge lights (glowing at night)
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
      for (let t2 = 0.07; t2 < 1; t2 += 0.14) {
        const x = A.x + dx * t2;
        const y = A.y + dy * t2;
        glow(x + px * 12, y + py * 12, 9, "rgba(120,200,255,0.8)");
        glow(x - px * 12, y - py * 12, 9, "rgba(120,200,255,0.8)");
      }
    }
    // aircraft nav + landing lights
    for (const ac of w.aircraft.values()) {
      const f = ac.flight;
      if (ac.phase === "cruise" || ac.phase === "gone") continue;
      const p = ac.pos;
      const h = ac.heading;
      const half = f.acTypeDef.len / 2;
      const tip = (off: number) => ({
        x: p.x + Math.cos(h + off) * half,
        y: p.y + Math.sin(h + off) * half,
      });
      const left = tip(Math.PI / 2);
      const right = tip(-Math.PI / 2);
      glow(left.x, left.y, 6, "rgba(255,60,60,0.9)");
      glow(right.x, right.y, 6, "rgba(60,255,60,0.9)");
      if (f.phase === "final" || f.phase === "landing") {
        glow(p.x + Math.cos(h) * half, p.y + Math.sin(h) * half, 14, "rgba(255,255,230,0.9)");
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
      push(sv.pos.y, () => drawVehicle(g, v, cam, world, this.dpr));
    }
    // aircraft (phase source of truth is AircraftSim.phase, NOT flight.phase)
    for (const ac of world.aircraft.values()) {
      const f = ac.flight;
      if (ac.phase === "cruise") continue;
      if (ac.phase === "gone") continue;
      const p = ac.pos;
      push(p.y, () => drawAircraft(g, ac, cam, night, this.dpr));
    }
    items.sort((a, b) => a.y - b.y);
    (window as any).__dbgItems = items.length;
    for (const it of items) it.draw();
    (window as any).__dbgItemsAfter = items.length;

    // labels on top
    const zoomed = cam.ppm > 1.6;
    if (zoomed) {
      g.setTransform(cam.ppm, 0, 0, cam.ppm, cam.viewW / 2 - cam.x * cam.ppm, cam.viewH / 2 - cam.y * cam.ppm);
      g.font = "5px monospace";
      for (const ac of world.aircraft.values()) {
        const f = ac.flight;
        if (ac.phase === "cruise" || ac.phase === "gone" || ac.phase === "landing" || ac.phase === "takeoff") continue;
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

function drawAircraft(g: CanvasRenderingContext2D, ac: any, cam: Camera, night: boolean, dpr: number) {
  const f = ac.flight;
  const def = f.acTypeDef;
  const airline = AIRLINES[f.airlineIdx] ?? AIRLINES[0];
  const spr = aircraftSprite(def, { color: airline.color, color2: airline.color2, pattern: airline.pattern });
  const scale = cam.ppm / spr.ppmm;
  const p = ac.pos;
  const x = (p.x - cam.x) * cam.ppm + cam.viewW / 2;
  const y = (p.y - cam.y) * cam.ppm + cam.viewH / 2;
  g.setTransform(scale * dpr, 0, 0, scale * dpr, x * dpr, y * dpr);
  g.rotate(ac.heading + Math.PI / 2);
  g.drawImage(spr.canvas, -spr.canvas.width / 2, -spr.canvas.height / 2);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (night && (ac.phase === "final" || ac.phase === "landing")) {
    // landing light glow at nose
    g.setTransform(dpr, 0, 0, dpr, x * dpr, y * dpr);
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

function drawVehicle(g: CanvasRenderingContext2D, v: any, cam: Camera, world: World, dpr: number) {
  const sv = v.state;
  const scale = cam.ppm / 8;
  const p = sv.pos;
  const x = (p.x - cam.x) * cam.ppm + cam.viewW / 2;
  const y = (p.y - cam.y) * cam.ppm + cam.viewH / 2;
  // soft shadow
  g.setTransform(scale * dpr, 0, 0, scale * dpr, (x + 4) * dpr, (y + 5) * dpr);
  g.rotate(sv.heading + Math.PI / 2);
  g.globalAlpha = 0.3;
  g.fillStyle = "#000";
  drawVehicleShape(g, sv.kind, sv.carts, sv.label, true);
  g.globalAlpha = 1;
  g.setTransform(scale * dpr, 0, 0, scale * dpr, x * dpr, y * dpr);
  g.rotate(sv.heading + Math.PI / 2);
  drawVehicleShape(g, sv.kind, sv.carts, sv.label);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawVehicleShape(g: CanvasRenderingContext2D, kind: string, carts: number, label: string, shadow = false) {
  // sprite space: nose up, units = px at 8 ppm (1 unit ≈ 0.125 m)
  const body = (len: number, wid: number, color: string, cab = false) => {
    g.save();
    if (!shadow) {
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.fillRect(-wid / 2 - 1, 1, wid, len - 2);
    }
    g.fillStyle = shadow ? "#000" : color;
    g.fillRect(-wid / 2, 0, wid, len);
    if (cab && !shadow) {
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
      if (!shadow) {
        g.fillStyle = "#8a6d1c";
        g.fillRect(-7, 6, 14, 16);
        g.fillStyle = "rgba(255,255,255,0.5)";
        g.fillRect(-4, 8, 8, 12);
      }
      break;
    }
    case "catering": {
      body(34, 10, "#4a90d9", true);
      if (!shadow) {
        g.fillStyle = "#2f5f95";
        g.fillRect(-8, 9, 16, 18);
        g.fillStyle = "rgba(255,255,255,0.7)";
        g.fillRect(-7, 11, 14, 3);
        g.fillRect(-7, 17, 14, 3);
      }
      break;
    }
    case "baggage": {
      body(18, 8, "#a3842f", true);
      if (!shadow) {
        g.fillStyle = "#6d5a20";
        for (let i = 0; i < carts; i++) {
          g.fillRect(-9, 20 + i * 12, 18, 10);
          g.fillStyle = "#7a6726";
          g.fillRect(-7, 22 + i * 12, 14, 6);
          g.fillStyle = "#6d5a20";
        }
      }
      break;
    }
    case "push": {
      body(14, 9, "#b23a48", false);
      if (!shadow) {
        g.fillStyle = "#8c2d38";
        g.fillRect(-4, 6, 8, 5);
      }
      break;
    }
    case "bus": {
      body(52, 11, "#4c8c4a", false);
      if (!shadow) {
        g.fillStyle = "rgba(150,200,170,0.85)";
        for (let i = 0; i < 7; i++) g.fillRect(-8, 4 + i * 6.5, 16, 4);
      }
      break;
    }
  }
}
