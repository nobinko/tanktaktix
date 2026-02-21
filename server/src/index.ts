import * as crypto from "crypto";
import * as fs from "fs";
import express from "express";
import http from "http";
import * as path from "path";
import { WebSocket, WebSocketServer } from "ws";
import type { BulletPublic, MapData, Team, Wall, Explosion } from "@tanktaktix/shared"; // Assumes shared is linked/built

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

type Vector2 = { x: number; y: number };

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

  socket: WebSocket;
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

  playerIds: Set<string>;
  bullets: Bullet[];
  explosions: Explosion[]; // Transient events to sync
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

// Action lock (5→0 countdown) — spec: 6 steps, 200ms each = 1200ms total
const ACTION_LOCK_STEPS = 6;
const ACTION_LOCK_STEP_MS = 300;
const ACTION_COOLDOWN_MS = ACTION_LOCK_STEPS * ACTION_LOCK_STEP_MS;

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
const BULLET_RANGE = 600;
const BULLET_TTL_MS = Math.ceil((BULLET_RANGE / BULLET_SPEED) * 1000);

const EXPLOSION_RADIUS = 40; // AoE radius
const EXPLOSION_DAMAGE = 20; // AoE damage
const HIT_RADIUS = TANK_SIZE; // Hitbox radius

// --- Maps (all 1800×1040) ---

/** alpha — クラシック: 縦壁2本＋角カバー＋中央アイランド */
const MAP_ALPHA: MapData = {
  id: "alpha",
  width: 1800,
  height: 1040,
  walls: [
    { x: 600,  y: 200, width: 60,  height: 440 },  // 左縦壁
    { x: 1140, y: 400, width: 60,  height: 440 },  // 右縦壁（下寄せ）
    { x: 180,  y: 160, width: 220, height: 60  },  // 左上カバー
    { x: 1400, y: 820, width: 220, height: 60  },  // 右下カバー
    { x: 840,  y: 460, width: 120, height: 120 },  // 中央アイランド
  ],
  spawnPoints: [
    { team: "red",  x: 120,  y: 260 },
    { team: "red",  x: 120,  y: 780 },
    { team: "blue", x: 1680, y: 260 },
    { team: "blue", x: 1680, y: 780 },
  ],
};

/** beta — アーバン: 6本縦ピラーで3コリドー＋左右カバー */
const MAP_BETA: MapData = {
  id: "beta",
  width: 1800,
  height: 1040,
  walls: [
    { x: 400,  y: 180, width: 60,  height: 280 },  // 左上ピラー
    { x: 400,  y: 580, width: 60,  height: 280 },  // 左下ピラー
    { x: 870,  y: 120, width: 60,  height: 340 },  // 中央上ピラー
    { x: 870,  y: 580, width: 60,  height: 340 },  // 中央下ピラー
    { x: 1340, y: 180, width: 60,  height: 280 },  // 右上ピラー
    { x: 1340, y: 580, width: 60,  height: 280 },  // 右下ピラー
    { x: 160,  y: 460, width: 180, height: 60  },  // 左横カバー
    { x: 1460, y: 520, width: 180, height: 60  },  // 右横カバー
  ],
  spawnPoints: [
    { team: "red",  x: 80,   y: 200 },
    { team: "red",  x: 80,   y: 840 },
    { team: "blue", x: 1720, y: 200 },
    { team: "blue", x: 1720, y: 840 },
  ],
};

