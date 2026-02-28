import { WebSocketServer } from "ws";
import type { Vector2 } from "@tanktaktix/shared";
import { clamp } from "../utils/math";
import { players, rooms, send } from "../state";
import type { ClientMsg, PlayerRuntime } from "../types";
import { nowMs } from "../utils/math";
import { newId } from "../utils/id";
import { createRoom, detachFromRoom, joinLobby, joinRoom } from "../room";
import { broadcastLobby, broadcastRoom, lobbyStatePayload, roomStatePayloadForSpectator, sendRoomState } from "./broadcast";
import { setAimDir, setMoveDir, setMoveTarget, stopMove } from "../systems/movement";
import { tryShoot, tryUseItem } from "../systems/combat";

function safeJsonParse(input: string): unknown {
  try { return JSON.parse(input); } catch { return null; }
}
function isRecord(v: unknown): v is Record<string, any> { return typeof v === "object" && v !== null && !Array.isArray(v); }
function pickString(v: unknown, fallback = ""): string { return typeof v === "string" ? v : fallback; }
function pickNumber(v: unknown, fallback = 0): number { return typeof v === "number" && Number.isFinite(v) ? v : fallback; }
function pickVector2(v: unknown, fallback: Vector2): Vector2 {
  if (!isRecord(v)) return fallback;
  const x = pickNumber(v.x, fallback.x);
  const y = pickNumber(v.y, fallback.y);
  return { x, y };
}

export function registerWsHandlers(wss: WebSocketServer) {
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
        const gameMode = (pickString(pld.gameMode, "ctf") === "ctf") ? "ctf" : "deathmatch";
        createRoom({ roomName, roomId, mapId, passwordProtected, password: passwordProtected ? password : undefined, maxPlayers, timeLimitSec, gameMode });
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
}
