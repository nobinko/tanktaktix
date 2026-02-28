import { state } from "../state";

export const drawEffects = (ctx: CanvasRenderingContext2D) => {
  const now = Date.now();
  state.explosions = state.explosions.filter(e => now - e.startedAt < 500);
  for (const e of state.explosions) {
    const progress = (now - e.startedAt) / 500;
    if (progress > 1) continue;
    const r = e.radius || 40;
    ctx.fillStyle = `rgba(212, 168, 67, ${1 - progress})`;
    ctx.beginPath(); ctx.arc(e.x, e.y, r * (0.5 + progress * 0.5), 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(184, 80, 30, ${1 - progress})`;
    ctx.lineWidth = 4 * (1 - progress); ctx.stroke();
  }

  const dt = 1 / 60;
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.life -= dt / p.maxLife;
    if (p.life <= 0) {
      state.particles.splice(i, 1);
      continue;
    }
    p.x += p.vx; p.y += p.vy;
    p.vx *= 0.92; p.vy *= 0.92;
    ctx.fillStyle = p.color;
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;
  }

  const FCT_DURATION = 1000;
  state.floatingTexts = state.floatingTexts.filter(ft => now - ft.startedAt < FCT_DURATION);
  for (const ft of state.floatingTexts) {
    const progress = (now - ft.startedAt) / FCT_DURATION;
    const currentY = ft.y - (progress * 30);
    ctx.save();
    ctx.translate(ft.x, currentY); ctx.rotate(-state.camera.rotation);
    ctx.globalAlpha = 1 - Math.pow(progress, 1.5);
    ctx.font = "bold 16px 'Bitter', serif"; ctx.textAlign = "center";
    ctx.lineWidth = 3; ctx.strokeStyle = "#000"; ctx.strokeText(ft.text, 0, 0);
    ctx.fillStyle = ft.color; ctx.fillText(ft.text, 0, 0);
    ctx.restore();
  }
};
