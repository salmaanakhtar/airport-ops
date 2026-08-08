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
  private asphaltColor = "#3b3e44";
  private night = false;

  constructor(private world: World) {
    this.rebuild();
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

    // ground
    g.fillStyle = "#23251f";
    g.fillRect(cam.worldX(0) - 200, cam.worldY(0) - 200, cam.worldSize().w + 400, cam.worldSize().h + 400);

    // ground texture: faint grid + patches
    g.fillStyle = "rgba(255,255,255,0.012)";
    const gs = 40;
    const wx0 = cam.worldX(0);
    const wy0 = cam.worldY(0);
    for (let x = Math.floor(wx0 / gs) * gs; x < wx0 + cam.worldSize().w; x += gs) {
      for (let y = Math.floor(wy0 / gs) * gs; y < wy0 + cam.worldSize().h; y += gs) {
        if ((x + y) % 80 === 0) g.fillRect(x, y, gs, gs);
      }
    }

    // asphalt
    g.fillStyle = this.asphaltColor;
    for (const p of this.taxiwayPaths) {
      g.fillStyle = "#3b3e44";
      g.fill(p.path);
      g.strokeStyle = "rgba(0,0,0,0.35)";
      g.lineWidth = 0.8;
      g.stroke(p.path);
    }
    if (this.apronPath) {
      g.fillStyle = "#41444a";
      g.fill(this.apronPath);
      g.strokeStyle = "rgba(0,0,0,0.4)";
      g.lineWidth = 1;
      g.stroke(this.apronPath);
    }
    for (const p of this.runwayPads) {
      g.fillStyle = "#2e3035";
      g.fill(p);
      g.strokeStyle = "rgba(0,0,0,0.45)";
      g.lineWidth = 1.2;
      g.stroke(p);
    }
    for (const p of this.standPads) {
      g.fillStyle = "#45484e";
      g.fill(p);
    }
    // rubber marks on runway near touchdown zone & ends
    g.fillStyle = "rgba(20,20,22,0.25)";
    for (const r of net.runways) {
      const a = net.node(r.thresholdNode[0]);
      const b = net.node(r.thresholdNode[1]);
      const hw = r.width / 2;
      const tdx = a.x + (b.x - a.x) * 0.42;
      for (let i = 0; i < 5; i++) {
        g.fillRect(tdx + i * 9 - 20, a.y - hw * 0.8, 16, hw * 1.6);
      }
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
  }

  private drawBuildings(g: CanvasRenderingContext2D, cam: Camera) {
    const w = this.world;
    // terminal
    const t = w.airport.terminal;
    g.fillStyle = "#9aa3ad";
    g.fillRect(t.x, t.y, t.w, t.h);
    g.fillStyle = "rgba(0,0,0,0.25)";
    g.fillRect(t.x, t.y + t.h - 6, t.w, 6);
    // glass roof strip
    g.fillStyle = "rgba(150,190,220,0.5)";
    for (let x = t.x + 4; x < t.x + t.w - 4; x += 8) g.fillRect(x, t.y + 2, 4, t.h - 8);
    // jetbridges to stands
    for (const s of w.airport.stands) {
      if (s.bridge <= 0) continue;
      g.strokeStyle = "#7c8791";
      g.lineWidth = 5;
      g.lineCap = "butt";
      g.beginPath();
      g.moveTo(s.x, t.y + t.h);
      g.lineTo(s.x, s.y + 4);
      g.stroke();
      g.strokeStyle = "#b9c2cb";
      g.lineWidth = 3.4;
      g.beginPath();
      g.moveTo(s.x, t.y + t.h);
      g.lineTo(s.x, s.y + 4);
      g.stroke();
    }
    // fuel depot
    const f = w.airport.depots.fuel;
    if (f >= 0) {
      const n = w.net.node(f);
      g.fillStyle = "#5a5f66";
      g.fillRect(n.x - 18, n.y - 10, 36, 20);
      g.fillStyle = "#c9a227";
      g.beginPath();
      g.arc(n.x - 12, n.y, 5.5, 0, Math.PI * 2);
      g.arc(n.x + 12, n.y, 5.5, 0, Math.PI * 2);
      g.fill();
    }
    // vehicle depot
    const v = w.airport.depots.vehicle;
    if (v >= 0) {
      const n = w.net.node(v);
      g.fillStyle = "#4c5158";
      g.fillRect(n.x - 16, n.y - 12, 32, 24);
      g.strokeStyle = "#666c74";
      g.lineWidth = 1;
      g.strokeRect(n.x - 16, n.y - 12, 32, 24);
    }
    // belt building
    const b = w.airport.beltNode;
    if (b >= 0) {
      const n = w.net.node(b);
      g.fillStyle = "#565b62";
      g.fillRect(n.x - 14, n.y - 8, 28, 16);
      g.fillStyle = "#8f6f2f";
      g.fillRect(n.x - 10, n.y - 6, 20, 3);
    }
  }

  private drawLights(g: CanvasRenderingContext2D, net: Network, cam: Camera, glow: boolean) {
    const R = glow ? 2.2 : 0.7;
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
      for (let t = 0.02; t < 1; t += 0.04) {
        const x = a.x + dx * L * t;
        const y = a.y + dy * L * t;
        const white = t > 0.55;
        g.fillStyle = white ? "rgba(255,255,255,0.9)" : "rgba(255,200,80,0.9)";
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
      const L = Math.hypot(dx, dy);
      const px = -dy / L;
      const py = dx / L;
      g.fillStyle = "rgba(90,180,255,0.75)";
      for (let t = 0.1; t < 1; t += 0.12) {
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
