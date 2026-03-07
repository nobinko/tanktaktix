import { state } from "../state.js";

/**
 * 壁の描画（回転対応）
 * rotation が設定されている壁は ctx.rotate() で回転描画する。
 */
function drawWall(ctx: CanvasRenderingContext2D, w: any) {
  const type = w.type || "wall";
  const hasRotation = w.rotation !== undefined && w.rotation !== 0;

  if (hasRotation) {
    // 回転壁: 中心を基準に回転して描画
    const cx = w.x + w.width / 2;
    const cy = w.y + w.height / 2;
    const rad = (w.rotation * Math.PI) / 180;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rad);
    drawWallShape(ctx, -w.width / 2, -w.height / 2, w.width, w.height, type, w.direction);
    ctx.restore();
  } else {
    // 通常壁: そのまま描画
    drawWallShape(ctx, w.x, w.y, w.width, w.height, type, w.direction);
  }
}

/**
 * 壁タイプ別の描画
 */
function drawWallShape(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, type: string, direction?: string) {
  // 塗り色
  switch (type) {
    case "bush":
      ctx.fillStyle = "rgba(90, 120, 50, 0.5)";
      break;
    case "water":
      ctx.fillStyle = "rgba(70, 100, 120, 0.5)";
      break;
    case "house":
      ctx.fillStyle = "#c4a070";
      break;
    case "oneway":
      ctx.fillStyle = "rgba(180, 140, 40, 0.5)";
      break;
    case "river":
      ctx.fillStyle = "rgba(50, 90, 140, 0.55)";
      break;
    case "bridge":
      // まず地面色で不透明に下地を塗ってリバーを隠す
      ctx.fillStyle = "#e8e0d4";
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = "rgba(120, 130, 145, 0.7)";
      break;
    default: // "wall"
      ctx.fillStyle = "#c4b4a0";
      break;
  }

  ctx.fillRect(x, y, w, h);

  // タイプ別の装飾
  switch (type) {
    case "wall":
      ctx.strokeStyle = "#8a7a68";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      break;

    case "house":
      ctx.strokeStyle = "#6b5a48";
      ctx.lineWidth = 4;
      ctx.strokeRect(x, y, w, h);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + h);
      ctx.moveTo(x + w, y);
      ctx.lineTo(x, y + h);
      ctx.stroke();
      break;

    case "oneway": {
      ctx.fillStyle = "rgba(100, 80, 40, 0.8)";
      const cx = x + w / 2;
      const cy = y + h / 2;
      ctx.save();
      ctx.translate(cx, cy);
      if (direction === "up") ctx.rotate(-Math.PI / 2);
      else if (direction === "down") ctx.rotate(Math.PI / 2);
      else if (direction === "left") ctx.rotate(Math.PI);
      // direction === "right" or rotation-based: no additional rotation
      ctx.beginPath();
      ctx.moveTo(-10, -10);
      ctx.lineTo(10, 0);
      ctx.lineTo(-10, 10);
      ctx.fill();
      ctx.restore();
      break;
    }

    case "river":
      // 波パターン
      ctx.strokeStyle = "rgba(80, 140, 200, 0.4)";
      ctx.lineWidth = 1;
      const waveStep = 30;
      for (let wy = y + 10; wy < y + h - 5; wy += 15) {
        ctx.beginPath();
        for (let wx = x; wx < x + w; wx += waveStep) {
          const waveY = wy + Math.sin((wx - x) * 0.08 + Date.now() * 0.002) * 3;
          if (wx === x) ctx.moveTo(wx, waveY);
          else ctx.lineTo(wx, waveY);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(30, 60, 100, 0.3)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
      break;

    case "bridge":
      // メタリック調の描画
      ctx.strokeStyle = "rgba(140, 150, 160, 0.4)";
      ctx.lineWidth = 1;
      // リベット風の横線
      for (let by = y + 10; by < y + h; by += 14) {
        ctx.beginPath();
        ctx.moveTo(x + 4, by);
        ctx.lineTo(x + w - 4, by);
        ctx.stroke();
      }
      // メタルフレーム枠
      ctx.strokeStyle = "rgba(80, 90, 100, 0.8)";
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, w, h);
      // 内側ハイライト
      ctx.strokeStyle = "rgba(200, 210, 220, 0.2)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
      break;
  }
}

export const drawWorld = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(state.camera.rotation);
  ctx.scale(state.camera.zoom, state.camera.zoom);
  ctx.translate(-state.camera.x - state.mapSize.width / 2, -state.camera.y - state.mapSize.height / 2);

  // マップ外（画面全体）の背景として、カメラから見える最大範囲を十分覆う巨大な矩形を描画
  const overdraw = 3000;
  ctx.fillStyle = "#a89f91";
  ctx.fillRect(-overdraw, -overdraw, state.mapSize.width + overdraw * 2, state.mapSize.height + overdraw * 2);

  // マップ内の背景色
  ctx.fillStyle = "#e8e0d4";
  ctx.fillRect(0, 0, state.mapSize.width, state.mapSize.height);

  // グリッド線
  ctx.strokeStyle = "rgba(160, 130, 80, 0.08)";
  for (let x = 0; x <= state.mapSize.width; x += 60) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, state.mapSize.height); ctx.stroke();
  }
  for (let y = 0; y <= state.mapSize.height; y += 60) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(state.mapSize.width, y); ctx.stroke();
  }

  // マップの境界枠
  ctx.strokeStyle = "#8a7a68";
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, state.mapSize.width, state.mapSize.height);

  if (state.mapData && state.mapData.walls) {
    // パス1: リバーを先に描画
    for (const w of state.mapData.walls) {
      if ((w.type || "wall") === "river") drawWall(ctx, w);
    }
    // パス2: リバー以外を描画（ブリッジがリバーを不透明に上書き）
    for (const w of state.mapData.walls) {
      if ((w.type || "wall") !== "river") drawWall(ctx, w);
    }
  }

  if (state.mapData && state.mapData.spawnPoints) {
    const now = Date.now();
    const pulse = Math.sin(now * 0.004) * 0.5 + 0.5;
    const ZONE_W = 200, ZONE_H = 200;
    for (const sp of state.mapData.spawnPoints) {
      const spColor = sp.team === "red" ? "#c44040" : sp.team === "blue" ? "#4a6a8a" : "#7a6a5a";
      const spColorRgb = sp.team === "red" ? "196,64,64" : sp.team === "blue" ? "74,106,138" : "122,106,90";
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
