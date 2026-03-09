import type { Item, ItemType } from "@tanktaktix/shared";
import { ACTION_COOLDOWN_MS, AMMO_REFILL_AMOUNT, COOLDOWN_LONG_MS, COOLDOWN_SHORT_MS, FLAG_RADIUS, HULL_ROTATION_SPEED, ITEM_RADIUS, MEDIC_HEAL_AMOUNT, MOVE_SPEED, RECONNECT_TIMEOUT_MS, RESPAWN_MS, TANK_SIZE, TURRET_ROTATION_SPEED } from "./constants.js";
import { players, rooms } from "./state.js";
import { applyItemEffect, canPlayerPickupItem, detachFromRoom, respawnItem, spawnPlayer } from "./room.js";
import { broadcastLobby, broadcastRoom, sendRoomState } from "./network/broadcast.js";
import { updateBullets } from "./systems/projectiles.js";
import { updateCTF } from "./systems/ctf.js";
import { clamp, len, norm, normalizeAngle, nowMs } from "./utils/math.js";
import { checkWallCollision, isPointInBush } from "./utils/collision.js";

let lastTickAt = nowMs();
export function tick() {
  const now = nowMs();
  const dtSec = Math.min(0.1, Math.max(0.001, (now - lastTickAt) / 1000));
  lastTickAt = now;

  // Disconnected players cleanup is now handled immediately in socket.on("close")

  for (const room of rooms.values()) {
    // Clear old explosions for state sync (visuals are one-shot via broadcast, but state keeps for late joiners/re-sync if needed)
    // Actually, just clear them every tick from the "State" object to avoid piling up?
    // Client handles "event" based explosion. State persistence is only needed for 1 tick.
    room.explosions = [];

    // Phase 4-1: アイテムは固定プール制。10秒スポーンは廃止済み。

    if (room.endsAt > 0 && now >= room.endsAt) {
      if (!room.ended) {
        room.ended = true;

        const results = [...room.history.entries()].map(([id, h]) => {
          const isActive = room.playerIds.has(id);
          return {
            id,
            name: h.name.substring(0, 20) + (isActive ? "" : " (Left)"),
            team: h.team,
            roomId: room.id,
            // dummy values for PlayerSummary compatibility
            position: { x: 0, y: 0 },
            target: null, moveQueue: [],
            hp: 0, ammo: 0,
            score: h.score,
            deaths: h.deaths,
            kills: h.kills,
            hits: h.hits,
            fired: h.fired,
            nextActionAt: 0, actionLockStep: 0, hullAngle: 0, turretAngle: 0, respawnAt: null
          };
        });

        // Calculate winner
        const winners =
          room.scoreRed > room.scoreBlue ? "red" :
            room.scoreBlue > room.scoreRed ? "blue" : "draw";

        console.log(`[DEBUG] GameEnd Room ${room.id}.Winner: ${winners} `);
        console.log(`[DEBUG] Results Payload: `, JSON.stringify(results, null, 2));

        broadcastRoom(room.id, {
          type: "gameEnd",
          payload: { roomId: room.id, winners, results } // Add roomId for client check
        });
      }

      // Continue to update game state even after end
      // sendRoomState(room.id) will be called at end of loop if we don't continue
      // continue; 
    }

    // Cleanup empty ended rooms (managed in detachFromRoom mostly, but safe here too)
    if (room.ended && room.playerIds.size === 0 && room.spectatorIds.size === 0) {
      rooms.delete(room.id);
      continue;
    }

    // FREEZE GAME: If ended, skip physics/logic updates
    if (room.ended) {
      // Just sync state (keep chat working etc)
      sendRoomState(room.id);
      continue;
    }

    // players update
    for (const pid of room.playerIds) {
      const p = players.get(pid);
      if (!p) continue;

      if (p.respawnAt && p.respawnAt <= now) {
        spawnPlayer(p, room);
      }
      if (p.respawnAt && p.respawnAt > now) continue;

      // Update visibility (B-2/B-5) — bush内は常に隠密、射撃で解除しない
      let inBush = isPointInBush(p.x, p.y, room.mapData.walls);

      if (!inBush) {
        // Phase 4: SmokeCloud visibility mechanism
        for (const smoke of room.smokeClouds) {
          if (Math.hypot(p.x - smoke.x, p.y - smoke.y) <= smoke.radius) {
            inBush = true;
            break;
          }
        }
      }

      p.isHidden = inBush;

      // Movement Logic (with pivot-turn phase)
      let wantsToMove = false;
      let dx = 0;
      let dy = 0;

      // Movement freeze applied during normal action cooldown
      // Phase E: Removed respawnCooldownUntil freeze so players can disperse during spawn immunity
      if (p.cooldownUntil > now) {
        // In Cooldown: FREEZE movement (but moveQueue keeps accepting)
        p.isMoving = false;
        p.isRotating = false;
        p.pendingMove = null;
      } else {
        if (p.pendingMove) {
          dx = p.pendingMove.x * MOVE_SPEED;
          dy = p.pendingMove.y * MOVE_SPEED;
          wantsToMove = true;
          p.hullAngle = Math.atan2(dy, dx);
        } else if (p.moveQueue.length > 0) {
          const currentTarget = p.moveQueue[0];
          const to = { x: currentTarget.x - p.x, y: currentTarget.y - p.y };
          const distance = len(to);

          // Phase 4: boots speed boost
          const effectiveSpeed = p.bootsCharges > 0 ? MOVE_SPEED * 1.5 : MOVE_SPEED;

          if (distance <= effectiveSpeed) {
            // Arrived at current target
            p.x = currentTarget.x;
            p.y = currentTarget.y;
            p.moveQueue.shift();
            p.isMoving = false;
            p.isRotating = false;

            // Phase 4: boots speed boost uses cost or specific logic, but normal movement is based on dist
            const applyCooldown = (dist: number) => {
              return dist >= 200 ? COOLDOWN_LONG_MS : COOLDOWN_SHORT_MS;
            };
            const movedDist = Math.hypot(p.x - currentTarget.startX, p.y - currentTarget.startY);
            const arrivedCooldown = applyCooldown(movedDist);
            p.cooldownUntil = now + arrivedCooldown;

            // Phase 4: consume boots charge on arrival
            if (p.bootsCharges > 0) {
              p.bootsCharges--;
            }
          } else {
            const targetAngle = Math.atan2(to.y, to.x);
            const angleDiff = normalizeAngle(targetAngle - p.hullAngle);

            if (Math.abs(angleDiff) > 0.05) {
              // PIVOT-TURN: rotate hull toward target
              p.isRotating = true;
              p.isMoving = false;
              const step = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), HULL_ROTATION_SPEED);
              p.hullAngle = normalizeAngle(p.hullAngle + step);
              // Turret also rotates toward final target angle (not current hull)
              const turretDiff = normalizeAngle(targetAngle - p.turretAngle);
              const tStep = Math.sign(turretDiff) * Math.min(Math.abs(turretDiff), TURRET_ROTATION_SPEED);
              p.turretAngle = normalizeAngle(p.turretAngle + tStep);
            } else {
              // Facing target — move
              p.hullAngle = targetAngle;
              p.turretAngle = targetAngle; // turret aligned to front
              p.isRotating = false;
              const d = norm(to);
              const moveSpd = p.bootsCharges > 0 ? MOVE_SPEED * 1.5 : MOVE_SPEED;
              dx = d.x * moveSpd;
              dy = d.y * moveSpd;
              wantsToMove = true;
            }
          }
        } else {
          if (p.isMoving || p.isRotating) {
            p.isMoving = false;
            p.isRotating = false;
            p.cooldownUntil = now + ACTION_COOLDOWN_MS;
          }
        }
      }

      if (wantsToMove) {
        const nextX = clamp(p.x + dx, 0, room.mapData.width);
        const nextY = clamp(p.y + dy, 0, room.mapData.height);

        // Check wall collision
        const hitWall = checkWallCollision(nextX, nextY, TANK_SIZE, room.mapData.walls);

        // Check player-to-player collision
        let hitPlayer = false;
        if (!hitWall) {
          for (const otherId of room.playerIds) {
            if (otherId === p.id) continue;
            const other = players.get(otherId);
            if (!other) continue;
            if (other.team === null) continue; // Skip spectators
            if (other.hp <= 0) continue;
            if (other.respawnAt) continue;
            const pdx = nextX - other.x;
            const pdy = nextY - other.y;

            // Phase E-4: Allow movement if players are moving AWAY from each other (resolves spawn overlap gridlocks)
            // if ((p.respawnCooldownUntil ?? 0) > now || (other.respawnCooldownUntil ?? 0) > now) continue;

            if (pdx * pdx + pdy * pdy < (TANK_SIZE * 2) * (TANK_SIZE * 2)) {
              // They will be colliding at the NEXT position.
              const currentPdx = p.x - other.x;
              const currentPdy = p.y - other.y;
              const currentDistSq = currentPdx * currentPdx + currentPdy * currentPdy;
              const nextDistSq = pdx * pdx + pdy * pdy;

              if (nextDistSq < currentDistSq) {
                // They are moving CLOSER to each other -> BLOCK!
                hitPlayer = true;
                break;
              }
              // If nextDistSq >= currentDistSq, they are moving AWAY from each other.
              // We ALLOW this movement to permit them to step out of existing overlaps (clumps).
            }
          }
        }

        if (!hitWall && !hitPlayer) {
          let hitItem: Item | null = null;
          let hitFlag: any | null = null;

          // 1. Check Item Collision
          for (const item of room.items) {
            if (Math.hypot(nextX - item.x, nextY - item.y) < TANK_SIZE + ITEM_RADIUS) {
              hitItem = item;
              break;
            }
          }

          // 2. Check Flag Collision
          if (!hitItem && room.gameMode === "ctf") {
            for (const f of room.flags) {
              // Ignore if already carried
              if (f.carrierId) continue;
              // Check hit
              if (Math.hypot(nextX - f.x, nextY - f.y) < TANK_SIZE + FLAG_RADIUS) {
                hitFlag = f;
                break;
              }
            }
          }

          if (hitItem || hitFlag) {
            // MOVEMENT CLAMP: Stop and trigger cooldown based on actual moved distance
            p.pendingMove = null;
            let collidedCost = COOLDOWN_SHORT_MS;
            if (p.moveQueue.length > 0) {
              const currentTarget = p.moveQueue.shift();
              if (currentTarget) {
                const movedDist = Math.hypot(p.x - currentTarget.startX, p.y - currentTarget.startY);
                collidedCost = movedDist >= 200 ? COOLDOWN_LONG_MS : COOLDOWN_SHORT_MS;
              }
            }
            p.isMoving = false;
            p.isRotating = false;
            p.cooldownUntil = now + collidedCost;

            // Trigger Pickup Logic
            if (hitItem) {
              if (canPlayerPickupItem(p, hitItem.type, room)) {
                applyItemEffect(p, hitItem, room);
              }
            } else if (hitFlag) {
              // Flag Pickup Logic
              if (p.team !== hitFlag.team) {
                // Enemy flag pickup
                const alreadyCarrying = room.flags.some(otherF => otherF.carrierId === p.id);
                if (!alreadyCarrying) {
                  hitFlag.carrierId = p.id;
                  hitFlag.droppedById = undefined;
                  broadcastRoom(room.id, {
                    type: "chat", payload: { from: "SYSTEM", message: `🚩 ${p.name} picked up the ${hitFlag.team} flag!`, timestamp: now }
                  });
                }
              } else if (hitFlag.droppedById === p.id) {
                // Own dropped flag recovery
                hitFlag.carrierId = p.id;
                hitFlag.droppedById = undefined;
                broadcastRoom(room.id, {
                  type: "chat", payload: { from: "SYSTEM", message: `🚩 ${p.name} recovered the ${hitFlag.team} flag!`, timestamp: now }
                });
              }
            }
          } else {
            // Normal movement
            p.x = nextX;
            p.y = nextY;
            p.isMoving = true;
          }
        } else {
          // Hit wall or player — trigger cooldown based on actual moved distance
          p.pendingMove = null;
          let collidedCost = COOLDOWN_SHORT_MS;
          if (p.moveQueue.length > 0) {
            const currentTarget = p.moveQueue.shift();
            if (currentTarget) {
              const movedDist = Math.hypot(p.x - currentTarget.startX, p.y - currentTarget.startY);
              collidedCost = movedDist >= 200 ? COOLDOWN_LONG_MS : COOLDOWN_SHORT_MS;
            }
          }
          p.isMoving = false;
          p.isRotating = false;
          p.cooldownUntil = now + collidedCost;
        }
      }
    } // This closes the `for (const pid of room.playerIds)` loop at line 91.

    // Cleanup expired smoke clouds
    room.smokeClouds = room.smokeClouds.filter(s => s.expiresAt > now);

    if (room.gameMode === "ctf") {
      updateCTF(room, now);
    }

    updateBullets(room, dtSec, now);
    sendRoomState(room.id);
  }
}
