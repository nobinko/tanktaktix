import { state } from "../state";
import { interpolationBuffers } from "./interpolation";

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
  } else if (type === "smoke") {
    ctx.fillStyle = "#999999"; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#dddddd"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 1.5); ctx.stroke();
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
      const interpBuf = interpolationBuffers.bullets.get(b.id);
      // 100ms default delay for interpolation
      const renderTime = Date.now() - 100;
      const interpState = interpBuf ? interpBuf.getInterpolatedState(renderTime) : null;
      const renderX = interpState ? interpState.x : b.position.x;
      const renderY = interpState ? interpState.y : b.position.y;

      if (bAny.isRope) {
        const sx = bAny.startX ?? renderX;
        const sy = bAny.startY ?? renderY;
        ctx.strokeStyle = "#a3752c"; ctx.lineWidth = 3; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(sx, sy);
        const dx = renderX - sx, dy = renderY - sy;
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
        ctx.fillStyle = "#8b5a2b"; ctx.beginPath(); ctx.arc(renderX, renderY, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        continue;
      }
      if (bAny.isAmmoPass) { ctx.translate(renderX, renderY); ctx.rotate(-state.camera.rotation); drawItemSprite(ctx, "ammo"); ctx.restore(); continue; }
      if (bAny.isHealPass) { ctx.translate(renderX, renderY); ctx.rotate(-state.camera.rotation); drawItemSprite(ctx, "medic"); ctx.restore(); continue; }
      if (bAny.isFlagPass) { ctx.translate(renderX, renderY); ctx.rotate(-state.camera.rotation); drawFlagSprite(ctx, bAny.flagTeam || "red"); ctx.restore(); continue; }
      if (bAny.isSmoke) { ctx.translate(renderX, renderY); ctx.rotate(-state.camera.rotation); drawItemSprite(ctx, "smoke"); ctx.restore(); continue; }

      ctx.fillStyle = bAny.isBomb ? "#000000" : "#c4843a";
      ctx.beginPath(); ctx.arc(renderX, renderY, b.radius, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  state.items.forEach(item => {
    ctx.save(); ctx.translate(item.x, item.y); ctx.rotate(-state.camera.rotation);
    drawItemSprite(ctx, item.type); ctx.restore();
  });

  if (state.flags) {
    state.flags.forEach(f => {
      // Skip flags currently in flight as a pass bullet (already rendered above)
      if (state.bullets.some(b => (b as any).isFlagPass && (b as any).flagTeam === f.team)) return;
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(-state.camera.rotation);
      if (f.team) drawFlagSprite(ctx, f.team);
      ctx.restore();
    });
  }

  const getSelf = () => state.players.find(p => p.id === state.selfId);
  const now = Date.now();

  state.players.forEach((player) => {
    const pTeam = (player as any).team;
    if (pTeam === null) return; // Skip spectators / unassigned players

    const interpBuf = interpolationBuffers.players.get(player.id);
    const renderTime = now - 100;
    const interpState = interpBuf ? interpBuf.getInterpolatedState(renderTime) : null;
    const { x, y } = interpState ? interpState : ((player as any).position ?? { x: (player as any).x, y: (player as any).y });

    let color = "#c47030";
    if (pTeam === "red") color = "#c44040";
    else if (pTeam === "blue") color = "#4a6a8a";
    else if (player.id === state.selfId) color = "#8a6a2a";

    const isFlashing = state.hitFlashes[player.id] && state.hitFlashes[player.id] > now;
    if (isFlashing) color = "#ffffff";

    const hullAngle = interpState?.angle ?? ((player as any).hullAngle ?? 0);
    const turretAngle = (player as any).turretAngle ?? 0;
    const isInvincible = (player as any).respawnCooldownUntil && (player as any).respawnCooldownUntil > now;

    ctx.save();
    if (isInvincible) ctx.globalAlpha = 0.5;
    ctx.translate(x, y); ctx.rotate(hullAngle);
    // 1. 履帯 (基準位置固定)
    ctx.fillStyle = isFlashing ? "#ffffff" : "#7a6a5a";
    ctx.strokeStyle = isFlashing ? "#ffffff" : "#3a2a1a";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.rect(-13, -10, 26, 20); ctx.fill(); // まず全体を塗りつぶし（元の仕様に近い）
    ctx.fillRect(-13, -10, 26, 20); // Fallback for original code logic just in case

    // 2. 車体 (ベース四角形から「控えめに」非対称に削る)
    ctx.fillStyle = color;
    ctx.strokeStyle = isFlashing ? "#ffffff" : "#3a2a1a"; // 枠線色
    ctx.lineWidth = 1.5;

    // HPに応じて形状を削る
    const hp = (player as any).hp ?? 100;

    if (hp > 80) {
      // 100% ベース完全体
      ctx.moveTo(-11, -8); ctx.lineTo(11, -8); ctx.lineTo(11, 8); ctx.lineTo(-11, 8); ctx.closePath();
    }
    else if (hp > 60) {
      // 80% 左上がほんの少し欠ける
      ctx.moveTo(-9, -8); ctx.lineTo(11, -8); ctx.lineTo(11, 8);
      ctx.lineTo(-11, 8); ctx.lineTo(-11, -5); ctx.closePath();
    }
    else if (hp > 40) {
      // 60% 左上がもう少し欠け、左下はごくわずかに。
      ctx.moveTo(-7, -8); ctx.lineTo(11, -8); ctx.lineTo(11, 8);
      ctx.lineTo(-9, 8); ctx.lineTo(-11, 5); ctx.lineTo(-11, -3); ctx.closePath();
    }
    else if (hp > 20) {
      // 40% 左側は全体的に下がるが、全体の面積の8割は維持。非対称。
      ctx.moveTo(-5, -8); ctx.lineTo(11, -8); ctx.lineTo(11, 8);
      ctx.lineTo(-11, 8); ctx.lineTo(-11, 5); ctx.lineTo(-9, 4); ctx.lineTo(-9, 0); ctx.lineTo(-8, -4); ctx.closePath();
    }
    else {
      // 20% 以下 さらに凹みを作るが、ベースの四角形感は維持。
      ctx.moveTo(-1, -8); ctx.lineTo(11, -8); ctx.lineTo(11, 8);
      ctx.lineTo(-8, 8); ctx.lineTo(-11, 4); ctx.lineTo(-11, 1); ctx.lineTo(-6, -1); ctx.lineTo(-5, -5); ctx.closePath();
    }
    ctx.fill(); ctx.stroke();

    // 進行方向インジケーター
    ctx.fillStyle = isFlashing ? "#ff0000" : "#3a2a1a"; ctx.globalAlpha = isInvincible ? 0.35 : 0.7;
    ctx.beginPath(); ctx.moveTo(11, -3); ctx.lineTo(15, 0); ctx.lineTo(11, 3); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = isInvincible ? 0.5 : 1.0;

    // 3. 剥き出しの骨組み・ひしゃげた線 (控えめに)
    if (!isFlashing) {
      ctx.strokeStyle = "#3a2a1a";
      ctx.lineWidth = 1.5;

      if (hp <= 80 && hp > 60) {
        ctx.beginPath(); ctx.moveTo(-10, -7); ctx.lineTo(-15, -12); ctx.stroke();
        // 前方の微細なめくれ
        ctx.beginPath(); ctx.moveTo(11, -5); ctx.lineTo(14, -7); ctx.stroke();
      }
      else if (hp <= 60 && hp > 40) {
        ctx.beginPath(); ctx.moveTo(-9, -6); ctx.lineTo(-15, -10); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-11, -4); ctx.lineTo(-16, -6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-10, 7); ctx.lineTo(-14, 11); ctx.stroke();
        // 前方のめくれ
        ctx.beginPath(); ctx.moveTo(11, -6); ctx.lineTo(16, -9); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(11, 4); ctx.lineTo(15, 6); ctx.stroke();
      }
      else if (hp <= 40 && hp > 20) {
        ctx.beginPath(); ctx.moveTo(-6, -6); ctx.lineTo(-14, -13); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-9, -1); ctx.lineTo(-16, -4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-10, 6); ctx.lineTo(-16, 12); ctx.stroke();
        // 前方にも激しめのめくれ
        ctx.beginPath(); ctx.moveTo(11, -4); ctx.lineTo(17, -8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(11, 6); ctx.lineTo(18, 11); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(11, 1); ctx.lineTo(15, 2); ctx.stroke();
      }
      else if (hp <= 20) {
        ctx.beginPath(); ctx.moveTo(-3, -7); ctx.lineTo(-12, -15); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-6, -3); ctx.lineTo(-16, -8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(-17, 3); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-9, 6); ctx.lineTo(-16, 13); ctx.stroke();
        // 前方から複数の装甲板がめくれ出ている
        ctx.beginPath(); ctx.moveTo(11, -7); ctx.lineTo(18, -12); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(11, -2); ctx.lineTo(19, -4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(11, 3); ctx.lineTo(18, 6); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(11, 8); ctx.lineTo(17, 14); ctx.stroke();
      }
    }

    // 4. 車体内（欠損空間）の炎上アニメーション
    if (hp <= 40 && !isFlashing) {
      ctx.save();
      const t = now / 100;

      let cx = -7, cy = -2; // 炎の基準座標

      if (hp > 20) {
        // 40% 小さな炎
        const s = 1.0 + Math.sin(t) * 0.5;
        ctx.fillStyle = "rgba(40,40,40,0.8)";
        ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = (Math.floor(t * 2) % 2 === 0) ? "rgba(255,100,0,0.8)" : "rgba(200,50,0,0.8)";
        ctx.beginPath(); ctx.arc(cx, cy, s, 0, Math.PI * 2); ctx.fill();
      }
      else {
        // 20% 少し大きめの乱れる炎
        const f1x = cx + Math.sin(t * 1.3) * 0.5;
        const f1y = cy + Math.cos(t * 1.5) * 0.5;
        const f1r = 2 + Math.sin(t * 2) * 0.5;

        const f2x = cx - 1 + Math.sin(t * 1.7) * 0.5;
        const f2y = cy + 1.5 + Math.cos(t * 1.1) * 0.5;
        const f2r = 1.5 + Math.sin(t * 2.5) * 0.5;

        ctx.fillStyle = "rgba(30,30,30,0.7)";
        ctx.beginPath(); ctx.arc(cx - 1, cy + 1, 3.5, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = (Math.floor(t * 3) % 2 === 0) ? "rgba(255,180,0,0.9)" : "rgba(255,80,0,0.9)";
        ctx.beginPath(); ctx.arc(f1x, f1y, f1r, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(f2x, f2y, f2r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

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
    // HPバーの描画を削除


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
      const selfPos = (self as any).position ?? { x: (self as any).x ?? 0, y: (self as any).y ?? 0 };
      const sx = selfPos.x, sy = selfPos.y;
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

  // Draw smoke clouds OVER tanks
  if (state.room?.smokeClouds && Array.isArray(state.room.smokeClouds)) {
    const now = Date.now();
    state.room.smokeClouds.forEach((smoke: any) => {
      ctx.save();
      try {
        const timeRemaining = (smoke.expiresAt || 0) - now;
        if (timeRemaining <= 0) return;

        const radius = Math.max(1, (typeof smoke.radius === "number" && !isNaN(smoke.radius)) ? smoke.radius : 130);
        let opacity = 0.55;
        if (timeRemaining > 19000) {
          opacity *= Math.max(0, (20000 - timeRemaining) / 1000);
        } else if (timeRemaining < 2000) {
          opacity *= Math.max(0, timeRemaining / 2000);
        }
        opacity = Math.max(0, Math.min(1, opacity));
        if (isNaN(opacity) || !isFinite(opacity)) opacity = 0.55;

        const sx = typeof smoke.x === "number" && !isNaN(smoke.x) ? smoke.x : 0;
        const sy = typeof smoke.y === "number" && !isNaN(smoke.y) ? smoke.y : 0;

        ctx.translate(sx, sy);

        const gradient = ctx.createRadialGradient(0, 0, radius * 0.2, 0, 0, radius);
        gradient.addColorStop(0, `rgba(110, 110, 110, ${opacity})`);
        gradient.addColorStop(0.6, `rgba(140, 140, 140, ${opacity * 0.8})`);
        gradient.addColorStop(1, `rgba(150, 150, 150, 0)`);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();

        const t = now / 2500;
        for (let i = 0; i < 3; i++) {
          const offsetAngle = t + (i * Math.PI * 2 / 3);
          const dist = radius * 0.35;
          const px = Math.cos(offsetAngle) * dist;
          const py = Math.sin(offsetAngle) * dist;
          const puffRadius = radius * 0.7;

          const puffGrad = ctx.createRadialGradient(px, py, 0, px, py, puffRadius);
          puffGrad.addColorStop(0, `rgba(150, 150, 150, ${opacity * 0.4})`);
          puffGrad.addColorStop(1, `rgba(150, 150, 150, 0)`);

          ctx.fillStyle = puffGrad;
          ctx.beginPath();
          ctx.arc(px, py, puffRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      } catch (err) {
        console.error("smoke render error", err);
      } finally {
        ctx.restore();
      }
    });
  }
};
