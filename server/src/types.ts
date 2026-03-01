import { WebSocket } from "ws";
import type { Explosion, Flag, Item, MapData, Team, Vector2 } from "@tanktaktix/shared";

export type ClientMsg = { type: string; payload?: unknown };
export type ServerMsg = { type: string; payload?: unknown };

export type PlayerRuntime = {
  id: string;
  name: string;
  team: Team;
  x: number;
  y: number;
  hp: number;
  ammo: number;
  roomId: string | null;
  lobbyId: string;
  aimDir: Vector2;
  pendingMove: Vector2 | null;
  moveQueue: { x: number; y: number; startX: number; startY: number }[];
  hullAngle: number;
  turretAngle: number;
  isRotating: boolean;
  isMoving: boolean;
  score: number;
  kills: number;
  deaths: number;
  hits: number;
  fired: number;
  lives: number;
  cooldownUntil: number;
  respawnAt: number | null;
  respawnCooldownUntil: number;
  isHidden: boolean;
  hasBomb: boolean;
  ropeCount: number;
  bootsCharges: number;
  socket: WebSocket | null;
  disconnectedAt: number | null;
  ping: number;
};

export type Bullet = {
  id: string;
  shooterId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  startX: number;
  startY: number;
  expiresAt: number;
  isBomb?: boolean;
  isRope?: boolean;
  ropeOwnerId?: string;
  isAmmoPass?: boolean;
  isHealPass?: boolean;
  isFlagPass?: boolean;
  flagTeam?: Team;
};

export type Room = {
  id: string;
  name: string;
  mapId: string;
  mapData: MapData;
  lobbyId: string;
  passwordProtected: boolean;
  password?: string;
  maxPlayers: number;
  timeLimitSec: number;
  createdAt: number;
  endsAt: number;
  ended: boolean;
  gameMode: "deathmatch" | "ctf";
  options: {
    teamSelect: boolean;
    instantKill: boolean;
    noItemRespawn: boolean;
    noShooting: boolean;
  };
  playerIds: Set<string>;
  spectatorIds: Set<string>;
  bullets: Bullet[];
  explosions: Explosion[];
  items: Item[];
  lastItemSpawnAt: number;
  flags: Flag[];
  scoreRed: number;
  scoreBlue: number;
  hostId: string; // ID of the player who created the room

  history: Map<string, {
    name: string;
    team: Team;
    kills: number;
    deaths: number;
    score: number;
    fired: number;
    hits: number;
  }>;
};
