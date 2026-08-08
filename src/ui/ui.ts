import type { Engine } from "../engine";
import type { ToolId } from "../input";
import { ECO } from "../game/config";

/**
 * DOM overlay HUD: status bar, tool palette, flight board, alerts, toasts.
 * Updated ~10x/sec from the engine loop.
 */
export class UI {
  private root: HTMLElement;
  private el: Record<string, HTMLElement> = {};
  private toolButtons: Record<string, HTMLButtonElement> = {};
  private boardEl: HTMLElement;
  private alertsEl: HTMLElement;
  private toastsEl: HTMLElement;
  private lastUiUpdate = 0;
  private toasts: { el: HTMLElement; ttl: number }[] = [];

  constructor(private engine: Engine) {
    this.root = document.getElementById("hud")!;
    this.root.innerHTML = `
      <div class="topbar">
        <div class="brand">
          <div class="brand-name">AIRPORT <span>//</span> OPS</div>
          <div class="brand-sub" id="airport-name"></div>
        </div>
        <div class="kpis">
          <div class="kpi"><span class="kpi-label">FUNDS</span><span class="kpi-val" id="k-money">$0</span></div>
          <div class="kpi"><span class="kpi-label">LEVEL</span><span class="kpi-val" id="k-level">1</span></div>
          <div class="kpi"><span class="kpi-label">TIME</span><span class="kpi-val" id="k-time">00:00</span></div>
          <div class="kpi"><span class="kpi-label">OTP</span><span class="kpi-val" id="k-otp">--</span></div>
          <div class="kpi"><span class="kpi-label">PAX SAT</span><span class="kpi-val" id="k-sat">--</span></div>
          <div class="kpi"><span class="kpi-label">MOVEMENTS</span><span class="kpi-val" id="k-ops">0</span></div>
        </div>
        <div class="speedctl">
          <button data-speed="0.25" title="Pause">❚❚</button>
          <button data-speed="1" class="active">1×</button>
          <button data-speed="2">2×</button>
          <button data-speed="4">4×</button>
          <button id="btn-night" title="Night (N)">☾</button>
        </div>
      </div>
      <div class="toolbar" id="toolbar"></div>
      <div class="rightcol">
        <div class="panel">
          <div class="panel-title">FLIGHT BOARD</div>
          <div id="flight-board" class="board"></div>
        </div>
        <div class="panel">
          <div class="panel-title">ALERTS</div>
          <div id="alerts" class="alerts"></div>
        </div>
      </div>
      <div class="toasts" id="toasts"></div>
      <div class="helpbar">drag = pan · wheel = zoom · 1-5 = tools · space = pause · N = night</div>
    `;
    this.boardEl = this.root.querySelector("#flight-board")!;
    this.alertsEl = this.root.querySelector("#alerts")!;
    this.toastsEl = this.root.querySelector("#toasts")!;

    const tools: { id: ToolId; icon: string; label: string; cost?: string; key: string }[] = [
      { id: "pan", icon: "✋", label: "Pan", key: "1" },
      { id: "taxiway", icon: "—", label: "Taxiway", cost: "$400/m", key: "2" },
      { id: "stand", icon: "◫", label: "Stand", cost: "$700k", key: "3" },
      { id: "fuel", icon: "⛽", label: "Fuel depot", cost: "$200k", key: "4" },
      { id: "delete", icon: "✕", label: "Remove", key: "5" },
    ];
    const tb = this.root.querySelector("#toolbar")!;
    for (const t of tools) {
      const b = document.createElement("button");
      b.className = "tool-btn";
      b.innerHTML = `<span class="tool-icon">${t.icon}</span><span class="tool-label">${t.label}${t.cost ? `<br><small>${t.cost}</small>` : ""}</span>`;
      b.addEventListener("click", () => this.engine.setTool(t.id));
      this.toolButtons[t.id] = b;
      tb.appendChild(b);
    }
    this.setTool("pan");

    const speedBtns = this.root.querySelectorAll<HTMLButtonElement>(".speedctl button");
    for (const b of speedBtns) {
      if (b.dataset.speed) {
        b.addEventListener("click", () => {
          this.engine.setSpeed(parseFloat(b.dataset.speed!));
          speedBtns.forEach((x) => x.classList.toggle("active", x === b));
        });
      }
    }
    this.root.querySelector("#btn-night")!.addEventListener("click", () => this.engine.toggleNight());
  }

