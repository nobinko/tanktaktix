import * as crypto from "crypto";
import * as fs from "fs";
import express from "express";
import http from "http";
import * as path from "path";
import { WebSocket, WebSocketServer } from "ws";

/**
 * server/src/index.ts
 *
 * ゴール:
 * - ルーム/入室/自機表示/撃ち合いが壊れない互換を維持しつつ
 * - hitscan(即時着弾)をやめて、弾＝移動体(projectile)としてサーバ権威で更新
 * - bullets を room payload に載せ、クライアントで描画できる状態にする
 *
 * 重要:
 * - monorepo で `npm start -w server` すると cwd が server/ になることがある
 *   -> client/dist の参照がズレて "Cannot GET /" になりがちなので、__dirname/cwd の両方から解決する
 */

type Vector2 = { x: number; y: number };

type ClientMsg = { type: string; payload?: unknown };
type ServerMsg = { type: string; payload?: unknown };

type PlayerRuntime = {
  id: string;
  name: string;

  x: number;
  y: number;

  hp: number;
  ammo: number;
  score: number;
  kills: number;
  deaths: number;

  roomId: string | null;

  aimDir: Vector2; // unit
  pendingMove: Vector2 | null; // unit
  pendingTarget: Vector2 | null; // click move

  lastMoveAt: number;
  lastShootAt: number;

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
  expiresAt: number;
};

type Room = {
  id: string;
  name: string;
  mapId: string;
  passwordProtected: boolean;
  password?: string;

  maxPlayers: number;
  timeLimitSec: number;

  createdAt: number;
  endsAt: number;
  ended: boolean;

  playerIds: Set<string>;
  bullets: Bullet[];
};

const PORT = Number(process.env.PORT ?? 3000);

// --- gameplay tuning ---
const TICK_MS = 50;

const MAP_W = 900;
const MAP_H = 520;

const MOVE_SPEED = 6; // per tick
const MOVE_COOLDOWN_MS = 0;

const SHOOT_COOLDOWN_MS = 300;
const RESPAWN_MS = 1500;

const HIT_RADIUS = 18;

// projectile bullets
const BULLET_SPEED = 220; // px/sec（遅くしたいなら 120 とか）
const BULLET_RADIUS = 4;
const BULLET_RANGE = 600;
const BULLET_DAMAGE = 20;
const BULLET_TTL_MS = Math.ceil((BULLET_RANGE / BULLET_SPEED) * 1000);

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

function distPointToSegment(a: Vector2, b: Vector2, p: Vector2) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-9) return Math.hypot(apx, apy);
  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + abx * t;
  const cy = a.y + aby * t;
  return Math.hypot(p.x - cx, p.y - cy);
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
    roomId: p.roomId,
    x: p.x,
    y: p.y,
    position: { x: p.x, y: p.y },

    target: p.pendingTarget ?? { x: p.x, y: p.y },

    hp: p.hp,
    ammo: p.ammo,
    score: p.score,
    kills: p.kills,
    deaths: p.deaths,
    respawnAt: p.respawnAt,
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
    roomName: r.name, // 互換

    mapId: r.mapId,
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
    };
  }

  const timeLeftSec = Math.max(0, Math.ceil((room.endsAt - nowMs()) / 1000));

  const ps = [...room.playerIds]
    .map((pid) => players.get(pid))
    .filter((p): p is PlayerRuntime => !!p)
    .map(toPlayerPublic);

  const bs = room.bullets.map(toBulletPublic);

  return {
    roomId: room.id,
    roomName: room.name,
    mapId: room.mapId,
    timeLeftSec,
    timeLeft: timeLeftSec,
    room: toRoomSummary(room),
    players: ps,
    bullets: bs,
    projectiles: bs, // 互換
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
  p.pendingTarget = null;

  sendRoomState(oldRoomId);
}

function joinLobby(p: PlayerRuntime) {
  detachFromRoom(p);
  send(p.socket, { type: "lobby", payload: lobbyStatePayload() });
  broadcastLobby();
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

  // spawn
  p.x = 150 + Math.random() * 200;
  p.y = 150 + Math.random() * 200;
  p.hp = 100;
  p.ammo = 20;
  p.respawnAt = null;

  p.pendingMove = null;
  p.pendingTarget = null;

  room.playerIds.add(p.id);

  sendRoomState(roomId);
  broadcastLobby();
}

// --- input handlers ---
function setMoveDir(p: PlayerRuntime, dir: Vector2) {
  const d = norm(dir);
  if (len(d) === 0) {
    p.pendingMove = null;
    return;
  }
  p.pendingMove = d;
}

