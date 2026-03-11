/**
 * カスタムマップデータのバリデーション
 *
 * クライアント / サーバー両方で使う共通バリデーション関数。
 */
import type { MapData, Wall, MapObject, WallType, ItemType } from "./index.js";
import { PREFAB_REGISTRY } from "./prefabs.js";

// ---------------------------------------------------------------------------
// 定数（prefabs.ts からも参照される）
// ---------------------------------------------------------------------------

export const MAX_OBJECTS = 100;
export const MAX_WALLS_TOTAL = 500;

const MIN_MAP_SIZE = 200;
const MAX_MAP_SIZE = 10000;

const VALID_WALL_TYPES: readonly string[] = ["wall", "bush", "water", "house", "oneway", "river", "bridge"];
const VALID_DIRECTIONS: readonly string[] = ["up", "down", "left", "right"];
const VALID_ITEM_TYPES: readonly string[] = ["medic", "ammo", "heart", "bomb", "rope", "boots", "smoke"];

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { valid: true; data: MapData }
  | { valid: false; errors: string[] };

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// エラー配列の wall/object index ごとのメッセージが膨れすぎないように制限
const MAX_ELEMENT_ERRORS = 20;

// ---------------------------------------------------------------------------
// メイン
// ---------------------------------------------------------------------------

