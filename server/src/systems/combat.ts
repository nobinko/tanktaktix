import type { Vector2, Explosion } from "@tanktaktix/shared";
import { ACTION_COOLDOWN_MS, AMMO_REFILL_AMOUNT, BULLET_RADIUS, BULLET_SPEED, BULLET_TTL_MS, EXPLOSION_DAMAGE, EXPLOSION_RADIUS, FLAG_RADIUS, HIT_RADIUS, ITEM_RADIUS, MEDIC_HEAL_AMOUNT, RESPAWN_COOLDOWN_MS, SMOKE_DURATION_MS, SMOKE_RADIUS, SMOKE_THROW_RANGE, TANK_SIZE } from "../constants.js";
import { players, rooms } from "../state.js";
import type { Bullet, PlayerRuntime, Room } from "../types.js";
import { broadcastRoom, sendRoomState } from "../network/broadcast.js";
import { clamp, len, norm, nowMs } from "../utils/math.js";
import { checkPointInWall, checkRayRotatedRect, isBulletBlockedByWall } from "../utils/collision.js";
import { newId } from "../utils/id.js";
import { respawnItem, spawnPlayer } from "../room.js";

export function triggerExplosion(room: Room, x: number, y: number, shooterId: string, isBomb = false) {
  // Phase 4: bomb = 3x explosion radius
  const explosionRadius = isBomb ? EXPLOSION_RADIUS * 3 : EXPLOSION_RADIUS;
  const explosion: Explosion = {
    id: newId(),
    x, y,
    radius: explosionRadius,
    at: nowMs()
  };
  room.explosions.push(explosion);

  // Broadcast explosion event immediately for VFX
  broadcastRoom(room.id, { type: "explosion", payload: explosion });

  // Apply Damage
  const shooter = players.get(shooterId);

  for (const pid of room.playerIds) {
    const target = players.get(pid);
    if (!target || target.team === null || target.hp <= 0 || target.respawnAt || target.respawnCooldownUntil > nowMs()) continue;

    // Calculate distance
    const dist = Math.hypot(target.x - x, target.y - y);
    if (dist <= explosionRadius + TANK_SIZE) {
      // Friendly Fire Rules:
      // - Damage Self: YES
      // - Damage Enemy: YES
      // - Damage Teammate: NO

      let canDamage = true;
      if (shooter && shooter.id !== target.id) {
        // If not self, check team
        if (shooter.team && target.team && shooter.team === target.team) {
          canDamage = false; // Teammate immune
        }
      }

      if (canDamage) {
        // Phase 4: Bomb = tiered damage based on distance
        let damage = EXPLOSION_DAMAGE; // default 20
        if (isBomb) {
          const innerR = explosionRadius / 3;
          const midR = (explosionRadius * 2) / 3;
          if (dist <= innerR + TANK_SIZE) {
            damage = 60; // Inner zone
          } else if (dist <= midR + TANK_SIZE) {
            damage = 40; // Mid zone
          } else {
            damage = 20; // Outer zone
          }
        }
        target.hp = Math.max(0, target.hp - damage);

        // CTF: Drop flag on ANY damage (not just death)
        if (room.gameMode === "ctf" && target.hp > 0) {
          dropFlag(target.id, room);
        }

        if (target.hp === 0) {
          // Kill credit
          if (shooter && shooter.id !== target.id) {
            shooter.kills += 1;
            shooter.score += 1; // Team Mode: Kill = +1 point

            // Updating Room Team Score
            if (shooter.team === "red") room.scoreRed += 1;
            if (shooter.team === "blue") room.scoreBlue += 1;
          } else if (!shooter || shooter.id === target.id) {
            // Suicide: +1 point for the opposing team
            if (target.team === "red") room.scoreBlue += 1;
            else if (target.team === "blue") room.scoreRed += 1;
          }

          // Update history for shooter
          if (shooter) {
            const h = room.history.get(shooter.id);
            if (h) {
              h.kills = shooter.kills;
              h.score = shooter.score;
            }
          }

          target.deaths += 1;

          // Update history for target
          const th = room.history.get(target.id);
          if (th) {
            th.deaths = target.deaths;
            th.score = target.score;
          }

          // CTF: Drop flag if carrying one
          if (room.gameMode === "ctf") {
            dropFlag(target.id, room);
          }

          // Instant Respawn Logic
          spawnPlayer(target, room);
          target.respawnCooldownUntil = nowMs() + RESPAWN_COOLDOWN_MS;
        }
      }
    }
  }

  // 3. Item Collision / Chain Reaction
  // We use a clone to avoid modification during iteration issues, though filter() handles it.
  const itemsToCheck = [...room.items];
  for (const item of itemsToCheck) {
    const dist = Math.hypot(item.x - x, item.y - y);
    if (dist <= explosionRadius + ITEM_RADIUS) {
      // Remove immediately to prevent double-hits in recursion
      room.items = room.items.filter(it => it.id !== item.id);
      respawnItem(room, item.type);

      if (item.type === "bomb") {
        triggerExplosion(room, item.x, item.y, shooterId, true);
      } else if (item.type === "smoke") {
        room.smokeClouds.push({
          id: newId(),
          x: item.x,
          y: item.y,
          radius: SMOKE_RADIUS,
          expiresAt: nowMs() + SMOKE_DURATION_MS
        });
      }
    }
  }
}

