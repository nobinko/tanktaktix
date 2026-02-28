import type { Wall } from "@tanktaktix/shared";

export function checkWallCollision(x: number, y: number, r: number, walls: Wall[]): boolean {
  for (const w of walls) {
    const type = w.type || "wall";
    if (type === "wall" || type === "water" || type === "house" || type === "oneway") {
      if (x + r > w.x && x - r < w.x + w.width && y + r > w.y && y - r < w.y + w.height) {
        return true;
      }
    }
  }
  return false;
}

export function checkPointInWall(x: number, y: number, walls: Wall[]): boolean {
  for (const w of walls) {
    const type = w.type || "wall";
    if (type === "wall" || type === "water" || type === "house" || type === "oneway") {
      if (x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height) {
        return true;
      }
    }
  }
  return false;
}

export function isPointInBush(x: number, y: number, walls: Wall[]): boolean {
  for (const w of walls) {
    if (w.type === "bush") {
      if (x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height) {
        return true;
      }
    }
  }
  return false;
}

export function isBulletBlockedByWall(x: number, y: number, vx: number, vy: number, walls: Wall[]): boolean {
  for (const w of walls) {
    const type = w.type || "wall";
    if (type === "wall" || type === "house") {
      if (x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height) {
        return true;
      }
    } else if (type === "oneway") {
      if (x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height) {
        if (w.direction === "up" && vy < 0) continue;
        if (w.direction === "down" && vy > 0) continue;
        if (w.direction === "left" && vx < 0) continue;
        if (w.direction === "right" && vx > 0) continue;
        return true;
      }
    }
  }
  return false;
}

function clipLineToRect(p1: { x: number; y: number }, p2: { x: number; y: number }, minX: number, minY: number, maxX: number, maxY: number): boolean {
  let t0 = 0, t1 = 1;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const p = [-dx, dx, -dy, dy];
  const q = [p1.x - minX, maxX - p1.x, p1.y - minY, maxY - p1.y];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1;
}

export function checkRayRotatedRect(
  rayStart: { x: number; y: number },
  rayEnd: { x: number; y: number },
  rectCenter: { x: number; y: number },
  rectSize: { w: number; h: number },
  angle: number,
  margin: number
): boolean {
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const tx1 = rayStart.x - rectCenter.x;
  const ty1 = rayStart.y - rectCenter.y;
  const localStart = { x: tx1 * cos - ty1 * sin, y: tx1 * sin + ty1 * cos };
  const tx2 = rayEnd.x - rectCenter.x;
  const ty2 = rayEnd.y - rectCenter.y;
  const localEnd = { x: tx2 * cos - ty2 * sin, y: tx2 * sin + ty2 * cos };
  const halfW = rectSize.w / 2 + margin;
  const halfH = rectSize.h / 2 + margin;
  return clipLineToRect(localStart, localEnd, -halfW, -halfH, halfW, halfH);
}
