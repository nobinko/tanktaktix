import * as crypto from "crypto";
import * as fs from "fs";
import express from "express";
import http from "http";
import * as path from "path";
import { WebSocket, WebSocketServer } from "ws";

/**
 * NOTE:
 * - Build (tsc) を最優先で通すため、@tanktaktix/shared の型依存を一旦やめる。
 * - ランタイムのメッセージ形は「いま動いてる挙動」を壊しにくい形で維持する。
 */

type Vector2 = { x: number; y: number };

type ClientMsg =
  | { type: "login"; payload?: { name?: string } }
  | { type: "requestLobby" }
  | { type: "createRoom"; payload?: { mapId?: string; maxPlayers?: number; timeLimitSec?: number; password?: string } }
  | { type: "joinRoom"; payload?: { roomId?: string; password?: string } }
  | { type: "leaveRoom" }
  | { type: "move"; payload?: { dir?: Vector2 } }
  | { type: "shoot"; payload?: { dir?: Vector2 } }
  | { type: "chat"; payload?: { text?: string } };

type ServerMsg = { type: string; payload?: unknown };

type Player = {
  id: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  ammo: number;
  score: number;
  kills: number;
  deaths: number;
  respawnAt: number | null;
};

type PlayerRuntime = Player & {
  socket: WebSocket;
  roomId: string | null;
  lastMoveAt: number;
  lastShootAt: number;
};

type PlayerSummary = Pick<Player, "id" | "name" | "score" | "kills" | "deaths">;

type Room = {
  id: string;
  mapId: string;
  passwordProtected: boolean;
  password?: string;
  maxPlayers: number;
  timeLimitSec: number;
  createdAt: number;
  endsAt: number;
  ended: boolean;
  players: PlayerRuntime[];
};

type LobbyState = { rooms: RoomSummary[] };

type RoomSummary = Omit<Room, "players" | "password"> & { players: PlayerSummary[] };
type RoomState = { room: RoomSummary; players: PlayerRuntime[] };

const PORT = Number(process.env.PORT ?? 3000);

const MOVE_COOLDOWN_MS = 80;
const SHOOT_COOLDOWN_MS = 300;
const RESPAWN_MS = 1500;
const TICK_MS = 50;

const BULLET_RANGE = 600;
const BULLET_DAMAGE = 20;

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
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l };
}

function dist(a: Vector2, b: Vector2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function isVector2(v: unknown): v is Vector2 {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.x === "number" && typeof o.y === "number";
}

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // ignore
  }
}

function newId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

/**
 * PUBLIC_DIR を「どこから起動しても」探せるようにする
 * - root で起動: ./client/dist
 * - server で起動: ../client/dist
 * - dist で起動: ../../client/dist
 */
function resolvePublicDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "client", "dist"),
    path.resolve(process.cwd(), "..", "client", "dist"),
    path.resolve(process.cwd(), "..", "..", "client", "dist"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.existsSync(path.join(c, "index.html"))) return c;
  }
  // fallback (exist しなくても起動だけはさせる)
  return candidates[0];
}

const PUBLIC_DIR = resolvePublicDir();

const players = new Map<string, PlayerRuntime>();
const rooms = new Map<string, Room>();

function broadcast(roomId: string, msg: ServerMsg) {
  for (const p of players.values()) {
    if (p.roomId === roomId) send(p.socket, msg);
  }
}

function getRoomSummaries(): RoomSummary[] {
  const list: RoomSummary[] = [];
  for (const r of rooms.values()) {
    const summary: RoomSummary = {
      id: r.id,
      mapId: r.mapId,
      passwordProtected: r.passwordProtected,
      maxPlayers: r.maxPlayers,
      timeLimitSec: r.timeLimitSec,
      createdAt: r.createdAt,
      endsAt: r.endsAt,
      ended: r.ended,
      players: r.players.map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        kills: p.kills,
        deaths: p.deaths,
      })),
    };
    list.push(summary);
  }
  list.sort((a, b) => b.createdAt - a.createdAt);
  return list;
}

function makeLobbyState(): LobbyState {
  return { rooms: getRoomSummaries() };
}

function makeRoomState(roomId: string): RoomState {
  const r = rooms.get(roomId);
  if (!r) {
    return {
      room: {
        id: roomId,
        mapId: "unknown",
        passwordProtected: false,
        maxPlayers: 0,
        timeLimitSec: 0,
        createdAt: 0,
        endsAt: 0,
        ended: true,
        players: [],
      },
      players: [],
    };
  }

  const roomSummary: RoomSummary = {
    id: r.id,
    mapId: r.mapId,
    passwordProtected: r.passwordProtected,
    maxPlayers: r.maxPlayers,
    timeLimitSec: r.timeLimitSec,
    createdAt: r.createdAt,
    endsAt: r.endsAt,
    ended: r.ended,
    players: r.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      kills: p.kills,
      deaths: p.deaths,
    })),
  };

  return { room: roomSummary, players: r.players };
}

