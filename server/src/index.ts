import * as crypto from "crypto";
import * as fs from "fs";
import express from "express";
import http from "http";
import * as path from "path";
import { WebSocket, WebSocketServer } from "ws";
import type { MapData, Team, Wall, Explosion } from "@tanktaktix/shared"; // Assumes shared is linked/built

/**
 * server/src/index.ts
 *
 * Tankmatch Features:
 * - Walls (MapData)
 * - Move Cooldown (Turn-based style)
 * - Teams (Red/Blue)
 * - Explosions (AoE Damage, Friendly Fire rules)
 */

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
  score: number;
  kills: number;
  deaths: number;

  roomId: string | null;

  aimDir: Vector2; // unit
  pendingMove: Vector2 | null; // unit (legacy directional, kept for compat)
  moveQueue: Vector2[]; // click-to-move queue (max MOVE_QUEUE_MAX)

  // Cooldown Logic
  // Tankmatch: 
  // - "Cooldown: after any action, a short cooldown applies"
  // - Interpretation: 
  //   - Moving blocks Shooting.
  //   - Shooting blocks Moving.
  //   - Completion of Move -> Start Cooldown.
  //   - Completion of Shoot -> Start Cooldown.

  isMoving: boolean;
  cooldownUntil: number; // Block all actions until this time

  respawnAt: number | null;

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
};

const PORT = Number(process.env.PORT ?? 3000);

// --- gameplay tuning ---
const TICK_MS = 50;

const MAP_W = 900;
const MAP_H = 520;

const MOVE_SPEED = 6; // per tick

// Action lock (5→0 countdown) — spec: 6 steps, 200ms each = 1200ms total
const ACTION_LOCK_STEPS = 6;
const ACTION_LOCK_STEP_MS = 200;
const ACTION_COOLDOWN_MS = ACTION_LOCK_STEPS * ACTION_LOCK_STEP_MS;

const MOVE_QUEUE_MAX = 5; // max queued move targets

const RESPAWN_MS = 1500;

const TANK_SIZE = 18;

// bullets & explosions
const BULLET_SPEED = 220;
const BULLET_RADIUS = 4;
const BULLET_RANGE = 600;
const BULLET_TTL_MS = Math.ceil((BULLET_RANGE / BULLET_SPEED) * 1000);

const EXPLOSION_RADIUS = 40; // AoE radius
const EXPLOSION_DAMAGE = 20; // AoE damage
const HIT_RADIUS = TANK_SIZE; // Hitbox radius

// --- Maps ---
const DEFAULT_MAP: MapData = {
  id: "alpha",
  width: MAP_W,
  height: MAP_H,
  walls: [
    { x: 300, y: 150, width: 40, height: 220 },
    { x: 560, y: 150, width: 40, height: 220 },
    { x: 100, y: 100, width: 100, height: 40 },
    { x: 700, y: 380, width: 100, height: 40 },
  ],
  spawnPoints: [
    { team: "red", x: 80, y: 260 },
    { team: "blue", x: 820, y: 260 },
    { team: "red", x: 80, y: 460 },
    { team: "blue", x: 820, y: 60 },
  ],
};

const MAPS: Record<string, MapData> = {
  alpha: DEFAULT_MAP,
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
    kills: p.kills,
    deaths: p.deaths,
    respawnAt: p.respawnAt,
    // Action lock: compute current step (5→0) from remaining cooldown ms
    nextActionAt: p.cooldownUntil,
    actionLockStep: Math.max(0, Math.ceil((p.cooldownUntil - nowMs()) / ACTION_LOCK_STEP_MS) - 1),
  };
}

function toBulletPublic(b: Bullet) {
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
  const list = [...rooms.values()].map(toRoomSummary);
  list.sort((a, b) => b.createdAt - a.createdAt);
  return { rooms: list };
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
    if (p) send(p.socket, msg);
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
    if (old.playerIds.size === 0) rooms.delete(old.id);
  }
  p.roomId = null;
  p.pendingMove = null;
  p.moveQueue = [];
  p.team = null;
  p.isMoving = false;
  p.cooldownUntil = 0;

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
  p.cooldownUntil = 0;
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
  spawnPlayer(p, room);
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

function setMoveTarget(p: PlayerRuntime, target: Vector2) {
  // 仕様: 移動中/カウント中のクリックでも移動予約を受け付ける
  const clamped = {
    x: clamp(target.x, 0, MAP_W),
    y: clamp(target.y, 0, MAP_H),
  };
  if (p.moveQueue.length >= MOVE_QUEUE_MAX) return; // 上限
  p.moveQueue.push(clamped);
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
    if (!target || target.hp <= 0 || target.respawnAt) continue;

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
        target.hp = Math.max(0, target.hp - EXPLOSION_DAMAGE);
        if (target.hp === 0) {
          // Kill credit
          if (shooter && shooter.id !== target.id) {
            shooter.kills += 1;
            shooter.score += 1;
          } else if (shooter && shooter.id === target.id) {
            // Suicide
            shooter.score -= 1;
          }

          target.deaths += 1;
          target.score -= 5;
          target.respawnAt = nowMs() + RESPAWN_MS;
          target.ammo = 0;
          target.isMoving = false;
          target.cooldownUntil = 0;
        }
      }
    }
  }
}

