import { WebSocketServer } from "ws";
import type { Vector2 } from "@tanktaktix/shared";
import { AVAILABLE_LOBBIES } from "../constants.js";
import { players, rooms, send } from "../state.js";
import type { ClientMsg, PlayerRuntime } from "../types.js";
import { clamp, nowMs } from "../utils/math.js";
import { newId } from "../utils/id.js";
import { createRoom, detachFromRoom, joinLobby, joinRoom, spawnPlayer } from "../room.js";
import { broadcastLobby, broadcastRoom, lobbyStatePayload, roomStatePayloadForSpectator, sendRoomState } from "./broadcast.js";
import { setAimDir, setMoveDir, setMoveTarget, stopMove } from "../systems/movement.js";
import { tryShoot, tryUseItem } from "../systems/combat.js";

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
      lobbyId: AVAILABLE_LOBBIES[0],
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
      lives: 0,

      socket,
      disconnectedAt: null,
      ping: 0,
    };

    players.set(boundPlayerId, p);
    send(socket, { type: "welcome", payload: { id: boundPlayerId } });
    send(socket, { type: "lobby", payload: lobbyStatePayload(p.lobbyId) });

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
              if (name) reclaimedPlayer.name = name.slice(0, 16); // Update name on reconnect
              send(socket, { type: "welcome", payload: { id: reclaimedPlayer.id } });

              if (reclaimedPlayer.roomId) {
                sendRoomState(reclaimedPlayer.roomId);
              } else {
                joinLobby(reclaimedPlayer, reclaimedPlayer.lobbyId);
                broadcastLobby(reclaimedPlayer.lobbyId); // Ensure everyone sees the updated name
              }
              return; // Exit wss.on('message') early as we swapped players
            }
          }

          if (name) player.name = name.slice(0, 16);
          send(socket, { type: "welcome", payload: { id: boundPlayerId } });
          joinLobby(player, player.lobbyId); // Trigger lobby update and broadcast
          broadcastLobby(player.lobbyId); // Ensure everyone sees the updated name
          break;
        }
        case "requestLobby": {
          joinLobby(player, player.lobbyId);
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
          const maxPlayers = (clamp(pickNumber(pld.maxPlayers, 4), 2, 100) >> 1) << 1; // even 2-100
          const timeLimitSec = clamp(pickNumber(pld.timeLimitSec ?? pld.timeLimit, 240), 30, 3600);
          const password = pickString(pld.password, "");
          const passwordProtected = !!password.trim();
          const gameMode = (pickString(pld.gameMode, "ctf") === "ctf") ? "ctf" : "deathmatch";
          const optionsRaw = isRecord(pld.options) ? pld.options : {};
          const options = {
            teamSelect: !!optionsRaw.teamSelect,
            instantKill: !!optionsRaw.instantKill,
            noItemRespawn: !!optionsRaw.noItemRespawn,
            noShooting: !!optionsRaw.noShooting,
          };
          createRoom({ roomName, roomId, mapId, passwordProtected, password: passwordProtected ? password : undefined, maxPlayers, timeLimitSec, gameMode, lobbyId: player.lobbyId, hostId: player.id, options });
          break;
        }
        case "switchLobby": {
          const pld = isRecord(payload) ? payload : {};
          const newLobbyId = pickString(pld.lobbyId, "");
          if (AVAILABLE_LOBBIES.includes(newLobbyId)) {
            joinLobby(player, newLobbyId);
          }
          break;
        }
        case "joinRoom": {
          const pld = isRecord(payload) ? payload : {};
          const roomId = pickString(pld.roomId, "").trim();
          const password = pickString(pld.password, "").trim() || undefined;
          if (roomId) joinRoom(player, roomId, password); // Drop requestedTeam from join payload
          break;
        }
        case "selectTeam": {
          if (!player.roomId) break;
          const room = rooms.get(player.roomId);
          if (!room || !room.options.teamSelect || player.team !== null) break;
          const pld = isRecord(payload) ? payload : {};
          const requestedTeam = pickString(pld.team, "");
          if (requestedTeam === "red" || requestedTeam === "blue") {
            player.team = requestedTeam;
            const safeName = (player.name && player.name.trim().length > 0) ? player.name : `Player - ${player.id.slice(0, 4)}`;
            room.history.set(player.id, { name: safeName, team: player.team, kills: 0, deaths: 0, score: 0, fired: 0, hits: 0 });
            const maxHp = room.options?.instantKill ? 20 : 100;
            player.lives = room.options?.instantKill ? 20 : 0;
            spawnPlayer(player, room);
            sendRoomState(room.id);
            broadcastRoom(room.id, { type: "chat", payload: { from: "SYSTEM", message: `${player.name} joined the ${requestedTeam} team.`, timestamp: Date.now() } });
          }
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
            broadcastLobby(player.lobbyId);
          }
          break;
        }
        case "leaveRoom":
        case "leave": {
          joinLobby(player, player.lobbyId);
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
          if (player.moveQueue.length > 1) {
            player.moveQueue.pop();
          } else if (player.moveQueue.length === 1 && player.cooldownUntil > nowMs()) {
            player.moveQueue.pop();
          }
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
          const channel = pickString(pld.channel, "global") as "global" | "team";
          if (!message) break;
          // Spectators can chat but with a distinguishing prefix
          const isSpectatorChat = player.roomId && rooms.get(player.roomId)?.spectatorIds.has(player.id);
          const chatName = isSpectatorChat ? `👁 ${player.name}` : player.name;
          if (player.roomId) {
            const chatMsg = {
              type: "chat",
              payload: {
                from: chatName,
                message: message.slice(0, 120),
                timestamp: nowMs(),
                channel,
              },
            };
            if (channel === "team" && player.team) {
              // Send only to team members in the same room
              for (const pid of players.keys()) {
                const target = players.get(pid);
                if (target && target.roomId === player.roomId && target.team === player.team) {
                  send(target.socket, chatMsg);
                }
              }
            } else {
              broadcastRoom(player.roomId, chatMsg);
            }
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
              if (!p.roomId && p.lobbyId === player.lobbyId) send(p.socket, chatMsg);
            }
          }
          break;
        }
        case "ping": {
          const pld = isRecord(payload) ? payload : {};
          const t = pickNumber(pld.timestamp, nowMs());
          // 往復時間(Ping)はクライアント側で計算するため、
          // サーバーは受け取ったtをそのまま返す
          send(socket, { type: "pong", payload: { timestamp: t } });
          break;
        }
        // Client sends reportPing to update their ping value on the server
        case "reportPing": {
          const pld = isRecord(payload) ? payload : {};
          const resultPing = pickNumber(pld.ping, 0);
          player.ping = Math.max(0, resultPing);
          if (!player.roomId) broadcastLobby(player.lobbyId); // Pingが変わったらロビー画面へ反映する
          break;
        }
        default: break;
      }
    });

    socket.on("close", () => {
      const p = players.get(boundPlayerId);
      if (p) {
        console.log(`[DEBUG] Player ${boundPlayerId} socket closed. Removing from game.`);
        p.socket = null;
        p.disconnectedAt = nowMs();

        const lobbyId = p.lobbyId;
        const wasInLobby = !p.roomId;
        detachFromRoom(p);
        players.delete(boundPlayerId);

        // 元のロビーにプレイヤーが去ったことを即座に通知
        if (wasInLobby) broadcastLobby(lobbyId);
      }
    });
  });
}
