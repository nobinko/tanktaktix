import * as crypto from "crypto";
import * as fs from "fs";
import express from "express";
import http from "http";
import * as path from "path";
import { WebSocket, WebSocketServer } from "ws";
import type {
  BulletPublic, Explosion, MapData, PlayerSummary, RoomState, Team, Vector2,
  Item, ItemType, Wall, WallType, Flag
} from "@tanktaktix/shared";
// Assumes shared is linked/built

/**
 * server/src/index.ts
 *
 * Tankmatch Features:
 * - Walls (MapData)
 * - Move Cooldown (Turn-based style)
 * - Teams (Red/Blue)
 * - Explosions (AoE Damage, Friendly Fire rules)
 */

// Global Error Handlers to prevent crash without logs
process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});



type ClientMsg = { type: string; payload?: unknown };
type ServerMsg = { type: string; payload?: unknown };

type PlayerRuntime = {
  id: string;
  name: string;
  team: Team;

  x: number;
  y: number;

  hp: number;
  ammo: number;
  // score/kills/deaths moved to Stats section below

  roomId: string | null;

  aimDir: Vector2; // unit
  pendingMove: Vector2 | null; // unit (legacy directional, kept for compat)
  moveQueue: { x: number; y: number; cost: number }[]; // click-to-move queue (max MOVE_QUEUE_MAX)

  hullAngle: number;    // current hull facing (radians)
  turretAngle: number;  // current turret facing (radians)
  isRotating: boolean;  // true during pivot-turn phase

  isMoving: boolean;
  // Stats
  score: number;
  kills: number;
  deaths: number;
  hits: number;
  fired: number;

  cooldownUntil: number; // Block all actions until this time

  respawnAt: number | null;
  respawnCooldownUntil: number; // Instant respawn cooldown end time
  isHidden: boolean;

  // Phase 4 item state
  hasBomb: boolean;       // true = next shot is a bomb shot
  ropeCount: number;      // 0~2 rope items held
  bootsCharges: number;   // 0 = no boots, 1~3 = remaining move arrivals

  socket: WebSocket | null; // Null if disconnected but keeping state for rejoin
  disconnectedAt: number | null;
};

type Bullet = {
  id: string;
  shooterId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  startX: number;
  startY: number;
  expiresAt: number;
  isBomb?: boolean; // Phase 4: bomb shot = 3x explosion radius
  isRope?: boolean; // Phase 4: rope projectile for item/flag pickup
  ropeOwnerId?: string; // Who fired the rope (for item collection)
  isAmmoPass?: boolean;
  isHealPass?: boolean;
  isFlagPass?: boolean;
  flagTeam?: Team;
};

type Room = {
  id: string;
  name: string;
  mapId: string;
  mapData: MapData;
  passwordProtected: boolean;
  password?: string;

  maxPlayers: number;
  timeLimitSec: number;

  createdAt: number;
  endsAt: number;
  ended: boolean;
  gameMode: "deathmatch" | "ctf";

  playerIds: Set<string>;
  spectatorIds: Set<string>; // Spectators watching the room
  bullets: Bullet[];
  explosions: Explosion[]; // Transient events to sync
  items: Item[];           // Persistent items on map
  lastItemSpawnAt: number;
  flags: Flag[];           // CTF: current flag states
  scoreRed: number;
  scoreBlue: number;
  history: Map<string, {
    name: string;
    team: Team;
    kills: number;
    deaths: number;
    score: number;
    fired: number;
    hits: number;
  }>;
};

const PORT = Number(process.env.PORT ?? 3000);

// --- gameplay tuning ---
const TICK_MS = 50;

// MAP_W / MAP_H removed — use room.mapData.width / room.mapData.height instead

const MOVE_SPEED = 6; // per tick

// Action lock (1 step = 300ms)
const ACTION_LOCK_STEP_MS = 300;
const ACTION_COOLDOWN_MS = 1800; // 6 steps (shoot, item, bump, etc.)

const MOVE_QUEUE_MAX = 5; // max queued move targets

// Rotation speeds (radians per tick)
const HULL_ROTATION_SPEED = Math.PI / 15;    // ~12 deg/tick → ~180° in 0.75s
const TURRET_ROTATION_SPEED = Math.PI / 10;  // ~18 deg/tick → faster than hull

const RESPAWN_MS = 1500;
const RESPAWN_COOLDOWN_MS = 1500; // CD for invincibility after instant respawn

const TANK_SIZE = 18;

// bullets & explosions
const BULLET_SPEED = 220;
const BULLET_RADIUS = 4;
const BULLET_RANGE = 99999;
const BULLET_TTL_MS = Math.ceil((BULLET_RANGE / BULLET_SPEED) * 1000);

const EXPLOSION_RADIUS = 40; // AoE radius
const EXPLOSION_DAMAGE = 20; // AoE damage
const HIT_RADIUS = TANK_SIZE; // Hitbox radius

const RECONNECT_TIMEOUT_MS = 60000;

const FLAG_RADIUS = 25; // Detection radius for taking/capturing (legacy, used for friendly return)
const FLAG_SCORE = 5; // Team score for capturing a flag
const SPAWN_ZONE_HALF = 100; // Half-size of 200x200 spawn zone (used for flag pickup & capture)

const ITEM_RADIUS = 15;
const MEDIC_HEAL_AMOUNT = 20;
const AMMO_REFILL_AMOUNT = 10;

// Phase 4-1: Fixed item pool per map (total 12 items)
const ITEM_POOL: { type: ItemType; count: number }[] = [
  { type: "medic", count: 2 },
  { type: "ammo", count: 2 },
  { type: "heart", count: 2 },
  { type: "bomb", count: 2 },
  { type: "rope", count: 2 },
  { type: "boots", count: 2 },
];

// --- Maps (all 1800×1040) ---

/** alpha — クラシック: 縦壁2本＋角カバー＋中央アイランド */
const MAP_ALPHA: MapData = {
  id: "alpha",
  width: 1800,
  height: 1040,
  walls: [
    { x: 600, y: 200, width: 60, height: 440 },  // 左縦壁
    { x: 1140, y: 400, width: 60, height: 440 },  // 右縦壁（下寄せ）
    { x: 180, y: 160, width: 220, height: 60 },  // 左上カバー
    { x: 1400, y: 820, width: 220, height: 60 },  // 右下カバー
    { x: 840, y: 460, width: 120, height: 120 },  // 中央アイランド
  ],
  spawnPoints: [
    { team: "red", x: 120, y: 520 },
    { team: "blue", x: 1680, y: 520 },
  ],
  flagPositions: [
    { team: "red", x: 120, y: 520 },
    { team: "blue", x: 1680, y: 520 },
  ],
};

/** beta — アーバン: 6本縦ピラーで3コリドー＋左右カバー */
const MAP_BETA: MapData = {
  id: "beta",
  width: 1800,
  height: 1040,
  walls: [
    { x: 400, y: 180, width: 60, height: 280 },  // 左上ピラー
    { x: 400, y: 580, width: 60, height: 280 },  // 左下ピラー
    { x: 870, y: 120, width: 60, height: 340 },  // 中央上ピラー
    { x: 870, y: 580, width: 60, height: 340 },  // 中央下ピラー
    { x: 1340, y: 180, width: 60, height: 280 },  // 右上ピラー
    { x: 1340, y: 580, width: 60, height: 280 },  // 右下ピラー
    { x: 160, y: 460, width: 180, height: 60 },  // 左横カバー
    { x: 1460, y: 520, width: 180, height: 60 },  // 右横カバー
  ],
  spawnPoints: [
    { team: "red", x: 80, y: 520 },
    { team: "blue", x: 1720, y: 520 },
  ],
  flagPositions: [
    { team: "red", x: 80, y: 520 },
    { team: "blue", x: 1720, y: 520 },
  ],
};

/** gamma — フォート: 中央要塞＋外側カバー2個 */
const MAP_GAMMA: MapData = {
  id: "gamma",
  width: 1800,
  height: 1040,
  walls: [
    { x: 560, y: 200, width: 60, height: 260 },  // 要塞 左上縦
    { x: 1180, y: 200, width: 60, height: 260 },  // 要塞 右上縦
    { x: 560, y: 580, width: 60, height: 260 },  // 要塞 左下縦
    { x: 1180, y: 580, width: 60, height: 260 },  // 要塞 右下縦
    { x: 620, y: 200, width: 560, height: 60 },  // 要塞 上辺
    { x: 620, y: 780, width: 560, height: 60 },  // 要塞 下辺
    { x: 200, y: 440, width: 240, height: 60 },  // 左外カバー
    { x: 1360, y: 540, width: 240, height: 60 },  // 右外カバー
  ],
  spawnPoints: [
    { team: "red", x: 100, y: 520 },
    { team: "blue", x: 1700, y: 520 },
  ],
  flagPositions: [
    { team: "red", x: 100, y: 520 },
    { team: "blue", x: 1700, y: 520 },
  ],
};



/** delta — 自然: ブッシュと水場が点対称に配置 */
const MAP_DELTA: MapData = {
  id: "delta",
  width: 1800,
  height: 1040,
  walls: [
    // 左上ブッシュ (Red側隠れ家)
    { x: 250, y: 170, width: 250, height: 300, type: "bush" },
    // 左下水場
    { x: 250, y: 570, width: 250, height: 300, type: "water" },
    // 右下ブッシュ (Blue側隠れ家) — 点対称
    { x: 1300, y: 570, width: 250, height: 300, type: "bush" },
    // 右上水場 — 点対称
    { x: 1300, y: 170, width: 250, height: 300, type: "water" },
    // 中央壁（上下対称）
    { x: 850, y: 100, width: 100, height: 280, type: "wall" },
    { x: 850, y: 660, width: 100, height: 280, type: "wall" },
  ],
  spawnPoints: [
    { team: "red", x: 100, y: 520 },
    { team: "blue", x: 1700, y: 520 },
  ],
  flagPositions: [
    { team: "red", x: 100, y: 520 },
    { team: "blue", x: 1700, y: 520 },
  ],
};