/** gamma — フォート: 中央要塞＋外側カバー2個 */
const MAP_GAMMA: MapData = {
  id: "gamma",
  width: 1800,
  height: 1040,
  walls: [
    { x: 560,  y: 200, width: 60,  height: 260 },  // 要塞 左上縦
    { x: 1180, y: 200, width: 60,  height: 260 },  // 要塞 右上縦
    { x: 560,  y: 580, width: 60,  height: 260 },  // 要塞 左下縦
    { x: 1180, y: 580, width: 60,  height: 260 },  // 要塞 右下縦
    { x: 620,  y: 200, width: 560, height: 60  },  // 要塞 上辺
    { x: 620,  y: 780, width: 560, height: 60  },  // 要塞 下辺
    { x: 200,  y: 440, width: 240, height: 60  },  // 左外カバー
    { x: 1360, y: 540, width: 240, height: 60  },  // 右外カバー
  ],
  spawnPoints: [
    { team: "red",  x: 100,  y: 300 },
    { team: "red",  x: 100,  y: 740 },
    { team: "blue", x: 1700, y: 300 },
    { team: "blue", x: 1700, y: 740 },
  ],
};

const DEFAULT_MAP = MAP_ALPHA;

const MAPS: Record<string, MapData> = {
  alpha: MAP_ALPHA,
  beta:  MAP_BETA,
  gamma: MAP_GAMMA,
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
    if (
      x + r > w.x &&
      x - r < w.x + w.width &&
      y + r > w.y &&
      y - r < w.y + w.height
    ) {
      return true;
    }
  }
  return false;
}