export function tryShoot(p: PlayerRuntime, dir: Vector2) {
  if (!p.roomId) return;
  const room = rooms.get(p.roomId);
  if (!room) return;

  if (room.options.noShooting) return;

  const now = nowMs();

  if (p.respawnAt && p.respawnAt > now) return;
  if (p.respawnCooldownUntil > now) return;

  if (now < p.cooldownUntil) return;
  if (p.isMoving) return;

  const isBombShot = p.hasBomb;

  if (!isBombShot && p.ammo <= 0) return;

  if (!isBombShot) {
    p.ammo -= 1;
  }

  p.fired += 1;

  if (p.roomId) {
    const r = rooms.get(p.roomId);
    if (r) {
      const h = r.history.get(p.id);
      if (h) h.fired = p.fired;
    }
  }

  if (isBombShot) {
    p.hasBomb = false;
  }

  p.cooldownUntil = now + ACTION_COOLDOWN_MS;

  const d = norm(dir);
  if (len(d) === 0) return;

  const spawnOffset = HIT_RADIUS + BULLET_RADIUS + 2;
  const bx = clamp(p.x + d.x * spawnOffset, 0, room.mapData.width);
  const by = clamp(p.y + d.y * spawnOffset, 0, room.mapData.height);

  const bulletRadius = isBombShot ? BULLET_RADIUS * 1.5 : BULLET_RADIUS;

  const bullet: Bullet = {
    id: newId(),
    shooterId: p.id,
    x: bx,
    y: by,
    vx: d.x * BULLET_SPEED,
    vy: d.y * BULLET_SPEED,
    radius: bulletRadius,
    startX: bx,
    startY: by,
    expiresAt: now + BULLET_TTL_MS,
    isBomb: isBombShot,
  };

  room.bullets.push(bullet);
  p.turretAngle = Math.atan2(d.y, d.x);
  sendRoomState(p.roomId);
}

