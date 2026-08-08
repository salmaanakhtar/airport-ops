/** Camera: world (meters) -> screen (CSS px). +Y down. */
export class Camera {
  x = 0;
  y = -120;
  ppm = 1.1; // pixels per meter
  viewW: number;
  viewH: number;

  constructor(w: number, h: number) {
    this.viewW = w;
    this.viewH = h;
  }

  resize(w: number, h: number) {
    this.viewW = w;
    this.viewH = h;
  }

  get zoom(): number {
    return this.ppm;
  }

  setZoom(z: number, cx?: number, cy?: number) {
    const nz = Math.max(0.15, Math.min(9, z));
    if (cx !== undefined && cy !== undefined) {
      // keep world point under (cx, cy) fixed
      const wx = (cx - this.viewW / 2) / this.ppm + this.x;
      const wy = (cy - this.viewH / 2) / this.ppm + this.y;
      this.ppm = nz;
      this.x = wx - (cx - this.viewW / 2) / this.ppm;
      this.y = wy - (cy - this.viewH / 2) / this.ppm;
    } else {
      this.ppm = nz;
    }
  }

  panBy(dx: number, dy: number) {
    this.x -= dx / this.ppm;
    this.y -= dy / this.ppm;
  }

  worldX(px: number): number {
    return (px - this.viewW / 2) / this.ppm + this.x;
  }

  worldY(py: number): number {
    return (py - this.viewH / 2) / this.ppm + this.y;
  }

  /** [w, h] in world units */
  worldSize(): { w: number; h: number } {
    return { w: this.viewW / this.ppm, h: this.viewH / this.ppm };
  }
}
