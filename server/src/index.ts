import crypto from "crypto";
import express from "express";
import { createServer } from "http";
import path from "path";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import type {
  ClientToServerMessage,
  PlayerSummary,
  RoomState,
  RoomSummary,
  ServerToClientMessage,
  Vector2
} from "@tanktaktix/shared";

const app = express();
app.use(express.json());

const PORT = Number(process.env.PORT) || 3000;
const MAX_MOVE_DISTANCE = 160;
const MOVE_SPEED = 220;
const COOLDOWN_MS = 700;
const RESPAWN_MS = 2500;
const SHOT_RANGE = 300;
const SHOT_WIDTH = 24;
const MAP_SIZE = { width: 900, height: 520 };

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

if (process.env.NODE_ENV === "production") {
  const clientDist = path.resolve(__dirname, "../../client/dist");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

type PlayerRecord = PlayerSummary & { pendingMove: Vector2 | null };

type RoomRecord = RoomSummary & {
  password?: string;
  ended: boolean;
};

const players = new Map<string, PlayerRecord>();
const sockets = new Map<string, WebSocket>();
const rooms = new Map<string, RoomRecord>();

const send = (socket: WebSocket, message: ServerToClientMessage) => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
};

const getRoomSummaries = (): RoomSummary[] =>
  Array.from(rooms.values()).map(({ password, ended, ...room }) => room);

const broadcastLobby = () => {
  const payload = { rooms: getRoomSummaries() };
  const message: ServerToClientMessage = { type: "lobby", payload };
  sockets.forEach((socket) => send(socket, message));
};

const sendRoomState = (roomId: string) => {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }
  const now = Date.now();
  const playersInRoom = room.players.map((id) => players.get(id)).filter(Boolean) as PlayerRecord[];
  const timeLeftSec = Math.max(0, Math.ceil((room.endsAt - now) / 1000));
  const payload: RoomState = {
    roomId,
    players: playersInRoom.map((player) => {
      const { pendingMove, ...summary } = player;
      return summary;
    }),
    timeLeftSec
  };
  const message: ServerToClientMessage = { type: "room", payload };
  playersInRoom.forEach((player) => {
    const socket = sockets.get(player.id);
    if (socket) {
      send(socket, message);
    }
  });
};

const broadcastRoom = (roomId: string, message: ServerToClientMessage) => {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }
  room.players.forEach((playerId) => {
    const socket = sockets.get(playerId);
    if (socket) {
      send(socket, message);
    }
  });
};

const createPlayer = (id: string): PlayerRecord => ({
  id,
  name: "Commander",
  roomId: null,
  position: { x: 100, y: 100 },
  target: null,
  hp: 100,
  ammo: 20,
  score: 0,
  deaths: 0,
  nextActionAt: 0,
  respawnAt: null,
  pendingMove: null
});

const spawnPosition = (): Vector2 => ({
  x: 80 + Math.random() * (MAP_SIZE.width - 160),
  y: 80 + Math.random() * (MAP_SIZE.height - 160)
});

const applyMove = (player: PlayerRecord, target: Vector2) => {
  const clampedTarget = {
    x: Math.max(0, Math.min(MAP_SIZE.width, target.x)),
    y: Math.max(0, Math.min(MAP_SIZE.height, target.y))
  };
  const dx = clampedTarget.x - player.position.x;
  const dy = clampedTarget.y - player.position.y;
  const distance = Math.hypot(dx, dy);
  const clamped = distance > MAX_MOVE_DISTANCE ? MAX_MOVE_DISTANCE / distance : 1;
  player.target = {
    x: player.position.x + dx * clamped,
    y: player.position.y + dy * clamped
  };
  player.nextActionAt = Date.now() + COOLDOWN_MS;
};

const normalize = (vector: Vector2) => {
  const length = Math.hypot(vector.x, vector.y);
  if (length === 0) {
    return { x: 0, y: 0 };
  }
  return { x: vector.x / length, y: vector.y / length };
};

const handleShot = (player: PlayerRecord, direction: Vector2) => {
  if (!player.roomId) {
    return;
  }
  const room = rooms.get(player.roomId);
  if (!room) {
    return;
  }
  if (player.ammo <= 0) {
    return;
  }
  if (Date.now() < player.nextActionAt) {
    return;
  }
  const dir = normalize(direction);
  player.ammo -= 1;
  player.nextActionAt = Date.now() + COOLDOWN_MS;

  let bestTarget: PlayerRecord | null = null;
  let bestDistance = Infinity;
  room.players.forEach((id) => {
    const target = players.get(id);
    if (!target || target.id === player.id || target.respawnAt) {
      return;
    }
    const toTarget = {
      x: target.position.x - player.position.x,
      y: target.position.y - player.position.y
    };
    const forward = toTarget.x * dir.x + toTarget.y * dir.y;
    if (forward <= 0 || forward > SHOT_RANGE) {
      return;
    }
    const perpendicular = Math.abs(toTarget.x * dir.y - toTarget.y * dir.x);
    if (perpendicular > SHOT_WIDTH) {
      return;
    }
    if (forward < bestDistance) {
      bestDistance = forward;
      bestTarget = target;
    }
  });

  if (bestTarget) {
    bestTarget.hp = Math.max(0, bestTarget.hp - 20);
    player.score += 1;
    if (bestTarget.hp === 0) {
      player.score += 1;
      bestTarget.deaths += 1;
      bestTarget.score -= 5;
      bestTarget.respawnAt = Date.now() + RESPAWN_MS;
      bestTarget.ammo = 0;
    }
  }
};