  resize() {}

  setTool(t: ToolId) {
    for (const [id, b] of Object.entries(this.toolButtons)) b.classList.toggle("active", id === t);
  }

  toast(msg: string) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    this.toastsEl.appendChild(el);
    this.toasts.push({ el, ttl: 3.5 });
    while (this.toasts.length > 5) {
      const t = this.toasts.shift()!;
      t.el.remove();
    }
  }

  update() {
    const now = performance.now();
    if (now - this.lastUiUpdate < 100) return;
    this.lastUiUpdate = now;
    const w = this.engine.world;
    const set = (id: string, txt: string) => {
      const el = this.root.querySelector("#" + id)!;
      if (el.textContent !== txt) el.textContent = txt;
    };
    set("airport-name", `${w.airport.name} · ${w.airport.icao} · LVL ${w.level}`);
    set("k-money", fmtMoney(w.money));
    set("k-level", String(w.level));
    const mins = Math.floor((w.time % 1440) / 60);
    const secs = Math.floor(w.time % 60);
    set("k-time", `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")} (d${Math.floor(w.time / 1440) + 1})`);
    set("k-otp", w.stats.departures > 0 ? `${(w.stats.onTime / w.stats.departures * 100).toFixed(0)}%` : "--");
    set("k-sat", `${(w.stats.sat * 100).toFixed(0)}%`);
    set("k-ops", `${w.stats.arrivals}✈/${w.stats.departures}✈`);

    // flight board
    const flights = [...w.aircraft.values()].sort((a, b) => a.flight.schedTime - b.flight.schedTime);
    let board = "";
    if (flights.length === 0) board = `<div class="board-empty">No movements yet</div>`;
    for (const ac of flights.slice(0, 14)) {
      const f = ac.flight;
      const phase = f.phase === "turnaround" ? "TURN" : f.phase.toUpperCase();
      const delay = Math.round(f.delay / 60);
      const dCls = delay > 15 ? "late" : delay < -5 ? "early" : "";
      board += `<div class="flight-row">
        <span class="fno">${f.flightNo}</span>
        <span class="ftype">${f.acType}</span>
        <span class="frte">${f.origin}→</span>
        <span class="fpax">${f.pax}p</span>
        <span class="fphase ${dCls}">${phase}${f.delay > 0 ? ` +${delay}m` : ""}</span>
      </div>`;
    }
    this.boardEl.innerHTML = board;

    // alerts
    const alerts = w.logs.slice(-6).reverse();
    let ahtml = "";
    for (const l of alerts) {
      const t = Math.floor(l.time);
      ahtml += `<div class="alert ${l.kind}"><span class="atime">${String(Math.floor(t / 60)).padStart(2, "0")}m</span>${l.text}</div>`;
    }
    if (ahtml) this.alertsEl.innerHTML = ahtml;

    // toasts ttl
    for (const t of this.toasts) {
      t.ttl -= 0.1;
      if (t.ttl <= 0) t.el.remove();
    }
    this.toasts = this.toasts.filter((t) => t.ttl > 0);

    // pause state
    const speedBtns = this.root.querySelectorAll<HTMLButtonElement>(".speedctl button");
    for (const b of speedBtns) {
      if (b.dataset.speed) {
        const active = (parseFloat(b.dataset.speed) === this.engine.speed) !== w.paused;
        b.classList.toggle("active", parseFloat(b.dataset.speed) === this.engine.speed && !w.paused);
        void active;
      }
    }
  }
}

export function fmtMoney(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}k`;
  return `${sign}$${abs.toFixed(0)}`;
}
