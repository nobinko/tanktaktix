import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  Envelope,
  LobbyStatePayload,
  RoomCounts,
  RoomStatePayload,
  RoomSummary,
  ServerEnvelope,
  Team
} from "@tanktaktix/shared";

const port = Number(process.env.PORT ?? 3000);
const clientDistDir = path.resolve(__dirname, "../../client/dist");
const maxRoomPlayers = 8;
const maxTeamPlayers = 4;

interface ConnectionState {
  sid: string;
  name: string;
  roomId: string | null;
  socket: WebSocket;
  hasHello: boolean;
}

interface RoomPlayerState {
  sid: string;
  name: string;
  team: Team;
  ready: boolean;
  joinedAt: number;
  socket: WebSocket;
}

interface RoomState {
  id: string;
  name: string;
  players: Map<string, RoomPlayerState>;
}

const rooms = new Map<string, RoomState>();
const connections = new Map<WebSocket, ConnectionState>();

const server = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }

  if (req.url.startsWith("/ws")) {
    res.writeHead(426);
    res.end("Upgrade Required");
    return;
  }

  if (req.url.startsWith("/health")) {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
    return;
  }

  const requestPath = req.url.split("?")[0];
  const filePath = path.join(clientDistDir, requestPath === "/" ? "/index.html" : requestPath);

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypeForPath(filePath)
    });
    res.end(data);
  } catch {
    try {
      const indexHtml = await readFile(path.join(clientDistDir, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(indexHtml);
    } catch {
      res.writeHead(404);
      res.end("Not Found");
    }
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (socket) => {
  const sid = createSid();
  const connection: ConnectionState = {
    sid,
    name: "",
    roomId: null,
    socket,
    hasHello: false
  };
  connections.set(socket, connection);

  socket.on("message", (data) => {
    const message = parseEnvelope(data.toString());
    if (!message) {
      sendError(socket, "BAD_REQUEST", "Invalid message format.");
      return;
    }

    handleMessage(connection, message);
  });

  socket.on("close", () => {
    handleDisconnect(connection);
    connections.delete(socket);
  });
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

function handleMessage(connection: ConnectionState, message: Envelope) {
  switch (message.type) {
    case "HELLO": {
      const name = normalizeName(message.payload as { name?: string } | undefined, connection.sid);
      connection.name = name;
      connection.hasHello = true;
      connection.roomId = null;
      send(connection.socket, { type: "WELCOME", payload: { sid: connection.sid, name } });
      broadcastLobbyState();
      return;
    }
    case "PING": {
      if (!connection.hasHello) {
        sendError(connection.socket, "NO_HELLO", "Send HELLO first.");
        return;
      }
      send(connection.socket, {
        type: "PONG",
        payload: { ts: (message.payload as { ts?: number } | undefined)?.ts }
      });
      return;
    }
    case "CREATE_ROOM": {
      if (!connection.hasHello) {
        sendError(connection.socket, "NO_HELLO", "Send HELLO first.");
        return;
      }
      const roomName = normalizeRoomName((message.payload as { name?: string } | undefined)?.name);
      if (!roomName) {
        sendError(connection.socket, "INVALID_NAME", "Room name is required.");
        return;
      }
      const room = createRoom(roomName);
      joinRoom(connection, room);
      return;
    }
    case "JOIN_ROOM": {
      if (!connection.hasHello) {
        sendError(connection.socket, "NO_HELLO", "Send HELLO first.");
        return;
      }
      const roomId = (message.payload as { roomId?: string } | undefined)?.roomId;
      if (!roomId) {
        sendError(connection.socket, "INVALID_ROOM", "Room ID is required.");
        return;
      }
      const room = rooms.get(roomId);
      if (!room) {
        sendError(connection.socket, "NOT_FOUND", "Room not found.");
        return;
      }
      joinRoom(connection, room);
      return;
    }
    case "LEAVE_ROOM": {
      if (!connection.hasHello) {
        sendError(connection.socket, "NO_HELLO", "Send HELLO first.");
        return;
      }
      leaveRoom(connection);
      broadcastLobbyState();
      return;
    }
    case "SET_TEAM": {
      if (!connection.hasHello) {
        sendError(connection.socket, "NO_HELLO", "Send HELLO first.");
        return;
      }
      const team = (message.payload as { team?: Team } | undefined)?.team ?? null;
      updateTeam(connection, team);
      return;
    }
    case "SET_READY": {
      if (!connection.hasHello) {
        sendError(connection.socket, "NO_HELLO", "Send HELLO first.");
        return;
      }
      const ready = Boolean((message.payload as { ready?: boolean } | undefined)?.ready);
      updateReady(connection, ready);
      return;
    }
    default:
      sendError(connection.socket, "UNKNOWN_TYPE", `Unsupported message type: ${message.type}`);
  }
}

function handleDisconnect(connection: ConnectionState) {
  leaveRoom(connection);
  if (connection.hasHello) {
    broadcastLobbyState();
  }
}

function createSid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function normalizeName(payload: { name?: string } | undefined, sid: string): string {
  const raw = payload?.name?.trim();
  if (raw) {
    return raw.slice(0, 24);
  }
  return `Guest-${sid.slice(0, 4)}`;
}

function normalizeRoomName(raw?: string): string | null {
  const name = raw?.trim();
  if (!name) {
    return null;
  }
  return name.slice(0, 32);
}

function createRoom(name: string): RoomState {
  let id = createSid();
  while (rooms.has(id)) {
    id = createSid();
  }
  const room: RoomState = { id, name, players: new Map() };
  rooms.set(id, room);
  return room;
}

function joinRoom(connection: ConnectionState, room: RoomState) {
  if (connection.roomId === room.id) {
    sendRoomState(room);
    return;
  }

  if (room.players.size >= maxRoomPlayers) {
    sendError(connection.socket, "ROOM_FULL", "Room is full.");
    return;
  }

  leaveRoom(connection);

  const player: RoomPlayerState = {
    sid: connection.sid,
    name: connection.name,
    team: null,
    ready: false,
    joinedAt: Date.now(),
    socket: connection.socket
  };
  room.players.set(connection.sid, player);
  connection.roomId = room.id;
  sendRoomState(room);
  broadcastLobbyState();
}

function leaveRoom(connection: ConnectionState) {
  if (!connection.roomId) {
    return;
  }
  const room = rooms.get(connection.roomId);
  if (!room) {
    connection.roomId = null;
    return;
  }
  room.players.delete(connection.sid);
  connection.roomId = null;
  if (room.players.size === 0) {
    rooms.delete(room.id);
  } else {
    sendRoomState(room);
  }
}

function updateTeam(connection: ConnectionState, team: Team) {
  if (!connection.roomId) {
    sendError(connection.socket, "NOT_IN_ROOM", "Join a room first.");
    return;
  }
  const room = rooms.get(connection.roomId);
  if (!room) {
    sendError(connection.socket, "NOT_FOUND", "Room not found.");
    connection.roomId = null;
    broadcastLobbyState();
    return;
  }
  const player = room.players.get(connection.sid);
  if (!player) {
    return;
  }
  if (team) {
    const counts = countTeams(room.players, connection.sid);
    const nextCount = team === "A" ? counts.a : counts.b;
    if (nextCount >= maxTeamPlayers) {
      sendError(connection.socket, "TEAM_FULL", "Team is full.");
      return;
    }
  }
  player.team = team;
  sendRoomState(room);
  broadcastLobbyState();
}

function updateReady(connection: ConnectionState, ready: boolean) {
  if (!connection.roomId) {
    sendError(connection.socket, "NOT_IN_ROOM", "Join a room first.");
    return;
  }
  const room = rooms.get(connection.roomId);
  if (!room) {
    sendError(connection.socket, "NOT_FOUND", "Room not found.");
    connection.roomId = null;
    broadcastLobbyState();
    return;
  }
  const player = room.players.get(connection.sid);
  if (!player) {
    return;
  }
  player.ready = ready;
  sendRoomState(room);
  broadcastLobbyState();
}

function sendRoomState(room: RoomState) {
  const payload: RoomStatePayload = {
    roomId: room.id,
    name: room.name,
    players: Array.from(room.players.values()).map((player) => ({
      sid: player.sid,
      name: player.name,
      team: player.team,
      ready: player.ready,
      joinedAt: player.joinedAt
    }))
  };

  for (const player of room.players.values()) {
    send(player.socket, { type: "ROOM_STATE", payload });
  }
}

function broadcastLobbyState() {
  const payload: LobbyStatePayload = {
    rooms: Array.from(rooms.values()).map((room) => buildRoomSummary(room))
  };
  const envelope: ServerEnvelope = { type: "LOBBY_STATE", payload };
  for (const connection of connections.values()) {
    if (connection.hasHello && !connection.roomId) {
      send(connection.socket, envelope);
    }
  }
}

function buildRoomSummary(room: RoomState): RoomSummary {
  const counts = countTeams(room.players);
  const inProgress = Array.from(room.players.values()).some((player) => player.ready);
  return {
    roomId: room.id,
    name: room.name,
    counts,
    inProgress
  };
}

function countTeams(players: Map<string, RoomPlayerState>, excludeSid?: string): RoomCounts {
  let a = 0;
  let b = 0;
  let total = 0;
  for (const player of players.values()) {
    if (excludeSid && player.sid === excludeSid) {
      continue;
    }
    total += 1;
    if (player.team === "A") {
      a += 1;
    }
    if (player.team === "B") {
      b += 1;
    }
  }
  return { total, a, b };
}

function send(socket: WebSocket, envelope: ServerEnvelope) {
  socket.send(formatEnvelope(envelope));
}

function sendError(socket: WebSocket, code: string, message: string) {
  send(socket, { type: "ERROR", payload: { code, message } });
}

function parseEnvelope(payload: string): Envelope | null {
  try {
    const parsed = JSON.parse(payload) as Envelope;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (typeof parsed.type !== "string" || !("payload" in parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function formatEnvelope(envelope: Envelope): string {
  return JSON.stringify(envelope);
}

function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html";
    case ".js":
      return "text/javascript";
    case ".css":
      return "text/css";
    case ".json":
      return "application/json";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}
