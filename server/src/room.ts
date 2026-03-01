import type { Item, ItemType, MapData, Team } from "@tanktaktix/shared";
import { ACTION_COOLDOWN_MS, AMMO_REFILL_AMOUNT, COOLDOWN_LONG_MS, COOLDOWN_SHORT_MS, HULL_ROTATION_SPEED, ITEM_RADIUS, MEDIC_HEAL_AMOUNT, MOVE_SPEED, RECONNECT_TIMEOUT_MS, RESPAWN_MS, TANK_SIZE, TURRET_ROTATION_SPEED, DEFAULT_MAP, ITEM_POOL, MOVE_QUEUE_MAX } from "./constants.js";
import { players, rooms, send } from "./state.js";
import type { PlayerRuntime, Room } from "./types.js";
import { clamp, nowMs } from "./utils/math.js";
import { checkWallCollision } from "./utils/collision.js";
import { newId } from "./utils/id.js";
import { broadcastLobby, lobbyStatePayload, sendRoomState } from "./network/broadcast.js";

export function detachFromRoom(p: PlayerRuntime) {
  if (!p.roomId) return;
  const oldRoomId = p.roomId;
  const old = rooms.get(oldRoomId);
  if (old) {
    old.playerIds.delete(p.id);
    old.spectatorIds.delete(p.id);
    if (old.playerIds.size === 0 && old.spectatorIds.size === 0) {
      if (nowMs() < old.endsAt) console.log(`Room ${old.id} is empty but kept because time remains.`);
      else {
        rooms.delete(old.id);
        console.log(`Room ${old.id} deleted(empty & time up).`);
      }
    }
  }
  p.roomId = null;
  p.pendingMove = null;
  p.moveQueue = [];
  p.team = null;
  p.isMoving = false;
  p.cooldownUntil = 0;
  p.respawnCooldownUntil = 0;
  sendRoomState(oldRoomId);
  const oldLobbyId = p.lobbyId;
  broadcastLobby(oldLobbyId);
}

export function joinLobby(p: PlayerRuntime, lobbyId?: string) {
  const oldLobbyId = p.lobbyId;
  if (lobbyId) p.lobbyId = lobbyId;
  detachFromRoom(p);
  // 元のロビーに「このプレイヤーが去った」を通知
  if (oldLobbyId && oldLobbyId !== p.lobbyId) {
    broadcastLobby(oldLobbyId);
  }
  send(p.socket, { type: "lobby", payload: lobbyStatePayload(p.lobbyId) });
  broadcastLobby(p.lobbyId);
}

export function assignTeam(room: Room): Team {
  let red = 0;
  let blue = 0;
  for (const pid of room.playerIds) {
    const p = players.get(pid);
    if (p?.team === "red") red++;
    if (p?.team === "blue") blue++;
  }
  return red <= blue ? "red" : "blue";
}

export function spawnPlayer(p: PlayerRuntime, room: Room) {
  const map = room.mapData;
  const teamSpawns = map.spawnPoints.filter(sp => sp.team === p.team);
  let baseX: number;
  let baseY: number;
  const otherPlayers = Array.from(room.playerIds).map(id => players.get(id)).filter(other => other && other.id !== p.id && other.hp > 0 && other.respawnAt === null);
  let foundSpot = false;
  let attempts = 0;
  while (attempts < 20 && !foundSpot) {
    if (teamSpawns.length > 0) {
      const sp = teamSpawns[Math.floor(Math.random() * teamSpawns.length)];
      baseX = sp.x;
      baseY = sp.y;
    } else {
      baseX = 150 + Math.random() * 200;
      baseY = 150 + Math.random() * 200;
    }
    const tx = clamp(baseX + (Math.random() * 80 - 40), TANK_SIZE, map.width - TANK_SIZE);
    const ty = clamp(baseY + (Math.random() * 80 - 40), TANK_SIZE, map.height - TANK_SIZE);
    if (checkWallCollision(tx, ty, TANK_SIZE, map.walls)) {
      attempts++;
      continue;
    }
    const tooClose = otherPlayers.some(other => other ? Math.hypot(tx - other.x, ty - other.y) < TANK_SIZE * 2.2 : false);
    if (tooClose) {
      attempts++;
      continue;
    }
    p.x = tx;
    p.y = ty;
    foundSpot = true;
  }
  if (!foundSpot) {
    console.log(`[DEBUG] Could not find perfectly clear spawn spot for ${p.id}, spawning at default.`);
    if (teamSpawns.length > 0) {
      const sp = teamSpawns[0];
      p.x = sp.x;
      p.y = sp.y;
    }
  }
  p.hp = 100;
  p.ammo = 20;
  p.respawnAt = null;
  p.pendingMove = null;
  p.moveQueue = [];
  p.isMoving = false;
  p.isRotating = false;
  p.cooldownUntil = 0;
  p.hullAngle = 0;
  p.turretAngle = 0;
  p.hasBomb = false;
  p.ropeCount = 0;
  p.bootsCharges = 0;
}

