import type { MapData, MapObject, PrefabType, Wall, WallType } from "./index.js";
import { PREFAB_REGISTRY } from "./prefabs.js";

export type RectTerrainShape = {
  kind: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  terrain: WallType;
  rotation?: number;
  direction?: "up" | "down" | "left" | "right";
  passable?: boolean;
};

export type RingSectorTerrainShape = {
  kind: "ringSector";
  cx: number;
  cy: number;
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
  sweepAngle: number;
  terrain: "river";
  passable?: boolean;
};

export type TerrainShape = RectTerrainShape | RingSectorTerrainShape;

export type RuntimeMapGeometry = {
  renderables: TerrainShape[];
  blocking: TerrainShape[];
  bulletBlocking: TerrainShape[];
  concealment: TerrainShape[];
  passable: TerrainShape[];
};

const RIVER_WIDTH = 80;
const BUSH_SIZE = 80;
const RIVER_ELBOW_RADII: Partial<Record<PrefabType, number>> = {
  "river-elbow-gentle-s": 300,
  "river-elbow-gentle-l": 500,
  "river-elbow-mid-s": 200,
  "river-elbow-mid-l": 350,
  "river-elbow-sharp-s": 120,
  "river-elbow-sharp-l": 180,
};

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function rotatePoint(px: number, py: number, angle: number): { x: number; y: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: px * cos - py * sin,
    y: px * sin + py * cos,
  };
}

function wallToRectShape(wall: Wall): RectTerrainShape {
  return {
    kind: "rect",
    x: wall.x,
    y: wall.y,
    width: wall.width,
    height: wall.height,
    terrain: wall.type ?? "wall",
    rotation: wall.rotation,
    direction: wall.direction,
    passable: wall.passable,
  };
}

function pushShape(shape: TerrainShape, out: RuntimeMapGeometry) {
  out.renderables.push(shape);

  if (shape.passable) {
    out.passable.push(shape);
  }

  if (shape.terrain === "bush") {
    out.concealment.push(shape);
  }

  if (!shape.passable) {
    if (
      shape.terrain === "wall" ||
      shape.terrain === "water" ||
      shape.terrain === "house" ||
      shape.terrain === "oneway" ||
      shape.terrain === "river"
    ) {
      out.blocking.push(shape);
    }

    if (shape.kind === "rect" && (shape.terrain === "wall" || shape.terrain === "house" || shape.terrain === "oneway")) {
      out.bulletBlocking.push(shape);
    }
  }
}

function objectToShapes(obj: MapObject): TerrainShape[] {
  if (obj.type === "bush") {
    return [{
      kind: "rect",
      x: obj.x - BUSH_SIZE / 2,
      y: obj.y - BUSH_SIZE / 2,
      width: BUSH_SIZE,
      height: BUSH_SIZE,
      terrain: "bush",
    }];
  }

  const elbowRadius = RIVER_ELBOW_RADII[obj.type];
  if (elbowRadius != null) {
    const rotation = degToRad(obj.rotation ?? 0);
    const centerOffset = rotatePoint(0, -elbowRadius, rotation);
    return [{
      kind: "ringSector",
      cx: obj.x + centerOffset.x,
      cy: obj.y + centerOffset.y,
      innerRadius: elbowRadius - RIVER_WIDTH / 2,
      outerRadius: elbowRadius + RIVER_WIDTH / 2,
      startAngle: rotation + Math.PI / 2,
      sweepAngle: -Math.PI / 4,
      terrain: "river",
    }];
  }

  const def = PREFAB_REGISTRY[obj.type];
  if (!def) return [];

  const objRotRad = degToRad(obj.rotation ?? 0);
  return def.parts.map((part) => {
    const rotated = rotatePoint(part.dx, part.dy, objRotRad);
    return {
      kind: "rect",
      x: obj.x + rotated.x - part.width / 2,
      y: obj.y + rotated.y - part.height / 2,
      width: part.width,
      height: part.height,
      terrain: part.wallType,
      rotation: (obj.rotation ?? 0) + (part.partRotation ?? 0) || undefined,
      passable: part.passable,
    } satisfies RectTerrainShape;
  });
}

export function compileMapGeometry(mapData: MapData): RuntimeMapGeometry {
  const geometry: RuntimeMapGeometry = {
    renderables: [],
    blocking: [],
    bulletBlocking: [],
    concealment: [],
    passable: [],
  };

  for (const wall of mapData.walls) {
    pushShape(wallToRectShape(wall), geometry);
  }

  for (const bush of mapData.dynamicBushes ?? []) {
    pushShape({
      kind: "rect",
      x: bush.x - BUSH_SIZE / 2,
      y: bush.y - BUSH_SIZE / 2,
      width: BUSH_SIZE,
      height: BUSH_SIZE,
      terrain: "bush",
    }, geometry);
  }

  for (const obj of mapData.objects ?? []) {
    for (const shape of objectToShapes(obj)) {
      pushShape(shape, geometry);
    }
  }

  return geometry;
}
