import type { BulletPublic } from "@tanktaktix/shared";
import { ACTION_LOCK_STEP_MS } from "../constants";
import { nowMs } from "../utils/math";
import { players, rooms, send } from "../state";
import type { Bullet, PlayerRuntime, Room, ServerMsg } from "../types";

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
    isHidden: p.isHidden,
    hasBomb: p.hasBomb,
    ropeCount: p.ropeCount,
    bootsCharges: p.bootsCharges,
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
    flagTeam: b.flagTeam,
  };
}

export function toRoomSummary(r: Room) {
  const playerIds = [...r.playerIds];
  return { id: r.id, name: r.name, roomName: r.name, mapId: r.mapId, mapData: r.mapData, passwordProtected: r.passwordProtected, maxPlayers: r.maxPlayers, timeLimitSec: r.timeLimitSec, createdAt: r.createdAt, endsAt: r.endsAt, ended: r.ended, gameMode: r.gameMode, players: playerIds, playerCount: playerIds.length, spectatorCount: r.spectatorIds.size };
}

export function lobbyStatePayload() {
  const list = [...rooms.values()].filter(r => !r.ended).map(toRoomSummary);
  list.sort((a, b) => b.createdAt - a.createdAt);
  const onlinePlayers = [...players.values()].filter(p => !p.roomId).map(p => ({ id: p.id, name: p.name }));
  return { rooms: list, onlinePlayers };
}

export function roomStatePayloadForPlayer(roomId: string, recipient: PlayerRuntime) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const timeLeftSec = Math.max(0, Math.ceil((room.endsAt - nowMs()) / 1000));
  const ps = [...room.playerIds].map(pid => players.get(pid)).filter((p): p is PlayerRuntime => !!p).filter(p => p.id === recipient.id || p.team === recipient.team || !p.isHidden).map(toPlayerPublic);
  const bs = room.bullets.map(toBulletPublic);
  return { roomId: room.id, roomName: room.name, mapId: room.mapId, room: toRoomSummary(room), timeLeftSec, players: ps, bullets: bs, projectiles: bs, explosions: room.explosions, gameMode: room.gameMode, teamScores: { red: room.scoreRed, blue: room.scoreBlue }, mapData: room.mapData, flags: room.gameMode === "ctf" ? room.flags : undefined, items: room.items };
}

export function roomStatePayloadForSpectator(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return null;
  const timeLeftSec = Math.max(0, Math.ceil((room.endsAt - nowMs()) / 1000));
  const ps = [...room.playerIds].map(pid => players.get(pid)).filter((p): p is PlayerRuntime => !!p).map(toPlayerPublic);
  const bs = room.bullets.map(toBulletPublic);
  return { roomId: room.id, roomName: room.name, mapId: room.mapId, room: toRoomSummary(room), timeLeftSec, players: ps, bullets: bs, projectiles: bs, explosions: room.explosions, gameMode: room.gameMode, teamScores: { red: room.scoreRed, blue: room.scoreBlue }, mapData: room.mapData, flags: room.gameMode === "ctf" ? room.flags : undefined, items: room.items };
}

export function broadcastLobby() {
  const payload = lobbyStatePayload();
  for (const p of players.values()) if (p.roomId === null) send(p.socket, { type: "lobby", payload });
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

export function sendRoomState(roomId: string) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const pid of room.playerIds) {
    const p = players.get(pid);
    if (!p || p.roomId !== roomId) continue;
    const payload = roomStatePayloadForPlayer(roomId, p);
    if (payload) send(p.socket, { type: "room", payload });
  }
  for (const sid of room.spectatorIds) {
    const s = players.get(sid);
    if (!s || s.roomId !== roomId) continue;
    const payload = roomStatePayloadForSpectator(roomId);
    if (payload) send(s.socket, { type: "room", payload });
  }
}
