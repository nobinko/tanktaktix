import type { ItemType } from "@tanktaktix/shared";
import { MAPS } from "@tanktaktix/shared";

export const PORT = Number(process.env.PORT ?? 3000);
export const TICK_MS = 50;
export const MOVE_SPEED = 6;
export const ACTION_LOCK_STEP_MS = 300;
export const ACTION_COOLDOWN_MS = 1800;
export const MOVE_QUEUE_MAX = 5;
export const HULL_ROTATION_SPEED = Math.PI / 15;
export const TURRET_ROTATION_SPEED = Math.PI / 10;
export const RESPAWN_MS = 1500;
export const RESPAWN_COOLDOWN_MS = 1500;
export const TANK_SIZE = 18;
export const BULLET_SPEED = 220;
export const BULLET_RADIUS = 4;
export const BULLET_RANGE = 99999;
export const BULLET_TTL_MS = Math.ceil((BULLET_RANGE / BULLET_SPEED) * 1000);
export const EXPLOSION_RADIUS = 40;
export const EXPLOSION_DAMAGE = 20;
export const HIT_RADIUS = TANK_SIZE;
export const RECONNECT_TIMEOUT_MS = 60000;
export const FLAG_RADIUS = 25;
export const FLAG_SCORE = 5;
export const SPAWN_ZONE_HALF = 100;
export const ITEM_RADIUS = 15;
export const SMOKE_RADIUS = 130;
export const SMOKE_DURATION_MS = 20000;
export const SMOKE_THROW_RANGE = 250;
export const MEDIC_HEAL_AMOUNT = 20;
export const AMMO_REFILL_AMOUNT = 10;
export const ITEM_POOL: { type: ItemType; count: number }[] = [
  { type: "medic", count: 2 },
  { type: "ammo", count: 2 },
  { type: "heart", count: 2 },
  { type: "bomb", count: 2 },
  { type: "smoke", count: 2 },
  { type: "rope", count: 2 },
  { type: "boots", count: 2 },
];
export const DEFAULT_MAP = MAPS["riverside"];
export const MAX_MOVE_DIST = 300;
export const COOLDOWN_THRESHOLD = 200;
export const COOLDOWN_SHORT_MS = 1500;
export const COOLDOWN_LONG_MS = 2100;
export const AVAILABLE_LOBBIES = ["Main Lobby", "Sub Lobby 1", "Sub Lobby 2"];
