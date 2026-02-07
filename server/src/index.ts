import * as crypto from "crypto";
import * as fs from "fs";
import express from "express";
import http from "http";
import * as path from "path";
import { WebSocket, WebSocketServer } from "ws";

/**
 * server/src/index.ts
 *
 * 目的:
 * - クライアント側のメッセージ形式が揺れても「動く/撃つ/抜ける」が壊れないように互換対応する
 * - 受信: move(dir/target/x,y), shoot(dir/target/angle), leaveRoom/leave などを吸収
 * - 送信: room の payload に roomName/timeLeft など「別名フィールド」も同梱（UI が undefined にならない）
 */

type Vector2 = { x: number; y: number };

type ClientMsg = { type: string; payload?: unknown };
type ServerMsg = { type: string; payload?: unknown };

type PlayerRuntime = {
  id: string;
  name: string;

  // 位置（互換のため x/y と position の両方を送る）
  x: number;
  y: number;

  hp: number;
  ammo: number;
  score: number;
  kills: number;
  deaths: number;

  roomId: string | null;

  // 入力状態
  aimDir: Vector2; // unit vector
  pendingMove: Vector2 | null; // unit vector（WASD 方向） or null
  pendingTarget: Vector2 | null; // クリック移動の目標

  // クールダウン
  lastMoveAt: number;
  lastShootAt: number;

  // リスポーン
  respawnAt: number | null;

  socket: WebSocket;
};

type Room = {
  id: string;
  name: string; // 表示名（未設定なら id と同じにする）
  mapId: string;
  passwordProtected: boolean;
  password?: string;

  maxPlayers: number;
  timeLimitSec: number;

  createdAt: number;
  endsAt: number;
  ended: boolean;

  playerIds: Set<string>;
};

const PORT = Number(process.env.PORT ?? 3000);

// --- gameplay tuning ---
const TICK_MS = 50;

const MAP_W = 800;
const MAP_H = 600;

const MOVE_SPEED = 6; // per tick
const MOVE_COOLDOWN_MS = 0; // WASD は連続で良いので 0（必要なら 80 などに）

const SHOOT_COOLDOWN_MS = 300;
const RESPAWN_MS = 1500;

const BULLET_RANGE = 600;
const BULLET_DAMAGE = 20;
const HIT_RADIUS = 18;

// --- utils ---
function nowMs() {
  return Date.now();
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function dist(a: Vector2, b: Vector2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function len(v: Vector2) {
  return Math.hypot(v.x, v.y);
}

function norm(v: Vector2): Vector2 {
  const l = len(v);
  if (!l) return { x: 0, y: 0 };
  return { x: v.x / l, y: v.y / l };
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object";
}

function isVector2(v: unknown): v is Vector2 {
  if (!isRecord(v)) return false;
  return typeof v.x === "number" && typeof v.y === "number";
}

function pickString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function pickNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function pickVector2(v: unknown): Vector2 | null {
  return isVector2(v) ? v : null;
}

function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // ignore
  }
}

// PUBLIC_DIR を「どこから起動しても」探せるようにする
function resolvePublicDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "client", "dist"),
    path.resolve(process.cwd(), "..", "client", "dist"),
    path.resolve(process.cwd(), "..", "..", "client", "dist"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.existsSync(path.join(c, "index.html"))) return c;
  }
  return candidates[0];
}

const PUBLIC_DIR = resolvePublicDir();

// --- state ---
const players = new Map<string, PlayerRuntime>();
const rooms = new Map<string, Room>();

