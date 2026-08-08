import { Engine } from "./engine";
import "./ui/styles.css";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const engine = new Engine(canvas);
engine.start();

// dev hooks: synchronous fast-forward for automated visual QA
function fastForward(seconds: number) {
  const step = 1 / 30;
  let remaining = seconds;
  while (remaining > 0) {
    engine.world.tick(step);
    remaining -= step;
  }
  engine.renderer.render(engine.night);
}

// debug hook
(window as any).game = engine;
(window as any).__ff = fastForward;

// ?bench=Ns fast-forwards N game-seconds at startup (headless QA)
const bench = new URLSearchParams(location.search).get("bench");
if (bench) fastForward(parseFloat(bench));
