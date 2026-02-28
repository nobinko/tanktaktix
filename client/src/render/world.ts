import { mapSize, state } from "../state";

export const drawWorld = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0b132b";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(state.camera.rotation);
  ctx.scale(state.camera.zoom, state.camera.zoom);
  ctx.translate(-state.camera.x - mapSize.width / 2, -state.camera.y - mapSize.height / 2);

  if (state.mapData) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, state.mapData.width, state.mapData.height);
    for (const w of state.mapData.walls) {
      const type = (w as any).type || "wall";
      if (type === "bush") ctx.fillStyle = "#16a34a";
      else if (type === "water") ctx.fillStyle = "#2563eb";
      else if (type === "house") ctx.fillStyle = "#8b4513";
      else if (type === "oneway") ctx.fillStyle = "#f97316";
      else ctx.fillStyle = "#475569";
      ctx.fillRect(w.x, w.y, w.width, w.height);
    }
  }
};

export const finishWorld = (ctx: CanvasRenderingContext2D) => ctx.restore();
