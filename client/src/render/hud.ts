import { state } from "../state";

export const drawHud = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
  ctx.resetTransform();
  ctx.fillStyle = "#fff";
  ctx.font = "14px monospace";
  ctx.fillText(`Time left: ${state.timeLeftSec}s`, 12, 20);
  const messages = state.chat.slice(-8);
  const lineHeight = 16;
  const bottomY = canvas.height - 40;
  const startX = 10;
  ctx.font = "12px 'Segoe UI', Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  messages.forEach((msg, i) => {
    const y = bottomY - ((messages.length - 1 - i) * lineHeight);
    const text = `${msg.from}: ${msg.message}`;
    const width = ctx.measureText(text).width;
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(startX - 2, y - lineHeight + 2, width + 4, lineHeight);
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillText(text, startX, y);
  });
};
