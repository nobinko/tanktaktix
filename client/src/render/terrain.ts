import type { RuntimeMapGeometry, TerrainShape } from "@tanktaktix/shared";

function withShapePath(ctx: CanvasRenderingContext2D, shape: TerrainShape, draw: () => void) {
  ctx.save();
  ctx.beginPath();
  if (shape.kind === "rect") {
    if (shape.rotation) {
      const cx = shape.x + shape.width / 2;
      const cy = shape.y + shape.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((shape.rotation * Math.PI) / 180);
      ctx.rect(-shape.width / 2, -shape.height / 2, shape.width, shape.height);
    } else {
      ctx.rect(shape.x, shape.y, shape.width, shape.height);
    }
  } else {
    const endAngle = shape.startAngle + shape.sweepAngle;
    ctx.arc(shape.cx, shape.cy, shape.outerRadius, shape.startAngle, endAngle, shape.sweepAngle < 0);
    ctx.arc(shape.cx, shape.cy, shape.innerRadius, endAngle, shape.startAngle, shape.sweepAngle >= 0);
    ctx.closePath();
  }
  draw();
  ctx.restore();
}

function drawRiverTexture(ctx: CanvasRenderingContext2D, shape: TerrainShape, now: number) {
  withShapePath(ctx, shape, () => {
    ctx.fillStyle = "rgba(50, 90, 140, 0.55)";
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = "rgba(80, 140, 200, 0.4)";
    ctx.lineWidth = 1;

    if (shape.kind === "rect") {
      const waveStep = 30;
      for (let wy = shape.y + 10; wy < shape.y + shape.height - 5; wy += 15) {
        ctx.beginPath();
        for (let wx = shape.x; wx < shape.x + shape.width; wx += waveStep) {
          const waveY = wy + Math.sin((wx - shape.x) * 0.08 + now * 0.002) * 3;
          if (wx === shape.x) ctx.moveTo(wx, waveY);
          else ctx.lineTo(wx, waveY);
        }
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(30, 60, 100, 0.3)";
      ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
      return;
    }

    const bandCount = 4;
    const span = shape.outerRadius - shape.innerRadius;
    for (let i = 1; i <= bandCount; i++) {
      const radius = shape.innerRadius + (span * i) / (bandCount + 1);
      const wobble = Math.sin(now * 0.002 + i) * 2;
      ctx.beginPath();
      ctx.arc(shape.cx, shape.cy, radius + wobble, shape.startAngle, shape.startAngle + shape.sweepAngle, shape.sweepAngle < 0);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(30, 60, 100, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(shape.cx, shape.cy, shape.outerRadius, shape.startAngle, shape.startAngle + shape.sweepAngle, shape.sweepAngle < 0);
    ctx.arc(shape.cx, shape.cy, shape.innerRadius, shape.startAngle + shape.sweepAngle, shape.startAngle, shape.sweepAngle >= 0);
    ctx.closePath();
    ctx.stroke();
  });
}

export function drawTerrainShape(ctx: CanvasRenderingContext2D, shape: TerrainShape, now = Date.now()) {
  switch (shape.terrain) {
    case "river":
      drawRiverTexture(ctx, shape, now);
      return;
    case "bush":
      withShapePath(ctx, shape, () => {
        ctx.fillStyle = "rgba(90, 120, 50, 0.5)";
        ctx.fill();
      });
      return;
    case "water":
      withShapePath(ctx, shape, () => {
        ctx.fillStyle = "rgba(70, 100, 120, 0.5)";
        ctx.fill();
      });
      return;
    case "house":
      withShapePath(ctx, shape, () => {
        ctx.fillStyle = "#c4a070";
        ctx.fill();
        ctx.strokeStyle = "#6b5a48";
        ctx.lineWidth = 4;
        ctx.stroke();
      });
      return;
    case "oneway":
      withShapePath(ctx, shape, () => {
        ctx.fillStyle = "rgba(180, 140, 40, 0.5)";
        ctx.fill();
        ctx.strokeStyle = "rgba(100, 80, 40, 0.8)";
        ctx.lineWidth = 1;
        ctx.stroke();
      });
      return;
    case "bridge":
      withShapePath(ctx, shape, () => {
        ctx.fillStyle = "#e8e0d4";
        ctx.fill();
        ctx.strokeStyle = "rgba(80, 90, 100, 0.8)";
        ctx.lineWidth = 3;
        ctx.stroke();
      });
      return;
    default:
      withShapePath(ctx, shape, () => {
        ctx.fillStyle = "#c4b4a0";
        ctx.fill();
        ctx.strokeStyle = "#8a7a68";
        ctx.lineWidth = 2;
        ctx.stroke();
      });
      return;
  }
}

export function fillTerrainShapeFlat(ctx: CanvasRenderingContext2D, shape: TerrainShape, fillStyle: string) {
  withShapePath(ctx, shape, () => {
    ctx.fillStyle = fillStyle;
    ctx.fill();
  });
}

export function getTerrainFillStyle(shape: TerrainShape): string {
  switch (shape.terrain) {
    case "bush":
      return "rgba(90, 120, 50, 0.6)";
    case "water":
      return "rgba(70, 100, 120, 0.6)";
    case "house":
      return "#c4a070";
    case "oneway":
      return "rgba(180, 140, 40, 0.6)";
    case "river":
      return "rgba(50, 90, 140, 0.6)";
    case "bridge":
      return "rgba(120, 130, 145, 0.75)";
    default:
      return "#c4b4a0";
  }
}

export function drawGeometryFlat(ctx: CanvasRenderingContext2D, geometry: RuntimeMapGeometry) {
  for (const shape of geometry.renderables) {
    if (shape.terrain !== "river") continue;
    fillTerrainShapeFlat(ctx, shape, getTerrainFillStyle(shape));
  }
  for (const shape of geometry.renderables) {
    if (shape.terrain === "river") continue;
    fillTerrainShapeFlat(ctx, shape, getTerrainFillStyle(shape));
  }
}
