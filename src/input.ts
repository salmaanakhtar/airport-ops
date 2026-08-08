import type { Engine } from "./engine";
import { findPath, nearestNode } from "./sim/pathfind";
import { ECO } from "./game/config";

export type ToolId = "pan" | "taxiway" | "stand" | "fuel" | "delete";

export interface BuildResult {
  ok: boolean;
  cost?: number;
  msg?: string;
}

/**
 * Pointer + keyboard input: drag to pan, wheel to zoom, tools to build.
 * Taxiway tool draws Mini-Motorways-style: click a node, drag, release to
 * place a segment. Building costs money.
 */
export class InputController {
  tool: ToolId = "pan";
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private buildStart: { node: number; x: number; y: number } | null = null;
  private hover: { x: number; y: number } | null = null;
  private draggingNode: number | null = null;
  private mouseBtn = 0;

  constructor(private engine: Engine) {
    const c = engine.canvasEl;
    c.addEventListener("pointerdown", (e) => this.onDown(e));
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e));
    c.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    window.addEventListener("keydown", (e) => this.onKey(e));
    c.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  setTool(t: ToolId) {
    this.tool = t;
    this.buildStart = null;
    this.draggingNode = null;
  }

  onDown(e: PointerEvent) {
    this.mouseBtn = e.button;
    if (this.tool === "pan" || e.button === 1 || e.button === 2) {
      this.drag = { x: e.clientX, y: e.clientY, moved: false };
      return;
    }
    if (e.button !== 0) return;
    const { x, y } = this.mouseWorld(e);
    if (this.tool === "taxiway") {
      const node = nearestNode(this.engine.world.net, x, y, ["taxiway", "hold"], 14);
      if (node !== null) {
        this.buildStart = { node, x, y };
        this.draggingNode = node;
      } else {
        this.buildStart = { node: -1, x, y };
      }
      this.engine.canvasEl.style.cursor = "crosshair";
    } else {
      this.buildStart = { node: -1, x, y };
    }
  }

  onMove(e: PointerEvent) {
    this.hover = { x: e.clientX, y: e.clientY };
    if (this.drag) {
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.drag.moved = true;
      this.engine.cam.panBy(dx, dy);
    }
  }

  onUp(e: PointerEvent) {
    if (this.drag) {
      this.drag = null;
      return;
    }
    if (e.button !== 0 || !this.buildStart) return;
    const { x, y } = this.mouseWorld(e);
    this.commitTool(x, y);
    this.buildStart = null;
    this.draggingNode = null;
  }

  onWheel(e: WheelEvent) {
    e.preventDefault();
    const factor = Math.pow(1.0015, -e.deltaY);
    this.engine.cam.setZoom(this.engine.cam.zoom * factor, e.clientX, e.clientY);
  }

  onKey(e: KeyboardEvent) {
    if (e.key === " ") {
      e.preventDefault();
      this.engine.togglePause();
    } else if (e.key === "n" || e.key === "N") {
      this.engine.toggleNight();
    } else if (e.key === "Escape") {
      this.setTool("pan");
    } else if (e.key === "1") this.setTool("pan");
    else if (e.key === "2") this.setTool("taxiway");
    else if (e.key === "3") this.setTool("stand");
    else if (e.key === "4") this.setTool("fuel");
    else if (e.key === "5") this.setTool("delete");
  }

  private mouseWorld(e: { clientX: number; clientY: number }): { x: number; y: number } {
    return { x: this.engine.cam.worldX(e.clientX), y: this.engine.cam.worldY(e.clientY) };
  }

  private snap(v: number): number {
    return Math.round(v / 5) * 5;
  }

  private commitTool(x: number, y: number) {
    const w = this.engine.world;
    const bs = this.buildStart!;
    switch (this.tool) {
      case "taxiway": {
        if (bs.node >= 0) {
          const target = nearestNode(w.net, x, y, ["taxiway", "hold"], 14);
          if (target !== null && target !== bs.node) {
            this.buildSegment(bs.node, target);
          }
        } else {
          // free placement: create node, connect to nearest within 80m
          const nx = this.snap(x);
          const ny = this.snap(y);
          const connect = nearestNode(w.net, nx, ny, ["taxiway", "hold"], 80);
          if (connect !== null) {
            this.buildSegment(connect, this.addNode(nx, ny));
          }
        }
        break;
      }
      case "stand": {
        const nx = this.snap(x);
        const ny = this.snap(y);
        const cost = ECO.standCost + ECO.bridgeCost;
        if (w.money < cost) {
          this.toast("Not enough funds for a stand");
          return;
        }
        const apron = nearestNode(w.net, nx, ny + 35, ["taxiway"], 90);
        if (apron === null) {
          this.toast("Place stands near a taxiway");
          return;
        }
        const label = `S${w.net.stands.length + 1}`;
        const sd = w.addStandAt(nx, ny, ["small", "medium"], label, 30);
        if (sd) {
          w.money -= cost;
          this.renderDirty();
          this.toast(`Built stand ${label} ($${(cost / 1000).toFixed(0)}k)`);
        }
        break;
      }
      case "fuel": {
        const nx = this.snap(x);
        const ny = this.snap(y);
        const connect = nearestNode(w.net, nx, ny, ["taxiway"], 90);
        if (connect === null) {
          this.toast("Fuel depot must be near a taxiway");
          return;
        }
        if (w.money < 200000) {
          this.toast("Not enough funds");
          return;
        }
        const n = w.addTaxiwayNodeAt(nx, ny, connect);
        w.net.node(n).service = "fuel";
        w.money -= 200000;
        this.renderDirty();
        this.toast("Built fuel depot");
        break;
      }
      case "delete": {
        const n = nearestNode(w.net, x, y, undefined, 30);
        if (n !== null) this.removeNode(n);
        break;
      }
    }
  }

  private addNode(x: number, y: number): number {
    const w = this.engine.world;
    const id = w.net.addNode(x, y, "taxiway");
    w.traffic.registerNode(id);
    return id;
  }

  private buildSegment(a: number, b: number) {
    const w = this.engine.world;
    const existing = w.net.edgeBetween(a, b);
    if (existing) return;
    const len = Math.hypot(w.net.node(b).x - w.net.node(a).x, w.net.node(b).y - w.net.node(a).y);
    const cost = len * ECO.taxiwayCostPerM;
    if (w.money < cost) {
      this.toast("Not enough funds for taxiway");
      return;
    }
    const eid = w.net.addEdge(a, b, { kind: "taxiway", maxSpeed: 8 });
    w.traffic.registerEdge(eid, w.net.edgeBlocks(w.net.edge(eid)));
    w.money -= cost;
    this.renderDirty();
  }

  private removeNode(n: number) {
    const w = this.engine.world;
    // don't remove critical infrastructure
    const node = w.net.node(n);
    if (node.kind === "threshold" || node.kind === "stand" || node.kind === "runway") return;
    const edges = w.net.edges.filter((e) => e.a === n || e.b === n);
    if (edges.length > 0) {
      for (const e of edges) {
        const idx = w.net.edges.indexOf(e);
        if (idx >= 0) w.net.edges.splice(idx, 1);
      }
    }
    const idx = w.net.nodes.indexOf(node);
    if (idx >= 0) w.net.nodes.splice(idx, 1);
    this.renderDirty();
  }

  private renderDirty() {
    this.engine.renderer.markDirty();
  }

  private toast(msg: string) {
    this.engine.ui.toast(msg);
  }

  update() {
    // build preview rendering is handled by renderer via engine; cursor feedback
    const c = this.engine.canvasEl;
    if (this.tool === "taxiway") c.style.cursor = this.drag ? "crosshair" : "copy";
    else if (this.tool === "pan") c.style.cursor = this.drag ? "grabbing" : "grab";
    else c.style.cursor = "crosshair";
  }
}
