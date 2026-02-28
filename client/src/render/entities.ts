import { state } from "../state";

const drawItemSprite = (ctx: CanvasRenderingContext2D, type: string) => {
  if (type === "medic") { ctx.fillStyle = "#16a34a"; ctx.fillRect(-10, -10, 20, 20); }
  else if (type === "ammo") { ctx.fillStyle = "#ca8a04"; ctx.fillRect(-10, -10, 20, 20); }
  else if (type === "heart") { ctx.fillStyle = "#ec4899"; ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill(); }
  else { ctx.fillStyle = "#374151"; ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill(); }
};

export const drawEntities = (ctx: CanvasRenderingContext2D) => {
  for (const b of state.bullets) {
    ctx.fillStyle = "#fde047";
    ctx.beginPath();
    ctx.arc(b.position.x, b.position.y, b.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const item of state.items) {
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(-state.camera.rotation);
    drawItemSprite(ctx, item.type);
    ctx.restore();
  }
  for (const p of state.players) {
    const { x, y } = (p as any).position ?? { x: (p as any).x, y: (p as any).y };
    const color = p.id === state.selfId ? "#4cc9f0" : "#f72585";
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(x - 13, y - 10, 26, 20);
    ctx.fillStyle = color;
    ctx.fillRect(x - 11, y - 8, 22, 16);
    ctx.fillStyle = "#fff";
    ctx.fillText(p.name, x + 24, y + 4);
  }
};
