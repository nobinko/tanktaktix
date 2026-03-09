import type { BulletPublic } from "@tanktaktix/shared";
import { ACTION_LOCK_STEP_MS, AVAILABLE_LOBBIES } from "../constants.js";
import { nowMs } from "../utils/math.js";
import { players, rooms, send } from "../state.js";
import type { Bullet, PlayerRuntime, Room, ServerMsg } from "../types.js";

export function toPlayerPublic(p: PlayerRuntime) {
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
    nextActionAt: p.cooldownUntil,
    actionLockStep: Math.max(0, Math.ceil((p.cooldownUntil - nowMs()) / ACTION_LOCK_STEP_MS)),
    hullAngle: p.hullAngle,
    turretAngle: p.turretAngle,
    kills: p.kills,
    deaths: p.deaths,
    hits: p.hits,
    fired: p.fired,
    hasBomb: p.hasBomb,
    hasSmoke: p.hasSmoke,
    ropeCount: p.ropeCount,
    bootsCharges: p.bootsCharges,
    ping: p.ping,
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
    isSmoke: b.isSmoke || false,
    flagTeam: b.flagTeam,
  };
}

export function toRoomSummary(r: Room) {
  const playerIds = [...r.playerIds];
  const hostPlayer = players.get(r.hostId);
  const hostName = hostPlayer?.name ?? "unknown";

  let teamStats: { red: { count: number; score: number }; blue: { count: number; score: number } } | undefined;
  if (r.options.teamSelect || r.gameMode === "ctf") {
    const redCount = playerIds.map(id => players.get(id)).filter(p => p && p.team === "red").length;
    const blueCount = playerIds.map(id => players.get(id)).filter(p => p && p.team === "blue").length;
    teamStats = {
      red: { count: redCount, score: r.scoreRed },
      blue: { count: blueCount, score: r.scoreBlue },
    };
  }

  return { id: r.id, name: r.name, roomName: r.name, mapId: r.mapId, mapData: r.mapData, passwordProtected: r.passwordProtected, maxPlayers: r.maxPlayers, timeLimitSec: r.timeLimitSec, createdAt: r.createdAt, endsAt: r.endsAt, ended: r.ended, gameMode: r.gameMode, players: playerIds, playerCount: playerIds.length, spectatorCount: r.spectatorIds.size, lobbyId: r.lobbyId, hostName, options: r.options, teamStats };
}

export function lobbyStatePayload(lobbyId: string) {
  const list = [...rooms.values()].filter(r => !r.ended && r.lobbyId === lobbyId).map(toRoomSummary);
  list.sort((a, b) => b.createdAt - a.createdAt);
  const onlinePlayers = [...players.values()].filter(p => !p.roomId && p.lobbyId === lobbyId && p.disconnectedAt === null).map(p => ({ id: p.id, name: p.name, ping: p.ping }));
  return { rooms: list, onlinePlayers, currentLobbyId: lobbyId, availableLobbies: AVAILABLE_LOBBIES };
}

export function roomStatePayloadForPlayer(roomId: string, recipient: PlayerRuntime) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const timeLeftSec = Math.max(0, Math.ceil((room.endsAt - nowMs()) / 1000));
  const ps = [...room.playerIds].map(pid => players.get(pid)).filter((p): p is PlayerRuntime => !!p).filter(p => !p.isHidden || p.id === recipient.id || p.team === recipient.team).map(toPlayerPublic);
  const bs = room.bullets.map(toBulletPublic);
  return { roomId: room.id, roomName: room.name, mapId: room.mapId, room: toRoomSummary(room), timeLeftSec, players: ps, bullets: bs, projectiles: bs, explosions: room.explosions, smokeClouds: room.smokeClouds, gameMode: room.gameMode, teamScores: { red: room.scoreRed, blue: room.scoreBlue }, flags: room.gameMode === "ctf" ? room.flags : undefined, items: room.items };
}

export function roomInitPayload(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return null;
  return { roomId: room.id, roomName: room.name, mapId: room.mapId, room: toRoomSummary(room), mapData: room.mapData, gameMode: room.gameMode };
}

export function roomStatePayloadForSpectator(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const timeLeftSec = Math.max(0, Math.ceil((room.endsAt - nowMs()) / 1000));
  const ps = [...room.playerIds].map(pid => players.get(pid)).filter((p): p is PlayerRuntime => !!p).map(toPlayerPublic);
  const bs = room.bullets.map(toBulletPublic);
  return { roomId: room.id, roomName: room.name, mapId: room.mapId, room: toRoomSummary(room), timeLeftSec, players: ps, bullets: bs, projectiles: bs, explosions: room.explosions, smokeClouds: room.smokeClouds, gameMode: room.gameMode, teamScores: { red: room.scoreRed, blue: room.scoreBlue }, flags: room.gameMode === "ctf" ? room.flags : undefined, items: room.items };
}

export function broadcastLobby(lobbyId: string) {
  const payload = lobbyStatePayload(lobbyId);
  for (const p of players.values()) if (p.roomId === null && p.lobbyId === lobbyId) send(p.socket, { type: "lobby", payload });
}

export function broadcastRoom(roomId: string, msg: ServerMsg) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const pid of room.playerIds) {
    const p = players.get(pid);
    if (p && p.roomId === roomId) send(p.socket, msg);
  }
  for (const sid of room.spectatorIds) {
    const s = players.get(sid);
    if (s && s.roomId === roomId) send(s.socket, msg);
  }
}

export function sendRoomState(roomId: string, isInit = false) {
  const room = rooms.get(roomId);
  if (!room) return;

  if (isInit) {
    const initPayload = roomInitPayload(roomId);
    if (!initPayload) return;
    const msg = { type: "roomInit", payload: initPayload };
    for (const pid of room.playerIds) {
      const p = players.get(pid);
      if (p && p.roomId === roomId) send(p.socket, msg);
    }
    for (const sid of room.spectatorIds) {
      const s = players.get(sid);
      if (s && s.roomId === roomId) send(s.socket, msg);
    }
    return;
  }

  // Pre-calculate full visibility state (spectator view essentially)
  const fullPayload = roomStatePayloadForSpectator(roomId);
  if (!fullPayload) return;

  // Cache the stringified full payload since stringify is expensive O(N)
  const fullPayloadStr = JSON.stringify({ type: "room", payload: fullPayload });

  for (const pid of room.playerIds) {
    const p = players.get(pid);
    if (!p || p.roomId !== roomId || !p.socket || p.socket.readyState !== 1) continue;

    // Fast-path: if player can see everything (e.g. no enemies are hidden) or we just send the full payload
    // In TankTaktix, usually we want to hide players in bushes. 
    // For 50vs50 optimization, calculating per-player visibility is O(N^2).
    // Let's check if anyone is actually hidden:
    const anyHidden = fullPayload.players.some(op => room.playerIds.has(op.id) && players.get(op.id)?.isHidden && p.team !== players.get(op.id)?.team && p.id !== op.id);

    if (!anyHidden) {
      p.socket.send(fullPayloadStr);
    } else {
      // Slow-path: custom payload for this player because some enemies are hidden from them
      const payload = roomStatePayloadForPlayer(roomId, p);
      if (payload) send(p.socket, { type: "room", payload });
    }
  }

  for (const sid of room.spectatorIds) {
    const s = players.get(sid);
    if (!s || s.roomId !== roomId || !s.socket || s.socket.readyState !== 1) continue;
    s.socket.send(fullPayloadStr);
  }
}