function toPlayerPublic(p: PlayerRuntime) {
  // クライアントが x/y でも position でも取れるように両方送る
  return {
    id: p.id,
    name: p.name,
    roomId: p.roomId,

    // 互換フィールド
    x: p.x,
    y: p.y,
    position: { x: p.x, y: p.y },

    // 移動ターゲット（描画側が target を参照する実装もある想定）
    target: p.pendingTarget ?? { x: p.x, y: p.y },

    hp: p.hp,
    ammo: p.ammo,
    score: p.score,
    kills: p.kills,
    deaths: p.deaths,
    respawnAt: p.respawnAt,
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

    // lobby 側は players.length を見てる想定
    players: playerIds,
    playerCount: playerIds.length, // 互換
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
    };
  }

  const timeLeftSec = Math.max(0, Math.ceil((room.endsAt - nowMs()) / 1000));

  const ps = [...room.playerIds]
    .map((pid) => players.get(pid))
    .filter((p): p is PlayerRuntime => !!p)
    .map(toPlayerPublic);

  return {
    roomId: room.id,
    roomName: room.name,
    mapId: room.mapId, // 互換（UI が mapId を直参照してる場合）
    timeLeftSec,
    timeLeft: timeLeftSec, // 互換

    room: toRoomSummary(room), // 互換（payload.room.name 参照を吸収）
    players: ps,
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

  // 残っているプレイヤーに更新を送る（空なら何もしない）
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

  // 前の部屋から抜ける
  detachFromRoom(p);

  p.roomId = roomId;

  // spawn
  p.x = 100 + Math.random() * 200;
  p.y = 100 + Math.random() * 200;
  p.hp = 100;
  p.ammo = 20;
  p.respawnAt = null;

  p.pendingMove = null;
  p.pendingTarget = null;

  room.playerIds.add(p.id);

  // 部屋更新
  sendRoomState(roomId);
  // ロビー更新
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

  // raycast vs circles
  let bestTarget: PlayerRuntime | null = null;
  let bestProj = Infinity;

  for (const pid of room.playerIds) {
    if (pid === p.id) continue;
    const t = players.get(pid);
    if (!t) continue;

    if (t.respawnAt && t.respawnAt > now) continue;
    if (t.hp <= 0) continue;

    const to = { x: t.x - p.x, y: t.y - p.y };
    const proj = to.x * d.x + to.y * d.y; // projection length
    if (proj <= 0 || proj > BULLET_RANGE) continue;

    const closest = { x: p.x + d.x * proj, y: p.y + d.y * proj };
    const dRay = dist(closest, { x: t.x, y: t.y });

    if (dRay <= HIT_RADIUS && proj < bestProj) {
      bestProj = proj;
      bestTarget = t;
    }
  }

  if (bestTarget) {
    bestTarget.hp = Math.max(0, bestTarget.hp - BULLET_DAMAGE);
    if (bestTarget.hp === 0) {
      p.kills += 1;
      p.score += 1;

      bestTarget.deaths += 1;
      bestTarget.score -= 5;
      bestTarget.respawnAt = now + RESPAWN_MS;
      bestTarget.ammo = 0;
    }
  }

  sendRoomState(p.roomId);
}

