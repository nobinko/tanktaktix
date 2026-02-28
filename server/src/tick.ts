import type { Item, ItemType } from "@tanktaktix/shared";
import { ACTION_COOLDOWN_MS, AMMO_REFILL_AMOUNT, COOLDOWN_LONG_MS, COOLDOWN_SHORT_MS, HULL_ROTATION_SPEED, ITEM_RADIUS, MEDIC_HEAL_AMOUNT, MOVE_SPEED, RECONNECT_TIMEOUT_MS, RESPAWN_MS, TANK_SIZE, TURRET_ROTATION_SPEED } from "./constants";
import { players, rooms } from "./state";
import { detachFromRoom, respawnItem, spawnPlayer } from "./room";
import { broadcastRoom, sendRoomState } from "./network/broadcast";
import { updateBullets } from "./systems/projectiles";
import { updateCTF } from "./systems/ctf";
import { clamp, len, norm, normalizeAngle, nowMs } from "./utils/math";
import { checkWallCollision, isPointInBush } from "./utils/collision";

let lastTickAt = nowMs();
export function tick() {
  const now = nowMs();
  const dtSec = Math.min(0.1, Math.max(0.001, (now - lastTickAt) / 1000));
  lastTickAt = now;

  // Cleanup disconnected players (B-3)
  for (const [pid, p] of players.entries()) {
    if (p.disconnectedAt !== null && now - p.disconnectedAt > RECONNECT_TIMEOUT_MS) {
      console.log(`[DEBUG] Player ${pid} reconnection timeout.Cleaning up.`);
      detachFromRoom(p);
      players.delete(pid);
    }
  }

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
      const inBush = isPointInBush(p.x, p.y, room.mapData.walls);
      p.isHidden = inBush;

      // Movement Logic (with pivot-turn phase)
      let wantsToMove = false;
      let dx = 0;
      let dy = 0;

      // Movement freeze applied during both normal action cooldown AND respawn cooldown
      if (p.cooldownUntil > now || p.respawnCooldownUntil > now) {
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
            const arrivedCooldown = currentTarget.cost ?? applyCooldown(Math.hypot(currentTarget.x - p.x, currentTarget.y - p.y));
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
            if (other.hp <= 0) continue;
            if (other.respawnAt) continue;
            const pdx = nextX - other.x;
            const pdy = nextY - other.y;
            if (Math.hypot(pdx, pdy) < TANK_SIZE * 2) {
              hitPlayer = true;
              break;
            }
          }
        }

        if (!hitWall && !hitPlayer) {
          let hitOwnDroppedFlag = false;
          if (room.gameMode === "ctf") {
            for (const f of room.flags) {
              if (f.droppedById === p.id && Math.hypot(nextX - f.x, nextY - f.y) < 25 + TANK_SIZE) {
                hitOwnDroppedFlag = true;
                f.carrierId = p.id;
                f.droppedById = undefined;
                broadcastRoom(room.id, {
                  type: "chat", payload: { from: "SYSTEM", message: `🚩 ${p.name} picked up the ${f.team} flag!`, timestamp: now }
                });
                break;
              }
            }
          }

          if (hitOwnDroppedFlag) {
            // Cancel movement and trigger cooldown as per standstill flag pickup rule
            p.pendingMove = null;
            if (p.moveQueue.length > 0) p.moveQueue.shift();
            p.isMoving = false;
            p.isRotating = false;
            p.cooldownUntil = now + Math.min(ACTION_COOLDOWN_MS, 300);
          } else {
            p.x = nextX;
            p.y = nextY;
            p.isMoving = true;
          }
        } else {
          // Hit wall or player — consume target, trigger cooldown
          p.pendingMove = null;
          let collidedCost = COOLDOWN_SHORT_MS;
          if (p.moveQueue.length > 0) {
            const currentTarget = p.moveQueue.shift();
            if (currentTarget?.cost) collidedCost = currentTarget.cost;
          }
          p.isMoving = false;
          p.isRotating = false;
          p.cooldownUntil = now + collidedCost;
        }
      }

      // Check Item Pickups (Phase 4-1/4-3/4-4)
      if (!room.ended && p.hp > 0 && !p.respawnAt) {
        const nextItems: Item[] = [];
        const pickedTypes: ItemType[] = [];
        for (const item of room.items) {
          const dist = Math.hypot(p.x - item.x, p.y - item.y);
          if (dist < TANK_SIZE + ITEM_RADIUS) {
            // Phase 4-3: Check pickup limits before applying
            let canPickup = true;
            if (item.type === "medic" || item.type === "heart") {
              if (p.hp >= 100) canPickup = false; // HP full → cannot pick
            } else if (item.type === "ammo") {
              if (p.ammo >= 40) canPickup = false; // Ammo full → cannot pick
            } else if (item.type === "bomb") {
              if (p.hasBomb) canPickup = false; // Already has bomb
            } else if (item.type === "rope") {
              if (p.ropeCount >= 2) canPickup = false; // Max 2 ropes
            } else if (item.type === "boots") {
              if (p.bootsCharges > 0) canPickup = false; // Already has boots
            }

            if (canPickup) {
              // Phase 4-4: Apply effects
              if (item.type === "medic") {
                p.hp = Math.min(100, p.hp + MEDIC_HEAL_AMOUNT);
              } else if (item.type === "ammo") {
                p.ammo = Math.min(40, p.ammo + AMMO_REFILL_AMOUNT);
              } else if (item.type === "heart") {
                p.hp = 100; // Full heal
              } else if (item.type === "bomb") {
                p.hasBomb = true; // Next shot is bomb shot
              } else if (item.type === "rope") {
                p.ropeCount = Math.min(2, p.ropeCount + 1);
              } else if (item.type === "boots") {
                p.bootsCharges = 3; // 3 move arrivals
              }
              pickedTypes.push(item.type);
            } else {
              nextItems.push(item); // Cannot pick → keep item
            }
          } else {
            nextItems.push(item);
          }
        }
        if (pickedTypes.length > 0) {
          room.items = nextItems;
          // Respawn same types at new random locations
          for (const t of pickedTypes) {
            respawnItem(room, t);
          }
        }
      }
    }

    if (room.gameMode === "ctf") {
      updateCTF(room, now);
    }

    updateBullets(room, dtSec, now);
    sendRoomState(room.id);
  }
}
