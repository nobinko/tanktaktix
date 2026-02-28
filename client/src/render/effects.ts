import { state } from "../state";

export const drawEffects = (ctx: CanvasRenderingContext2D) => {
  state.explosions = state.explosions.filter((e) => Date.now() - e.startedAt < 500);
  for (const e of state.explosions) {
    const progress = (Date.now() - e.startedAt) / 500;
    if (progress > 1) continue;
    ctx.fillStyle = `rgba(255, 165, 0, ${1 - progress})`;
    ctx.beginPath();
    ctx.arc(e.x, e.y, (e.radius || 40) * (0.5 + progress * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
};
