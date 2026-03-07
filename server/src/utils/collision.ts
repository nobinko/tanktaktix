import type { Wall } from "@tanktaktix/shared";

// ---------------------------------------------------------------------------
// ユーティリティ: 回転壁のローカル座標変換
// ---------------------------------------------------------------------------

/**
 * 壁の中心座標を取得
 */
function wallCenter(w: Wall): { cx: number; cy: number } {
  return { cx: w.x + w.width / 2, cy: w.y + w.height / 2 };
}

/**
 * 壁に rotation がある場合、点をローカル座標系に変換
 * rotation が 0 または未指定なら変換不要（AABB判定のまま使える）
 */
function hasRotation(w: Wall): boolean {
  return w.rotation !== undefined && w.rotation !== 0;
}

/**
 * 点をローカル座標系（壁の中心を原点、回転を打ち消した空間）に変換
 */
function toLocalSpace(px: number, py: number, w: Wall): { lx: number; ly: number } {
  const { cx, cy } = wallCenter(w);
  const rad = -(w.rotation! * Math.PI) / 180; // 逆回転
  const dx = px - cx;
  const dy = py - cy;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    lx: cx + dx * cos - dy * sin,
    ly: cy + dx * sin + dy * cos,
  };
}

// ---------------------------------------------------------------------------
// 壁の通行可否タイプ判定
// ---------------------------------------------------------------------------

function isBlockingType(w: Wall): boolean {
  const type = w.type || "wall";
  return type === "wall" || type === "water" || type === "house" || type === "oneway" || type === "river";
}

function isBulletBlockingType(w: Wall): boolean {
  const type = w.type || "wall";
  return type === "wall" || type === "house";
}

// ---------------------------------------------------------------------------
// checkWallCollision — 円 vs AABB/OBB
// ---------------------------------------------------------------------------

/**
 * 円（中心 x,y 半径 r）が壁と衝突しているか。
 * passable な壁（ブリッジ）は判定前にチェック。
 */
export function checkWallCollision(x: number, y: number, r: number, walls: Wall[]): boolean {
  // まず passable ゾーン（ブリッジ）内にいるかチェック
  let inPassableZone = false;
  for (const w of walls) {
    if (!w.passable) continue;
    if (isPointInRect(x, y, w)) {
      inPassableZone = true;
      break;
    }
  }

  for (const w of walls) {
    if (w.passable) continue;
    if (!isBlockingType(w)) continue;

    // リバーの場合、ブリッジ内にいるなら判定スキップ
    if (inPassableZone && (w.type === "river" || w.type === "water")) continue;

    if (isCircleInRect(x, y, r, w)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// checkPointInWall — 点 vs AABB/OBB
// ---------------------------------------------------------------------------

export function checkPointInWall(x: number, y: number, walls: Wall[]): boolean {
  for (const w of walls) {
    if (w.passable) continue;
    if (!isBlockingType(w)) continue;
    if (isPointInRect(x, y, w)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// isPointInBush — 点 vs AABB/OBB
// ---------------------------------------------------------------------------

export function isPointInBush(x: number, y: number, walls: Wall[]): boolean {
  for (const w of walls) {
    if (w.type !== "bush") continue;
    if (isPointInRect(x, y, w)) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// isBulletBlockedByWall — 点 vs AABB/OBB + oneway方向判定
// ---------------------------------------------------------------------------

export function isBulletBlockedByWall(x: number, y: number, vx: number, vy: number, walls: Wall[]): boolean {
  for (const w of walls) {
    if (w.passable) continue;
    const type = w.type || "wall";

    if (type === "oneway") {
      if (isPointInRect(x, y, w)) {
        // oneway の方向判定
        if (w.rotation !== undefined && w.rotation !== 0) {
          // 回転ベースの方向判定: rotation=0 → 通過方向は右（+x）
          const rad = (w.rotation * Math.PI) / 180;
          const passDir = { x: Math.cos(rad), y: Math.sin(rad) };
          const dot = vx * passDir.x + vy * passDir.y;
          if (dot > 0) continue; // 通過方向なのでブロックしない
        } else if (w.direction) {
          // レガシー direction ベース
          if (w.direction === "up" && vy < 0) continue;
          if (w.direction === "down" && vy > 0) continue;
          if (w.direction === "left" && vx < 0) continue;
          if (w.direction === "right" && vx > 0) continue;
        }
        return true;
      }
    } else if (isBulletBlockingType(w)) {
      if (isPointInRect(x, y, w)) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// ヘルパー: 点が矩形内にあるか（回転対応）
// ---------------------------------------------------------------------------

function isPointInRect(px: number, py: number, w: Wall): boolean {
  let x = px, y = py;
  if (hasRotation(w)) {
    const local = toLocalSpace(px, py, w);
    x = local.lx;
    y = local.ly;
  }
  return x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height;
}

// ---------------------------------------------------------------------------
// ヘルパー: 円が矩形と衝突しているか（回転対応）
// 円の中心をローカル空間に変換 → 最近傍点との距離で判定
// ---------------------------------------------------------------------------

function isCircleInRect(cx: number, cy: number, r: number, w: Wall): boolean {
  let x = cx, y = cy;
  if (hasRotation(w)) {
    const local = toLocalSpace(cx, cy, w);
    x = local.lx;
    y = local.ly;
  }
  // AABB vs 円: 最近傍点との距離
  const nearestX = Math.max(w.x, Math.min(x, w.x + w.width));
  const nearestY = Math.max(w.y, Math.min(y, w.y + w.height));
  const dx = x - nearestX;
  const dy = y - nearestY;
  return dx * dx + dy * dy <= r * r;
}

// ---------------------------------------------------------------------------
// 既存のレイキャスト判定（弾丸の射線チェック用）
// ---------------------------------------------------------------------------

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
