/**
 * Tileset asset loader.
 * Loads terrain tile textures from a single spritesheet and creates
 * CanvasPattern objects for each terrain type.
 */

type TerrainType = "wall" | "bush" | "water" | "house" | "oneway" | "ground";

/** Source regions within tileset.png (1024×559, 4 cols × 3 rows) */
const COL_W = 256;
const ROW_H = 186; // ~559/3

const TILE_REGIONS: Record<TerrainType, { sx: number; sy: number; sw: number; sh: number }> = {
  wall:   { sx: 0,           sy: 0,           sw: COL_W, sh: ROW_H },
  bush:   { sx: COL_W,       sy: 0,           sw: COL_W, sh: ROW_H },
  water:  { sx: COL_W * 2,   sy: 0,           sw: COL_W, sh: ROW_H },
  house:  { sx: COL_W * 2,   sy: ROW_H,       sw: COL_W, sh: ROW_H },
  oneway: { sx: COL_W * 2,   sy: ROW_H * 2,   sw: COL_W, sh: ROW_H },
  ground: { sx: COL_W * 3,   sy: ROW_H * 2,   sw: COL_W, sh: ROW_H },
};

/** Pattern tile size in world pixels (matches grid spacing) */
const PATTERN_SIZE = 60;

const patterns: Partial<Record<TerrainType, CanvasPattern>> = {};
let loaded = false;

function extractPattern(
  img: HTMLImageElement,
  region: { sx: number; sy: number; sw: number; sh: number },
): CanvasPattern | null {
  const off = document.createElement("canvas");
  off.width = PATTERN_SIZE;
  off.height = PATTERN_SIZE;
  const c = off.getContext("2d");
  if (!c) return null;
  c.drawImage(img, region.sx, region.sy, region.sw, region.sh, 0, 0, PATTERN_SIZE, PATTERN_SIZE);
  return c.createPattern(off, "repeat");
}

export function loadAssets(): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      for (const [type, region] of Object.entries(TILE_REGIONS)) {
        const pat = extractPattern(img, region);
        if (pat) patterns[type as TerrainType] = pat;
      }
      loaded = true;
      resolve();
    };
    img.onerror = () => {
      console.warn("[assets] Failed to load tileset.png — using fallback colors");
      resolve(); // graceful fallback
    };
    img.src = "/assets/tileset.png";
  });
}

export function getPattern(type: TerrainType): CanvasPattern | null {
  return patterns[type] ?? null;
}

export function isLoaded(): boolean {
  return loaded;
}