function findRandomItemPosition(map: MapData): { x: number; y: number } | null {
  for (let attempts = 0; attempts < 30; attempts++) {
    const x = Math.random() * (map.width - 100) + 50;
    const y = Math.random() * (map.height - 100) + 50;
    if (!checkWallCollision(x, y, ITEM_RADIUS, map.walls)) return { x, y };
  }
  return null;
}

export function initializeItems(room: Room) {
  room.items = [];
  for (const entry of ITEM_POOL) {
    for (let i = 0; i < entry.count; i++) {
      const pos = findRandomItemPosition(room.mapData);
      if (pos) room.items.push({ id: newId(), x: pos.x, y: pos.y, type: entry.type, spawnedAt: nowMs() });
    }
  }
  console.log(`[DEBUG] Initialized ${room.items.length} items for room ${room.id}`);
}

export function canPlayerPickupItem(p: PlayerRuntime, type: ItemType): boolean {
  if (type === "medic" || type === "heart") {
    if (p.hp >= 100) return false;
  } else if (type === "ammo") {
    if (p.ammo >= 40) return false;
  } else if (type === "bomb") {
    if (p.hasBomb) return false;
  } else if (type === "rope") {
    if (p.ropeCount >= 2) return false;
  } else if (type === "boots") {
    if (p.bootsCharges > 0) return false;
  }
  return true;
}

export function applyItemEffect(p: PlayerRuntime, item: Item, room: Room) {
  if (item.type === "medic") p.hp = Math.min(100, p.hp + MEDIC_HEAL_AMOUNT);
  else if (item.type === "ammo") p.ammo = Math.min(40, p.ammo + AMMO_REFILL_AMOUNT);
  else if (item.type === "heart") p.hp = 100;
  else if (item.type === "bomb") p.hasBomb = true;
  else if (item.type === "rope") p.ropeCount = Math.min(2, p.ropeCount + 1);
  else if (item.type === "boots") p.bootsCharges = 3;

  // Remove and Respawn
  room.items = room.items.filter(it => it.id !== item.id);
  respawnItem(room, item.type);
}

export function respawnItem(room: Room, type: ItemType) {
  const pos = findRandomItemPosition(room.mapData);
  if (pos) room.items.push({ id: newId(), x: pos.x, y: pos.y, type, spawnedAt: nowMs() });
}

export function joinRoom(p: PlayerRuntime, roomId: string, password?: string) {
  const room = rooms.get(roomId);
  if (!room) return send(p.socket, { type: "error", payload: { message: "Room not found." } });
  if (room.passwordProtected && room.password !== password) return send(p.socket, { type: "error", payload: { message: "Invalid password." } });
  if (room.playerIds.size >= room.maxPlayers) return send(p.socket, { type: "error", payload: { message: "Room is full." } });
  detachFromRoom(p);
  p.roomId = roomId;
  room.playerIds.add(p.id);
  p.team = assignTeam(room);
  const safeName = (p.name && p.name.trim().length > 0) ? p.name : `Player - ${p.id.slice(0, 4)} `;
  room.history.set(p.id, { name: safeName, team: p.team, kills: 0, deaths: 0, score: 0, fired: 0, hits: 0 });
  spawnPlayer(p, room);
  p.score = 0; p.kills = 0; p.deaths = 0; p.hits = 0; p.fired = 0;
  sendRoomState(roomId);
  broadcastLobby(room.lobbyId);
}

import { MAPS } from "@tanktaktix/shared";

export function createRoom(roomData: { roomName: string; roomId: string; mapId: string; passwordProtected: boolean; password?: string; maxPlayers: number; timeLimitSec: number; gameMode: "deathmatch" | "ctf"; lobbyId: string; }) {
  const createdAt = nowMs();
  const endsAt = createdAt + roomData.timeLimitSec * 1000;
  const mapData = MAPS[roomData.mapId] || DEFAULT_MAP;
  const flagSrc = mapData.flagPositions ?? mapData.spawnPoints;
  const flags = roomData.gameMode === "ctf" ? [{ team: "red" as const, x: flagSrc.find(s => s.team === "red")?.x ?? 100, y: flagSrc.find(s => s.team === "red")?.y ?? 100, carrierId: null }, { team: "blue" as const, x: flagSrc.find(s => s.team === "blue")?.x ?? 1700, y: flagSrc.find(s => s.team === "blue")?.y ?? 900, carrierId: null }] : [];
  const room: Room = { id: roomData.roomId, name: roomData.roomName, mapId: roomData.mapId, mapData, lobbyId: roomData.lobbyId, passwordProtected: roomData.passwordProtected, password: roomData.password, maxPlayers: roomData.maxPlayers, timeLimitSec: roomData.timeLimitSec, createdAt, endsAt, ended: false, gameMode: roomData.gameMode, playerIds: new Set(), spectatorIds: new Set(), bullets: [], explosions: [], items: [], lastItemSpawnAt: createdAt, flags, scoreRed: 0, scoreBlue: 0, history: new Map() };
  rooms.set(roomData.roomId, room);
  initializeItems(room);
  broadcastLobby(room.lobbyId);
}