function createBase(x: number, y: number, size: number, entranceType: "top-bottom" | "1-way" | "adjacent" | "3-way" | "open-right" | "open-left" | "open-top" | "open-bottom", thickness: number = 40, type: WallType = "wall"): Wall[] {
  const walls: Wall[] = [];
  const g = 100; // Entrance gap size
  const s2 = size / 2;
  const hg = g / 2; // half gap

  const addWall = (wx: number, wy: number, w: number, h: number) => walls.push({ x: wx, y: wy, width: w, height: h, type });

  // Top
  if (entranceType !== "open-top") {
    if (entranceType === "top-bottom" || entranceType === "3-way") {
      addWall(x, y, s2 - hg, thickness);
      addWall(x + s2 + hg, y, s2 - hg, thickness);
    } else {
      addWall(x, y, size, thickness);
    }
  }

  // Bottom
  if (entranceType !== "open-bottom") {
    if (entranceType === "top-bottom" || entranceType === "1-way" || entranceType === "adjacent" || entranceType === "3-way") {
      addWall(x, y + size - thickness, s2 - hg, thickness);
      addWall(x + s2 + hg, y + size - thickness, s2 - hg, thickness);
    } else {
      addWall(x, y + size - thickness, size, thickness);
    }
  }

  // Left
  if (entranceType !== "open-left") {
    if (entranceType === "3-way") {
      addWall(x, y + thickness, thickness, s2 - hg - thickness);
      addWall(x, y + s2 + hg, thickness, s2 - hg - thickness);
    } else {
      addWall(x, y + thickness, thickness, size - thickness * 2);
    }
  }

  // Right
  if (entranceType !== "open-right") {
    if (entranceType === "adjacent") {
      addWall(x + size - thickness, y + thickness, thickness, s2 - hg - thickness);
      addWall(x + size - thickness, y + s2 + hg, thickness, s2 - hg - thickness);
    } else {
      addWall(x + size - thickness, y + thickness, thickness, size - thickness * 2);
    }
  }

  return walls;
}

/** epsilon — テスト: 障害物検証用マップ (Playable & Symmetric) */
const MAP_EPSILON: MapData = {
  id: "epsilon",
  width: 1800,
  height: 1040,
  walls: [
    // Red Base Protections ( [ shaped )
    ...createBase(25, 420, 200, "open-right", 30, "house"),

    // Blue Base Protections (Point Symmetric to Red, ] shaped )
    ...createBase(1575, 420, 200, "open-left", 30, "house"),

    // Central One-Way Corridors
    { x: 800, y: 300, width: 20, height: 150, type: "oneway", direction: "right" },
    { x: 980, y: 590, width: 20, height: 150, type: "oneway", direction: "left" },
    { x: 800, y: 700, width: 150, height: 20, type: "oneway", direction: "up" },
    { x: 850, y: 320, width: 150, height: 20, type: "oneway", direction: "down" },

    // Obstacles
    { x: 860, y: 480, width: 80, height: 80, type: "house" }, // Center block
    { x: 350, y: 150, width: 200, height: 60, type: "wall" }, // Top structure
    { x: 1250, y: 830, width: 200, height: 60, type: "wall" }, // Bottom structure

    // Additional symmetry covers
    { x: 450, y: 750, width: 60, height: 150, type: "bush" },
    { x: 1290, y: 140, width: 60, height: 150, type: "bush" },
  ],
  spawnPoints: [
    { team: "red", x: 125, y: 520 },
    { team: "blue", x: 1675, y: 520 },
  ],
  flagPositions: [
    { team: "red", x: 100, y: 520 },
    { team: "blue", x: 1700, y: 520 },
  ],
};

const MAP_TEST_S: MapData = {
  id: "test-s",
  width: 1000,
  height: 1000,
  walls: [],
  spawnPoints: [
    { team: "red", x: 100, y: 500 },
    { team: "blue", x: 900, y: 500 },
  ],
  flagPositions: [
    { team: "red", x: 100, y: 500 },
    { team: "blue", x: 900, y: 500 },
  ],
};

const MAP_TEST_M: MapData = {
  id: "test-m",
  width: 1200,
  height: 1200,
  walls: [],
  spawnPoints: [
    { team: "red", x: 100, y: 600 },
    { team: "blue", x: 1100, y: 600 },
  ],
  flagPositions: [
    { team: "red", x: 100, y: 600 },
    { team: "blue", x: 1100, y: 600 },
  ],
};

const MAP_TEST_L: MapData = {
  id: "test-l",
  width: 1500,
  height: 1500,
  walls: [],
  spawnPoints: [
    { team: "red", x: 100, y: 750 },
    { team: "blue", x: 1400, y: 750 },
  ],
  flagPositions: [
    { team: "red", x: 100, y: 750 },
    { team: "blue", x: 1400, y: 750 },
  ],
};

const DEFAULT_MAP = MAP_ALPHA;

const MAPS: Record<string, MapData> = {
  alpha: MAP_ALPHA,
  beta: MAP_BETA,
  gamma: MAP_GAMMA,
  delta: MAP_DELTA,
  epsilon: MAP_EPSILON,
  "test-s": MAP_TEST_S,
  "test-m": MAP_TEST_M,
  "test-l": MAP_TEST_L,
};