export function validateMapData(input: unknown): ValidationResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { valid: false, errors: ["Map data must be a JSON object"] };
  }

  const obj = input as Record<string, unknown>;
  const errors: string[] = [];

  // --- dimensions ---
  if (!isFiniteNumber(obj.width) || obj.width < MIN_MAP_SIZE || obj.width > MAX_MAP_SIZE) {
    errors.push(`width must be a number between ${MIN_MAP_SIZE} and ${MAX_MAP_SIZE}`);
  }
  if (!isFiniteNumber(obj.height) || obj.height < MIN_MAP_SIZE || obj.height > MAX_MAP_SIZE) {
    errors.push(`height must be a number between ${MIN_MAP_SIZE} and ${MAX_MAP_SIZE}`);
  }

  const width = isFiniteNumber(obj.width) ? obj.width : 0;
  const height = isFiniteNumber(obj.height) ? obj.height : 0;

  // --- id (optional, auto-generate if missing) ---
  const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : `custom-${Date.now()}`;

  // --- walls ---
  if (!Array.isArray(obj.walls)) {
    errors.push("walls must be an array");
  } else {
    if (obj.walls.length > MAX_WALLS_TOTAL) {
      errors.push(`walls count (${obj.walls.length}) exceeds maximum of ${MAX_WALLS_TOTAL}`);
    }
    let wallErrors = 0;
    for (let i = 0; i < Math.min(obj.walls.length, MAX_WALLS_TOTAL); i++) {
      if (wallErrors >= MAX_ELEMENT_ERRORS) {
        errors.push(`... and more wall errors (stopped after ${MAX_ELEMENT_ERRORS})`);
        break;
      }
      const w = obj.walls[i];
      if (typeof w !== "object" || w === null) {
        errors.push(`walls[${i}]: must be an object`);
        wallErrors++;
        continue;
      }
      const wObj = w as Record<string, unknown>;
      if (!isFiniteNumber(wObj.x)) { errors.push(`walls[${i}]: x must be a finite number`); wallErrors++; }
      if (!isFiniteNumber(wObj.y)) { errors.push(`walls[${i}]: y must be a finite number`); wallErrors++; }
      if (!isFiniteNumber(wObj.width) || (wObj.width as number) <= 0) { errors.push(`walls[${i}]: width must be a positive number`); wallErrors++; }
      if (!isFiniteNumber(wObj.height) || (wObj.height as number) <= 0) { errors.push(`walls[${i}]: height must be a positive number`); wallErrors++; }
      if (wObj.type !== undefined && (typeof wObj.type !== "string" || !VALID_WALL_TYPES.includes(wObj.type))) {
        errors.push(`walls[${i}]: type must be one of: ${VALID_WALL_TYPES.join(", ")}`);
        wallErrors++;
      }
      if (wObj.direction !== undefined && (typeof wObj.direction !== "string" || !VALID_DIRECTIONS.includes(wObj.direction))) {
        errors.push(`walls[${i}]: direction must be one of: ${VALID_DIRECTIONS.join(", ")}`);
        wallErrors++;
      }
      if (wObj.rotation !== undefined && !isFiniteNumber(wObj.rotation)) {
        errors.push(`walls[${i}]: rotation must be a finite number`);
        wallErrors++;
      }
      if (wObj.passable !== undefined && typeof wObj.passable !== "boolean") {
        errors.push(`walls[${i}]: passable must be a boolean`);
        wallErrors++;
      }
    }
  }

  // --- spawnPoints ---
  if (!Array.isArray(obj.spawnPoints)) {
    errors.push("spawnPoints must be an array");
  } else {
    if (obj.spawnPoints.length < 2) {
      errors.push("spawnPoints needs at least 2 entries");
    }
    let hasRed = false;
    let hasBlue = false;
    for (let i = 0; i < obj.spawnPoints.length; i++) {
      const sp = obj.spawnPoints[i];
      if (typeof sp !== "object" || sp === null) {
        errors.push(`spawnPoints[${i}]: must be an object`);
        continue;
      }
      const spObj = sp as Record<string, unknown>;
      if (spObj.team !== "red" && spObj.team !== "blue") {
        errors.push(`spawnPoints[${i}]: team must be "red" or "blue"`);
      } else {
        if (spObj.team === "red") hasRed = true;
        if (spObj.team === "blue") hasBlue = true;
      }
      if (!isFiniteNumber(spObj.x)) {
        errors.push(`spawnPoints[${i}]: x must be a finite number`);
      } else if (width > 0 && (spObj.x < 0 || spObj.x > width)) {
        errors.push(`spawnPoints[${i}]: x=${spObj.x} is outside map bounds (0-${width})`);
      }
      if (!isFiniteNumber(spObj.y)) {
        errors.push(`spawnPoints[${i}]: y must be a finite number`);
      } else if (height > 0 && (spObj.y < 0 || spObj.y > height)) {
        errors.push(`spawnPoints[${i}]: y=${spObj.y} is outside map bounds (0-${height})`);
      }
      if (spObj.radius !== undefined && (!isFiniteNumber(spObj.radius) || (spObj.radius as number) <= 0)) {
        errors.push(`spawnPoints[${i}]: radius must be a positive number`);
      }
    }
    if (obj.spawnPoints.length >= 2 && (!hasRed || !hasBlue)) {
      errors.push('spawnPoints must include at least one "red" and one "blue" team spawn');
    }
  }

  // --- flagPositions (optional) ---
  if (obj.flagPositions !== undefined) {
    if (!Array.isArray(obj.flagPositions)) {
      errors.push("flagPositions must be an array");
    } else if (obj.flagPositions.length === 0) {
      errors.push("flagPositions cannot be empty (omit the field to use spawnPoints as defaults)");
    } else {
      let hasRedFlag = false;
      let hasBlueFlag = false;
      for (let i = 0; i < obj.flagPositions.length; i++) {
        const fp = obj.flagPositions[i];
        if (typeof fp !== "object" || fp === null) {
          errors.push(`flagPositions[${i}]: must be an object`);
          continue;
        }
        const fpObj = fp as Record<string, unknown>;
        if (fpObj.team !== "red" && fpObj.team !== "blue") {
          errors.push(`flagPositions[${i}]: team must be "red" or "blue"`);
        } else {
          if (fpObj.team === "red") hasRedFlag = true;
          if (fpObj.team === "blue") hasBlueFlag = true;
        }
        if (!isFiniteNumber(fpObj.x)) {
          errors.push(`flagPositions[${i}]: x must be a finite number`);
        } else if (width > 0 && (fpObj.x < 0 || fpObj.x > width)) {
          errors.push(`flagPositions[${i}]: x is outside map bounds`);
        }
        if (!isFiniteNumber(fpObj.y)) {
          errors.push(`flagPositions[${i}]: y must be a finite number`);
        } else if (height > 0 && (fpObj.y < 0 || fpObj.y > height)) {
          errors.push(`flagPositions[${i}]: y is outside map bounds`);
        }
      }
      if (!hasRedFlag || !hasBlueFlag) {
        errors.push('flagPositions must include at least one "red" and one "blue" flag');
      }
    }
  }

  // --- objects (optional) ---
  if (obj.objects !== undefined) {
    if (!Array.isArray(obj.objects)) {
      errors.push("objects must be an array");
    } else {
      if (obj.objects.length > MAX_OBJECTS) {
        errors.push(`objects count (${obj.objects.length}) exceeds maximum of ${MAX_OBJECTS}`);
      }
      const validPrefabTypes = Object.keys(PREFAB_REGISTRY);
      let objErrors = 0;
      for (let i = 0; i < Math.min(obj.objects.length, MAX_OBJECTS); i++) {
        if (objErrors >= MAX_ELEMENT_ERRORS) {
          errors.push(`... and more object errors (stopped after ${MAX_ELEMENT_ERRORS})`);
          break;
        }
        const o = obj.objects[i];
        if (typeof o !== "object" || o === null) {
          errors.push(`objects[${i}]: must be an object`);
          objErrors++;
          continue;
        }
        const oObj = o as Record<string, unknown>;
        if (typeof oObj.type !== "string" || !validPrefabTypes.includes(oObj.type)) {
          errors.push(`objects[${i}]: unknown prefab type "${oObj.type}"`);
          objErrors++;
        }
        if (!isFiniteNumber(oObj.x)) { errors.push(`objects[${i}]: x must be a finite number`); objErrors++; }
        if (!isFiniteNumber(oObj.y)) { errors.push(`objects[${i}]: y must be a finite number`); objErrors++; }
        if (oObj.rotation !== undefined && !isFiniteNumber(oObj.rotation)) {
          errors.push(`objects[${i}]: rotation must be a finite number`);
          objErrors++;
        }
      }
    }
  }

  // --- itemMode (optional) ---
  if (obj.itemMode !== undefined && obj.itemMode !== "random" && obj.itemMode !== "manual") {
    errors.push('itemMode must be "random" or "manual"');
  }

  // --- itemSpawns (optional) ---
  if (obj.itemSpawns !== undefined) {
    if (!Array.isArray(obj.itemSpawns)) {
      errors.push("itemSpawns must be an array");
    } else {
      for (let i = 0; i < obj.itemSpawns.length; i++) {
        const is = obj.itemSpawns[i];
        if (typeof is !== "object" || is === null) {
          errors.push(`itemSpawns[${i}]: must be an object`);
          continue;
        }
        const isObj = is as Record<string, unknown>;
        if (!isFiniteNumber(isObj.x)) errors.push(`itemSpawns[${i}]: x must be a number`);
        if (!isFiniteNumber(isObj.y)) errors.push(`itemSpawns[${i}]: y must be a number`);
        if (typeof isObj.type !== "string" || !VALID_ITEM_TYPES.includes(isObj.type)) {
          errors.push(`itemSpawns[${i}]: type must be one of: ${VALID_ITEM_TYPES.join(", ")}`);
        }
      }
    }
  }

  // --- 結果 ---
  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // 検証済みデータを安全に構築（as キャスト不要）
  const validatedWalls: Wall[] = (obj.walls as any[]).map((w: any) => {
    const wall: Wall = { x: w.x, y: w.y, width: w.width, height: w.height };
    if (w.type) wall.type = w.type as WallType;
    if (w.direction) wall.direction = w.direction;
    if (w.rotation !== undefined) wall.rotation = w.rotation;
    if (w.passable !== undefined) wall.passable = w.passable;
    return wall;
  });

  const data: MapData = {
    id,
    width: obj.width as number,
    height: obj.height as number,
    walls: validatedWalls,
    spawnPoints: (obj.spawnPoints as any[]).map((sp: any) => {
      const point: { team: "red" | "blue"; x: number; y: number; radius?: number } = {
        team: sp.team,
        x: sp.x,
        y: sp.y,
      };
      if (sp.radius) point.radius = sp.radius;
      return point;
    }),
  };

  if (Array.isArray(obj.flagPositions) && obj.flagPositions.length > 0) {
    data.flagPositions = (obj.flagPositions as any[]).map((fp: any) => ({
      team: fp.team,
      x: fp.x,
      y: fp.y,
    }));
  }
  if (Array.isArray(obj.objects) && obj.objects.length > 0) {
    data.objects = (obj.objects as any[]).slice(0, MAX_OBJECTS).map((o: any) => {
      const mo: MapObject = { type: o.type, x: o.x, y: o.y };
      if (o.rotation !== undefined) mo.rotation = o.rotation;
      return mo;
    });
  }
  if (Array.isArray(obj.dynamicBushes) && obj.dynamicBushes.length > 0) {
    data.dynamicBushes = obj.dynamicBushes as { x: number; y: number }[];
  }
  if (obj.itemMode === "random" || obj.itemMode === "manual") {
    data.itemMode = obj.itemMode;
  }
  if (Array.isArray(obj.itemSpawns) && obj.itemSpawns.length > 0) {
    data.itemSpawns = (obj.itemSpawns as any[]).map((is: any) => ({
      x: is.x,
      y: is.y,
      type: is.type as ItemType,
    }));
  }

  return { valid: true, data };
}
