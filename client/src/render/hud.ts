import { state } from "../state.js";
import { drawGeometryFlat } from "./terrain.js";

const drawMinimap = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
  const maxMboxW = 160;
  const maxMboxH = 160;
  const mapWidth = state.mapSize.width;
  const mapHeight = state.mapSize.height;
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

  ctx.fillStyle = "rgba(229, 220, 208, 0.80)";
  ctx.fillRect(mmX, mmY, mmW, mmH);
  ctx.strokeStyle = "rgba(168, 148, 104, 0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(mmX, mmY, mmW, mmH);

  if (state.mapGeometry) {
    ctx.save();
    ctx.translate(mmX, mmY);
    ctx.scale(scaleX, scaleY);
    drawGeometryFlat(ctx, state.mapGeometry);
    ctx.restore();
  }

  const bullets = (state as any).bullets ?? [];
  ctx.fillStyle = "#c4843a";
  for (const b of bullets) {
    const bx = b.x ?? (b.position?.x ?? 0);
    const by = b.y ?? (b.position?.y ?? 0);
    ctx.fillRect(mmX + bx * scaleX - 1, mmY + by * scaleY - 1, 2, 2);
  }

  const itemColors: Record<string, string> = {
    medic: "#5c8a3a", ammo: "#c49832", heart: "#ec4899",
    bomb: "#6b5d4a", rope: "#a3752c", boots: "#7a7aad",
  };
  for (const item of state.items) {
    ctx.fillStyle = itemColors[item.type] ?? "#e8e0d4";
    ctx.fillRect(mmX + item.x * scaleX - 1, mmY + item.y * scaleY - 1, 3, 3);
  }

  if (state.flags) {
    for (const f of state.flags) {
      ctx.fillStyle = f.team === "red" ? "#c44040" : "#4a6a8a";
      ctx.beginPath(); ctx.arc(mmX + f.x * scaleX, mmY + f.y * scaleY, 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  const getSelf = () => state.players.find(p => p.id === state.selfId);
  for (const p of state.players) {
    const team = (p as any).team;
    if (team === null) continue; // Skip spectators

    const px = (p as any).position?.x ?? (p as any).x ?? 0;
    const py = (p as any).position?.y ?? (p as any).y ?? 0;
    const isSelf = p.id === state.selfId;
    if (team === "red") ctx.fillStyle = isSelf ? "#ff5555" : "#c44040";
    else if (team === "blue") ctx.fillStyle = isSelf ? "#6a92c8" : "#4a6a8a";
    else ctx.fillStyle = isSelf ? "#8a6a2a" : "#7a6a5a";
    const dotSize = isSelf ? 4 : 2;
    ctx.fillRect(mmX + px * scaleX - dotSize / 2, mmY + py * scaleY - dotSize / 2, dotSize, dotSize);
  }

  ctx.strokeStyle = "rgba(100, 90, 80, 0.4)";
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
  ctx.font = "12px 'Share Tech Mono', monospace";
  ctx.textAlign = "left"; ctx.textBaseline = "bottom";
  messages.forEach((msg, i) => {
    const y = bottomY - ((messages.length - 1 - i) * lineHeight);
    const text = `${msg.from}: ${msg.message}`;
    const width = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(229, 220, 208, 0.85)";
    ctx.fillRect(startX - 2, y - lineHeight + 2, width + 4, lineHeight);
    ctx.fillStyle = "#3a2a1a";
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
  ctx.fillStyle = respawnCD > now ? "rgba(196, 200, 180, 0.90)" : "rgba(229, 220, 208, 0.90)";
  ctx.fillRect(0, 0, W, barH);
  ctx.strokeStyle = "rgba(168, 148, 104, 0.4)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, barH); ctx.lineTo(W, barH); ctx.stroke();

  ctx.font = "bold 13px 'Share Tech Mono', monospace";
  const hp = self ? (self as any).hp ?? 0 : 0;
  const hpColor = hp > 60 ? "#5c8a3a" : hp > 20 ? "#d4a832" : "#c83a2e";
  ctx.fillStyle = "#3a2a1a"; ctx.textAlign = "left"; ctx.fillText("\u2764\ufe0f", 12, 19);
  ctx.fillStyle = hpColor; ctx.fillText(`${hp}%`, 32, 19);

  const ammo = self ? (self as any).ammo ?? 0 : 0;
  ctx.fillStyle = "#3a2a1a"; ctx.fillText("\ud83d\udd2b", 88, 19);
  ctx.fillStyle = ammo > 5 ? "#3a2a1a" : "#c83a2e"; ctx.fillText(`${ammo}`, 108, 19);

  if (self && (self as any).isHidden) {
    ctx.fillStyle = "#5c8a3a"; ctx.font = "bold 12px 'Share Tech Mono', monospace";
    ctx.textAlign = "left";
    ctx.fillText("\ud83d\udd75\ufe0f HIDDEN", 140, 19);
  }

  if (self && !state.isSpectator) {
    let itemX = 240; const iy = 19;
    ctx.font = "bold 11px 'Share Tech Mono', monospace"; ctx.textAlign = "left";
    if ((self as any).hasBomb) { ctx.fillStyle = "#c47030"; ctx.fillText("\ud83d\udca3BOMB", itemX, iy); itemX += 58; }
    if ((self as any).ropeCount > 0) { ctx.fillStyle = "#a3752c"; ctx.fillText(`\ud83e\udea2\u00d7${(self as any).ropeCount}`, itemX, iy); itemX += 42; }
    if ((self as any).bootsCharges > 0) { ctx.fillStyle = "#7a7aad"; ctx.fillText(`\ud83d\udc62\u00d7${(self as any).bootsCharges}`, itemX, iy); itemX += 42; }
  }

  // Draw timer in exact center
  const mins = Math.floor(state.timeLeftSec / 60).toString().padStart(2, "0");
  const secs = (state.timeLeftSec % 60).toString().padStart(2, "0");
  ctx.fillStyle = "#3a2a1a"; ctx.textAlign = "center"; ctx.font = "bold 15px 'Share Tech Mono', monospace";
  ctx.fillText(`${mins}:${secs}`, W / 2, 19);

  // Restore and emphasize Team Scores around center
  const isTeamMode = state.players.some((p) => (p as any).team != null);
  if (isTeamMode) {
    const scores = state.teamScores;
    ctx.font = "bold 14px 'Share Tech Mono', monospace";
    ctx.textAlign = "right"; ctx.fillStyle = "#c44040"; ctx.fillText(`RED: ${scores.red}`, W / 2 - 60, 19);
    ctx.textAlign = "left"; ctx.fillStyle = "#4a6a8a"; ctx.fillText(`${scores.blue} :BLUE`, W / 2 + 60, 19);
  } else {
    const myScore = self ? (self as any).score ?? 0 : 0;
    ctx.font = "bold 13px 'Share Tech Mono', monospace";
    ctx.textAlign = "left"; ctx.fillStyle = "#7a6a5a"; ctx.fillText(`Score: ${myScore}`, W / 2 + 60, 19);
  }

  // Draw Room Info - Shifted left to avoid LEAVE button overlap
  ctx.fillStyle = "#7a6a5a"; ctx.textAlign = "right"; ctx.font = "bold 12px 'Share Tech Mono', monospace";
  const roomName = (state.mapData as any)?.roomName || state.roomId;
  ctx.fillText(`Room: ${state.roomId}${roomName ? ` (${roomName})` : ""}`, W - 140, 19);

  drawMinimap(ctx, canvas);
  drawChat(ctx, canvas);
  ctx.textAlign = "start";
};