export function tryUseItem(p: PlayerRuntime, item: string, dir: Vector2, isThrow?: boolean) {
  if (!p.roomId) return;
  const now = nowMs();

  if (p.respawnAt && p.respawnAt > now) return;
  if (p.respawnCooldownUntil > now) return;
  if (now < p.cooldownUntil) return;

  const room = rooms.get(p.roomId);
  if (!room) return;

  const d = norm(dir);
  if (len(d) === 0) return;

  const bx = p.x + d.x * 20;
  const by = p.y + d.y * 20;

  if (item === "smoke" && p.hasSmoke) {
    p.hasSmoke = false;
    // We purposely DO NOT trigger p.cooldownUntil

    if (isThrow) {
      const throwSpeed = BULLET_SPEED;
      room.bullets.push({
        id: newId(),
        shooterId: p.id,
        x: bx,
        y: by,
        vx: d.x * throwSpeed,
        vy: d.y * throwSpeed,
        radius: 6,
        startX: bx,
        startY: by,
        expiresAt: now + (SMOKE_THROW_RANGE / throwSpeed) * 1000,
        isSmoke: true
      });
      p.turretAngle = Math.atan2(d.y, d.x);
    } else {
      // Drop immediately based on player coordinates
      room.smokeClouds.push({
        id: newId(),
        x: p.x,
        y: p.y,
        radius: SMOKE_RADIUS,
        expiresAt: now + SMOKE_DURATION_MS
      });
    }
  } else if (item === "rope" && p.ropeCount > 0) {
    const ropeRange = p.ropeCount === 2 ? 300 : 200;
    p.cooldownUntil = now + ACTION_COOLDOWN_MS;

    const ropeBullet: Bullet = {
      id: newId(),
      shooterId: p.id,
      x: bx,
      y: by,
      vx: d.x * BULLET_SPEED,
      vy: d.y * BULLET_SPEED,
      radius: 4,
      startX: bx,
      startY: by,
      expiresAt: now + (ropeRange / BULLET_SPEED) * 1000 + 200,
      isRope: true,
      ropeOwnerId: p.id,
    };
    room.bullets.push(ropeBullet);

    p.turretAngle = Math.atan2(d.y, d.x);
  } else if (item === "ammo" && p.ammo >= 5) {
    p.ammo -= 5;
    p.cooldownUntil = now + ACTION_COOLDOWN_MS;
    const ammoRange = 99999;
    room.bullets.push({
      id: newId(), shooterId: p.id, x: bx, y: by, vx: d.x * BULLET_SPEED, vy: d.y * BULLET_SPEED,
      radius: 6, startX: bx, startY: by, expiresAt: now + (ammoRange / BULLET_SPEED) * 1000,
      isAmmoPass: true
    });
    p.turretAngle = Math.atan2(d.y, d.x);
  } else if (item === "heal" && p.hp > 20) {
    p.hp -= 20;
    p.cooldownUntil = now + ACTION_COOLDOWN_MS;
    const healRange = 99999;
    room.bullets.push({
      id: newId(), shooterId: p.id, x: bx, y: by, vx: d.x * BULLET_SPEED, vy: d.y * BULLET_SPEED,
      radius: 6, startX: bx, startY: by, expiresAt: now + (healRange / BULLET_SPEED) * 1000,
      isHealPass: true
    });
    p.turretAngle = Math.atan2(d.y, d.x);
  } else if (item === "flag") {
    const carriedFlag = room.flags.find(f => f.carrierId === p.id);
    if (carriedFlag) {
      carriedFlag.carrierId = null;
      carriedFlag.droppedById = p.id;
      p.cooldownUntil = now + ACTION_COOLDOWN_MS;
      const passRange = 99999;
      room.bullets.push({
        id: newId(), shooterId: p.id, x: bx, y: by, vx: d.x * BULLET_SPEED, vy: d.y * BULLET_SPEED,
        radius: 8, startX: bx, startY: by, expiresAt: now + (passRange / BULLET_SPEED) * 1000,
        isFlagPass: true,
        flagTeam: carriedFlag.team
      });
      carriedFlag.x = bx;
      carriedFlag.y = by;
      p.turretAngle = Math.atan2(d.y, d.x);
    }
  }
}

export function dropFlag(carrierId: string, room: Room) {
  for (const f of room.flags) {
    if (f.carrierId === carrierId) {
      console.log(`[DEBUG] Flag ${f.team} dropped by ${carrierId} at (${f.x}, ${f.y})`);
      f.carrierId = null;
      f.droppedById = carrierId;
    }
  }
}
