import { state } from "../state";

const drawItemSprite = (ctx: CanvasRenderingContext2D, type: string) => {
  if (type === "medic") {
    ctx.fillStyle = "#5c8a3a"; ctx.fillRect(-10, -10, 20, 20);
    ctx.fillStyle = "#fff"; ctx.fillRect(-7, -2, 14, 4); ctx.fillRect(-2, -7, 4, 14);
  } else if (type === "ammo") {
    ctx.fillStyle = "#c49832"; ctx.fillRect(-10, -10, 20, 20);
    ctx.fillStyle = "#7a6a5a"; ctx.fillRect(-7, 2, 8, 5);
  } else if (type === "heart") {
    ctx.fillStyle = "#ec4899";
    ctx.beginPath(); ctx.moveTo(0, 4);
    ctx.bezierCurveTo(-10, -6, -14, 2, 0, 12);
    ctx.bezierCurveTo(14, 2, 10, -6, 0, 4); ctx.fill();
  } else if (type === "bomb") {
    ctx.fillStyle = "#6b5d4a"; ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#c47030"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(5, -8); ctx.lineTo(8, -14); ctx.stroke();
    ctx.fillStyle = "#d4a843"; ctx.beginPath(); ctx.arc(8, -14, 2, 0, Math.PI * 2); ctx.fill();
  } else if (type === "rope") {
    ctx.strokeStyle = "#a3752c"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 1.5); ctx.stroke();
    ctx.fillStyle = "#a3752c"; ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(4, -4); ctx.lineTo(-4, -4); ctx.closePath(); ctx.fill();
  } else if (type === "boots") {
    ctx.fillStyle = "#6b6b9a"; ctx.fillRect(-8, -4, 10, 12); ctx.fillRect(-8, 4, 16, 6);
    ctx.strokeStyle = "#8a8ab5"; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(-12, 0); ctx.lineTo(-16, 0); ctx.moveTo(-12, 4); ctx.lineTo(-18, 4); ctx.moveTo(-12, 8); ctx.lineTo(-15, 8); ctx.stroke();
  }
};

const drawFlagSprite = (ctx: CanvasRenderingContext2D, team: string) => {
  ctx.fillStyle = "#3a2a1a"; ctx.fillRect(-1, -20, 2, 40);
  ctx.fillStyle = team === "red" ? "#c44040" : "#4a6a8a";
  ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(25, -10); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#e8e0d4"; ctx.font = "bold 10px 'Share Tech Mono', monospace"; ctx.textAlign = "center"; ctx.fillText(team.toUpperCase(), 0, 30);
};