function joinLobby(socket: WebSocket, playerId: string) {
  const p = players.get(playerId);
  if (!p) return;

  p.roomId = null;
  send(socket, { type: "lobby", payload: makeLobbyState() });
}

function joinRoom(socket: WebSocket, playerId: string, roomId: string, password?: string) {
  const p = players.get(playerId);
  const r = rooms.get(roomId);
  if (!p || !r) return;

  if (r.passwordProtected) {
    if (!password || password !== r.password) {
      send(socket, { type: "error", payload: { message: "Invalid password." } });
      return;
    }
  }
  if (r.players.length >= r.maxPlayers) {
    send(socket, { type: "error", payload: { message: "Room is full." } });
    return;
  }

  // remove from old room
  if (p.roomId) {
    const old = rooms.get(p.roomId);
    if (old) old.players = old.players.filter((x) => x.id !== p.id);
  }

  p.roomId = roomId;

  // spawn
  p.x = 100 + Math.random() * 200;
  p.y = 100 + Math.random() * 200;
  p.hp = 100;
  p.ammo = 20;
  p.respawnAt = null;

  r.players.push(p);

  // tell the joiner
  send(socket, { type: "room", payload: makeRoomState(roomId) });

  // tell everyone in the room
  broadcast(roomId, { type: "room", payload: makeRoomState(roomId) });

  // update lobby listings for everybody in lobby
  for (const other of players.values()) {
    if (other.roomId === null) send(other.socket, { type: "lobby", payload: makeLobbyState() });
  }
}

function leaveRoom(socket: WebSocket, playerId: string) {
  const p = players.get(playerId);
  if (!p) return;

  if (p.roomId) {
    const r = rooms.get(p.roomId);
    if (r) r.players = r.players.filter((x) => x.id !== p.id);
    const oldRoomId = p.roomId;
    p.roomId = null;

    // notify old room and lobby
    if (r) broadcast(oldRoomId, { type: "room", payload: makeRoomState(oldRoomId) });
    for (const other of players.values()) {
      if (other.roomId === null) send(other.socket, { type: "lobby", payload: makeLobbyState() });
    }
  }

  joinLobby(socket, playerId);
}

function handleMove(playerId: string, dir: Vector2) {
  const p = players.get(playerId);
  if (!p || !p.roomId) return;

  const now = nowMs();
  if (now - p.lastMoveAt < MOVE_COOLDOWN_MS) return;
  p.lastMoveAt = now;

  if (p.respawnAt && p.respawnAt > now) return;

  const d = norm(dir);
  const speed = 6;

  p.x = clamp(p.x + d.x * speed, 0, 800);
  p.y = clamp(p.y + d.y * speed, 0, 600);

  broadcast(p.roomId, { type: "room", payload: makeRoomState(p.roomId) });
}

function handleShoot(playerId: string, dir0: Vector2) {
  const shooter = players.get(playerId);
  if (!shooter || !shooter.roomId) return;

  const now = nowMs();
  if (now - shooter.lastShootAt < SHOOT_COOLDOWN_MS) return;
  shooter.lastShootAt = now;

  if (shooter.respawnAt && shooter.respawnAt > now) return;
  if (shooter.ammo <= 0) return;

  shooter.ammo -= 1;

  const dir = norm(dir0);
  const room = rooms.get(shooter.roomId);
  if (!room) return;

  const targets = room.players.filter((p) => p.id !== shooter.id);

  let bestTarget: PlayerRuntime | null = null;
  let bestDist = Infinity;

  // naive raycast against player circles
  for (const target of targets) {
    if (target.respawnAt && target.respawnAt > now) continue;

    const to: Vector2 = { x: target.x - shooter.x, y: target.y - shooter.y };
    const proj = to.x * dir.x + to.y * dir.y; // projection length
    if (proj <= 0 || proj > BULLET_RANGE) continue;

    // distance from ray
    const closest: Vector2 = { x: shooter.x + dir.x * proj, y: shooter.y + dir.y * proj };
    const dRay = dist(closest, { x: target.x, y: target.y });

    const hitRadius = 18; // rough tank radius
    if (dRay <= hitRadius) {
      if (proj < bestDist) {
        bestDist = proj;
        bestTarget = target;
      }
    }
  }

  if (bestTarget) {
    bestTarget.hp = Math.max(0, bestTarget.hp - BULLET_DAMAGE);
    if (bestTarget.hp === 0) {
      shooter.kills += 1;
      shooter.score += 1;

      bestTarget.deaths += 1;
      bestTarget.score -= 5;
      bestTarget.respawnAt = now + RESPAWN_MS;
      bestTarget.ammo = 0;
    }
  }

  broadcast(shooter.roomId, { type: "room", payload: makeRoomState(shooter.roomId) });
}

