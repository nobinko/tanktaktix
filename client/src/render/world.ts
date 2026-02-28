import { state } from "../state.js";

export const drawWorld = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#1e1a14";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(state.camera.rotation);
  ctx.scale(state.camera.zoom, state.camera.zoom);
  ctx.translate(-state.camera.x - state.mapSize.width / 2, -state.camera.y - state.mapSize.height / 2);

  ctx.strokeStyle = "rgba(184, 150, 62, 0.06)";
  for (let x = 0; x < state.mapSize.width; x += 60) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, state.mapSize.height); ctx.stroke();
  }
  for (let y = 0; y < state.mapSize.height; y += 60) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(state.mapSize.width, y); ctx.stroke();
  }

  if (state.mapData && state.mapData.walls) {
    for (const w of state.mapData.walls) {
      const type = (w as any).type || "wall";
      if (type === "bush") ctx.fillStyle = "rgba(90, 120, 50, 0.4)";
      else if (type === "water") ctx.fillStyle = "rgba(70, 100, 120, 0.4)";
      else if (type === "house") ctx.fillStyle = "#6b4420";
      else if (type === "oneway") ctx.fillStyle = "rgba(200, 160, 60, 0.4)";
      else ctx.fillStyle = "#4a4035";

      ctx.fillRect(w.x, w.y, w.width, w.height);

      if (type === "wall") {
        ctx.strokeStyle = "#6b5d4a"; ctx.lineWidth = 2; ctx.strokeRect(w.x, w.y, w.width, w.height);
      } else if (type === "house") {
        ctx.strokeStyle = "#4a2e10"; ctx.lineWidth = 4; ctx.strokeRect(w.x, w.y, w.width, w.height);
        ctx.beginPath(); ctx.moveTo(w.x, w.y); ctx.lineTo(w.x + w.width, w.y + w.height);
        ctx.moveTo(w.x + w.width, w.y); ctx.lineTo(w.x, w.y + w.height); ctx.stroke();
      } else if (type === "oneway") {
        ctx.fillStyle = "rgba(232, 220, 200, 0.8)";
        const dir = (w as any).direction;
        const cx = w.x + w.width / 2; const cy = w.y + w.height / 2;
        ctx.save(); ctx.translate(cx, cy);
        if (dir === "up") ctx.rotate(-Math.PI / 2);
        else if (dir === "down") ctx.rotate(Math.PI / 2);
        else if (dir === "left") ctx.rotate(Math.PI);
        ctx.beginPath(); ctx.moveTo(-10, -10); ctx.lineTo(10, 0); ctx.lineTo(-10, 10); ctx.fill();
        ctx.restore();
      }
    }
  }

  if (state.mapData && state.mapData.spawnPoints) {
    const now = Date.now();
    const pulse = Math.sin(now * 0.004) * 0.5 + 0.5;
    const ZONE_W = 200, ZONE_H = 200;
    for (const sp of state.mapData.spawnPoints) {
      const spColor = sp.team === "red" ? "#c44040" : sp.team === "blue" ? "#4a6a8a" : "#a89878";
      const spColorRgb = sp.team === "red" ? "196,64,64" : sp.team === "blue" ? "74,106,138" : "168,152,120";
      const zx = sp.x - ZONE_W / 2; const zy = sp.y - ZONE_H / 2;

      ctx.save(); ctx.strokeStyle = `rgba(${spColorRgb}, ${0.15 + pulse * 0.25})`; ctx.lineWidth = 2;
      ctx.strokeRect(zx - 4 - pulse * 3, zy - 4 - pulse * 3, ZONE_W + 8 + pulse * 6, ZONE_H + 8 + pulse * 6);
      ctx.restore();

      ctx.fillStyle = `rgba(${spColorRgb}, 0.15)`; ctx.fillRect(zx, zy, ZONE_W, ZONE_H);
      ctx.strokeStyle = spColor; ctx.lineWidth = 1.5; ctx.strokeRect(zx, zy, ZONE_W, ZONE_H);

      const cb = 8; ctx.strokeStyle = `rgba(${spColorRgb}, 0.7)`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(zx, zy + cb); ctx.lineTo(zx, zy); ctx.lineTo(zx + cb, zy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(zx + ZONE_W - cb, zy); ctx.lineTo(zx + ZONE_W, zy); ctx.lineTo(zx + ZONE_W, zy + cb); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(zx, zy + ZONE_H - cb); ctx.lineTo(zx, zy + ZONE_H); ctx.lineTo(zx + cb, zy + ZONE_H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(zx + ZONE_W - cb, zy + ZONE_H); ctx.lineTo(zx + ZONE_W, zy + ZONE_H); ctx.lineTo(zx + ZONE_W, zy + ZONE_H - cb); ctx.stroke();

      ctx.save(); ctx.translate(sp.x, sp.y); ctx.rotate(-state.camera.rotation);
      ctx.font = "bold 9px 'Share Tech Mono', monospace"; ctx.textAlign = "center";
      ctx.fillStyle = `rgba(${spColorRgb}, 0.6)`; ctx.fillText("SPAWN", 0, 4);
      ctx.restore();
    }
  }
};

export const finishWorld = (ctx: CanvasRenderingContext2D) => ctx.restore();
