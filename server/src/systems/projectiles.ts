import type { Vector2, Explosion } from "@tanktaktix/shared";
import { ACTION_COOLDOWN_MS, AMMO_REFILL_AMOUNT, BULLET_RADIUS, BULLET_SPEED, BULLET_TTL_MS, EXPLOSION_DAMAGE, EXPLOSION_RADIUS, HIT_RADIUS, ITEM_RADIUS, MEDIC_HEAL_AMOUNT, RESPAWN_COOLDOWN_MS, TANK_SIZE } from "../constants.js";
import { players, rooms } from "../state.js";
import type { Bullet, Room } from "../types.js";
import { broadcastRoom, sendRoomState } from "../network/broadcast.js";
import { clamp, len, norm, nowMs } from "../utils/math.js";
import { checkPointInWall, checkRayRotatedRect, isBulletBlockedByWall } from "../utils/collision.js";
import { newId } from "../utils/id.js";
import { respawnItem } from "../room.js";
import { triggerExplosion } from "./combat.js";


export function updateBullets(room: Room, dtSec: number, now: number) {
  if (!room.bullets.length) return;

  const next: Bullet[] = [];

  for (const b of room.bullets) {
    let exploded = false;
    let passFinished = false;

    // 1. Timeout -> Explode (rope projectiles just disappear)
    if (now >= b.expiresAt) {
      if (b.isAmmoPass || b.isHealPass || b.isFlagPass) {
        passFinished = true;
      } else if (!b.isRope) {
        triggerExplosion(room, b.x, b.y, b.shooterId, b.isBomb);
      }
      exploded = true;
    }

    if (exploded && !passFinished) continue;

    const prev = { x: b.x, y: b.y };
    const curr = {
      x: passFinished ? Math.max(0, Math.min(room.mapData.width, b.x + b.vx * dtSec)) : b.x + b.vx * dtSec,
      y: passFinished ? Math.max(0, Math.min(room.mapData.height, b.y + b.vy * dtSec)) : b.y + b.vy * dtSec
    };

    // Move flag with flag pass
    if (b.isFlagPass && b.flagTeam) {
      const f = room.flags.find(fl => fl.team === b.flagTeam);
      if (f) {
        f.x = curr.x;
        f.y = curr.y;
      }
    }

    // Rope bullet: Check item/flag collision FIRST
    if (b.isRope && !exploded) {
      const owner = players.get(b.ropeOwnerId || b.shooterId);

      // Check Items
      const hitItem = room.items.find(i => Math.hypot(i.x - curr.x, i.y - curr.y) < 25);
      if (hitItem && owner) {
        // Teleport item to owner so they pick it up next tick
        hitItem.x = owner.x;
        hitItem.y = owner.y;
        exploded = true;
      }

      // Check Flags
      if (!exploded) {
        const hitFlag = room.flags.find(f => Math.hypot(f.x - curr.x, f.y - curr.y) < 25);
        if (hitFlag && owner && hitFlag.carrierId !== owner.id) {
          hitFlag.carrierId = owner.id;
          hitFlag.droppedById = undefined;
          exploded = true;
        }
      }

      // Check teammates carrying flags (rope can steal from ally)
      if (!exploded && owner) {
        for (const pid of room.playerIds) {
          if (pid === owner.id) continue;
          const other = players.get(pid);
          if (!other || other.hp <= 0) continue;
          const dist = Math.hypot(other.x - curr.x, other.y - curr.y);
          if (dist < 20) {
            // Check if this player carries a flag
            const carriedFlag = room.flags.find(f => f.carrierId === other.id);
            if (carriedFlag) {
              carriedFlag.carrierId = owner.id;
              carriedFlag.droppedById = undefined;
              exploded = true;
              break;
            }
          }
        }
      }

      if (exploded) continue;
    }

    // 2. Wall Collision -> Explode (rope just disappears)
    if (!exploded && isBulletBlockedByWall(curr.x, curr.y, b.vx, b.vy, room.mapData.walls)) {
      if (b.isAmmoPass || b.isHealPass || b.isFlagPass) {
        passFinished = true;
      } else if (!b.isRope) {
        triggerExplosion(room, curr.x, curr.y, b.shooterId, b.isBomb);
      }
      exploded = true;
    }

    // 3. Out of bounds -> Explode
    if (!exploded && (curr.x < 0 || curr.x > room.mapData.width || curr.y < 0 || curr.y > room.mapData.height)) {
      if (b.isAmmoPass || b.isHealPass || b.isFlagPass) {
        passFinished = true;
      } else if (!b.isRope) {
        triggerExplosion(room, Math.max(0, Math.min(curr.x, room.mapData.width)), Math.max(0, Math.min(curr.y, room.mapData.height)), b.shooterId, b.isBomb);
      }
      exploded = true;
    }

    if (exploded && !passFinished) continue;

    if (passFinished) continue;

    // 4. Player Collision -> Explode (Direct hit)
    // Note: Direct hit also triggers explosion logic for damage
    const shooter = players.get(b.shooterId) ?? null;

    for (const pid of room.playerIds) {
      if (pid === b.shooterId) continue;
      const t = players.get(pid);
      if (!t) continue;
      if (t.respawnAt && t.respawnAt > now) continue;
      if (t.respawnCooldownUntil > now) continue; // Invincible to bullets during respawn CD
      if (t.hp <= 0) continue;

      // Friendly fire check: Bullets pass through teammates?
      // Or they hit and explode but do no damage?
      // "Team members are大丈夫" -> Likely pass through or no-damage impact.
      // Let's assume passed-through for nicer gameplay, or impact but 0 dmg.
      // Let's do: Impact -> Explode. Same damage logic applies (0 to teammate).

      if (t.hp <= 0) continue;

      // FIX: Arguments were swapped!
      // Old: distPointToSegment(prev, curr, target) -> Distance form Prev, to Line(Curr, Target) -> NONSENSE
      // New: distPointToSegment(target, prev, curr) -> Distance from Target, to Line(Prev, Curr) -> CORRECT
      // Hitbox: Rotated Rectangle (26x20)
      const hit = checkRayRotatedRect(
        prev, curr,
        { x: t.x, y: t.y },
        { w: 26, h: 20 },
        t.hullAngle,
        b.radius
      );

      if (hit) {
        if (b.isAmmoPass || b.isHealPass || b.isFlagPass) {
          if (b.isAmmoPass && t.ammo < 40) {
            t.ammo = Math.min(40, t.ammo + 5);
          } else if (b.isHealPass && t.hp < 100) {
            t.hp = Math.min(100, t.hp + 20);
          } else if (b.isFlagPass && b.flagTeam) {
            const alreadyCarrying = room.flags.some(fl => fl.carrierId === t.id);
            if (!alreadyCarrying) {
              const fl = room.flags.find(fl => fl.team === b.flagTeam);
              if (fl) {
                fl.carrierId = t.id;
                fl.droppedById = undefined;
                broadcastRoom(room.id, {
                  type: "chat", payload: { from: "SYSTEM", message: `🚩 ${t.name} caught the ${fl.team} flag!`, timestamp: now }
                });
              }
            }
          }
          exploded = true;
          break;
        }

        // Stats: Hit
        if (shooter) {
          shooter.hits++;

          // Sync history
          const h = room.history.get(shooter.id);
          if (h) h.hits = shooter.hits;
        }

        triggerExplosion(room, curr.x, curr.y, b.shooterId, b.isBomb);
        exploded = true;
        break;
      }
    }

    if (exploded) continue;

    // 5. Phase 4-2: Item Collision — bullet destroys items, same-type respawns
    if (!b.isAmmoPass && !b.isHealPass && !b.isFlagPass && !b.isRope) {
      const hitIdx = room.items.findIndex(item =>
        Math.hypot(curr.x - item.x, curr.y - item.y) < b.radius + ITEM_RADIUS
      );
      if (hitIdx >= 0) {
        const destroyed = room.items[hitIdx];
        room.items.splice(hitIdx, 1);
        respawnItem(room, destroyed.type);
        triggerExplosion(room, curr.x, curr.y, b.shooterId, b.isBomb);
        exploded = true;
      }
    }

    if (exploded) continue;

    // 6. Phase 4-5: Flag Collision — bullet hits dropped flag → reset to base
    if (room.gameMode === "ctf" && !b.isAmmoPass && !b.isHealPass && !b.isFlagPass && !b.isRope) {
      for (const f of room.flags) {
        if (f.carrierId) continue; // Carried flags can't be hit
        const flagSrc = room.mapData.flagPositions ?? room.mapData.spawnPoints;
        const basePos = flagSrc.find(s => s.team === f.team);
        if (!basePos) continue;
        // Skip if flag is already at base
        if (Math.abs(f.x - basePos.x) < 2 && Math.abs(f.y - basePos.y) < 2) continue;
        const dist = Math.hypot(curr.x - f.x, curr.y - f.y);
        if (dist < b.radius + 25) { // FLAG_RADIUS = 25
          f.x = basePos.x;
          f.y = basePos.y;
          broadcastRoom(room.id, {
            type: "chat",
            payload: {
              from: "SYSTEM",
              message: `🔫 The ${f.team} flag was shot and returned to base!`,
              timestamp: now
            }
          });
          triggerExplosion(room, curr.x, curr.y, b.shooterId, b.isBomb);
          exploded = true;
          break;
        }
      }
    }

    if (exploded) continue;

    b.x = curr.x;
    b.y = curr.y;
    next.push(b);
  }

  room.bullets = next;
}
