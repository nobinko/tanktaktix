import type { MapData, Team } from "@tanktaktix/shared";
import { FLAG_RADIUS, FLAG_SCORE, SPAWN_ZONE_HALF, TANK_SIZE } from "../constants.js";
import { players } from "../state.js";
import type { Room } from "../types.js";
import { broadcastRoom } from "../network/broadcast.js";
import { dropFlag } from "./combat.js";

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
            f.x = f.baseX;
            f.y = f.baseY;
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
      if (Math.abs(f.x - f.baseX) > 1 || Math.abs(f.y - f.baseY) > 1) {
        f.x = f.baseX;
        f.y = f.baseY;
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

  }
}