function tryShoot(p: PlayerRuntime, dir: Vector2) {
  if (!p.roomId) return;
  const now = nowMs();

  if (p.respawnAt && p.respawnAt > now) return;

  // Cooldown Check
  if (now < p.cooldownUntil) return;
  if (p.isMoving) return; // Cannot shoot while moving

  if (p.ammo <= 0) return;

  p.ammo -= 1;

  // Trigger Cooldown immediately
  p.cooldownUntil = now + ACTION_COOLDOWN_MS;

  const room = rooms.get(p.roomId);
  if (!room) return;

  const d = norm(dir);
  if (len(d) === 0) return;

  const spawnOffset = HIT_RADIUS + BULLET_RADIUS + 2;
  const bx = clamp(p.x + d.x * spawnOffset, 0, MAP_W);
  const by = clamp(p.y + d.y * spawnOffset, 0, MAP_H);

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
      if (t.hp <= 0) continue;

      // Friendly fire check: Bullets pass through teammates?
      // Or they hit and explode but do no damage?
      // "Team members are大丈夫" -> Likely pass through or no-damage impact.
      // Let's assume passed-through for nicer gameplay, or impact but 0 dmg.
      // Let's do: Impact -> Explode. Same damage logic applies (0 to teammate).

      if (t.hp <= 0) continue;

      // Dynamic Safety Zone: Ignore collision if target is within 40px of bullet Start Position
      const distFromStart = Math.hypot(t.x - b.startX, t.y - b.startY);
      if (distFromStart < 40) {
        continue;
      }

      // FIX: Arguments were swapped!
      // Old: distPointToSegment(prev, curr, target) -> Distance form Prev, to Line(Curr, Target) -> NONSENSE
      // New: distPointToSegment(target, prev, curr) -> Distance from Target, to Line(Prev, Curr) -> CORRECT
      const dSeg = distPointToSegment({ x: t.x, y: t.y }, prev, curr);

      if (dSeg <= HIT_RADIUS + b.radius) {
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

    if (room.ended) continue;

    if (room.endsAt > 0 && now >= room.endsAt) {
      room.ended = true;
      const leaderboard = [...room.playerIds]
        .map((pid) => players.get(pid))
        .filter((p): p is PlayerRuntime => !!p)
        .map((p) => ({ id: p.id, name: p.name, score: p.score, kills: p.kills, deaths: p.deaths, team: p.team }))
        .sort((a, b) => b.score - a.score);

      broadcastRoom(room.id, { type: "leaderboard", payload: { players: leaderboard } });
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

      // Movement Logic
      let wantsToMove = false;
      let dx = 0;
      let dy = 0;

      if (p.cooldownUntil > now) {
        // In Cooldown: FREEZE movement (but moveQueue keeps accepting via setMoveTarget)
        p.isMoving = false;
        p.pendingMove = null;
      } else {
        // Ready to move
        if (p.pendingMove) {
          dx = p.pendingMove.x * MOVE_SPEED;
          dy = p.pendingMove.y * MOVE_SPEED;
          wantsToMove = true;
        } else if (p.moveQueue.length > 0) {
          const currentTarget = p.moveQueue[0];
          const to = { x: currentTarget.x - p.x, y: currentTarget.y - p.y };
          const distance = len(to);
          if (distance <= MOVE_SPEED) {
            // Arrived at current target
            p.x = currentTarget.x;
            p.y = currentTarget.y;
            p.moveQueue.shift(); // consume this target
            p.isMoving = false;

            // ARRIVAL -> Cooldown Start
            p.cooldownUntil = now + ACTION_COOLDOWN_MS;
          } else {
            const d = norm(to);
            dx = d.x * MOVE_SPEED;
            dy = d.y * MOVE_SPEED;
            wantsToMove = true;
          }
        } else {
          // Not moving, queue empty
          if (p.isMoving) {
            p.isMoving = false;
            p.cooldownUntil = now + ACTION_COOLDOWN_MS;
          }
        }
      }

      if (wantsToMove) {
        const nextX = clamp(p.x + dx, 0, room.mapData.width);
        const nextY = clamp(p.y + dy, 0, room.mapData.height);

        if (!checkWallCollision(nextX, nextY, TANK_SIZE, room.mapData.walls)) {
          p.x = nextX;
          p.y = nextY;
          p.isMoving = true;
        } else {
          // Hit wall — consume only this target, trigger cooldown
          p.pendingMove = null;
          if (p.moveQueue.length > 0) p.moveQueue.shift();
          p.isMoving = false;
          p.cooldownUntil = now + ACTION_COOLDOWN_MS; // Bonk -> Cooldown
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
    hp: 100, ammo: 20, score: 0, kills: 0, deaths: 0,
    roomId: null,
    aimDir: { x: 1, y: 0 },
    pendingMove: null, moveQueue: [],
    isMoving: false, cooldownUntil: 0,
    respawnAt: null,
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
        const nameRaw = pickString(pld.name ?? pld.roomName, "");
        const roomName = nameRaw.trim() ? nameRaw.trim() : roomId;
        const mapId = pickString(pld.mapId, "alpha");
        const maxPlayers = clamp(pickNumber(pld.maxPlayers, 4), 2, 16);
        const timeLimitSec = clamp(pickNumber(pld.timeLimitSec ?? pld.timeLimit, 240), 30, 3600);
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
        };
        rooms.set(roomId, room);
        broadcastLobby();
        joinRoom(player, roomId, passwordProtected ? password : undefined);
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
          setMoveTarget(player, t);
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
        if (!player.roomId) break;
        broadcastRoom(player.roomId, {
          type: "chat",
          payload: {
            from: player.name, color: "",
            message: message.slice(0, 120),
            at: nowMs(),
          },
        });
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

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});