function tickRooms() {
  const now = nowMs();
  for (const r of rooms.values()) {
    if (r.ended) continue;
    if (r.endsAt > 0 && now >= r.endsAt) {
      r.ended = true;
      const sorted = [...r.players]
        .map((p) => ({ id: p.id, name: p.name, score: p.score, kills: p.kills, deaths: p.deaths }))
        .sort((a, b) => b.score - a.score);

      broadcast(r.id, { type: "leaderboard", payload: { players: sorted } });
      broadcast(r.id, { type: "room", payload: makeRoomState(r.id) });
    }

    // respawns
    for (const p of r.players) {
      if (p.respawnAt && p.respawnAt <= now) {
        p.hp = 100;
        p.ammo = 20;
        p.respawnAt = null;
        p.x = 100 + Math.random() * 200;
        p.y = 100 + Math.random() * 200;
      }
    }
  }
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// client build があるなら配信
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

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
    respawnAt: null,
    socket,
    roomId: null,
    lastMoveAt: 0,
    lastShootAt: 0,
  };

  players.set(playerId, p);

  send(socket, { type: "welcome", payload: { id: playerId } });
  send(socket, { type: "lobby", payload: makeLobbyState() });

  socket.on("message", (buf) => {
    const raw = safeJsonParse(String(buf));
    if (!raw || typeof raw !== "object") return;

    const msg = raw as ClientMsg;
    const player = players.get(playerId);
    if (!player) return;

    switch (msg.type) {
      case "login": {
        const name = String(msg.payload?.name ?? "").trim();
        if (name) player.name = name.slice(0, 20);
        send(socket, { type: "welcome", payload: { id: playerId } });
        send(socket, { type: "lobby", payload: makeLobbyState() });
        break;
      }
      case "requestLobby": {
        joinLobby(socket, playerId);
        break;
      }
      case "createRoom": {
        const payload = msg.payload ?? {};
        const mapId = String(payload.mapId ?? "alpha");
        const maxPlayers = clamp(Number(payload.maxPlayers ?? 4), 2, 16);
        const timeLimitSec = clamp(Number(payload.timeLimitSec ?? 240), 30, 3600);
        const password = payload.password ? String(payload.password) : undefined;

        const id = newId();
        const createdAt = nowMs();
        const endsAt = createdAt + timeLimitSec * 1000;

        const newRoom: Room = {
          id,
          mapId,
          passwordProtected: Boolean(password),
          password,
          maxPlayers,
          timeLimitSec,
          createdAt,
          endsAt,
          ended: false,
          players: [],
        };

        rooms.set(id, newRoom);

        // update lobby for everyone in lobby
        for (const other of players.values()) {
          if (other.roomId === null) send(other.socket, { type: "lobby", payload: makeLobbyState() });
        }

        // auto join creator
        joinRoom(socket, playerId, id, password);
        break;
      }
      case "joinRoom": {
        const roomId = String(msg.payload?.roomId ?? "");
        const password = msg.payload?.password ? String(msg.payload.password) : undefined;
        if (roomId) joinRoom(socket, playerId, roomId, password);
        break;
      }
      case "leaveRoom": {
        leaveRoom(socket, playerId);
        break;
      }
      case "move": {
        if (!player.roomId) break;
        const dir = msg.payload?.dir;
        if (!isVector2(dir)) break;
        handleMove(playerId, dir);
        break;
      }
      case "shoot": {
        if (!player.roomId) break;
        const dir = msg.payload?.dir;
        if (!isVector2(dir)) break;
        handleShoot(playerId, dir);
        break;
      }
      case "chat": {
        const text = String(msg.payload?.text ?? "").trim().slice(0, 200);
        if (!text) break;

        const chatMsg = {
          id: newId(),
          at: nowMs(),
          from: { id: player.id, name: player.name },
          text,
        };

        if (player.roomId) {
          broadcast(player.roomId, { type: "chat", payload: chatMsg });
        } else {
          for (const other of players.values()) {
            if (other.roomId === null) send(other.socket, { type: "chat", payload: chatMsg });
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

    if (player.roomId) {
      const r = rooms.get(player.roomId);
      if (r) r.players = r.players.filter((x) => x.id !== playerId);
      const oldRoomId = player.roomId;

      players.delete(playerId);

      if (r) broadcast(oldRoomId, { type: "room", payload: makeRoomState(oldRoomId) });
      for (const other of players.values()) {
        if (other.roomId === null) send(other.socket, { type: "lobby", payload: makeLobbyState() });
      }
    } else {
      players.delete(playerId);
    }
  });
});

setInterval(() => tickRooms(), TICK_MS);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
