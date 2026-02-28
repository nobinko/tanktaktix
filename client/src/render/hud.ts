import { mapSize, state } from "../state";

const drawMinimap = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
  const maxMboxW = 160;
  const maxMboxH = 160;
  const mapWidth = mapSize.width;
  const mapHeight = mapSize.height;
  let mmW = maxMboxW;
  let mmH = (maxMboxW / mapWidth) * mapHeight;
  if (mmH > maxMboxH) {
    mmH = maxMboxH;
    mmW = (maxMboxH / mapHeight) * mapWidth;
  }

  const mmX = canvas.width - mmW - 8;
  const mmY = canvas.height - mmH - 8;
  const scaleX = mmW / mapWidth;
  const scaleY = mmH / mapHeight;

  ctx.fillStyle = "rgba(10, 20, 40, 0.75)";
  ctx.fillRect(mmX, mmY, mmW, mmH);
  ctx.strokeStyle = "rgba(120, 150, 255, 0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(mmX, mmY, mmW, mmH);

  if (state.mapData && state.mapData.walls) {
    for (const w of state.mapData.walls) {
      const type = (w as any).type || "wall";
      if (type === "bush") ctx.fillStyle = "rgba(34, 197, 94, 0.6)";
      else if (type === "water") ctx.fillStyle = "rgba(59, 130, 246, 0.6)";
      else if (type === "house") ctx.fillStyle = "#8b4513";
      else if (type === "oneway") ctx.fillStyle = "rgba(255, 140, 0, 0.6)";
      else ctx.fillStyle = "rgba(100, 120, 140, 0.6)";
      ctx.fillRect(mmX + w.x * scaleX, mmY + w.y * scaleY, Math.max(1, w.width * scaleX), Math.max(1, w.height * scaleY));
    }
  }

  const bullets = (state as any).bullets ?? [];
  ctx.fillStyle = "#fde047";
  for (const b of bullets) {
    const bx = b.x ?? (b.position?.x ?? 0);
    const by = b.y ?? (b.position?.y ?? 0);
    ctx.fillRect(mmX + bx * scaleX - 1, mmY + by * scaleY - 1, 2, 2);
  }

  const itemColors: Record<string, string> = {
    medic: "#22c55e", ammo: "#facc15", heart: "#ec4899",
    bomb: "#6b7280", rope: "#a3752c", boots: "#818cf8",
  };
  for (const item of state.items) {
    ctx.fillStyle = itemColors[item.type] ?? "#fff";
    ctx.fillRect(mmX + item.x * scaleX - 1, mmY + item.y * scaleY - 1, 3, 3);
  }

  if (state.flags) {
    for (const f of state.flags) {
      ctx.fillStyle = f.team === "red" ? "#ef4444" : "#3b82f6";
      ctx.beginPath(); ctx.arc(mmX + f.x * scaleX, mmY + f.y * scaleY, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  const getSelf = () => state.players.find(p => p.id === state.selfId);
  for (const p of state.players) {
    const px = (p as any).position?.x ?? (p as any).x ?? 0;
    const py = (p as any).position?.y ?? (p as any).y ?? 0;
    const isSelf = p.id === state.selfId;
    const team = (p as any).team;
    if (team === "red") ctx.fillStyle = isSelf ? "#ff6b6b" : "#dc2626";
    else if (team === "blue") ctx.fillStyle = isSelf ? "#60a5fa" : "#2563eb";
    else ctx.fillStyle = isSelf ? "#4cc9f0" : "#9ca3af";
    const dotSize = isSelf ? 4 : 2;
    ctx.fillRect(mmX + px * scaleX - dotSize / 2, mmY + py * scaleY - dotSize / 2, dotSize, dotSize);
  }

  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 1;
  const vpX = mmX + state.camera.x * scaleX;
  const vpY = mmY + state.camera.y * scaleY;
  const vpW = canvas.width * scaleX / state.camera.zoom;
  const vpH = canvas.height * scaleY / state.camera.zoom;
  ctx.strokeRect(vpX, vpY, vpW, vpH);
};

const drawChat = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
  const messages = state.chat.slice(-8);
  const lineHeight = 16;
  const bottomY = canvas.height - 40;
  const startX = 10;
  ctx.font = "12px 'Segoe UI', Arial, sans-serif";
  ctx.textAlign = "left"; ctx.textBaseline = "bottom";
  messages.forEach((msg, i) => {
    const y = bottomY - ((messages.length - 1 - i) * lineHeight);
    const text = `${msg.from}: ${msg.message}`;
    const width = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(startX - 2, y - lineHeight + 2, width + 4, lineHeight);
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillText(text, startX, y);
  });
  ctx.textBaseline = "alphabetic";
};

export const drawHud = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
  ctx.resetTransform();
  const W = canvas.width;
  const getSelf = () => state.players.find(p => p.id === state.selfId);
  const self = getSelf();
  const barH = 28;

  const now = Date.now();
  const respawnCD = self ? (self as any).respawnCooldownUntil ?? 0 : 0;
  ctx.fillStyle = respawnCD > now ? "rgba(100, 200, 255, 0.85)" : "rgba(200, 200, 200, 0.85)";
  ctx.fillRect(0, 0, W, barH);
  ctx.strokeStyle = "rgba(160, 160, 160, 0.6)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, barH); ctx.lineTo(W, barH); ctx.stroke();

  ctx.font = "bold 13px 'Segoe UI', Arial, sans-serif";
  const hp = self ? (self as any).hp ?? 0 : 0;
  const hpColor = hp > 60 ? "#16a34a" : hp > 20 ? "#d97706" : "#dc2626";
  ctx.fillStyle = "#333"; ctx.textAlign = "left"; ctx.fillText("❤️", 12, 19);
  ctx.fillStyle = hpColor; ctx.fillText(`${hp}%`, 32, 19);

  const ammo = self ? (self as any).ammo ?? 0 : 0;
  ctx.fillStyle = "#333"; ctx.fillText("🔫", 88, 19);
  ctx.fillStyle = ammo > 5 ? "#333" : "#dc2626"; ctx.fillText(`${ammo}`, 108, 19);

  if (self && (self as any).isHidden) {
    ctx.fillStyle = "#16a34a"; ctx.font = "bold 12px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("🕵️ HIDDEN", 138, 19);
  }

  if (self && !state.isSpectator) {
    let itemX = 240; const iy = 19;
    ctx.font = "bold 11px 'Segoe UI', Arial, sans-serif"; ctx.textAlign = "left";
    if ((self as any).hasBomb) { ctx.fillStyle = "#f97316"; ctx.fillText("💣BOMB", itemX, iy); itemX += 58; }
    if ((self as any).ropeCount > 0) { ctx.fillStyle = "#a3752c"; ctx.fillText(`🪢×${(self as any).ropeCount}`, itemX, iy); itemX += 42; }
    if ((self as any).bootsCharges > 0) { ctx.fillStyle = "#818cf8"; ctx.fillText(`👢×${(self as any).bootsCharges}`, itemX, iy); itemX += 42; }
  }

  if (state.isSpectator) {
    ctx.fillStyle = "#a855f7"; ctx.font = "bold 12px 'Segoe UI', Arial, sans-serif"; ctx.textAlign = "left";
    ctx.fillText("📺 SPECTATING", 138, 19);
  }

  const mins = Math.floor(state.timeLeftSec / 60).toString().padStart(2, "0");
  const secs = (state.timeLeftSec % 60).toString().padStart(2, "0");
  ctx.fillStyle = "#111"; ctx.textAlign = "center"; ctx.font = "bold 14px 'Segoe UI', Arial, sans-serif";
  ctx.fillText(`${mins}:${secs}`, W / 2, 19);

  const isTeamMode = state.players.some((p) => (p as any).team != null);
  ctx.font = "bold 12px 'Segoe UI', Arial, sans-serif";
  if (isTeamMode) {
    const scores = state.teamScores;
    ctx.textAlign = "right";
    ctx.fillStyle = "#dc2626"; ctx.fillText(`Red:${scores.red}`, W / 2 + 120, 19);
    ctx.fillStyle = "#2563eb"; ctx.fillText(`Blue:${scores.blue}`, W / 2 + 200, 19);
  } else {
    const myScore = self ? (self as any).score ?? 0 : 0;
    ctx.textAlign = "right"; ctx.fillStyle = "#333"; ctx.fillText(`Score:${myScore}`, W / 2 + 140, 19);
  }

  if (!state.isSpectator) {
    const lockStep = self ? ((self as any).actionLockStep ?? 0) : 0;
    ctx.textAlign = "right";
    if (lockStep > 0) {
      ctx.fillStyle = "#f97316"; ctx.fillText(`LOCK ${lockStep}`, W - 12, 19);
    } else {
      ctx.fillStyle = "#16a34a"; ctx.fillText("READY", W - 12, 19);
    }
  }

  drawMinimap(ctx, canvas);
  drawChat(ctx, canvas);
  ctx.textAlign = "start";
};