// --- tick ---
function tick() {
  const now = nowMs();

  for (const room of rooms.values()) {
    if (room.ended) continue;

    if (room.endsAt > 0 && now >= room.endsAt) {
      room.ended = true;

      // leaderboard
      const leaderboard = [...room.playerIds]
        .map((pid) => players.get(pid))
        .filter((p): p is PlayerRuntime => !!p)
        .map((p) => ({ id: p.id, name: p.name, score: p.score, kills: p.kills, deaths: p.deaths }))
        .sort((a, b) => b.score - a.score);

      broadcastRoom(room.id, { type: "leaderboard", payload: { players: leaderboard } });
      sendRoomState(room.id);
      continue;
    }

    // movement + respawn
    for (const pid of room.playerIds) {
      const p = players.get(pid);
      if (!p) continue;

      // respawn
      if (p.respawnAt && p.respawnAt <= now) {
        p.hp = 100;
        p.ammo = 20;
        p.respawnAt = null;
        p.x = 100 + Math.random() * 200;
        p.y = 100 + Math.random() * 200;
      }

      if (p.respawnAt && p.respawnAt > now) continue;

      // continuous dir move (WASD)
      if (p.pendingMove) {
        if (MOVE_COOLDOWN_MS === 0 || now - p.lastMoveAt >= MOVE_COOLDOWN_MS) {
          p.lastMoveAt = now;
          p.x = clamp(p.x + p.pendingMove.x * MOVE_SPEED, 0, MAP_W);
          p.y = clamp(p.y + p.pendingMove.y * MOVE_SPEED, 0, MAP_H);
        }
      }

      // target move (click)
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

    // broadcast room state every tick
    sendRoomState(room.id);
  }
}

setInterval(() => tick(), TICK_MS);

// --- http ---
const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// client build があるなら配信
if (fs.existsSync(PUBLIC_DIR) && fs.existsSync(path.join(PUBLIC_DIR, "index.html"))) {
  app.use(express.static(PUBLIC_DIR));

  // Express 5 / path-to-regexp でも落ちにくいように wildcard ではなく middleware で吸収
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();

    // 既存ファイルは static が返す。ここは SPA fallback 用。
    const indexPath = path.join(PUBLIC_DIR, "index.html");
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
      return;
    }
    next();
  });
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server }); // path を縛らず互換重視

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

  // welcome + lobby
  send(socket, { type: "welcome", payload: { id: playerId } });
  send(socket, { type: "lobby", payload: lobbyStatePayload() });

  socket.on("message", (buf) => {
    const raw = safeJsonParse(String(buf));
    if (!raw || !isRecord(raw)) return;

    const type = pickString(raw.type);
    const payload = raw.payload;

    const player = players.get(playerId);
    if (!player) return;

    // 互換: クライアントが違う名前で投げてくるのを吸収
    const normalizedType =
      type === "joinLobby" ? "requestLobby" :
      type === "leave" ? "leaveRoom" :
      type;

    switch (normalizedType) {
      case "login": {
        if (isRecord(payload)) {
          const name = pickString(payload.name ?? payload.playerName ?? payload.nickname, "").trim();
          if (name) player.name = name.slice(0, 20);
        }
        send(socket, { type: "welcome", payload: { id: playerId } });
        if (player.roomId) sendRoomState(player.roomId);
        else send(socket, { type: "lobby", payload: lobbyStatePayload() });
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

      case "leaveRoom": {
        joinLobby(player);
        break;
      }

      case "stop":
      case "stopMove":
      case "moveStop": {
        stopMove(player);
        if (player.roomId) sendRoomState(player.roomId);
        break;
      }

      case "move": {
        // 互換:
        // - {dir:{x,y}} (WASD)
        // - {direction:{x,y}}
        // - {target:{x,y}} / {to:{x,y}} / {x,y}
        const pld = isRecord(payload) ? payload : {};

        const dir = pickVector2(pld.dir) ?? pickVector2(pld.direction);

        const target =
          pickVector2(pld.target) ??
          pickVector2(pld.to) ??
          (typeof pld.x === "number" && typeof pld.y === "number" ? { x: pld.x, y: pld.y } : null);

        if (dir) {
          setMoveDir(player, dir);
          if (len(dir) > 0) setAimDir(player, dir);
        }
        if (target) {
          setMoveTarget(player, target);
          const aim = { x: target.x - player.x, y: target.y - player.y };
          if (len(aim) > 0) setAimDir(player, aim);
        }

        if (player.roomId) sendRoomState(player.roomId);
        break;
      }

      case "aim": {
        // aim だけ投げる実装も吸収
        const pld = isRecord(payload) ? payload : {};
        const dir =
          pickVector2(pld.dir) ??
          pickVector2(pld.direction) ??
          (typeof pld.x === "number" && typeof pld.y === "number" ? { x: pld.x, y: pld.y } : null);

        if (dir) setAimDir(player, dir);
        break;
      }

      case "shoot": {
        // 互換:
        // - {dir:{x,y}} / {direction:{x,y}}
        // - {angleDeg:number} / {angleRad:number}
        // - {target:{x,y}} (クリック射撃)
        const pld = isRecord(payload) ? payload : {};

        const dir = pickVector2(pld.dir) ?? pickVector2(pld.direction);
        const target = pickVector2(pld.target) ?? pickVector2(pld.to);

        const angleDeg = pickNumber(pld.angleDeg, NaN);
        const angleRad = pickNumber(pld.angleRad, NaN);

        let shootDir: Vector2 | null = null;

        if (dir) shootDir = dir;
        else if (target) shootDir = { x: target.x - player.x, y: target.y - player.y };
        else if (Number.isFinite(angleRad)) shootDir = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
        else if (Number.isFinite(angleDeg)) {
          const rad = (angleDeg * Math.PI) / 180;
          shootDir = { x: Math.cos(rad), y: Math.sin(rad) };
        } else {
          shootDir = player.aimDir; // 最後に向いてた方向
        }

        if (shootDir) {
          setAimDir(player, shootDir);
          tryShoot(player, shootDir);
        }
        break;
      }

      case "chat": {
        const pld = isRecord(payload) ? payload : {};
        const text = pickString(pld.text ?? pld.message, "").trim().slice(0, 200);
        if (!text) break;

        const chatPayload = {
          id: newId(),
          at: nowMs(),
          from: { id: player.id, name: player.name },
          text,
          message: text, // 互換
        };

        if (player.roomId) {
          broadcastRoom(player.roomId, { type: "chat", payload: chatPayload });
        } else {
          for (const other of players.values()) {
            if (other.roomId === null) send(other.socket, { type: "chat", payload: chatPayload });
          }
        }
        break;
      }

      default:
        break;
    }
  });

  socket.on("close", () => {
    const player = players.get(playerId);
    if (!player) return;

    const oldRoomId = player.roomId;
    detachFromRoom(player);

    players.delete(playerId);

    if (oldRoomId) sendRoomState(oldRoomId);
    broadcastLobby();
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