function stopMove(p: PlayerRuntime) {
  p.pendingMove = null;
  p.pendingTarget = null;
}

function setMoveTarget(p: PlayerRuntime, target: Vector2) {
  p.pendingTarget = {
    x: clamp(target.x, 0, MAP_W),
    y: clamp(target.y, 0, MAP_H),
  };
}

function setAimDir(p: PlayerRuntime, dir: Vector2) {
  const d = norm(dir);
  if (len(d) === 0) return;
  p.aimDir = d;
}

function applyBulletHit(shooter: PlayerRuntime, target: PlayerRuntime, now: number) {
  target.hp = Math.max(0, target.hp - BULLET_DAMAGE);
  if (target.hp === 0) {
    shooter.kills += 1;
    shooter.score += 1;

    target.deaths += 1;
    target.score -= 5;
    target.respawnAt = now + RESPAWN_MS;
    target.ammo = 0;
  }
}

function tryShoot(p: PlayerRuntime, dir: Vector2) {
  if (!p.roomId) return;

  const now = nowMs();
  if (p.respawnAt && p.respawnAt > now) return;

  if (now - p.lastShootAt < SHOOT_COOLDOWN_MS) return;
  p.lastShootAt = now;

  if (p.ammo <= 0) return;
  p.ammo -= 1;

  const room = rooms.get(p.roomId);
  if (!room) return;

  const d = norm(dir);
  if (len(d) === 0) return;

  const spawnOffset = HIT_RADIUS + BULLET_RADIUS + 2;
  const bullet: Bullet = {
    id: newId(),
    shooterId: p.id,
    x: clamp(p.x + d.x * spawnOffset, 0, MAP_W),
    y: clamp(p.y + d.y * spawnOffset, 0, MAP_H),
    vx: d.x * BULLET_SPEED,
    vy: d.y * BULLET_SPEED,
    radius: BULLET_RADIUS,
    expiresAt: now + BULLET_TTL_MS,
  };

  room.bullets.push(bullet);

  // すぐ見えるよう即送信
  sendRoomState(p.roomId);
}

function updateBullets(room: Room, dtSec: number, now: number) {
  if (!room.bullets.length) return;

  const next: Bullet[] = [];

  for (const b of room.bullets) {
    if (now >= b.expiresAt) continue;

    const prev = { x: b.x, y: b.y };
    const curr = { x: b.x + b.vx * dtSec, y: b.y + b.vy * dtSec };

    // 範囲外は消す
    if (curr.x < 0 || curr.x > MAP_W || curr.y < 0 || curr.y > MAP_H) continue;

    let hit = false;
    const shooter = players.get(b.shooterId) ?? null;

    for (const pid of room.playerIds) {
      if (pid === b.shooterId) continue;
      const t = players.get(pid);
      if (!t) continue;

      if (t.respawnAt && t.respawnAt > now) continue;
      if (t.hp <= 0) continue;

      // sweep：線分-円距離（高速すり抜け対策）
      const dSeg = distPointToSegment(prev, curr, { x: t.x, y: t.y });
      if (dSeg <= HIT_RADIUS + b.radius) {
        if (shooter) applyBulletHit(shooter, t, now);
        hit = true;
        break;
      }
    }

    if (hit) continue;

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
    if (room.ended) continue;

    if (room.endsAt > 0 && now >= room.endsAt) {
      room.ended = true;

      const leaderboard = [...room.playerIds]
        .map((pid) => players.get(pid))
        .filter((p): p is PlayerRuntime => !!p)
        .map((p) => ({ id: p.id, name: p.name, score: p.score, kills: p.kills, deaths: p.deaths }))
        .sort((a, b) => b.score - a.score);

      broadcastRoom(room.id, { type: "leaderboard", payload: { players: leaderboard } });
      sendRoomState(room.id);
      continue;
    }

    // players update
    for (const pid of room.playerIds) {
      const p = players.get(pid);
      if (!p) continue;

      // respawn
      if (p.respawnAt && p.respawnAt <= now) {
        p.hp = 100;
        p.ammo = 20;
        p.respawnAt = null;
        p.x = 150 + Math.random() * 200;
        p.y = 150 + Math.random() * 200;
      }

      if (p.respawnAt && p.respawnAt > now) continue;

      // dir move
      if (p.pendingMove) {
        if (MOVE_COOLDOWN_MS === 0 || now - p.lastMoveAt >= MOVE_COOLDOWN_MS) {
          p.lastMoveAt = now;
          p.x = clamp(p.x + p.pendingMove.x * MOVE_SPEED, 0, MAP_W);
          p.y = clamp(p.y + p.pendingMove.y * MOVE_SPEED, 0, MAP_H);
        }
      }

      // click move
      if (p.pendingTarget) {
        const to = { x: p.pendingTarget.x - p.x, y: p.pendingTarget.y - p.y };
        const distance = len(to);
        if (distance <= 1) {
          p.pendingTarget = null;
        } else {
          const d = norm(to);
          const step = Math.min(MOVE_SPEED, distance);
          p.x = clamp(p.x + d.x * step, 0, MAP_W);
          p.y = clamp(p.y + d.y * step, 0, MAP_H);
        }
      }
    }

    // bullets update
    updateBullets(room, dtSec, now);

    // broadcast every tick
    sendRoomState(room.id);
  }
}