export const drawEntities = (ctx: CanvasRenderingContext2D) => {
  if (state.bullets.length > 0) {
    for (const b of state.bullets) {
      ctx.save();
      const bAny = b as any;
      if (bAny.isRope) {
        const sx = bAny.startX ?? b.position.x;
        const sy = bAny.startY ?? b.position.y;
        ctx.strokeStyle = "#a3752c"; ctx.lineWidth = 3; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(sx, sy);
        const dx = b.position.x - sx, dy = b.position.y - sy;
        const dist = Math.hypot(dx, dy);
        const segments = Math.max(1, Math.floor(dist / 10));
        if (dist > 0) {
          const perpX = -dy / dist, perpY = dx / dist;
          for (let i = 1; i <= segments; i++) {
            const t = i / segments;
            const wave = Math.sin(t * Math.PI * 4) * 4;
            ctx.lineTo(sx + dx * t + perpX * wave, sy + dy * t + perpY * wave);
          }
        }
        ctx.stroke();
        ctx.fillStyle = "#8b5a2b"; ctx.beginPath(); ctx.arc(b.position.x, b.position.y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        continue;
      }
      if (bAny.isAmmoPass) { ctx.translate(b.position.x, b.position.y); ctx.rotate(-state.camera.rotation); drawItemSprite(ctx, "ammo"); ctx.restore(); continue; }
      if (bAny.isHealPass) { ctx.translate(b.position.x, b.position.y); ctx.rotate(-state.camera.rotation); drawItemSprite(ctx, "medic"); ctx.restore(); continue; }
      if (bAny.isFlagPass) { ctx.translate(b.position.x, b.position.y); ctx.rotate(-state.camera.rotation); drawFlagSprite(ctx, bAny.flagTeam || "red"); ctx.restore(); continue; }

      ctx.fillStyle = bAny.isBomb ? "#000000" : "#c4843a";
      ctx.beginPath(); ctx.arc(b.position.x, b.position.y, b.radius, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  state.items.forEach(item => {
    ctx.save(); ctx.translate(item.x, item.y); ctx.rotate(-state.camera.rotation);
    drawItemSprite(ctx, item.type); ctx.restore();
  });

  if (state.flags) {
    state.flags.forEach(f => {
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(-state.camera.rotation);
      if (f.team) drawFlagSprite(ctx, f.team);
      ctx.restore();
    });
  }

  const getSelf = () => state.players.find(p => p.id === state.selfId);
  const now = Date.now();

  state.players.forEach((player) => {
    const { x, y } = (player as any).position ?? { x: (player as any).x, y: (player as any).y };
    let color = "#c47030";
    const pTeam = (player as any).team;
    if (pTeam === "red") color = "#c44040";
    else if (pTeam === "blue") color = "#4a6a8a";
    else if (player.id === state.selfId) color = "#8a6a2a";

    const isFlashing = state.hitFlashes[player.id] && state.hitFlashes[player.id] > now;
    if (isFlashing) color = "#ffffff";

    const hullAngle = (player as any).hullAngle ?? 0;
    const turretAngle = (player as any).turretAngle ?? 0;
    const isInvincible = (player as any).respawnCooldownUntil && (player as any).respawnCooldownUntil > now;

    ctx.save();
    if (isInvincible) ctx.globalAlpha = 0.5;
    ctx.translate(x, y); ctx.rotate(hullAngle);
    ctx.fillStyle = isFlashing ? "#ffffff" : "#7a6a5a"; ctx.fillRect(-13, -10, 26, 20);
    ctx.fillStyle = color; ctx.fillRect(-11, -8, 22, 16);
    ctx.fillStyle = isFlashing ? "#ff0000" : "#3a2a1a"; ctx.globalAlpha = isInvincible ? 0.35 : 0.7;
    ctx.beginPath(); ctx.moveTo(11, -3); ctx.lineTo(15, 0); ctx.lineTo(11, 3); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = isInvincible ? 0.5 : 1.0;

    if ((player as any).hasBomb) {
      ctx.fillStyle = "#7a6a5a"; ctx.beginPath(); ctx.arc(-8, 0, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#c47030"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-8, -5); ctx.lineTo(-6, -8); ctx.stroke();
      ctx.fillStyle = "#d4a843"; ctx.beginPath(); ctx.arc(-6, -8, 1.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    ctx.save();
    if (isInvincible) ctx.globalAlpha = 0.5;
    ctx.translate(x, y);
    if (state.aiming && player.id === state.selfId && state.aimPoint) {
      const aimAngle = Math.atan2(y - state.aimPoint.y, x - state.aimPoint.x);
      ctx.rotate(aimAngle);
    } else ctx.rotate(turretAngle);
    ctx.fillStyle = "#3a2a1a"; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#c4b4a0"; ctx.fillRect(5, -1.5, 14, 3);
    ctx.restore();

    ctx.save();
    if (isInvincible) ctx.globalAlpha = 0.5;
    ctx.translate(x, y); ctx.rotate(-state.camera.rotation);
    ctx.fillStyle = "#3a2a1a"; ctx.fillText(player.name, 24, 4);
    ctx.fillStyle = "#5c8a3a"; ctx.fillRect(-20, -28, ((player as any).hp / 100) * 40, 4);

    const lockStep = (player as any).actionLockStep ?? 0;
    if (lockStep > 0 && player.id === state.selfId) {
      ctx.font = "bold 16px 'Share Tech Mono', monospace"; ctx.fillStyle = "#c47030"; ctx.textAlign = "center";
      ctx.fillText(`${lockStep}`, 0, -34); ctx.textAlign = "start";
    }

    const hasFlag = state.flags.find(f => f.carrierId === player.id);
    if (hasFlag) {
      ctx.fillStyle = hasFlag.team === "red" ? "#c44040" : "#4a6a8a";
      ctx.font = "bold 16px 'Share Tech Mono', monospace"; ctx.textAlign = "center"; ctx.fillText("\ud83d\udea9", 0, -38);
    }
    ctx.restore();
  });

  const selfPlayer = getSelf();
  if (selfPlayer) {
    const queue = (selfPlayer as any).moveQueue ?? [];
    queue.forEach((pt: any, i: number) => {
      let alpha = 0.8;
      if (i > 0) {
        alpha = 0.3;
      } else if ((selfPlayer as any).nextActionAt > Date.now()) {
        alpha = 0.3;
      }
      ctx.strokeStyle = `rgba(168, 148, 104, ${alpha})`; ctx.lineWidth = 2;
      const sz = 8;
      ctx.beginPath(); ctx.moveTo(pt.x - sz, pt.y); ctx.lineTo(pt.x + sz, pt.y);
      ctx.moveTo(pt.x, pt.y - sz); ctx.lineTo(pt.x, pt.y + sz); ctx.stroke();
      ctx.fillStyle = `rgba(168, 148, 104, ${alpha})`; ctx.font = "10px 'Share Tech Mono', monospace"; ctx.fillText(`${i + 1}`, pt.x + sz + 2, pt.y - 2);
    });
  }

  if (state.aiming && state.aimPoint) {
    const self = getSelf();
    if (self) {
      const sx = (self as any).position.x, sy = (self as any).position.y;
      const dragX = state.aimPoint.x - sx, dragY = state.aimPoint.y - sy;
      const dragDist = Math.hypot(dragX, dragY);
      const CANCEL_DIST = 18;
      ctx.save();
      if (dragDist <= CANCEL_DIST) {
        ctx.fillStyle = "rgba(200, 58, 46, 0.7)"; ctx.font = "bold 12px 'Share Tech Mono', monospace"; ctx.textAlign = "center";
        ctx.fillText("CANCEL", sx, sy - 28); ctx.textAlign = "start";
      } else {
        const aimX = -dragX, aimY = -dragY;
        const aimLen = Math.hypot(aimX, aimY);
        const ndx = aimX / aimLen, ndy = aimY / aimLen;
        const guideLen = 54;
        const gx = sx + ndx * guideLen, gy = sy + ndy * guideLen;
        ctx.setLineDash([6, 4]); ctx.strokeStyle = "rgba(168, 148, 104, 0.8)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(gx, gy); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = "rgba(168, 148, 104, 0.8)"; ctx.beginPath();
      }
      ctx.restore();
    }
  }
};
