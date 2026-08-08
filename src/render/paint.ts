import type { World } from "../sim/world";
import type { Camera } from "./camera";
import { Network } from "../sim/network";
import { RWY_WIDTH, TAXIWAY_WIDTH } from "../game/config";

/**
 * AirfieldPainter draws the static airport: ground, asphalt, markings,
 * terminal and depots. Path2D objects are built once (on structure change)
 * and replayed per frame under the camera transform, so even a huge hub
 * stays cheap. Markings follow real standards (ICAO-ish): yellow taxiway
 * centerlines, white runway markings, blue taxiway edge lights.
 */
export class AirfieldPainter {
  private runwayPads: Path2D[] = [];
  private taxiwayPaths: { path: Path2D; kind: string }[] = [];
  private apronPath: Path2D | null = null;
  private standPads: Path2D[] = [];
  private dirty = true;
  private night = false;
  private texAsphalt: CanvasPattern | null = null;
  private texGrass: CanvasPattern | null = null;
  private texRunway: CanvasPattern | null = null;

  constructor(private world: World) {
    this.buildTextures();
    this.rebuild();
  }

  /** procedural surface textures (grain, not repeating tiles) */
  private buildTextures() {
    const mk = (w: number, h: number, base: string, speckle: [number, number, number], n: number) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d")!;
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 0.12;
        g.fillStyle = `rgba(${speckle[0]},${speckle[1]},${speckle[2]},${a})`;
        g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
      }
      return g.createPattern(c, "repeat");
    };
    this.texAsphalt = mk(256, 256, "rgba(0,0,0,0)", [30, 32, 36], 900);
    this.texGrass = mk(256, 256, "rgba(0,0,0,0)", [120, 140, 90], 1600);
    this.texRunway = mk(256, 256, "rgba(0,0,0,0)", [10, 10, 12], 500);
  }

  markDirty() {
    this.dirty = true;
  }

  private rebuild() {
    this.dirty = false;
    const net = this.world.net;
    this.runwayPads = [];
    this.taxiwayPaths = [];
    this.standPads = [];
    for (const r of net.runways) {
      const p = new Path2D();
      const a = net.node(r.thresholdNode[0]);
      const b = net.node(r.thresholdNode[1]);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L = Math.hypot(dx, dy);
      const px = -dy / L;
      const py = dx / L;
      const hw = r.width / 2;
      p.moveTo(a.x + px * hw, a.y + py * hw);
      p.lineTo(b.x + px * hw, b.y + py * hw);
      p.lineTo(b.x - px * hw, b.y - py * hw);
      p.lineTo(a.x - px * hw, a.y - py * hw);
      p.closePath();
      this.runwayPads.push(p);
    }
    // taxiway strips: each edge becomes a thick round-capped strip
    const seen = new Set<string>();
    for (const e of net.edges) {
      if (e.kind !== "taxiway") continue;
      const key = `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const A = net.node(e.a);
      const B = net.node(e.b);
      const p = new Path2D();
      const dx = B.x - A.x;
      const dy = B.y - A.y;
      const L = Math.hypot(dx, dy) || 1;
      const px = (-dy / L) * TAXIWAY_WIDTH * 0.5;
      const py = (dx / L) * TAXIWAY_WIDTH * 0.5;
      p.moveTo(A.x + px, A.y + py);
      p.lineTo(B.x + px, B.y + py);
      p.lineTo(B.x - px, B.y - py);
      p.lineTo(A.x - px, A.y - py);
      p.closePath();
      this.taxiwayPaths.push({ path: p, kind: "taxiway" });
    }
    // apron: build convex blob around apron nodes (y = -140 area)
    const apronNodes = net.nodes.filter((n) => n.kind === "taxiway" && n.y === -140);
    if (apronNodes.length > 1) {
      const xs = apronNodes.map((n) => n.x);
      const x0 = Math.min(...xs) - 60;
      const x1 = Math.max(...xs) + 60;
      const p = new Path2D();
      p.moveTo(x0, -95);
      p.lineTo(x1, -95);
      p.lineTo(x1, -235);
      p.lineTo(x0, -235);
      p.closePath();
      this.apronPath = p;
    }
    // stand pads
    for (const s of net.stands) {
      const p = new Path2D();
      p.ellipse(s.x, s.y + 12, 28, 46, 0, 0, Math.PI * 2);
      this.standPads.push(p);
    }
  }

  private applyTransform(g: CanvasRenderingContext2D, cam: Camera) {
    g.setTransform(cam.ppm, 0, 0, cam.ppm, cam.viewW / 2 - cam.x * cam.ppm, cam.viewH / 2 - cam.y * cam.ppm);
  }

  draw(g: CanvasRenderingContext2D, cam: Camera) {
    if (this.dirty) this.rebuild();
    const net = this.world.net;
    this.applyTransform(g, cam);

    // ---- ground: muted grass with texture + tonal patches (never bare) ----
    g.fillStyle = "#2c3523";
    g.fillRect(cam.worldX(0) - 400, cam.worldY(0) - 400, cam.worldSize().w + 800, cam.worldSize().h + 800);
    if (this.texGrass) {
      g.globalAlpha = 0.5;
      g.fillStyle = this.texGrass;
      g.fillRect(cam.worldX(0) - 400, cam.worldY(0) - 400, cam.worldSize().w + 800, cam.worldSize().h + 800);
      g.globalAlpha = 1;
    }
    // darker mown stripes (airfield grass banding)
    g.fillStyle = "rgba(20,26,14,0.18)";
    const gs = 22;
    const wx0 = cam.worldX(0);
    const wy0 = cam.worldY(0);
    for (let x = Math.floor(wx0 / gs) * gs; x < wx0 + cam.worldSize().w; x += gs) {
      if ((x / gs) % 2 === 0) g.fillRect(x, wy0 - 20, gs, cam.worldSize().h + 40);
    }

    // ---- asphalt ----
    for (const p of this.taxiwayPaths) {
      g.fillStyle = "#3b3e44";
      g.fill(p.path);
      if (this.texAsphalt) {
        g.globalAlpha = 0.55;
        g.fillStyle = this.texAsphalt;
        g.fill(p.path);
        g.globalAlpha = 1;
      }
      g.strokeStyle = "rgba(0,0,0,0.35)";
      g.lineWidth = 0.8;
      g.stroke(p.path);
    }
    if (this.apronPath) {
      g.fillStyle = "#41444a";
      g.fill(this.apronPath);
      if (this.texAsphalt) {
        g.globalAlpha = 0.55;
        g.fillStyle = this.texAsphalt;
        g.fill(this.apronPath);
        g.globalAlpha = 1;
      }
      // concrete panel seams
      g.strokeStyle = "rgba(0,0,0,0.22)";
      g.lineWidth = 0.5;
      const ax0 = 480;
      const ax1 = 1260;
      for (let x = ax0; x <= ax1; x += 48) {
        g.beginPath();
        g.moveTo(x, -95);
        g.lineTo(x, -235);
        g.stroke();
      }
      for (let y = -105; y >= -225; y -= 48) {
        g.beginPath();
        g.moveTo(ax0 - 60, y);
        g.lineTo(ax1 + 60, y);
        g.stroke();
      }
      g.strokeStyle = "rgba(0,0,0,0.4)";
      g.lineWidth = 1;
      g.stroke(this.apronPath);
    }
    for (const p of this.runwayPads) {
      g.fillStyle = "#2e3035";
      g.fill(p);
      if (this.texRunway) {
        g.globalAlpha = 0.7;
        g.fillStyle = this.texRunway;
        g.fill(p);
        g.globalAlpha = 1;
      }
      // concrete expansion joints across the runway
      g.strokeStyle = "rgba(0,0,0,0.25)";
      g.lineWidth = 0.4;
      for (const r of net.runways) {
        const a = net.node(r.thresholdNode[0]);
        const b = net.node(r.thresholdNode[1]);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const L = Math.hypot(dx, dy);
        const px = -dy / L;
        const py = dx / L;
        for (let t = 0.04; t < 1; t += 0.08) {
          g.beginPath();
          g.moveTo(a.x + dx * t + px * r.width / 2, a.y + dy * t + py * r.width / 2);
          g.lineTo(a.x + dx * t - px * r.width / 2, a.y + dy * t - py * r.width / 2);
          g.stroke();
        }
      }
      g.strokeStyle = "rgba(0,0,0,0.45)";
      g.lineWidth = 1.2;
      g.stroke(p);
    }
    for (const p of this.standPads) {
      g.fillStyle = "#45484e";
      g.fill(p);
    }
    // apron wear: oil stains near stand noses, tire marks at lead-ins
    for (const s of net.stands) {
      g.fillStyle = "rgba(20,20,24,0.22)";
      g.beginPath();
      g.ellipse(s.x - 6 + Math.random() * 4, s.y + 8 + Math.random() * 6, 4 + Math.random() * 5, 3 + Math.random() * 4, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(18,18,22,0.25)";
      for (let i = 0; i < 2; i++) {
        g.fillRect(s.x - 5 + i * 9, s.y + 14 + Math.random() * 4, 3, 14 + Math.random() * 8);
      }
      if (s.leadNode >= 0) {
        const lead = net.node(s.leadNode);
        g.strokeStyle = "rgba(16,16,20,0.3)";
        g.lineWidth = 0.5;
        g.beginPath();
        g.moveTo(lead.x, lead.y);
        g.quadraticCurveTo(s.x + 3, s.y + 14, s.x, s.y + 12);
        g.stroke();
      }
    }
    // rubber marks: touchdown zone streaks + scatter near thresholds
    for (const r of net.runways) {
      const a = net.node(r.thresholdNode[0]);
      const b = net.node(r.thresholdNode[1]);
      const hw = r.width / 2;
      const tdx = a.x + (b.x - a.x) * 0.42;
      g.fillStyle = "rgba(18,18,20,0.3)";
      for (let i = 0; i < 6; i++) {
        const w = 5 + Math.random() * 9;
        g.fillRect(tdx + i * 8 - 26 + Math.random() * 6, a.y - hw * (0.7 + Math.random() * 0.4), w, hw * (1.2 + Math.random() * 0.6));
      }
      // threshold wear
      g.fillStyle = "rgba(18,18,20,0.22)";
      g.fillRect(a.x - 30, a.y - hw * 0.8, 60, hw * 1.6);
      g.fillRect(b.x - 30, b.y - hw * 0.8, 60, hw * 1.6);
    }

    this.drawMarkings(g, net, cam);
    this.drawBuildings(g, cam);
    this.drawLights(g, net, cam, false);
  }

  private drawMarkings(g: CanvasRenderingContext2D, net: Network, cam: Camera) {
    // ----- taxiway centerlines (yellow) -----
    g.strokeStyle = "#d8c23a";
    g.lineCap = "round";
    g.lineJoin = "round";
    const seen = new Set<string>();
    for (const e of net.edges) {
      if (e.kind !== "taxiway") continue;
      const key = `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const A = net.node(e.a);
      const B = net.node(e.b);
      g.lineWidth = 0.32;
      g.beginPath();
      g.moveTo(A.x, A.y);
      g.lineTo(B.x, B.y);
      g.stroke();
    }

    // ----- runway markings -----
    g.strokeStyle = "#e8e8e4";
    g.fillStyle = "#e8e8e4";
    for (const r of net.runways) {
      const a = net.node(r.thresholdNode[0]);
      const b = net.node(r.thresholdNode[1]);
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const dx = (b.x - a.x) / L;
      const dy = (b.y - a.y) / L;
      const hw = r.width / 2;
      const px = -dy;
      const py = dx;
      const along = (t: number) => ({ x: a.x + dx * L * t, y: a.y + dy * L * t });

      // edge lines
      g.lineWidth = 0.3;
      g.beginPath();
      g.moveTo(a.x + px * hw, a.y + py * hw);
      g.lineTo(b.x + px * hw, b.y + py * hw);
      g.moveTo(a.x - px * hw, a.y - py * hw);
      g.lineTo(b.x - px * hw, b.y - py * hw);
      g.stroke();

      // centerline dashes
      g.lineWidth = 0.55;
      g.setLineDash([12, 24]);
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      g.setLineDash([]);

      // threshold stripes (8 white bars across each end)
      for (const end of [0, 1]) {
        const c = along(end === 0 ? 0.005 : 0.995);
        const back = (end === 0 ? 1 : -1) * 6;
        const stripW = hw * 1.9;
        const barLen = 30; // along the runway
        const barW = stripW / 8; // across
        g.fillStyle = "#e8e8e4";
        for (let i = 0; i < 8; i++) {
          const off = (i - 3.5) * (stripW / 8);
          const sx = c.x + px * off + dx * back;
          const sy = c.y + py * off + dy * back;
          const w = Math.abs(dx) * barLen + Math.abs(dy) * barW;
          const h = Math.abs(dy) * barLen + Math.abs(dx) * barW;
          g.fillRect(sx, sy, w, h);
        }
      }
      // touchdown zone marks
      const c = along(0.45);
      for (let i = 0; i < 6; i++) {
        const off = (i - 2.5) * 3;
        g.fillRect(c.x + px * off - 4, c.y + py * off - 6, 8, 12);
      }
    }

    // ----- stand markings: lead-in line, stop bar, gate labels -----
    g.strokeStyle = "#d8c23a";
    g.lineWidth = 0.3;
    for (const s of net.stands) {
      if (s.leadNode < 0) continue;
      const lead = net.node(s.leadNode);
      // guidance line from lead to nose
      g.beginPath();
      g.moveTo(lead.x, lead.y);
      g.lineTo(s.x, s.y + 6);
      g.stroke();
      // stop bar (yellow/red) at the nose
      g.fillStyle = "rgba(220,60,50,0.85)";
      g.fillRect(s.x - 4, s.y - 1.5, 8, 3);
      g.fillStyle = "rgba(216,194,58,0.9)";
      g.fillRect(s.x - 4, s.y - 5.5, 8, 3);
    }
    // stand labels (only when zoomed in)
    if (cam.ppm > 2.2) {
      g.font = "4px monospace";
      for (const s of net.stands) {
        g.fillStyle = "rgba(10,12,16,0.6)";
        g.fillRect(s.x - 7, s.y + 8, 14, 5.5);
        g.fillStyle = "#f2e9c8";
        g.fillText(s.label, s.x - 5, s.y + 12.5);
      }
    }
  }

  private drawBuildings(g: CanvasRenderingContext2D, cam: Camera) {
    const w = this.world;
    // terminal
    const t = w.airport.terminal;
    // shadow
    g.fillStyle = "rgba(0,0,0,0.3)";
    g.fillRect(t.x + 4, t.y + 5, t.w, t.h);
    // body
    const grad = g.createLinearGradient(0, t.y, 0, t.y + t.h);
    grad.addColorStop(0, "#aeb8c2");
    grad.addColorStop(1, "#7d8894");
    g.fillStyle = grad;
    g.fillRect(t.x, t.y, t.w, t.h);
    // roof cap
    g.fillStyle = "#5d6874";
    g.fillRect(t.x - 2, t.y - 2, t.w + 4, 5);
    // window grid (two floors)
    g.fillStyle = "rgba(30,42,54,0.85)";
    for (let y = t.y + 8; y < t.y + t.h - 10; y += 16) {
      for (let x = t.x + 4; x < t.x + t.w - 8; x += 9) {
        g.fillRect(x, y, 5, 7);
      }
    }
    // roof light strips
    g.fillStyle = "rgba(170,205,235,0.5)";
    for (let x = t.x + 4; x < t.x + t.w - 4; x += 22) g.fillRect(x, t.y + 2, 12, 2.4);
    // signage
    g.fillStyle = "#d8e2ec";
    g.font = "10px monospace";
    g.fillText("GRAY LAKE REGIONAL  GLR", t.x + 60, t.y + 30);
    // jetbridges with shadow + structure
    for (const s of w.airport.stands) {
      if (s.bridge <= 0) continue;
      const fromX = s.x;
      const fromY = t.y + t.h;
      const toY = s.y + 4;
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.fillRect(fromX - 3 + 2, fromY + 3, 6, toY - fromY);
      g.fillStyle = "#8b95a0";
      g.fillRect(fromX - 3, fromY, 6, toY - fromY);
      g.fillStyle = "#c3ccd5";
      g.fillRect(fromX - 2.4, fromY + 1, 4.8, toY - fromY - 2);
      // bridge window strip
      g.fillStyle = "rgba(35,50,66,0.8)";
      g.fillRect(fromX - 1.8, fromY + 2, 3.6, toY - fromY - 5);
      g.fillStyle = "rgba(150,190,220,0.5)";
      for (let y = fromY + 3; y < toY - 4; y += 5) g.fillRect(fromX - 1.2, y, 2.4, 2.2);
      // telescoping sections
      g.strokeStyle = "rgba(60,68,78,0.7)";
      g.lineWidth = 0.4;
      for (let y = fromY + 8; y < toY - 2; y += 11) {
        g.beginPath();
        g.moveTo(fromX - 3, y);
        g.lineTo(fromX + 3, y);
        g.stroke();
      }
      // base plinth
      g.fillStyle = "#6b7580";
      g.fillRect(fromX - 4.5, toY - 3, 9, 3);
      // joint at terminal
      g.fillStyle = "#56606b";
      g.fillRect(fromX - 5, fromY - 2, 10, 4);
    }
    // fuel depot
    const f = w.airport.depots.fuel;
    if (f >= 0) {
      const n = w.net.node(f);
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.fillRect(n.x - 16 + 2, n.y - 8 + 3, 32, 20);
      g.fillStyle = "#5a5f66";
      g.fillRect(n.x - 18, n.y - 10, 36, 20);
      g.fillStyle = "#6f747b";
      g.fillRect(n.x - 18, n.y - 12, 36, 4);
      g.fillStyle = "#c9a227";
      g.beginPath();
      g.arc(n.x - 12, n.y, 5.5, 0, Math.PI * 2);
      g.arc(n.x + 12, n.y, 5.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.fillRect(n.x - 14, n.y - 1.5, 4, 3);
      g.fillRect(n.x + 10, n.y - 1.5, 4, 3);
    }
    // vehicle depot
    const v = w.airport.depots.vehicle;
    if (v >= 0) {
      const n = w.net.node(v);
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.fillRect(n.x - 14 + 2, n.y - 10 + 3, 32, 24);
      g.fillStyle = "#4c5158";
      g.fillRect(n.x - 16, n.y - 12, 32, 24);
      g.fillStyle = "rgba(120,140,160,0.3)";
      g.fillRect(n.x - 12, n.y - 8, 24, 16);
      g.strokeStyle = "#666c74";
      g.lineWidth = 1;
      g.strokeRect(n.x - 16, n.y - 12, 32, 24);
    }
    // belt building
    const b = w.airport.beltNode;
    if (b >= 0) {
      const n = w.net.node(b);
      g.fillStyle = "rgba(0,0,0,0.3)";
      g.fillRect(n.x - 12 + 2, n.y - 6 + 2, 28, 16);
      g.fillStyle = "#565b62";
      g.fillRect(n.x - 14, n.y - 8, 28, 16);
      g.fillStyle = "#8f6f2f";
      g.fillRect(n.x - 10, n.y - 6, 20, 3);
    }
  }

  private drawLights(g: CanvasRenderingContext2D, net: Network, cam: Camera, glow: boolean) {
    const R = glow ? 2.2 : 0.55;
    // runway edge lights
    for (const r of net.runways) {
      const a = net.node(r.thresholdNode[0]);
      const b = net.node(r.thresholdNode[1]);
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const dx = (b.x - a.x) / L;
      const dy = (b.y - a.y) / L;
      const hw = r.width / 2;
      const px = -dy;
      const py = dx;
      for (let t = 0.03; t < 1; t += 0.06) {
        const x = a.x + dx * L * t;
        const y = a.y + dy * L * t;
        const white = t > 0.55;
        g.fillStyle = white ? "rgba(255,255,255,0.8)" : "rgba(255,200,80,0.8)";
        g.beginPath();
        g.arc(x + px * hw, y + py * hw, R, 0, Math.PI * 2);
        g.arc(x - px * hw, y - py * hw, R, 0, Math.PI * 2);
        g.fill();
      }
      // threshold green + red
      const thrLights: [number, string][] = [
        [r.thresholdNode[0], "rgba(0,255,0,0.9)"],
        [r.thresholdNode[1], "rgba(255,40,40,0.9)"],
      ];
      for (const [endNode, color] of thrLights) {
        const n = net.node(endNode);
        g.fillStyle = color;
        for (let i = -4; i <= 4; i++) {
          g.beginPath();
          g.arc(n.x + px * i * 4.5, n.y + py * i * 4.5, R, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    // taxiway blue edge lights: essentially invisible by day, glowing at night
    const spacing = glow ? 0.14 : 0.45;
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
      const L = Math.hypot(dx, dy);
      const px = -dy / L;
      const py = dx / L;
      g.fillStyle = glow ? "rgba(120,200,255,0.9)" : "rgba(90,180,255,0.14)";
      for (let t = spacing / 2; t < 1; t += spacing) {
        const x = A.x + dx * t;
        const y = A.y + dy * t;
        g.beginPath();
        g.arc(x + px * (TAXIWAY_WIDTH / 2 + 0.6), y + py * (TAXIWAY_WIDTH / 2 + 0.6), R, 0, Math.PI * 2);
        g.arc(x - px * (TAXIWAY_WIDTH / 2 + 0.6), y - py * (TAXIWAY_WIDTH / 2 + 0.6), R, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}