// --- utils ---
function nowMs() {
  return Date.now();
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function len(v: Vector2) {
  return Math.hypot(v.x, v.y);
}

function norm(v: Vector2): Vector2 {
  const l = len(v);
  if (!l) return { x: 0, y: 0 };
  return { x: v.x / l, y: v.y / l };
}

/** Normalize angle to [-π, π] */
function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function checkWallCollision(x: number, y: number, r: number, walls: Wall[]): boolean {
  for (const w of walls) {
    // Tank is blocked by regular walls and water, plus house and oneway
    const type = w.type || "wall";
    if (type === "wall" || type === "water" || type === "house" || type === "oneway") {
      if (
        x + r > w.x &&
        x - r < w.x + w.width &&
        y + r > w.y &&
        y - r < w.y + w.height
      ) {
        return true;
      }
    }
  }
  return false;
}

function checkPointInWall(x: number, y: number, walls: Wall[]): boolean {
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

function isPointInBush(x: number, y: number, walls: Wall[]): boolean {
  for (const w of walls) {
    if (w.type === "bush") {
      if (x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height) {
        return true;
      }
    }
  }
  return false;
}

function distPointToSegment(
  p: { x: number; y: number },
  v: { x: number; y: number },
  w: { x: number; y: number }
) {
  const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
}

function isBulletBlockedByWall(x: number, y: number, vx: number, vy: number, walls: Wall[]): boolean {
  for (const w of walls) {
    const type = w.type || "wall";
    if (type === "wall" || type === "house") {
      if (x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height) {
        return true;
      }
    } else if (type === "oneway") {
      if (x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height) {
        // Allow passing if bullet direction matches oneway permeable direction
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

/**
 * Check if a ray (p1->p2) intersects a localized AABB (minX, minY, maxX, maxY)
 * using Liang-Barsky algorithm.
 */
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

/**
 * Check collision between Ray (prev->curr) and Rotated Rectangle (Tank).
 * rectSize: { w, h }
 */
function checkRayRotatedRect(
  rayStart: { x: number; y: number },
  rayEnd: { x: number; y: number },
  rectCenter: { x: number; y: number },
  rectSize: { w: number; h: number },
  angle: number,
  margin: number
): boolean {
  // 1. Transform ray to local rect coordinates
  // Rotate ray points by -angle around rectCenter
  // Shift to origin
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);

  const tx1 = rayStart.x - rectCenter.x;
  const ty1 = rayStart.y - rectCenter.y;
  const localStart = {
    x: tx1 * cos - ty1 * sin,
    y: tx1 * sin + ty1 * cos
  };

  const tx2 = rayEnd.x - rectCenter.x;
  const ty2 = rayEnd.y - rectCenter.y;
  const localEnd = {
    x: tx2 * cos - ty2 * sin,
    y: tx2 * sin + ty2 * cos
  };

  // 2. AABB check against expanded rect
  // Tank visual size: 26x20. Expand by bullet radius (margin).
  const halfW = rectSize.w / 2 + margin;
  const halfH = rectSize.h / 2 + margin;

  return clipLineToRect(localStart, localEnd, -halfW, -halfH, halfW, halfH);
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function pickNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function pickVector2(v: unknown, fallback: Vector2): Vector2 {
  if (!isRecord(v)) return fallback;
  const x = pickNumber(v.x, fallback.x);
  const y = pickNumber(v.y, fallback.y);
  return { x, y };
}

function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Math.random().toString(16).slice(2)} -${Math.random().toString(16).slice(2)} `;
}

function send(ws: WebSocket | null, msg: ServerMsg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

// --- state ---
const players = new Map<string, PlayerRuntime>();
const rooms = new Map<string, Room>();

function toPlayerPublic(p: PlayerRuntime) {
  return {
    id: p.id,
    name: p.name,
    team: p.team,
    roomId: p.roomId,
    x: p.x,
    y: p.y,
    position: { x: p.x, y: p.y },
    target: p.moveQueue.length > 0 ? p.moveQueue[0] : { x: p.x, y: p.y },
    moveQueue: p.moveQueue,
    hp: p.hp,
    ammo: p.ammo,
    score: p.score,
    respawnAt: p.respawnAt,
    respawnCooldownUntil: p.respawnCooldownUntil,
    // Action lock: compute current step from remaining cooldown ms (1 step = 300ms)
    nextActionAt: p.cooldownUntil,
    actionLockStep: Math.max(0, Math.ceil((p.cooldownUntil - nowMs()) / ACTION_LOCK_STEP_MS)),
    hullAngle: p.hullAngle,
    turretAngle: p.turretAngle,
    // Stats
    kills: p.kills,
    deaths: p.deaths,
    hits: p.hits,
    fired: p.fired,
    isHidden: p.isHidden,
    // Phase 4 item state
    hasBomb: p.hasBomb,
    ropeCount: p.ropeCount,
    bootsCharges: p.bootsCharges,
  };
}

function toBulletPublic(b: Bullet): BulletPublic {
  return {
    id: b.id,
    shooterId: b.shooterId,
    x: b.x,
    y: b.y,
    position: { x: b.x, y: b.y },
    radius: b.radius,
    startX: b.startX,
    startY: b.startY,
    isBomb: b.isBomb || false,
    isRope: b.isRope || false,
    isAmmoPass: b.isAmmoPass || false,
    isHealPass: b.isHealPass || false,
    isFlagPass: b.isFlagPass || false,
    flagTeam: b.flagTeam,
  };
}

function toRoomSummary(r: Room) {
  const playerIds = [...r.playerIds];
  return {
    id: r.id,
    name: r.name,
    roomName: r.name,
    mapId: r.mapId,
    mapData: r.mapData,
    passwordProtected: r.passwordProtected,
    maxPlayers: r.maxPlayers,
    timeLimitSec: r.timeLimitSec,
    createdAt: r.createdAt,
    endsAt: r.endsAt,
    ended: r.ended,
    gameMode: r.gameMode,
    players: playerIds,
    playerCount: playerIds.length,
    spectatorCount: r.spectatorIds.size,
  };
}

function lobbyStatePayload() {
  const list = [...rooms.values()]
    .filter(r => !r.ended) // Hide ended rooms
    .map(toRoomSummary);
  list.sort((a, b) => b.createdAt - a.createdAt);

  // Exclude players who are in a room (including spectators)
  const onlinePlayers = [...players.values()]
    .filter(p => !p.roomId)
    .map(p => ({ id: p.id, name: p.name }));

  return { rooms: list, onlinePlayers };
}

function roomStatePayloadForPlayer(roomId: string, recipient: PlayerRuntime) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const timeLeftSec = Math.max(0, Math.ceil((room.endsAt - nowMs()) / 1000));

  const ps = [...room.playerIds]
    .map(pid => players.get(pid))
    .filter((p): p is PlayerRuntime => !!p)
    .filter(p => {
      // Visibility Logic (B-2/B-5)
      if (p.id === recipient.id) return true; // Always see self
      if (p.team && p.team === recipient.team) return true; // Always see teammates
      return !p.isHidden; // Only see enemies if not hidden
    })
    .map(toPlayerPublic);

  const bs = room.bullets.map(toBulletPublic);
  const es = room.explosions;

  return {
    roomId: room.id,
    roomName: room.name,
    mapId: room.mapId,
    timeLeftSec,
    room: toRoomSummary(room),
    players: ps,
    bullets: bs,
    projectiles: bs,
    explosions: es,
    gameMode: room.gameMode,
    teamScores: { red: room.scoreRed, blue: room.scoreBlue },
    mapData: room.mapData,
    flags: room.gameMode === "ctf" ? room.flags : undefined,
    items: room.items,
  };
}

/** Spectator version: no stealth filter — spectators see ALL players */
function roomStatePayloadForSpectator(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const timeLeftSec = Math.max(0, Math.ceil((room.endsAt - nowMs()) / 1000));

  // Spectators see ALL players (no stealth filter)
  const ps = [...room.playerIds]
    .map(pid => players.get(pid))
    .filter((p): p is PlayerRuntime => !!p)
    .map(toPlayerPublic);

  const bs = room.bullets.map(toBulletPublic);
  const es = room.explosions;

  return {
    roomId: room.id,
    roomName: room.name,
    mapId: room.mapId,
    timeLeftSec,
    room: toRoomSummary(room),
    players: ps,
    bullets: bs,
    projectiles: bs,
    explosions: es,
    gameMode: room.gameMode,
    teamScores: { red: room.scoreRed, blue: room.scoreBlue },
    mapData: room.mapData,
    flags: room.gameMode === "ctf" ? room.flags : undefined,
    items: room.items,
  };
}

function broadcastLobby() {
  const payload = lobbyStatePayload();
  for (const p of players.values()) {
    if (p.roomId === null) send(p.socket, { type: "lobby", payload });
  }
}

function broadcastRoom(roomId: string, msg: ServerMsg) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const pid of room.playerIds) {
    const p = players.get(pid);
    // Double-check: ensure the player actually thinks they are in this room
    if (p && p.roomId === roomId) send(p.socket, msg);
  }
  // Also broadcast to spectators
  for (const sid of room.spectatorIds) {
    const s = players.get(sid);
    if (s && s.roomId === roomId) send(s.socket, msg);
  }
}

function sendRoomState(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const pid of room.playerIds) {
    const p = players.get(pid);
    if (!p || p.roomId !== roomId) continue;
    const payload = roomStatePayloadForPlayer(roomId, p);
    if (payload) send(p.socket, { type: "room", payload });
  }
  // Send to spectators (full visibility, no stealth filter)
  for (const sid of room.spectatorIds) {
    const s = players.get(sid);
    if (!s || s.roomId !== roomId) continue;
    const payload = roomStatePayloadForSpectator(roomId);
    if (payload) send(s.socket, { type: "room", payload });
  }
}

function detachFromRoom(p: PlayerRuntime) {
  if (!p.roomId) return;
  const oldRoomId = p.roomId;
  const old = rooms.get(oldRoomId);
  if (old) {
    old.playerIds.delete(p.id);
    old.spectatorIds.delete(p.id); // Also remove from spectators
    if (old.playerIds.size === 0 && old.spectatorIds.size === 0) {
      // Persistent Room: Keep valid until time ends
      if (nowMs() < old.endsAt) {
        console.log(`Room ${old.id} is empty but kept because time remains.`);
      } else {
        rooms.delete(old.id);
        console.log(`Room ${old.id} deleted(empty & time up).`);
      }
    }
  }
  p.roomId = null;
  p.pendingMove = null;
  p.moveQueue = [];
  p.team = null;
  p.isMoving = false;
  p.cooldownUntil = 0;
  p.respawnCooldownUntil = 0;

  sendRoomState(oldRoomId);
}

function joinLobby(p: PlayerRuntime) {
  detachFromRoom(p);
  send(p.socket, { type: "lobby", payload: lobbyStatePayload() });
  broadcastLobby();
}

function assignTeam(room: Room): Team {
  let red = 0;
  let blue = 0;
  for (const pid of room.playerIds) {
    const p = players.get(pid);
    // console.log(`[AssignTeam] Checking ${ pid }: Team = ${ p?.team } `);
    if (p?.team === "red") red++;
    if (p?.team === "blue") blue++;
  }
  return red <= blue ? "red" : "blue";
}

function spawnPlayer(p: PlayerRuntime, room: Room) {
  const map = room.mapData;
  const teamSpawns = map.spawnPoints.filter(sp => sp.team === p.team);
  let baseX: number;
  let baseY: number;

  const otherPlayers = Array.from(room.playerIds)
    .map(id => players.get(id))
    .filter(other => other && other.id !== p.id && other.hp > 0 && other.respawnAt === null);

  let foundSpot = false;
  let attempts = 0;

  while (attempts < 20 && !foundSpot) {
    if (teamSpawns.length > 0) {
      const sp = teamSpawns[Math.floor(Math.random() * teamSpawns.length)];
      baseX = sp.x;
      baseY = sp.y;
    } else {
      baseX = 150 + Math.random() * 200;
      baseY = 150 + Math.random() * 200;
    }

    const tx = clamp(baseX + (Math.random() * 80 - 40), TANK_SIZE, map.width - TANK_SIZE);
    const ty = clamp(baseY + (Math.random() * 80 - 40), TANK_SIZE, map.height - TANK_SIZE);

    // Check Wall
    if (checkWallCollision(tx, ty, TANK_SIZE, map.walls)) {
      attempts++;
      continue;
    }

    // Check Players (TANK_SIZE is radius, so diam is TANK_SIZE*2)
    const tooClose = otherPlayers.some(other => {
      if (!other) return false;
      return Math.hypot(tx - other.x, ty - other.y) < TANK_SIZE * 2.2; // 2.2 for a bit of margin
    });

    if (tooClose) {
      attempts++;
      continue;
    }

    p.x = tx;
    p.y = ty;
    foundSpot = true;
  }

  // Fallback if no perfect spot found: use last attempts' coordinates or just spawn anyway
  if (!foundSpot) {
    console.log(`[DEBUG] Could not find perfectly clear spawn spot for ${p.id}, spawning at default.`);
    if (teamSpawns.length > 0) {
      const sp = teamSpawns[0];
      p.x = sp.x;
      p.y = sp.y;
    }
  }

  p.hp = 100;
  p.ammo = 20;
  p.respawnAt = null;
  p.pendingMove = null;
  p.moveQueue = [];
  p.isMoving = false;
  p.isRotating = false;
  p.cooldownUntil = 0;
  // Note: we do not reset respawnCooldownUntil here. It's set explicitly upon death.
  p.hullAngle = 0;
  p.turretAngle = 0;
  // Phase 4: Reset item state on respawn
  p.hasBomb = false;
  p.ropeCount = 0;
  p.bootsCharges = 0;

  // Stats (score/kills/deaths/hits/fired) are NOT reset here.
  // They are reset once in joinRoom() at initial spawn only.
}

/** Find a random open position on the map (not inside walls) */
function findRandomItemPosition(map: MapData): { x: number; y: number } | null {
  for (let attempts = 0; attempts < 30; attempts++) {
    const x = Math.random() * (map.width - 100) + 50;
    const y = Math.random() * (map.height - 100) + 50;
    if (!checkWallCollision(x, y, ITEM_RADIUS, map.walls)) {
      return { x, y };
    }
  }
  return null;
}

/** Phase 4-1: Initialize all items from pool at game start */
function initializeItems(room: Room) {
  room.items = [];
  for (const entry of ITEM_POOL) {
    for (let i = 0; i < entry.count; i++) {
      const pos = findRandomItemPosition(room.mapData);
      if (pos) {
        room.items.push({
          id: newId(),
          x: pos.x,
          y: pos.y,
          type: entry.type,
          spawnedAt: nowMs(),
        });
      }
    }
  }
  console.log(`[DEBUG] Initialized ${room.items.length} items for room ${room.id}`);
}

/** Phase 4-1: Respawn a single item of the given type at a random location */
function respawnItem(room: Room, type: ItemType) {
  const pos = findRandomItemPosition(room.mapData);
  if (pos) {
    room.items.push({
      id: newId(),
      x: pos.x,
      y: pos.y,
      type,
      spawnedAt: nowMs(),
    });
  }
}

function joinRoom(p: PlayerRuntime, roomId: string, password?: string) {
  const room = rooms.get(roomId);
  if (!room) {
    send(p.socket, { type: "error", payload: { message: "Room not found." } });
    return;
  }
  if (room.passwordProtected && room.password !== password) {
    send(p.socket, { type: "error", payload: { message: "Invalid password." } });
    return;
  }
  if (room.playerIds.size >= room.maxPlayers) {
    send(p.socket, { type: "error", payload: { message: "Room is full." } });
    return;
  }
  detachFromRoom(p);
  p.roomId = roomId;
  room.playerIds.add(p.id);
  p.team = assignTeam(room);

  // Update History
  const safeName = (p.name && p.name.trim().length > 0) ? p.name : `Player - ${p.id.slice(0, 4)} `;
  room.history.set(p.id, {
    name: safeName,
    team: p.team,
    kills: 0, deaths: 0, score: 0, fired: 0, hits: 0
  });

  spawnPlayer(p, room);
  // Reset stats only on initial join (not on respawn)
  p.score = 0;
  p.kills = 0;
  p.deaths = 0;
  p.hits = 0;
  p.fired = 0;
  sendRoomState(roomId);
  broadcastLobby();
}

// --- input handlers ---
function setMoveDir(p: PlayerRuntime, dir: Vector2) {
  // If in cooldown, ignore input
  if (nowMs() < p.cooldownUntil) return;

  const d = norm(dir);
  if (len(d) === 0) {
    // Stopping move? 
    // If was moving, triggered cooldown?
    // Tankmatch: "Movement can be queued". 
    // Let's keep simple: Input valid only if Ready.
    p.pendingMove = null;
    return;
  }
  p.pendingMove = d;
  p.isMoving = true;
}

function stopMove(p: PlayerRuntime) {
  p.pendingMove = null;
  p.moveQueue = [];
  // Note: if stop, triggers cooldown -> handled in tick
}

const MAX_MOVE_DIST = 300; // Max distance per move command
const COOLDOWN_THRESHOLD = 200;
const COOLDOWN_SHORT_MS = 1500; // 5 steps * 300ms
const COOLDOWN_LONG_MS = 2100;  // 7 steps * 300ms

function setMoveTarget(p: PlayerRuntime, target: Vector2, mapW: number, mapH: number) {
  // 仕様: 移動中/カウント中のクリックでも移動予約を受け付ける
  // Spec A-4: Max movement distance limit

  // Determine origin: last queued target OR current position
  let origin = { x: p.x, y: p.y };
  if (p.moveQueue.length > 0) {
    origin = p.moveQueue[p.moveQueue.length - 1];
  }

  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dist = Math.hypot(dx, dy);

  let finalTarget = target;
  if (dist > MAX_MOVE_DIST) {
    const ratio = MAX_MOVE_DIST / dist;
    finalTarget = {
      x: origin.x + dx * ratio,
      y: origin.y + dy * ratio,
    };
  }

  const clamped = {
    x: clamp(finalTarget.x, 0, mapW),
    y: clamp(finalTarget.y, 0, mapH),
  };
  // Spec A-6 EXT: Variable Cooldown
  // Re-calculate distance of VALIDated move
  const fdx = clamped.x - origin.x;
  const fdy = clamped.y - origin.y;
  const fdist = Math.hypot(fdx, fdy);

  const cost = fdist > COOLDOWN_THRESHOLD ? COOLDOWN_LONG_MS : COOLDOWN_SHORT_MS;

  if (p.moveQueue.length >= MOVE_QUEUE_MAX) return; // 上限
  p.moveQueue.push({ ...clamped, cost });
  // Start moving if not already (and if no current target? handled in tick)
  p.isMoving = true;
}

function setAimDir(p: PlayerRuntime, dir: Vector2) {
  // Aiming usually allowed anytime?
  const d = norm(dir);
  if (len(d) === 0) return;
  p.aimDir = d;
}

function triggerExplosion(room: Room, x: number, y: number, shooterId: string, isBomb = false) {
  // Phase 4: bomb = 3x explosion radius
  const explosionRadius = isBomb ? EXPLOSION_RADIUS * 3 : EXPLOSION_RADIUS;
  const explosion: Explosion = {
    id: newId(),
    x, y,
    radius: explosionRadius,
    at: nowMs()
  };
  room.explosions.push(explosion);

  // Broadcast explosion event immediately for VFX
  broadcastRoom(room.id, { type: "explosion", payload: explosion });

  // Apply Damage
  const shooter = players.get(shooterId);

  for (const pid of room.playerIds) {
    const target = players.get(pid);
    if (!target || target.hp <= 0 || target.respawnAt || target.respawnCooldownUntil > nowMs()) continue;

    // Calculate distance
    const dist = Math.hypot(target.x - x, target.y - y);
    if (dist <= explosionRadius + TANK_SIZE) {
      // Friendly Fire Rules:
      // - Damage Self: YES
      // - Damage Enemy: YES
      // - Damage Teammate: NO

      let canDamage = true;
      if (shooter && shooter.id !== target.id) {
        // If not self, check team
        if (shooter.team && target.team && shooter.team === target.team) {
          canDamage = false; // Teammate immune
        }
      }

      if (canDamage) {
        // Phase 4: Bomb = tiered damage based on distance
        let damage = EXPLOSION_DAMAGE; // default 20
        if (isBomb) {
          const innerR = explosionRadius / 3;
          const midR = (explosionRadius * 2) / 3;
          if (dist <= innerR + TANK_SIZE) {
            damage = 60; // Inner zone
          } else if (dist <= midR + TANK_SIZE) {
            damage = 40; // Mid zone
          } else {
            damage = 20; // Outer zone
          }
        }
        target.hp = Math.max(0, target.hp - damage);

        // CTF: Drop flag on ANY damage (not just death)
        if (room.gameMode === "ctf" && target.hp > 0) {
          dropFlag(target.id, room);
        }

        // Scoring: Hit (None for Team Mode "Kill is 1 point. That's it.")
        // if (shooter && shooter.id !== target.id) {
        //   shooter.score += 1; 
        // }

        if (target.hp === 0) {
          // Kill credit
          if (shooter && shooter.id !== target.id) {
            shooter.kills += 1;
            shooter.score += 1; // Team Mode: Kill = +1 point

            // Updating Room Team Score
            if (shooter.team === "red") room.scoreRed += 1;
            if (shooter.team === "blue") room.scoreBlue += 1;
          } else if (shooter && shooter.id === target.id) {
            // Suicide: No penalty mentioned? Usually -1 but user said "Death score doesn't change".
            // Let's keep 0 change for suicide to be safe with "That's it".
          }

          // Update history for shooter
          if (shooter) {
            const h = room.history.get(shooter.id);
            if (h) {
              h.kills = shooter.kills;
              h.score = shooter.score;
              // h.hits updated below?
            }
          }

          target.deaths += 1;
          // target.score -= 5; // Team Mode: No death penalty

          // Update history for target
          const th = room.history.get(target.id);
          if (th) {
            th.deaths = target.deaths;
            th.score = target.score;
          }

          // CTF: Drop flag if carrying one
          if (room.gameMode === "ctf") {
            dropFlag(target.id, room);
          }

          // Instant Respawn Logic
          spawnPlayer(target, room);
          // Instead of delayed respawn, apply instant respawn with cooldown
          target.respawnCooldownUntil = nowMs() + RESPAWN_COOLDOWN_MS;
          // Note: spawnPlayer already clears moveQueue, pendingMove, and cooldownUntil (set to 0)
        }
      }
    }
  }
}

function tryShoot(p: PlayerRuntime, dir: Vector2) {
  if (!p.roomId) return;
  const now = nowMs();

  if (p.respawnAt && p.respawnAt > now) return;
  if (p.respawnCooldownUntil > now) return; // Cannot shoot during respawn CD

  // Cooldown Check
  if (now < p.cooldownUntil) return;
  if (p.isMoving) return; // Cannot shoot while moving

  if (p.ammo <= 0) return;

  p.ammo -= 1;
  p.fired += 1; // Increment fired count

  // Sync to history
  if (p.roomId) {
    const r = rooms.get(p.roomId);
    if (r) {
      const h = r.history.get(p.id);
      if (h) h.fired = p.fired;
    }
  }



  // Phase 4: Check if this is a bomb shot
  const isBombShot = p.hasBomb;
  if (isBombShot) {
    p.hasBomb = false; // Consume bomb on use
  }

  // Trigger Cooldown immediately
  p.cooldownUntil = now + ACTION_COOLDOWN_MS;

  const room = rooms.get(p.roomId);
  if (!room) return;

  const d = norm(dir);
  if (len(d) === 0) return;

  const spawnOffset = HIT_RADIUS + BULLET_RADIUS + 2;
  const bx = clamp(p.x + d.x * spawnOffset, 0, room.mapData.width);
  const by = clamp(p.y + d.y * spawnOffset, 0, room.mapData.height);

  // Phase 4: Bomb shot has 3x explosion radius
  const bulletRadius = isBombShot ? BULLET_RADIUS * 1.5 : BULLET_RADIUS; // slightly larger visual

  const bullet: Bullet = {
    id: newId(),
    shooterId: p.id,
    x: bx,
    y: by,
    vx: d.x * BULLET_SPEED,
    vy: d.y * BULLET_SPEED,
    radius: bulletRadius,
    startX: bx,
    startY: by,
    expiresAt: now + BULLET_TTL_MS,
    isBomb: isBombShot, // Tag for explosion handler
  };

  room.bullets.push(bullet);

  // Lock turret to shot direction
  p.turretAngle = Math.atan2(d.y, d.x);
  sendRoomState(p.roomId);
}

// Phase 4-7: Use Item Action (Ammo, Heal, Flag, Rope)
function tryUseItem(p: PlayerRuntime, item: string, dir: Vector2) {
  if (!p.roomId) return;
  const now = nowMs();

  if (p.respawnAt && p.respawnAt > now) return;
  if (p.respawnCooldownUntil > now) return;

  // Actions share cooldown
  if (now < p.cooldownUntil) return;

  const room = rooms.get(p.roomId);
  if (!room) return;

  const d = norm(dir);
  if (len(d) === 0) return;

  const bx = p.x + d.x * 20;
  const by = p.y + d.y * 20;

  if (item === "rope" && p.ropeCount > 0) {
    const ropeRange = p.ropeCount === 2 ? 300 : 200;
    p.cooldownUntil = now + ACTION_COOLDOWN_MS;

    const ropeBullet: Bullet = {
      id: newId(),
      shooterId: p.id,
      x: bx,
      y: by,
      vx: d.x * BULLET_SPEED,
      vy: d.y * BULLET_SPEED,
      radius: 4,
      startX: bx,
      startY: by,
      expiresAt: now + (ropeRange / BULLET_SPEED) * 1000 + 200,
      isRope: true,
      ropeOwnerId: p.id,
    };
    room.bullets.push(ropeBullet);

    p.turretAngle = Math.atan2(d.y, d.x);
    broadcastRoom(p.roomId, {
      type: "chat", payload: { from: "SYSTEM", message: `🔗 ${p.name} used a Rope!`, timestamp: now }
    });
  } else if (item === "ammo" && p.ammo >= 5) {
    p.ammo -= 5;
    p.cooldownUntil = now + ACTION_COOLDOWN_MS;
    const ammoRange = 99999;
    room.bullets.push({
      id: newId(), shooterId: p.id, x: bx, y: by, vx: d.x * BULLET_SPEED, vy: d.y * BULLET_SPEED,
      radius: 6, startX: bx, startY: by, expiresAt: now + (ammoRange / BULLET_SPEED) * 1000,
      isAmmoPass: true
    });
    p.turretAngle = Math.atan2(d.y, d.x);
  } else if (item === "heal" && p.hp > 20) {
    p.hp -= 20;
    p.cooldownUntil = now + ACTION_COOLDOWN_MS;
    const healRange = 99999;
    room.bullets.push({
      id: newId(), shooterId: p.id, x: bx, y: by, vx: d.x * BULLET_SPEED, vy: d.y * BULLET_SPEED,
      radius: 6, startX: bx, startY: by, expiresAt: now + (healRange / BULLET_SPEED) * 1000,
      isHealPass: true
    });
    p.turretAngle = Math.atan2(d.y, d.x);
  } else if (item === "flag") {
    const carriedFlag = room.flags.find(f => f.carrierId === p.id);
    if (carriedFlag) {
      carriedFlag.carrierId = null;
      carriedFlag.droppedById = p.id;
      p.cooldownUntil = now + ACTION_COOLDOWN_MS;
      const passRange = 99999;
      room.bullets.push({
        id: newId(), shooterId: p.id, x: bx, y: by, vx: d.x * BULLET_SPEED, vy: d.y * BULLET_SPEED,
        radius: 8, startX: bx, startY: by, expiresAt: now + (passRange / BULLET_SPEED) * 1000,
        isFlagPass: true,
        flagTeam: carriedFlag.team
      });
      // The flag is technically 'in the air' but we just update its pos to follow the bullet in updateBullets
      carriedFlag.x = bx;
      carriedFlag.y = by;
      p.turretAngle = Math.atan2(d.y, d.x);
    }
  }
}

function dropFlag(carrierId: string, room: Room) {
  for (const f of room.flags) {
    if (f.carrierId === carrierId) {
      console.log(`[DEBUG] Flag ${f.team} dropped by ${carrierId} at (${f.x}, ${f.y})`);
      f.carrierId = null;
      f.droppedById = carrierId; // Phase 4-5: mark who dropped it to prevent instant re-pickup
      // Phase 4-5: flag stays exactly where dropped, do not return to base
    }
  }
}

/** Check if a point is inside the spawn zone (200x200 area) of a given team */
function isInSpawnZone(x: number, y: number, team: Team, mapData: MapData): boolean {
  const sp = mapData.spawnPoints.find(s => s.team === team);
  if (!sp) return false;
  return Math.abs(x - sp.x) < SPAWN_ZONE_HALF && Math.abs(y - sp.y) < SPAWN_ZONE_HALF;
}

function updateCTF(room: Room, now: number) {
  if (room.gameMode !== "ctf") return;

  for (const f of room.flags) {
    // Check if flag is currently flying via a pass action
    const isFlying = room.bullets.some(b => b.isFlagPass && b.flagTeam === f.team);
    if (isFlying) continue;

    // 1. Follow carrier
    if (f.carrierId) {
      const carrier = players.get(f.carrierId);
      if (carrier && carrier.hp > 0 && carrier.roomId === room.id) {
        f.x = carrier.x;
        f.y = carrier.y;

        // Check for capture: carrier brings enemy flag to their own base
        // Carrier's team: carrier.team
        // Flag's team: f.team (it's the enemy flag if carrier.team !== f.team)
        if (carrier.team && carrier.team !== f.team) {
          // Rule: Must be inside own spawn zone AND stopped to capture
          const isStopped = !carrier.isMoving && !carrier.isRotating;
          const inZone = isInSpawnZone(carrier.x, carrier.y, carrier.team, room.mapData);

          if (inZone && isStopped) {
            // CAPTURE!
            console.log(`[DEBUG] Team ${carrier.team} captured ${f.team} flag!`);
            if (carrier.team === "red") room.scoreRed += FLAG_SCORE;
            else if (carrier.team === "blue") room.scoreBlue += FLAG_SCORE;

            // Return flag to its original base
            const flagSrcOrig = room.mapData.flagPositions ?? room.mapData.spawnPoints;
            const originalBase = flagSrcOrig.find(s => s.team === f.team);
            if (originalBase) {
              f.x = originalBase.x;
              f.y = originalBase.y;
            }
            f.carrierId = null;

            // Update stats
            carrier.score += 5; // Personal bonus
            const h = room.history.get(carrier.id);
            if (h) h.score = carrier.score;

            broadcastRoom(room.id, {
              type: "chat",
              payload: {
                from: "SYSTEM",
                message: `🚩 Team ${carrier.team.toUpperCase()} captured the ${f.team} flag!`,
                timestamp: now
              }
            });
          }
        }
      } else {
        // Carrier lost/dead/left
        f.carrierId = null;
      }
    } else {
      // NEW LOGIC: Instantly return dropped flag to base
      const flagSrc = room.mapData.flagPositions ?? room.mapData.spawnPoints;
      const basePos = flagSrc.find(s => s.team === f.team);
      if (basePos) {
        if (Math.abs(f.x - basePos.x) > 1 || Math.abs(f.y - basePos.y) > 1) {
          f.x = basePos.x;
          f.y = basePos.y;
          f.droppedById = undefined;
          broadcastRoom(room.id, {
            type: "chat",
            payload: {
              from: "SYSTEM",
              message: `🏠 The ${f.team} flag returned to base.`,
              timestamp: now
            }
          });
        }
      }

      // 2. Pickup (Enemy taking flag from base)
      for (const pid of room.playerIds) {
        const p = players.get(pid);
        if (!p || p.hp <= 0 || p.respawnAt || p.respawnCooldownUntil > now) continue;

        const dist = Math.hypot(p.x - f.x, p.y - f.y);

        if (dist < FLAG_RADIUS + TANK_SIZE) {
          if (p.team !== f.team) {
            // Enemy touches flag -> Take it
            const alreadyCarrying = room.flags.some(otherF => otherF.carrierId === p.id);
            if (!alreadyCarrying) {
              f.carrierId = p.id;
              console.log(`[DEBUG] CTF Pickup! Player ${p.id} (${p.team}) took ${f.team} flag.`);
              broadcastRoom(room.id, {
                type: "chat",
                payload: {
                  from: "SYSTEM",
                  message: `🚩 ${p.name} has the ${f.team} flag!`,
                  timestamp: now
                }
              });
            }
          }
        }
      }
    }
  }
}

function updateBullets(room: Room, dtSec: number, now: number) {
  if (!room.bullets.length) return;

  const next: Bullet[] = [];

  for (const b of room.bullets) {
    let exploded = false;
    let passFinished = false;

    // 1. Timeout -> Explode (rope projectiles just disappear)
    if (now >= b.expiresAt) {
      if (b.isAmmoPass || b.isHealPass || b.isFlagPass) {
        passFinished = true;
      } else if (!b.isRope) {
        triggerExplosion(room, b.x, b.y, b.shooterId, b.isBomb);
      }
      exploded = true;
    }

    if (exploded && !passFinished) continue;

    const prev = { x: b.x, y: b.y };
    const curr = {
      x: passFinished ? Math.max(0, Math.min(room.mapData.width, b.x + b.vx * dtSec)) : b.x + b.vx * dtSec,
      y: passFinished ? Math.max(0, Math.min(room.mapData.height, b.y + b.vy * dtSec)) : b.y + b.vy * dtSec
    };

    // Move flag with flag pass
    if (b.isFlagPass && b.flagTeam) {
      const f = room.flags.find(fl => fl.team === b.flagTeam);
      if (f) {
        f.x = curr.x;
        f.y = curr.y;
      }
    }

    // Rope bullet: Check item/flag collision FIRST
    if (b.isRope && !exploded) {
      const owner = players.get(b.ropeOwnerId || b.shooterId);

      // Check Items
      const hitItem = room.items.find(i => Math.hypot(i.x - curr.x, i.y - curr.y) < 25);
      if (hitItem && owner) {
        // Teleport item to owner so they pick it up next tick
        hitItem.x = owner.x;
        hitItem.y = owner.y;
        exploded = true;
      }

      // Check Flags
      if (!exploded) {
        const hitFlag = room.flags.find(f => Math.hypot(f.x - curr.x, f.y - curr.y) < 25);
        if (hitFlag && owner && hitFlag.carrierId !== owner.id) {
          hitFlag.carrierId = owner.id;
          hitFlag.droppedById = undefined;
          exploded = true;
        }
      }

      // Check teammates carrying flags (rope can steal from ally)
      if (!exploded && owner) {
        for (const pid of room.playerIds) {
          if (pid === owner.id) continue;
          const other = players.get(pid);
          if (!other || other.hp <= 0) continue;
          const dist = Math.hypot(other.x - curr.x, other.y - curr.y);
          if (dist < 20) {
            // Check if this player carries a flag
            const carriedFlag = room.flags.find(f => f.carrierId === other.id);
            if (carriedFlag) {
              carriedFlag.carrierId = owner.id;
              carriedFlag.droppedById = undefined;
              exploded = true;
              break;
            }
          }
        }
      }

      if (exploded) continue;
    }

    // 2. Wall Collision -> Explode (rope just disappears)
    if (!exploded && isBulletBlockedByWall(curr.x, curr.y, b.vx, b.vy, room.mapData.walls)) {
      if (b.isAmmoPass || b.isHealPass || b.isFlagPass) {
        passFinished = true;
      } else if (!b.isRope) {
        triggerExplosion(room, curr.x, curr.y, b.shooterId, b.isBomb);
      }
      exploded = true;
    }

    // 3. Out of bounds -> Explode
    if (!exploded && (curr.x < 0 || curr.x > room.mapData.width || curr.y < 0 || curr.y > room.mapData.height)) {
      if (b.isAmmoPass || b.isHealPass || b.isFlagPass) {
        passFinished = true;
      } else if (!b.isRope) {
        triggerExplosion(room, Math.max(0, Math.min(curr.x, room.mapData.width)), Math.max(0, Math.min(curr.y, room.mapData.height)), b.shooterId, b.isBomb);
      }
      exploded = true;
    }

    if (exploded && !passFinished) continue;

    if (passFinished) continue;

    // 4. Player Collision -> Explode (Direct hit)
    // Note: Direct hit also triggers explosion logic for damage
    const shooter = players.get(b.shooterId) ?? null;

    for (const pid of room.playerIds) {
      if (pid === b.shooterId) continue;
      const t = players.get(pid);
      if (!t) continue;
      if (t.respawnAt && t.respawnAt > now) continue;
      if (t.respawnCooldownUntil > now) continue; // Invincible to bullets during respawn CD
      if (t.hp <= 0) continue;

      // Friendly fire check: Bullets pass through teammates?
      // Or they hit and explode but do no damage?
      // "Team members are大丈夫" -> Likely pass through or no-damage impact.
      // Let's assume passed-through for nicer gameplay, or impact but 0 dmg.
      // Let's do: Impact -> Explode. Same damage logic applies (0 to teammate).

      if (t.hp <= 0) continue;

      // FIX: Arguments were swapped!
      // Old: distPointToSegment(prev, curr, target) -> Distance form Prev, to Line(Curr, Target) -> NONSENSE
      // New: distPointToSegment(target, prev, curr) -> Distance from Target, to Line(Prev, Curr) -> CORRECT
      // Hitbox: Rotated Rectangle (26x20)
      const hit = checkRayRotatedRect(
        prev, curr,
        { x: t.x, y: t.y },
        { w: 26, h: 20 },
        t.hullAngle,
        b.radius
      );

      if (hit) {
        if (b.isAmmoPass || b.isHealPass || b.isFlagPass) {
          if (b.isAmmoPass && t.ammo < 40) {
            t.ammo = Math.min(40, t.ammo + 5);
          } else if (b.isHealPass && t.hp < 100) {
            t.hp = Math.min(100, t.hp + 20);
          } else if (b.isFlagPass && b.flagTeam) {
            const alreadyCarrying = room.flags.some(fl => fl.carrierId === t.id);
            if (!alreadyCarrying) {
              const fl = room.flags.find(fl => fl.team === b.flagTeam);
              if (fl) {
                fl.carrierId = t.id;
                fl.droppedById = undefined;
                broadcastRoom(room.id, {
                  type: "chat", payload: { from: "SYSTEM", message: `🚩 ${t.name} caught the ${fl.team} flag!`, timestamp: now }
                });
              }
            }
          }
          exploded = true;
          break;
        }

        // Stats: Hit
        if (shooter) {
          shooter.hits++;

          // Sync history
          const h = room.history.get(shooter.id);
          if (h) h.hits = shooter.hits;
        }

        triggerExplosion(room, curr.x, curr.y, b.shooterId, b.isBomb);
        exploded = true;
        break;
      }
    }

    if (exploded) continue;

    // 5. Phase 4-2: Item Collision — bullet destroys items, same-type respawns
    if (!b.isAmmoPass && !b.isHealPass && !b.isFlagPass && !b.isRope) {
      const hitIdx = room.items.findIndex(item =>
        Math.hypot(curr.x - item.x, curr.y - item.y) < b.radius + ITEM_RADIUS
      );
      if (hitIdx >= 0) {
        const destroyed = room.items[hitIdx];
        room.items.splice(hitIdx, 1);
        respawnItem(room, destroyed.type);
        triggerExplosion(room, curr.x, curr.y, b.shooterId, b.isBomb);
        exploded = true;
      }
    }

    if (exploded) continue;

    // 6. Phase 4-5: Flag Collision — bullet hits dropped flag → reset to base
    if (room.gameMode === "ctf" && !b.isAmmoPass && !b.isHealPass && !b.isFlagPass && !b.isRope) {
      for (const f of room.flags) {
        if (f.carrierId) continue; // Carried flags can't be hit
        const flagSrc = room.mapData.flagPositions ?? room.mapData.spawnPoints;
        const basePos = flagSrc.find(s => s.team === f.team);
        if (!basePos) continue;
        // Skip if flag is already at base
        if (Math.abs(f.x - basePos.x) < 2 && Math.abs(f.y - basePos.y) < 2) continue;
        const dist = Math.hypot(curr.x - f.x, curr.y - f.y);
        if (dist < b.radius + 25) { // FLAG_RADIUS = 25
          f.x = basePos.x;
          f.y = basePos.y;
          broadcastRoom(room.id, {
            type: "chat",
            payload: {
              from: "SYSTEM",
              message: `🔫 The ${f.team} flag was shot and returned to base!`,
              timestamp: now
            }
          });
          triggerExplosion(room, curr.x, curr.y, b.shooterId, b.isBomb);
          exploded = true;
          break;
        }
      }
    }

    if (exploded) continue;

    b.x = curr.x;
    b.y = curr.y;
    next.push(b);
  }

  room.bullets = next;
}

// --- tick ---
let lastTickAt = nowMs();
function tick() {
  const now = nowMs();
  const dtSec = Math.min(0.1, Math.max(0.001, (now - lastTickAt) / 1000));
  lastTickAt = now;

  // Cleanup disconnected players (B-3)
  for (const [pid, p] of players.entries()) {
    if (p.disconnectedAt !== null && now - p.disconnectedAt > RECONNECT_TIMEOUT_MS) {
      console.log(`[DEBUG] Player ${pid} reconnection timeout.Cleaning up.`);
      detachFromRoom(p);
      players.delete(pid);
    }
  }

  for (const room of rooms.values()) {
    // Clear old explosions for state sync (visuals are one-shot via broadcast, but state keeps for late joiners/re-sync if needed)
    // Actually, just clear them every tick from the "State" object to avoid piling up?
    // Client handles "event" based explosion. State persistence is only needed for 1 tick.
    room.explosions = [];

    // Phase 4-1: アイテムは固定プール制。10秒スポーンは廃止済み。

    if (room.endsAt > 0 && now >= room.endsAt) {
      if (!room.ended) {
        room.ended = true;

        const results = [...room.history.entries()].map(([id, h]) => {
          const isActive = room.playerIds.has(id);
          return {
            id,
            name: h.name.substring(0, 20) + (isActive ? "" : " (Left)"),
            team: h.team,
            roomId: room.id,
            // dummy values for PlayerSummary compatibility
            position: { x: 0, y: 0 },
            target: null, moveQueue: [],
            hp: 0, ammo: 0,
            score: h.score,
            deaths: h.deaths,
            kills: h.kills,
            hits: h.hits,
            fired: h.fired,
            nextActionAt: 0, actionLockStep: 0, hullAngle: 0, turretAngle: 0, respawnAt: null
          };
        });

        // Calculate winner
        const winners =
          room.scoreRed > room.scoreBlue ? "red" :
            room.scoreBlue > room.scoreRed ? "blue" : "draw";

        console.log(`[DEBUG] GameEnd Room ${room.id}.Winner: ${winners} `);
        console.log(`[DEBUG] Results Payload: `, JSON.stringify(results, null, 2));

        broadcastRoom(room.id, {
          type: "gameEnd",
          payload: { roomId: room.id, winners, results } // Add roomId for client check
        });
      }

      // Continue to update game state even after end
      // sendRoomState(room.id) will be called at end of loop if we don't continue
      // continue; 
    }

    // Cleanup empty ended rooms (managed in detachFromRoom mostly, but safe here too)
    if (room.ended && room.playerIds.size === 0 && room.spectatorIds.size === 0) {
      rooms.delete(room.id);
      continue;
    }

    // FREEZE GAME: If ended, skip physics/logic updates
    if (room.ended) {
      // Just sync state (keep chat working etc)
      sendRoomState(room.id);
      continue;
    }

    // players update
    for (const pid of room.playerIds) {
      const p = players.get(pid);
      if (!p) continue;

      if (p.respawnAt && p.respawnAt <= now) {
        spawnPlayer(p, room);
      }
      if (p.respawnAt && p.respawnAt > now) continue;

      // Update visibility (B-2/B-5) — bush内は常に隠密、射撃で解除しない
      const inBush = isPointInBush(p.x, p.y, room.mapData.walls);
      p.isHidden = inBush;

      // Movement Logic (with pivot-turn phase)
      let wantsToMove = false;
      let dx = 0;
      let dy = 0;

      // Movement freeze applied during both normal action cooldown AND respawn cooldown
      if (p.cooldownUntil > now || p.respawnCooldownUntil > now) {
        // In Cooldown: FREEZE movement (but moveQueue keeps accepting)
        p.isMoving = false;
        p.isRotating = false;
        p.pendingMove = null;
      } else {
        if (p.pendingMove) {
          dx = p.pendingMove.x * MOVE_SPEED;
          dy = p.pendingMove.y * MOVE_SPEED;
          wantsToMove = true;
          p.hullAngle = Math.atan2(dy, dx);
        } else if (p.moveQueue.length > 0) {
          const currentTarget = p.moveQueue[0];
          const to = { x: currentTarget.x - p.x, y: currentTarget.y - p.y };
          const distance = len(to);

          // Phase 4: boots speed boost
          const effectiveSpeed = p.bootsCharges > 0 ? MOVE_SPEED * 1.5 : MOVE_SPEED;

          if (distance <= effectiveSpeed) {
            // Arrived at current target
            p.x = currentTarget.x;
            p.y = currentTarget.y;
            p.moveQueue.shift();
            p.isMoving = false;
            p.isRotating = false;

            // Phase 4: boots speed boost uses cost or specific logic, but normal movement is based on dist
            const applyCooldown = (dist: number) => {
              return dist >= 200 ? COOLDOWN_LONG_MS : COOLDOWN_SHORT_MS;
            };
            const arrivedCooldown = currentTarget.cost ?? applyCooldown(Math.hypot(currentTarget.x - p.x, currentTarget.y - p.y));
            p.cooldownUntil = now + arrivedCooldown;

            // Phase 4: consume boots charge on arrival
            if (p.bootsCharges > 0) {
              p.bootsCharges--;
            }
          } else {
            const targetAngle = Math.atan2(to.y, to.x);
            const angleDiff = normalizeAngle(targetAngle - p.hullAngle);

            if (Math.abs(angleDiff) > 0.05) {
              // PIVOT-TURN: rotate hull toward target
              p.isRotating = true;
              p.isMoving = false;
              const step = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), HULL_ROTATION_SPEED);
              p.hullAngle = normalizeAngle(p.hullAngle + step);
              // Turret also rotates toward final target angle (not current hull)
              const turretDiff = normalizeAngle(targetAngle - p.turretAngle);
              const tStep = Math.sign(turretDiff) * Math.min(Math.abs(turretDiff), TURRET_ROTATION_SPEED);
              p.turretAngle = normalizeAngle(p.turretAngle + tStep);
            } else {
              // Facing target — move
              p.hullAngle = targetAngle;
              p.turretAngle = targetAngle; // turret aligned to front
              p.isRotating = false;
              const d = norm(to);
              const moveSpd = p.bootsCharges > 0 ? MOVE_SPEED * 1.5 : MOVE_SPEED;
              dx = d.x * moveSpd;
              dy = d.y * moveSpd;
              wantsToMove = true;
            }
          }
        } else {
          if (p.isMoving || p.isRotating) {
            p.isMoving = false;
            p.isRotating = false;
            p.cooldownUntil = now + ACTION_COOLDOWN_MS;
          }
        }
      }

      if (wantsToMove) {
        const nextX = clamp(p.x + dx, 0, room.mapData.width);
        const nextY = clamp(p.y + dy, 0, room.mapData.height);

        // Check wall collision
        const hitWall = checkWallCollision(nextX, nextY, TANK_SIZE, room.mapData.walls);

        // Check player-to-player collision
        let hitPlayer = false;
        if (!hitWall) {
          for (const otherId of room.playerIds) {
            if (otherId === p.id) continue;
            const other = players.get(otherId);
            if (!other) continue;
            if (other.hp <= 0) continue;
            if (other.respawnAt) continue;
            const pdx = nextX - other.x;
            const pdy = nextY - other.y;
            if (Math.hypot(pdx, pdy) < TANK_SIZE * 2) {
              hitPlayer = true;
              break;
            }
          }
        }

        if (!hitWall && !hitPlayer) {
          let hitOwnDroppedFlag = false;
          if (room.gameMode === "ctf") {
            for (const f of room.flags) {
              if (f.droppedById === p.id && Math.hypot(nextX - f.x, nextY - f.y) < 25 + TANK_SIZE) {
                hitOwnDroppedFlag = true;
                f.carrierId = p.id;
                f.droppedById = undefined;
                broadcastRoom(room.id, {
                  type: "chat", payload: { from: "SYSTEM", message: `🚩 ${p.name} picked up the ${f.team} flag!`, timestamp: now }
                });
                break;
              }
            }
          }

          if (hitOwnDroppedFlag) {
            // Cancel movement and trigger cooldown as per standstill flag pickup rule
            p.pendingMove = null;
            if (p.moveQueue.length > 0) p.moveQueue.shift();
            p.isMoving = false;
            p.isRotating = false;
            p.cooldownUntil = now + Math.min(ACTION_COOLDOWN_MS, 300);
          } else {
            p.x = nextX;
            p.y = nextY;
            p.isMoving = true;
          }
        } else {
          // Hit wall or player — consume target, trigger cooldown
          p.pendingMove = null;
          let collidedCost = COOLDOWN_SHORT_MS;
          if (p.moveQueue.length > 0) {
            const currentTarget = p.moveQueue.shift();
            if (currentTarget?.cost) collidedCost = currentTarget.cost;
          }
          p.isMoving = false;
          p.isRotating = false;
          p.cooldownUntil = now + collidedCost;
        }
      }

      // Check Item Pickups (Phase 4-1/4-3/4-4)
      if (!room.ended && p.hp > 0 && !p.respawnAt) {
        const nextItems: Item[] = [];
        const pickedTypes: ItemType[] = [];
        for (const item of room.items) {
          const dist = Math.hypot(p.x - item.x, p.y - item.y);
          if (dist < TANK_SIZE + ITEM_RADIUS) {
            // Phase 4-3: Check pickup limits before applying
            let canPickup = true;
            if (item.type === "medic" || item.type === "heart") {
              if (p.hp >= 100) canPickup = false; // HP full → cannot pick
            } else if (item.type === "ammo") {
              if (p.ammo >= 40) canPickup = false; // Ammo full → cannot pick
            } else if (item.type === "bomb") {
              if (p.hasBomb) canPickup = false; // Already has bomb
            } else if (item.type === "rope") {
              if (p.ropeCount >= 2) canPickup = false; // Max 2 ropes
            } else if (item.type === "boots") {
              if (p.bootsCharges > 0) canPickup = false; // Already has boots
            }

            if (canPickup) {
              // Phase 4-4: Apply effects
              if (item.type === "medic") {
                p.hp = Math.min(100, p.hp + MEDIC_HEAL_AMOUNT);
              } else if (item.type === "ammo") {
                p.ammo = Math.min(40, p.ammo + AMMO_REFILL_AMOUNT);
              } else if (item.type === "heart") {
                p.hp = 100; // Full heal
              } else if (item.type === "bomb") {
                p.hasBomb = true; // Next shot is bomb shot
              } else if (item.type === "rope") {
                p.ropeCount = Math.min(2, p.ropeCount + 1);
              } else if (item.type === "boots") {
                p.bootsCharges = 3; // 3 move arrivals
              }
              pickedTypes.push(item.type);
            } else {
              nextItems.push(item); // Cannot pick → keep item
            }
          } else {
            nextItems.push(item);
          }
        }
        if (pickedTypes.length > 0) {
          room.items = nextItems;
          // Respawn same types at new random locations
          for (const t of pickedTypes) {
            respawnItem(room, t);
          }
        }
      }
    }

    if (room.gameMode === "ctf") {
      updateCTF(room, now);
    }

    updateBullets(room, dtSec, now);
    sendRoomState(room.id);
  }
}

setInterval(() => tick(), TICK_MS);

// --- static / ws path fix ---
function resolvePublicDir(): string {
  const candidates = [
    path.resolve(__dirname, "../../client/dist"),
    path.resolve(__dirname, "../../../client/dist"),
    path.resolve(process.cwd(), "client", "dist"),
    path.resolve(process.cwd(), "..", "client", "dist"),
    path.resolve(process.cwd(), "..", "..", "client", "dist"),
  ];

  for (const c of candidates) {
    const indexPath = path.join(c, "index.html");
    if (fs.existsSync(indexPath)) return c;
  }
  return candidates[0];
}

const PUBLIC_DIR = resolvePublicDir();
const PUBLIC_INDEX = path.join(PUBLIC_DIR, "index.html");

const app = express();
app.use(express.json());
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use(express.static(PUBLIC_DIR, { index: false }));
app.get("/", (_req, res) => {
  if (fs.existsSync(PUBLIC_INDEX)) {
    res.sendFile(PUBLIC_INDEX);
    return;
  }
  res.status(500).send(`client build not found.npm run build`);
});
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (!fs.existsSync(PUBLIC_INDEX)) return next();
  if (req.path === "/health" || req.path.startsWith("/ws")) return next();
  if (path.extname(req.path)) return next();
  res.sendFile(PUBLIC_INDEX);
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket) => {
  let boundPlayerId = newId();
  const p: PlayerRuntime = {
    id: boundPlayerId,
    name: `Player - ${boundPlayerId.slice(0, 4)} `,
    team: null,
    x: 150, y: 150,
    hp: 100, ammo: 20,
    // Stats
    score: 0, kills: 0, deaths: 0, hits: 0, fired: 0,

    roomId: null,
    aimDir: { x: 1, y: 0 },
    pendingMove: null, moveQueue: [],
    hullAngle: 0, turretAngle: 0, isRotating: false,
    isMoving: false, cooldownUntil: 0,
    respawnAt: null,
    respawnCooldownUntil: 0,
    isHidden: false,
    // Phase 4 item state
    hasBomb: false,
    ropeCount: 0,
    bootsCharges: 0,

    socket,
    disconnectedAt: null,
  };

  players.set(boundPlayerId, p);
  send(socket, { type: "welcome", payload: { id: boundPlayerId } });
  send(socket, { type: "lobby", payload: lobbyStatePayload() });

  socket.on("message", (raw) => {
    const msg = safeJsonParse(raw.toString());
    if (!isRecord(msg)) return;
    const type = pickString(msg.type, "");
    const payload = (msg as ClientMsg).payload;
    const player = players.get(boundPlayerId);
    if (!player) return;

    switch (type) {
      case "login": {
        const pld = isRecord(payload) ? payload : {};
        const name = pickString(pld.name, "").trim();
        const reclaimId = pickString(pld.id, "");

        if (reclaimId && players.has(reclaimId)) {
          const existing = players.get(reclaimId)!;
          if (existing.disconnectedAt !== null) {
            console.log(`[DEBUG] Player ${reclaimId} re - claiming their session.`);

            // Cleanup the temporary guest ID created on connection
            players.delete(boundPlayerId);

            // Re-claim session
            boundPlayerId = reclaimId; // Update the ID this connection points to
            existing.socket = socket;
            existing.disconnectedAt = null;

            // Re-assign local variable for subsequent switch cases
            const reclaimedPlayer = existing;
            send(socket, { type: "welcome", payload: { id: reclaimedPlayer.id } });

            if (reclaimedPlayer.roomId) {
              sendRoomState(reclaimedPlayer.roomId);
            } else {
              joinLobby(reclaimedPlayer);
            }
            return; // Exit wss.on('message') early as we swapped players
          }
        }

        if (name) player.name = name.slice(0, 16);
        send(socket, { type: "welcome", payload: { id: boundPlayerId } });
        joinLobby(player); // Trigger lobby update and broadcast
        break;
      }
      case "requestLobby": {
        joinLobby(player);
        break;
      }
      case "createRoom": {
        const pld = isRecord(payload) ? payload : {};
        const roomIdRaw = pickString(pld.roomId, "");
        const roomId = roomIdRaw.trim() ? roomIdRaw.trim() : newId();

        if (rooms.has(roomId)) {
          send(socket, { type: "error", payload: { message: "Room ID already exists." } });
          return;
        }
        const nameRaw = pickString(pld.name ?? pld.roomName, "");
        const roomName = nameRaw.trim() ? nameRaw.trim() : roomId;
        const mapId = pickString(pld.mapId, "alpha");
        const maxPlayers = clamp(pickNumber(pld.maxPlayers, 4), 2, 16);
        const timeLimitSec = clamp(pickNumber(pld.timeLimitSec ?? pld.timeLimit, 240), 5, 3600);
        const password = pickString(pld.password, "");
        const passwordProtected = !!password.trim();
        const createdAt = nowMs();
        const endsAt = createdAt + timeLimitSec * 1000;
        const mapData = MAPS[mapId] ?? DEFAULT_MAP;
        const gameMode = (pickString(pld.gameMode, "ctf") === "ctf") ? "ctf" : "deathmatch";

        const flags: Flag[] = [];
        if (gameMode === "ctf") {
          // Use flagPositions if defined, fallback to spawnPoints
          const flagSrc = mapData.flagPositions ?? mapData.spawnPoints;
          const redFlag = flagSrc.find(s => s.team === "red");
          const blueFlag = flagSrc.find(s => s.team === "blue");
          if (redFlag) flags.push({ team: "red", x: redFlag.x, y: redFlag.y, carrierId: null });
          if (blueFlag) flags.push({ team: "blue", x: blueFlag.x, y: blueFlag.y, carrierId: null });
        }

        const room: Room = {
          id: roomId, name: roomName, mapId, mapData,
          passwordProtected, password: passwordProtected ? password : undefined,
          gameMode,
          maxPlayers, timeLimitSec, createdAt, endsAt, ended: false,
          playerIds: new Set<string>(), spectatorIds: new Set<string>(),
          bullets: [], explosions: [],
          items: [], lastItemSpawnAt: createdAt, // kept for compat
          flags,
          scoreRed: 0, scoreBlue: 0,
          history: new Map(),
        };
        rooms.set(roomId, room);
        initializeItems(room); // Phase 4-1: populate item pool
        broadcastLobby();
        // User requested: "Creation and Entry are separate". Do not auto-join.
        // joinRoom(player, roomId, passwordProtected ? password : undefined);
        break;
      }
      case "joinRoom": {
        const pld = isRecord(payload) ? payload : {};
        const roomId = pickString(pld.roomId, "").trim();
        const password = pickString(pld.password, "").trim() || undefined;
        if (roomId) joinRoom(player, roomId, password);
        break;
      }
      case "spectateRoom": {
        const pld = isRecord(payload) ? payload : {};
        const roomId = pickString(pld.roomId, "").trim();
        const password = pickString(pld.password, "").trim() || undefined;
        if (roomId) {
          const room = rooms.get(roomId);
          if (!room) {
            send(socket, { type: "error", payload: { message: "Room not found." } });
            break;
          }
          if (room.passwordProtected && room.password !== password) {
            send(socket, { type: "error", payload: { message: "Invalid password." } });
            break;
          }
          detachFromRoom(player);
          player.roomId = roomId;
          player.team = null; // Spectators have no team
          room.spectatorIds.add(player.id);
          console.log(`[DEBUG] Player ${player.id} spectating room ${roomId}`);
          // Send initial room state to spectator (full visibility)
          const statePayload = roomStatePayloadForSpectator(roomId);
          if (statePayload) send(player.socket, { type: "room", payload: statePayload });
          broadcastLobby();
        }
        break;
      }
      case "leaveRoom":
      case "leave": {
        joinLobby(player);
        break;
      }
      case "move": {
        // Spectators cannot move
        if (player.roomId && rooms.get(player.roomId)?.spectatorIds.has(player.id)) break;
        const pld = isRecord(payload) ? payload : payload ?? {};
        if (isRecord(pld) && (pld.dir || pld.direction)) {
          const d = pickVector2(pld.dir ?? pld.direction, { x: 0, y: 0 });
          setMoveDir(player, d);
        } else if (
          isRecord(pld) &&
          (pld.target || (typeof pld.x === "number" && typeof pld.y === "number"))
        ) {
          const t = pld.target
            ? pickVector2(pld.target, { x: player.x, y: player.y })
            : { x: pickNumber(pld.x, player.x), y: pickNumber(pld.y, player.y) };
          const moveRoom = player.roomId ? rooms.get(player.roomId) : null;
          const mw = moveRoom?.mapData.width ?? 1800;
          const mh = moveRoom?.mapData.height ?? 1040;
          setMoveTarget(player, t, mw, mh);
        } else {
          stopMove(player);
        }
        break;
      }
      case "stopMove": {
        stopMove(player);
        break;
      }
      case "moveCancelOne": {
        if (player.moveQueue.length > 0) player.moveQueue.pop();
        break;
      }
      case "aim": {
        const pld = isRecord(payload) ? payload : {};
        const dir = pickVector2(pld.dir ?? pld.direction ?? pld, player.aimDir);
        setAimDir(player, dir);
        break;
      }
      case "shoot": {
        // Spectators cannot shoot
        if (player.roomId && rooms.get(player.roomId)?.spectatorIds.has(player.id)) break;
        const pld = isRecord(payload) ? payload : payload ?? {};
        let shootDir: Vector2 | null = null;
        if (isRecord(pld) && (pld.dir || pld.direction)) {
          shootDir = pickVector2(pld.dir ?? pld.direction, player.aimDir);
        } else if (isRecord(pld) && pld.target) {
          const t = pickVector2(pld.target, { x: player.x, y: player.y });
          shootDir = { x: t.x - player.x, y: t.y - player.y };
        } else if (isRecord(pld)) {
          shootDir = pickVector2(pld, player.aimDir);
        }
        if (shootDir) tryShoot(player, shootDir);
        break;
      }
      case "useItem": {
        // Spectators cannot use items
        if (player.roomId && rooms.get(player.roomId)?.spectatorIds.has(player.id)) break;
        const pld = isRecord(payload) ? payload : {};
        const item = pickString(pld.item, "rope");
        const shootDir = pickVector2(pld.direction, player.aimDir);
        tryUseItem(player, item, shootDir);
        break;
      }
      case "chat": {
        const pld = isRecord(payload) ? payload : {};
        const message = pickString(pld.message, "").trim();
        if (!message) break;
        // Spectators can chat but with a distinguishing prefix
        const isSpectatorChat = player.roomId && rooms.get(player.roomId)?.spectatorIds.has(player.id);
        const chatName = isSpectatorChat ? `👁 ${player.name}` : player.name;
        if (player.roomId) {
          broadcastRoom(player.roomId, {
            type: "chat",
            payload: {
              from: chatName,
              message: message.slice(0, 120),
              timestamp: nowMs(),
            },
          });
        } else {
          // Lobby Chat
          const chatMsg = {
            type: "chat",
            payload: {
              from: player.name,
              message: message.slice(0, 120),
              timestamp: nowMs(),
            },
          };
          for (const p of players.values()) {
            if (!p.roomId) send(p.socket, chatMsg);
          }
        }
        break;
      }
      default: break;
    }
  });

  socket.on("close", () => {
    const p = players.get(boundPlayerId);
    if (p) {
      console.log(`[DEBUG] Player ${boundPlayerId} socket closed.Waiting for rejoin...`);
      p.socket = null;
      p.disconnectedAt = nowMs();
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});