function checkPointInWall(x: number, y: number, walls: Wall[]): boolean {
  for (const w of walls) {
    if (x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height) {
      return true;
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
  return `${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState !== WebSocket.OPEN) return;
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
    // Action lock: compute current step (5→0) from remaining cooldown ms
    nextActionAt: p.cooldownUntil,
    actionLockStep: Math.max(0, Math.ceil((p.cooldownUntil - nowMs()) / ACTION_LOCK_STEP_MS)),
    hullAngle: p.hullAngle,
    turretAngle: p.turretAngle,
    // Stats
    kills: p.kills,
    deaths: p.deaths,
    hits: p.hits,
    fired: p.fired,
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
    players: playerIds,
    playerCount: playerIds.length,
  };
}

function lobbyStatePayload() {
  const list = [...rooms.values()]
    .filter(r => !r.ended) // Hide ended rooms
    .map(toRoomSummary);
  list.sort((a, b) => b.createdAt - a.createdAt);

  const onlinePlayers = [...players.values()]
    .filter(p => !p.roomId)
    .map(p => ({ id: p.id, name: p.name }));

  // console.log(`[DEBUG] Lobby Payload: ${onlinePlayers.length} online, ${list.length} rooms`);

  return { rooms: list, onlinePlayers };
}

function roomStatePayload(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) {
    return {
      roomId,
      roomName: roomId,
      timeLeftSec: 0,
      timeLeft: 0,
      room: null,
      players: [],
      bullets: [],
      projectiles: [],
      explosions: [], // added
    };
  }

  const timeLeftSec = Math.max(0, Math.ceil((room.endsAt - nowMs()) / 1000));
  // Removed duplicate gameEnd logic from here. Handled in tick().


  const ps = [...room.playerIds].map(pid => players.get(pid)).filter((p): p is PlayerRuntime => !!p).map(toPlayerPublic);
  const bs = room.bullets.map(toBulletPublic);
  const es = room.explosions; // Sync current frame explosions

  return {
    roomId: room.id,
    roomName: room.name,
    mapId: room.mapId,
    timeLeftSec,
    timeLeft: timeLeftSec,
    room: toRoomSummary(room),
    players: ps,
    bullets: bs,
    projectiles: bs,
    explosions: es,
    teamScores: { red: room.scoreRed, blue: room.scoreBlue },
    mapData: room.mapData,
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
}

function sendRoomState(roomId: string) {
  broadcastRoom(roomId, { type: "room", payload: roomStatePayload(roomId) });
}

function detachFromRoom(p: PlayerRuntime) {
  if (!p.roomId) return;
  const oldRoomId = p.roomId;
  const old = rooms.get(oldRoomId);
  if (old) {
    old.playerIds.delete(p.id);
    if (old.playerIds.size === 0) {
      // Persistent Room: Keep valid until time ends
      if (nowMs() < old.endsAt) {
        console.log(`Room ${old.id} is empty but kept because time remains.`);
      } else {
        rooms.delete(old.id);
        console.log(`Room ${old.id} deleted (empty & time up).`);
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
    // console.log(`[AssignTeam] Checking ${pid}: Team=${p?.team}`);
    if (p?.team === "red") red++;
    if (p?.team === "blue") blue++;
  }
  return red <= blue ? "red" : "blue";
}

function spawnPlayer(p: PlayerRuntime, room: Room) {
  const map = room.mapData;
  const teamSpawns = map.spawnPoints.filter(sp => sp.team === p.team);

  if (teamSpawns.length > 0) {
    const sp = teamSpawns[Math.floor(Math.random() * teamSpawns.length)];
    p.x = clamp(sp.x + (Math.random() * 80 - 40), 0, map.width);
    p.y = clamp(sp.y + (Math.random() * 80 - 40), 0, map.height);
  } else {
    p.x = 150 + Math.random() * 200;
    p.y = 150 + Math.random() * 200;
  }

  if (checkWallCollision(p.x, p.y, TANK_SIZE, map.walls)) {
    p.x += 20;
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
  // Stats (score/kills/deaths/hits/fired) are NOT reset here.
  // They are reset once in joinRoom() at initial spawn only.
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
  const safeName = (p.name && p.name.trim().length > 0) ? p.name : `Player-${p.id.slice(0, 4)}`;
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

function triggerExplosion(room: Room, x: number, y: number, shooterId: string) {
  const explosion: Explosion = {
    id: newId(),
    x, y,
    radius: EXPLOSION_RADIUS,
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
    if (dist <= EXPLOSION_RADIUS + TANK_SIZE) {
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
        // Damage Rule: 20 per hit (Max 100 -> 5 hits)
        const damage = 20;
        target.hp = Math.max(0, target.hp - damage);

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

  // Trigger Cooldown immediately
  p.cooldownUntil = now + ACTION_COOLDOWN_MS;

  const room = rooms.get(p.roomId);
  if (!room) return;

  const d = norm(dir);
  if (len(d) === 0) return;

  const spawnOffset = HIT_RADIUS + BULLET_RADIUS + 2;
  const bx = clamp(p.x + d.x * spawnOffset, 0, room.mapData.width);
  const by = clamp(p.y + d.y * spawnOffset, 0, room.mapData.height);

  const bullet: Bullet = {
    id: newId(),
    shooterId: p.id,
    x: bx,
    y: by,
    vx: d.x * BULLET_SPEED,
    vy: d.y * BULLET_SPEED,
    radius: BULLET_RADIUS,
    startX: bx,
    startY: by,
    expiresAt: now + BULLET_TTL_MS,
  };

  room.bullets.push(bullet);

  // Lock turret to shot direction
  p.turretAngle = Math.atan2(d.y, d.x);

  sendRoomState(p.roomId);
}

function updateBullets(room: Room, dtSec: number, now: number) {
  if (!room.bullets.length) return;

  const next: Bullet[] = [];

  for (const b of room.bullets) {
    let exploded = false;

    // 1. Timeout -> Explode
    if (now >= b.expiresAt) {
      triggerExplosion(room, b.x, b.y, b.shooterId);
      exploded = true;
    }

    if (exploded) continue;

    const prev = { x: b.x, y: b.y };
    const curr = { x: b.x + b.vx * dtSec, y: b.y + b.vy * dtSec };

    // 2. Wall Collision -> Explode
    if (checkPointInWall(curr.x, curr.y, room.mapData.walls)) {
      triggerExplosion(room, curr.x, curr.y, b.shooterId);
      exploded = true;
    }

    // 3. Out of bounds -> Explode
    if (!exploded && (curr.x < 0 || curr.x > room.mapData.width || curr.y < 0 || curr.y > room.mapData.height)) {
      triggerExplosion(room, curr.x, curr.y, b.shooterId);
      exploded = true;
    }

    if (exploded) continue;

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
        // Stats: Hit
        const shooter = players.get(b.shooterId);
        if (shooter) {
          shooter.hits++;

          // Sync history
          const h = room.history.get(shooter.id);
          if (h) h.hits = shooter.hits;

          // Score for hit matches team mode logic (0)
        }

        triggerExplosion(room, curr.x, curr.y, b.shooterId);
        exploded = true;
        break;
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

  for (const room of rooms.values()) {
    // Clear old explosions for state sync (visuals are one-shot via broadcast, but state keeps for late joiners/re-sync if needed)
    // Actually, just clear them every tick from the "State" object to avoid piling up?
    // Client handles "event" based explosion. State persistence is only needed for 1 tick.
    room.explosions = [];

    // if (room.ended) continue; // Removed to allow post-game updates (chat, physics)

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

        console.log(`[DEBUG] GameEnd Room ${room.id}. Winner: ${winners}`);
        console.log(`[DEBUG] Results Payload:`, JSON.stringify(results, null, 2));

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
    if (room.ended && room.playerIds.size === 0) {
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

          if (distance <= MOVE_SPEED) {
            // Arrived at current target
            p.x = currentTarget.x;
            p.y = currentTarget.y;
            p.moveQueue.shift();
            p.isMoving = false;
            p.isRotating = false;
            p.cooldownUntil = now + (currentTarget.cost ?? ACTION_COOLDOWN_MS);
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
              dx = d.x * MOVE_SPEED;
              dy = d.y * MOVE_SPEED;
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
          p.x = nextX;
          p.y = nextY;
          p.isMoving = true;
        } else {
          // Hit wall or player — consume target, trigger cooldown
          p.pendingMove = null;
          if (p.moveQueue.length > 0) p.moveQueue.shift();
          p.isMoving = false;
          p.isRotating = false;
          p.cooldownUntil = now + ACTION_COOLDOWN_MS;
        }
      }
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
  res.status(500).send(`client build not found. npm run build`);
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
  const playerId = newId();
  const p: PlayerRuntime = {
    id: playerId,
    name: `Player-${playerId.slice(0, 4)}`,
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
    socket,
  };

  players.set(playerId, p);
  send(socket, { type: "welcome", payload: { id: playerId } });
  send(socket, { type: "lobby", payload: lobbyStatePayload() });

  socket.on("message", (raw) => {
    const msg = safeJsonParse(raw.toString());
    if (!isRecord(msg)) return;
    const type = pickString(msg.type, "");
    const payload = (msg as ClientMsg).payload;
    const player = players.get(playerId);
    if (!player) return;

    switch (type) {
      case "login": {
        const pld = isRecord(payload) ? payload : {};
        const name = pickString(pld.name, "").trim();
        if (name) player.name = name.slice(0, 16);
        send(socket, { type: "welcome", payload: { id: playerId } });
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
        const room: Room = {
          id: roomId, name: roomName, mapId, mapData,
          passwordProtected, password: passwordProtected ? password : undefined,
          maxPlayers, timeLimitSec, createdAt, endsAt, ended: false,
          playerIds: new Set<string>(), bullets: [], explosions: [],
          scoreRed: 0, scoreBlue: 0,
          history: new Map(),
        };
        rooms.set(roomId, room);
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
      case "leaveRoom":
      case "leave": {
        joinLobby(player);
        break;
      }
      case "move": {
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
          const mw = moveRoom?.mapData.width  ?? 1800;
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
      case "chat": {
        const pld = isRecord(payload) ? payload : {};
        const message = pickString(pld.message, "").trim();
        if (!message) break;
        if (player.roomId) {
          broadcastRoom(player.roomId, {
            type: "chat",
            payload: {
              from: player.name,
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
    detachFromRoom(p);
    players.delete(playerId);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});