const handleMove = (player: PlayerRecord, target: Vector2) => {
  if (Date.now() < player.nextActionAt) {
    player.pendingMove = target;
    return;
  }
  applyMove(player, target);
};

const leaveRoom = (player: PlayerRecord) => {
  if (!player.roomId) {
    return;
  }
  const room = rooms.get(player.roomId);
  if (!room) {
    player.roomId = null;
    return;
  }
  room.players = room.players.filter((id) => id !== player.id);
  player.roomId = null;
  player.target = null;
  player.pendingMove = null;
  broadcastLobby();
  if (room.players.length === 0) {
    rooms.delete(room.id);
  }
};

wss.on("connection", (socket) => {
  const id = crypto.randomUUID();
  const player = createPlayer(id);
  players.set(id, player);
  sockets.set(id, socket);

  send(socket, { type: "welcome", payload: { id } });

  socket.on("message", (raw) => {
    try {
      const message = JSON.parse(raw.toString()) as ClientToServerMessage;
      switch (message.type) {
        case "login":
          player.name = message.payload.name.slice(0, 16);
          send(socket, { type: "lobby", payload: { rooms: getRoomSummaries() } });
          break;
        case "requestLobby":
          send(socket, { type: "lobby", payload: { rooms: getRoomSummaries() } });
          break;
        case "createRoom": {
          const { roomId, mapId, maxPlayers, timeLimitSec, password } = message.payload;
          if (rooms.has(roomId)) {
            send(socket, { type: "error", payload: { message: "Room already exists." } });
            return;
          }
          const now = Date.now();
          const limitSec = Math.max(60, Math.min(timeLimitSec, 900));
          const newRoom: RoomRecord = {
            id: roomId,
            mapId,
            maxPlayers: Math.max(2, Math.min(maxPlayers, 8)),
            timeLimitSec: limitSec,
            passwordProtected: Boolean(password),
            password,
            createdAt: now,
            endsAt: now + limitSec * 1000,
            players: [],
            ended: false
          };
          rooms.set(roomId, newRoom);
          broadcastLobby();
          player.roomId = roomId;
          player.position = spawnPosition();
          player.hp = 100;
          player.ammo = 20;
          player.respawnAt = null;
          newRoom.players.push(player.id);
          sendRoomState(roomId);
          break;
        }
        case "joinRoom": {
          const room = rooms.get(message.payload.roomId);
          if (!room) {
            send(socket, { type: "error", payload: { message: "Room not found." } });
            return;
          }
          if (room.password && room.password !== message.payload.password) {
            send(socket, { type: "error", payload: { message: "Incorrect password." } });
            return;
          }
          if (room.players.length >= room.maxPlayers) {
            send(socket, { type: "error", payload: { message: "Room is full." } });
            return;
          }
          leaveRoom(player);
          player.roomId = room.id;
          player.position = spawnPosition();
          player.hp = 100;
          player.ammo = 20;
          player.respawnAt = null;
          room.players.push(player.id);
          sendRoomState(room.id);
          broadcastLobby();
          break;
        }
        case "leaveRoom":
          leaveRoom(player);
          send(socket, { type: "lobby", payload: { rooms: getRoomSummaries() } });
          break;
        case "chat":
          if (!player.roomId) {
            return;
          }
          broadcastRoom(player.roomId, {
            type: "chat",
            payload: {
              from: player.name,
              message: message.payload.message.slice(0, 140),
              timestamp: Date.now()
            }
          });
          break;
        case "move":
          if (!player.roomId || player.respawnAt) {
            return;
          }
          handleMove(player, message.payload.target);
          break;
        case "shoot":
          if (player.respawnAt) {
            return;
          }
          handleShot(player, message.payload.direction);
          break;
        default:
          break;
      }
    } catch (error) {
      send(socket, { type: "error", payload: { message: "Invalid message." } });
    }
  });

  socket.on("close", () => {
    leaveRoom(player);
    players.delete(id);
    sockets.delete(id);
    broadcastLobby();
  });
});

setInterval(() => {
  const now = Date.now();
  rooms.forEach((room) => {
    room.players.forEach((id) => {
      const player = players.get(id);
      if (!player) {
        return;
      }
      if (player.respawnAt && now >= player.respawnAt) {
        player.respawnAt = null;
        player.hp = 100;
        player.ammo = 20;
        player.position = spawnPosition();
      }
      if (player.pendingMove && now >= player.nextActionAt) {
        applyMove(player, player.pendingMove);
        player.pendingMove = null;
      }
      if (player.target) {
        const dx = player.target.x - player.position.x;
        const dy = player.target.y - player.position.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 1) {
          player.position = player.target;
          player.target = null;
        } else {
          const step = (MOVE_SPEED * 0.1);
          const ratio = Math.min(step / distance, 1);
          player.position = {
            x: player.position.x + dx * ratio,
            y: player.position.y + dy * ratio
          };
        }
      }
    });

    const timeLeftSec = Math.max(0, Math.ceil((room.endsAt - now) / 1000));
    if (timeLeftSec === 0 && !room.ended) {
      room.ended = true;
      const playersInRoom = room.players
        .map((id) => players.get(id))
        .filter(Boolean) as PlayerRecord[];
      broadcastRoom(room.id, {
        type: "leaderboard",
        payload: {
          players: playersInRoom.map((player) => {
            const { pendingMove, ...summary } = player;
            return summary;
          })
        }
      });
    }
    sendRoomState(room.id);
  });
}, 100);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
