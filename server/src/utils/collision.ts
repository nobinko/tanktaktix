import type { RectTerrainShape, RingSectorTerrainShape, RuntimeMapGeometry, TerrainShape, Wall } from "@tanktaktix/shared";
import { compileMapGeometry } from "@tanktaktix/shared";

function wallCenter(w: RectTerrainShape): { cx: number; cy: number } {
  return { cx: w.x + w.width / 2, cy: w.y + w.height / 2 };
}

function hasRotation(w: RectTerrainShape): boolean {
  return w.rotation !== undefined && w.rotation !== 0;
}

function toLocalSpace(px: number, py: number, w: RectTerrainShape): { lx: number; ly: number } {
  const { cx, cy } = wallCenter(w);
  const rad = -(w.rotation! * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    lx: cx + dx * cos - dy * sin,
    ly: cy + dx * sin + dy * cos,
  };
}

function toShapeFromWall(wall: Wall): RectTerrainShape {
  return {
    kind: "rect",
    x: wall.x,
    y: wall.y,
    width: wall.width,
    height: wall.height,
    terrain: wall.type ?? "wall",
    rotation: wall.rotation,
    direction: wall.direction,
    passable: wall.passable,
  };
}

function ensureGeometry(input: RuntimeMapGeometry | Wall[]): RuntimeMapGeometry {
  if (Array.isArray(input)) {
    return compileMapGeometry({ id: "legacy", width: 0, height: 0, walls: input, spawnPoints: [] });
  }
  return input;
}

function normalizeAnglePositive(angle: number): number {
  const tau = Math.PI * 2;
  return ((angle % tau) + tau) % tau;
}

function isAngleWithinSweep(angle: number, startAngle: number, sweepAngle: number): boolean {
  if (sweepAngle >= 0) {
    return normalizeAnglePositive(angle - startAngle) <= sweepAngle;
  }
  return normalizeAnglePositive(startAngle - angle) <= -sweepAngle;
}

function pointToSegmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const denom = abx * abx + aby * aby;
  if (denom === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / denom));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

function distancePointToRingSector(px: number, py: number, shape: RingSectorTerrainShape): number {
  const dx = px - shape.cx;
  const dy = py - shape.cy;
  const distance = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);

  if (isAngleWithinSweep(angle, shape.startAngle, shape.sweepAngle)) {
    if (distance >= shape.innerRadius && distance <= shape.outerRadius) return 0;
    if (distance < shape.innerRadius) return shape.innerRadius - distance;
    return distance - shape.outerRadius;
  }

  const endAngle = shape.startAngle + shape.sweepAngle;
  const startInnerX = shape.cx + Math.cos(shape.startAngle) * shape.innerRadius;
  const startInnerY = shape.cy + Math.sin(shape.startAngle) * shape.innerRadius;
  const startOuterX = shape.cx + Math.cos(shape.startAngle) * shape.outerRadius;
  const startOuterY = shape.cy + Math.sin(shape.startAngle) * shape.outerRadius;
  const endInnerX = shape.cx + Math.cos(endAngle) * shape.innerRadius;
  const endInnerY = shape.cy + Math.sin(endAngle) * shape.innerRadius;
  const endOuterX = shape.cx + Math.cos(endAngle) * shape.outerRadius;
  const endOuterY = shape.cy + Math.sin(endAngle) * shape.outerRadius;

  return Math.min(
    pointToSegmentDistance(px, py, startInnerX, startInnerY, startOuterX, startOuterY),
    pointToSegmentDistance(px, py, endInnerX, endInnerY, endOuterX, endOuterY),
  );
}

function isPointInRect(px: number, py: number, w: RectTerrainShape): boolean {
  let x = px;
  let y = py;
  if (hasRotation(w)) {
    const local = toLocalSpace(px, py, w);
    x = local.lx;
    y = local.ly;
  }
  return x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height;
}

function isCircleInRect(cx: number, cy: number, r: number, w: RectTerrainShape): boolean {
  let x = cx;
  let y = cy;
  if (hasRotation(w)) {
    const local = toLocalSpace(cx, cy, w);
    x = local.lx;
    y = local.ly;
  }
  const nearestX = Math.max(w.x, Math.min(x, w.x + w.width));
  const nearestY = Math.max(w.y, Math.min(y, w.y + w.height));
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy <= r * r;
}

function isPointInShape(x: number, y: number, shape: TerrainShape): boolean {
  if (shape.kind === "rect") return isPointInRect(x, y, shape);
  return distancePointToRingSector(x, y, shape) === 0;
}

function isCircleInShape(x: number, y: number, r: number, shape: TerrainShape): boolean {
  if (shape.kind === "rect") return isCircleInRect(x, y, r, shape);
  return distancePointToRingSector(x, y, shape) <= r;
}

export function checkWallCollision(x: number, y: number, r: number, wallsOrGeometry: RuntimeMapGeometry | Wall[]): boolean {
  const geometry = ensureGeometry(wallsOrGeometry);
  let inPassableZone = false;

  for (const shape of geometry.passable) {
    if (isPointInShape(x, y, shape)) {
      inPassableZone = true;
      break;
    }
  }

  for (const shape of geometry.blocking) {
    if (inPassableZone && (shape.terrain === "river" || shape.terrain === "water")) continue;
    if (isCircleInShape(x, y, r, shape)) return true;
  }

  return false;
}

export function checkPointInWall(x: number, y: number, wallsOrGeometry: RuntimeMapGeometry | Wall[]): boolean {
  const geometry = ensureGeometry(wallsOrGeometry);
  for (const shape of geometry.blocking) {
    if (isPointInShape(x, y, shape)) return true;
  }
  return false;
}

export function isPointInBush(x: number, y: number, wallsOrGeometry: RuntimeMapGeometry | Wall[]): boolean {
  const geometry = ensureGeometry(wallsOrGeometry);
  for (const shape of geometry.concealment) {
    if (isPointInShape(x, y, shape)) return true;
  }
  return false;
}

export function isBulletBlockedByWall(x: number, y: number, vx: number, vy: number, wallsOrGeometry: RuntimeMapGeometry | Wall[]): boolean {
  const geometry = ensureGeometry(wallsOrGeometry);

  for (const shape of geometry.bulletBlocking) {
    if (shape.kind !== "rect") continue;

    if (shape.terrain === "oneway") {
      if (isPointInRect(x, y, shape)) {
        if (shape.rotation !== undefined && shape.rotation !== 0) {
          const rad = (shape.rotation * Math.PI) / 180;
          const passDir = { x: Math.cos(rad), y: Math.sin(rad) };
          const dot = vx * passDir.x + vy * passDir.y;
          if (dot > 0) continue;
        } else if (shape.direction) {
          if (shape.direction === "up" && vy < 0) continue;
          if (shape.direction === "down" && vy > 0) continue;
          if (shape.direction === "left" && vx < 0) continue;
          if (shape.direction === "right" && vx > 0) continue;
        }
        return true;
      }
    } else if (isPointInRect(x, y, shape)) {
      return true;
    }
  }

  return false;
}

function clipLineToRect(p1: { x: number; y: number }, p2: { x: number; y: number }, minX: number, minY: number, maxX: number, maxY: number): boolean {
  let t0 = 0;
  let t1 = 1;
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
