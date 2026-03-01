import type { Vector2 } from "@tanktaktix/shared";
import { ACTION_COOLDOWN_MS, COOLDOWN_LONG_MS, COOLDOWN_SHORT_MS, COOLDOWN_THRESHOLD, HULL_ROTATION_SPEED, MAX_MOVE_DIST, MOVE_QUEUE_MAX, MOVE_SPEED, TANK_SIZE, TURRET_ROTATION_SPEED } from "../constants.js";
import { players } from "../state.js";
import type { PlayerRuntime, Room } from "../types.js";
import { clamp, len, norm, normalizeAngle } from "../utils/math.js";
import { checkWallCollision, isPointInBush } from "../utils/collision.js";

export function setMoveDir(p: PlayerRuntime, dir: Vector2) {
  if (Date.now() < p.cooldownUntil) return;
  const d = norm(dir);
  if (len(d) === 0) {
    p.pendingMove = null;
    return;
  }
  p.pendingMove = d;
  p.isMoving = true;
}

export function stopMove(p: PlayerRuntime) {
  p.pendingMove = null;
  p.moveQueue = [];
}

export function setMoveTarget(p: PlayerRuntime, target: Vector2, mapW: number, mapH: number) {
  let origin = { x: p.x, y: p.y };
  if (p.moveQueue.length > 0) origin = p.moveQueue[p.moveQueue.length - 1];
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const dist = Math.hypot(dx, dy);
  let finalTarget = target;
  if (dist > MAX_MOVE_DIST) {
    const ratio = MAX_MOVE_DIST / dist;
    finalTarget = { x: origin.x + dx * ratio, y: origin.y + dy * ratio };
  }
  const clamped = { x: clamp(finalTarget.x, 0, mapW), y: clamp(finalTarget.y, 0, mapH) };
  const fdx = clamped.x - origin.x;
  const fdy = clamped.y - origin.y;
  if (p.moveQueue.length >= MOVE_QUEUE_MAX) return;
  p.moveQueue.push({ ...clamped, startX: origin.x, startY: origin.y });
  p.isMoving = true;
}

export function setAimDir(p: PlayerRuntime, dir: Vector2) {
  const d = norm(dir);
  if (len(d) === 0) return;
  p.aimDir = d;
}

export function updateRoomMovement(room: Room, now: number) {
  for (const pid of room.playerIds) {
    const p = players.get(pid);
    if (!p) continue;
    if (p.respawnAt && p.respawnAt > now) continue;
    p.isHidden = isPointInBush(p.x, p.y, room.mapData.walls);
    let wantsToMove = false;
    let dx = 0;
    let dy = 0;
    if (p.cooldownUntil > now || p.respawnCooldownUntil > now) {
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
        const effectiveSpeed = p.bootsCharges > 0 ? MOVE_SPEED * 1.5 : MOVE_SPEED;
        if (distance <= effectiveSpeed) {
          p.x = currentTarget.x; p.y = currentTarget.y; p.moveQueue.shift(); p.isMoving = false; p.isRotating = false;
          const movedDist = Math.hypot(p.x - currentTarget.startX, p.y - currentTarget.startY);
          const arrivedCooldown = movedDist >= 200 ? COOLDOWN_LONG_MS : COOLDOWN_SHORT_MS;
          p.cooldownUntil = now + arrivedCooldown;
          if (p.bootsCharges > 0) p.bootsCharges--;
        } else {
          const targetAngle = Math.atan2(to.y, to.x);
          const angleDiff = normalizeAngle(targetAngle - p.hullAngle);
          if (Math.abs(angleDiff) > 0.05) {
            p.isRotating = true; p.isMoving = false;
            const step = Math.sign(angleDiff) * Math.min(Math.abs(angleDiff), HULL_ROTATION_SPEED);
            p.hullAngle = normalizeAngle(p.hullAngle + step);
            const turretDiff = normalizeAngle(targetAngle - p.turretAngle);
            const tStep = Math.sign(turretDiff) * Math.min(Math.abs(turretDiff), TURRET_ROTATION_SPEED);
            p.turretAngle = normalizeAngle(p.turretAngle + tStep);
          } else {
            p.hullAngle = targetAngle; p.turretAngle = targetAngle; p.isRotating = false;
            const d = norm(to);
            const moveSpd = p.bootsCharges > 0 ? MOVE_SPEED * 1.5 : MOVE_SPEED;
            dx = d.x * moveSpd; dy = d.y * moveSpd; wantsToMove = true;
          }
        }
      } else if (p.isMoving || p.isRotating) {
        p.isMoving = false; p.isRotating = false; p.cooldownUntil = now + ACTION_COOLDOWN_MS;
      }
    }

    if (wantsToMove) {
      const nextX = clamp(p.x + dx, 0, room.mapData.width);
      const nextY = clamp(p.y + dy, 0, room.mapData.height);
      const hitWall = checkWallCollision(nextX, nextY, TANK_SIZE, room.mapData.walls);
      let hitPlayer = false;
      if (!hitWall) {
        for (const opid of room.playerIds) {
          if (opid === p.id) continue;
          const other = players.get(opid);
          if (!other || other.hp <= 0 || (other.respawnAt && other.respawnAt > now)) continue;
          if (Math.hypot(nextX - other.x, nextY - other.y) < TANK_SIZE * 2) { hitPlayer = true; break; }
        }
      }
      if (hitWall || hitPlayer) {
        p.isMoving = false;
        p.pendingMove = null;
        p.moveQueue = [];
        p.cooldownUntil = now + ACTION_COOLDOWN_MS;
      } else {
        p.x = nextX; p.y = nextY; p.isMoving = true;
      }
    }
  }
}
