import type { MapData, Team } from "@tanktaktix/shared";
import { FLAG_RADIUS, FLAG_SCORE, SPAWN_ZONE_HALF, TANK_SIZE } from "../constants";
import { players } from "../state";
import type { Room } from "../types";
import { broadcastRoom } from "../network/broadcast";
import { dropFlag } from "./combat";

export function isInSpawnZone(x: number, y: number, team: Team, mapData: MapData): boolean {
  const sp = mapData.spawnPoints.find(s => s.team === team);
  if (!sp) return false;
  return Math.abs(x - sp.x) < SPAWN_ZONE_HALF && Math.abs(y - sp.y) < SPAWN_ZONE_HALF;
}
export function updateCTF(room: Room, now: number) {
  if (room.gameMode !== "ctf") return;

  for (const f of room.flags) {
    // Check if flag is currently flying via a pass action
    const isFlying = room.bullets.some(b => b.isFlagPass && b.flagTeam === f.team);
    if (isFlying) continue;

    // 1. Follow carrier
    if (f.carrierId) {
      const carrier = players.get(f.carrierId);
      if (carrier && carrier.hp > 0 && carrier.roomId === room.id) {
        f.x = carrier.x;
        f.y = carrier.y;

        // Check for capture: carrier brings enemy flag to their own base
        // Carrier's team: carrier.team
        // Flag's team: f.team (it's the enemy flag if carrier.team !== f.team)
        if (carrier.team && carrier.team !== f.team) {
          // Rule: Must be inside own spawn zone AND stopped to capture
          const isStopped = !carrier.isMoving && !carrier.isRotating;
          const inZone = isInSpawnZone(carrier.x, carrier.y, carrier.team, room.mapData);

          if (inZone && isStopped) {
            // CAPTURE!
            console.log(`[DEBUG] Team ${carrier.team} captured ${f.team} flag!`);
            if (carrier.team === "red") room.scoreRed += FLAG_SCORE;
            else if (carrier.team === "blue") room.scoreBlue += FLAG_SCORE;

            // Return flag to its original base
            const flagSrcOrig = room.mapData.flagPositions ?? room.mapData.spawnPoints;
            const originalBase = flagSrcOrig.find(s => s.team === f.team);
            if (originalBase) {
              f.x = originalBase.x;
              f.y = originalBase.y;
            }
            f.carrierId = null;

            // Update stats
            carrier.score += 5; // Personal bonus
            const h = room.history.get(carrier.id);
            if (h) h.score = carrier.score;

            broadcastRoom(room.id, {
              type: "chat",
              payload: {
                from: "SYSTEM",
                message: `🚩 Team ${carrier.team.toUpperCase()} captured the ${f.team} flag!`,
                timestamp: now
              }
            });
          }
        }
      } else {
        // Carrier lost/dead/left
        f.carrierId = null;
      }
    } else {
      // NEW LOGIC: Instantly return dropped flag to base
      const flagSrc = room.mapData.flagPositions ?? room.mapData.spawnPoints;
      const basePos = flagSrc.find(s => s.team === f.team);
      if (basePos) {
        if (Math.abs(f.x - basePos.x) > 1 || Math.abs(f.y - basePos.y) > 1) {
          f.x = basePos.x;
          f.y = basePos.y;
          f.droppedById = undefined;
          broadcastRoom(room.id, {
            type: "chat",
            payload: {
              from: "SYSTEM",
              message: `🏠 The ${f.team} flag returned to base.`,
              timestamp: now
            }
          });
        }
      }

      // 2. Pickup (Enemy taking flag from base)
      for (const pid of room.playerIds) {
        const p = players.get(pid);
        if (!p || p.hp <= 0 || p.respawnAt || p.respawnCooldownUntil > now) continue;

        const dist = Math.hypot(p.x - f.x, p.y - f.y);

        if (dist < FLAG_RADIUS + TANK_SIZE) {
          if (p.team !== f.team) {
            // Enemy touches flag -> Take it
            const alreadyCarrying = room.flags.some(otherF => otherF.carrierId === p.id);
            if (!alreadyCarrying) {
              f.carrierId = p.id;
              console.log(`[DEBUG] CTF Pickup! Player ${p.id} (${p.team}) took ${f.team} flag.`);
              broadcastRoom(room.id, {
                type: "chat",
                payload: {
                  from: "SYSTEM",
                  message: `🚩 ${p.name} has the ${f.team} flag!`,
                  timestamp: now
                }
              });
            }
          }
        }
      }
    }
  }
}