setInterval(() => tick(), TICK_MS);

// --- static / ws path fix ---
function resolvePublicDir(): string {
  // 実行場所が root/server/dist どれでも拾えるように候補を増やす
  const candidates = [
    path.resolve(__dirname, "../../client/dist"), // server/dist から
    path.resolve(__dirname, "../../../client/dist"),
    path.resolve(process.cwd(), "client", "dist"), // root から
    path.resolve(process.cwd(), "..", "client", "dist"), // server から
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

// --- http ---
const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// dist が無くても 404 ではなく原因が見えるようにする
app.use(express.static(PUBLIC_DIR, { index: false }));

app.get("/", (_req, res) => {
  if (fs.existsSync(PUBLIC_INDEX)) {
    res.sendFile(PUBLIC_INDEX);
    return;
  }
  res
    .status(500)
    .type("text/plain")
    .send(`client build not found.\nExpected:\n  ${PUBLIC_INDEX}\n\nRun:\n  npm run build`);
});

// SPA fallback（拡張子付きは除外）
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  if (!fs.existsSync(PUBLIC_INDEX)) return next();

  // API/WS系は触らない
  if (req.path === "/health" || req.path.startsWith("/ws")) return next();

  // 画像や js/css などは静的に任せる
  if (path.extname(req.path)) return next();

  res.sendFile(PUBLIC_INDEX);
});

const server = http.createServer(app);

// client 側が /ws に繋ぐので path を合わせる
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket) => {
  const playerId = newId();

  const p: PlayerRuntime = {
    id: playerId,
    name: `Player-${playerId.slice(0, 4)}`,

    x: 150,
    y: 150,

    hp: 100,
    ammo: 20,
    score: 0,
    kills: 0,
    deaths: 0,

    roomId: null,

    aimDir: { x: 1, y: 0 },
    pendingMove: null,
    pendingTarget: null,

    lastMoveAt: 0,
    lastShootAt: 0,

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

        const timeLimitSec = clamp(
          pickNumber(pld.timeLimitSec ?? pld.timeLimit, 240),
          30,
          3600
        );

        const password = pickString(pld.password, "");
        const passwordProtected = !!password.trim();

        const createdAt = nowMs();
        const endsAt = createdAt + timeLimitSec * 1000;

        const room: Room = {
          id: roomId,
          name: roomName,
          mapId,
          passwordProtected,
          password: passwordProtected ? password : undefined,
          maxPlayers,
          timeLimitSec,
          createdAt,
          endsAt,
          ended: false,
          playerIds: new Set<string>(),
          bullets: [],
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
        // 互換: {dir}, {direction}, {target}, {x,y}
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

      case "aim": {
        const pld = isRecord(payload) ? payload : {};
        const dir = pickVector2(pld.dir ?? pld.direction ?? pld, player.aimDir);
        setAimDir(player, dir);
        break;
      }

      case "shoot": {
        const pld = isRecord(payload) ? payload : payload ?? {};
        // 互換: {direction}, {dir}, {target}, {angle}
        let shootDir: Vector2 | null = null;

        if (isRecord(pld) && (pld.dir || pld.direction)) {
          shootDir = pickVector2(pld.dir ?? pld.direction, player.aimDir);
        } else if (isRecord(pld) && pld.target) {
          const t = pickVector2(pld.target, { x: player.x, y: player.y });
          shootDir = { x: t.x - player.x, y: t.y - player.y };
        } else if (isRecord(pld) && typeof pld.angle === "number") {
          const ang = pickNumber(pld.angle, 0);
          shootDir = { x: Math.cos(ang), y: Math.sin(ang) };
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
            from: player.name,
            message: message.slice(0, 120),
            at: nowMs(),
          },
        });
        break;
      }

      default:
        break;
    }
  });

  socket.on("close", () => {
    const player = players.get(playerId);
    if (player) detachFromRoom(player);
    players.delete(playerId);
    broadcastLobby();
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});