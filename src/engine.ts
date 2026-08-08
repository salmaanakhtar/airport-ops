import { World } from "./sim/world";
import { Camera } from "./render/camera";
import { Renderer } from "./render/renderer";
import { InputController } from "./input";
import { UI } from "./ui/ui";

/** Game engine: fixed-timestep simulation + per-frame render + UI.
 * The sim runs on a visibility-independent interval so background tabs keep
 * simulating; rAF drives rendering. */
export class Engine {
  world: World;
  cam: Camera;
  renderer: Renderer;
  input: InputController;
  ui: UI;
  speed = 1;
  night = false;
  private last = performance.now();
  private acc = 0;
  private raf = 0;
  private timer: ReturnType<typeof setInterval>;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.world = new World();
    this.cam = new Camera(window.innerWidth, window.innerHeight);
    this.renderer = new Renderer(canvas, this.world, this.cam);
    this.ui = new UI(this);
    this.input = new InputController(this);
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.step = this.step.bind(this);
    this.render = this.render.bind(this);
    this.timer = setInterval(this.step, 1000 / 30);
  }

  resize() {
    this.renderer.resize(window.innerWidth, window.innerHeight);
    this.ui.resize();
  }

  start() {
    this.raf = requestAnimationFrame(this.render);
  }

  private step() {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (!this.world.paused) {
      this.acc += dt * this.speed;
      const step = 1 / 30;
      let n = 0;
      while (this.acc >= step && n < 12) {
        this.world.tick(step);
        this.acc -= step;
        n++;
      }
      if (n === 12) this.acc = 0;
    }
    this.input.update();
    this.ui.update();
  }

  private render(t: number) {
    this.raf = requestAnimationFrame(this.render);
    void t;
    this.renderer.render(this.night);
  }

  setTool(tool: import("./input").ToolId) {
    this.input.setTool(tool);
  }

  setSpeed(s: number) {
    this.speed = s;
  }

  togglePause() {
    this.world.paused = !this.world.paused;
  }

  toggleNight() {
    this.night = !this.night;
  }

  get canvasEl(): HTMLCanvasElement {
    return this.canvas;
  }
}
