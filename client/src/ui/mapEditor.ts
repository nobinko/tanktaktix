import type { Wall, MapData, ItemType, WallType, PrefabType, MapObject } from "@tanktaktix/shared";
import { expandMapObjects } from "@tanktaktix/shared";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SymmetryMode = "none" | "h" | "v" | "point";
type ResizeHandle = "tl" | "tm" | "tr" | "ml" | "mr" | "bl" | "bm" | "br";

type WallTool   = { kind: "wall";   wallType: WallType };
type SpawnTool  = { kind: "spawn";  team: "red" | "blue" };
type FlagTool   = { kind: "flag";   team: "red" | "blue" };
type ItemTool   = { kind: "item";   itemType: ItemType };
type PrefabTool = { kind: "prefab"; prefabType: PrefabType };
type PaletteTool = WallTool | SpawnTool | FlagTool | ItemTool | PrefabTool;

type SpawnPoint   = { team: "red" | "blue"; x: number; y: number; radius: number };
type FlagPosition = { team: "red" | "blue"; x: number; y: number };
type ItemSpawn    = { x: number; y: number; type: ItemType };

type SelectedIdx =
  | { category: "wall";   index: number }
  | { category: "spawn";  index: number }
  | { category: "flag";   index: number }
  | { category: "item";   index: number }
  | { category: "object"; index: number };

type ActiveInteraction =
  | { type: "move";   idx: SelectedIdx; offsetX: number; offsetY: number }
  | { type: "resize"; wallIndex: number; handle: ResizeHandle; initialWall: Wall; initMx: number; initMy: number };

type EditorSnapshot = {
  walls: Wall[];
  spawnPoints: SpawnPoint[];
  flagPositions: FlagPosition[];
  itemSpawns: ItemSpawn[];
  objects: MapObject[];
};

interface EditorState {
  mapWidth: number;
  mapHeight: number;
  walls: Wall[];
  spawnPoints: SpawnPoint[];
  flagPositions: FlagPosition[];
  itemSpawns: ItemSpawn[];
  objects: MapObject[];

  activeTool: PaletteTool | null;
  selectedIdx: SelectedIdx | null;
  symmetryMode: SymmetryMode;
  activeRotation: number;
  snapEnabled: boolean;
  gridSize: number;

  isDrawing: boolean;
  drawStartWorld: { x: number; y: number } | null;
  activeInteraction: ActiveInteraction | null;

  undoStack: EditorSnapshot[];
  redoStack: EditorSnapshot[];

  panX: number; panY: number; zoom: number;
  isPanning: boolean; panLastX: number; panLastY: number; spaceDown: boolean;
  mouseWorldX: number; mouseWorldY: number;
  mouseScreenX: number; mouseScreenY: number;
  rafId: number | null;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

const es: EditorState = {
  mapWidth: 1600, mapHeight: 1200,
  walls: [], spawnPoints: [], flagPositions: [], itemSpawns: [], objects: [],
  activeTool: null, selectedIdx: null,
  symmetryMode: "none", activeRotation: 0, snapEnabled: false, gridSize: 50,
  isDrawing: false, drawStartWorld: null, activeInteraction: null,
  undoStack: [], redoStack: [],
  panX: 0, panY: 0, zoom: 1,
  isPanning: false, panLastX: 0, panLastY: 0, spaceDown: false,
  mouseWorldX: 0, mouseWorldY: 0, mouseScreenX: 0, mouseScreenY: 0,
  rafId: null,
};

// ---------------------------------------------------------------------------
// Undo / Redo
// ---------------------------------------------------------------------------

function snapshot(): EditorSnapshot {
  return {
    walls:         es.walls.map((w) => ({ ...w })),
    spawnPoints:   es.spawnPoints.map((s) => ({ ...s })),
    flagPositions: es.flagPositions.map((f) => ({ ...f })),
    itemSpawns:    es.itemSpawns.map((i) => ({ ...i })),
    objects:       es.objects.map((o) => ({ ...o })),
  };
}

function saveSnapshot() {
  es.undoStack.push(snapshot());
  if (es.undoStack.length > 100) es.undoStack.shift();
  es.redoStack = [];
}

function restoreSnapshot(s: EditorSnapshot) {
  es.walls         = s.walls;
  es.spawnPoints   = s.spawnPoints;
  es.flagPositions = s.flagPositions;
  es.itemSpawns    = s.itemSpawns;
  es.objects       = s.objects;
  es.selectedIdx   = null;
  updatePropertiesPanel();
}

function undo() { if (!es.undoStack.length) return; es.redoStack.push(snapshot()); restoreSnapshot(es.undoStack.pop()!); }
function redo() { if (!es.redoStack.length) return; es.undoStack.push(snapshot()); restoreSnapshot(es.redoStack.pop()!); }

// ---------------------------------------------------------------------------
// Coord helpers
// ---------------------------------------------------------------------------

function screenToWorld(sx: number, sy: number) { return { x: (sx - es.panX) / es.zoom, y: (sy - es.panY) / es.zoom }; }
function worldToScreen(wx: number, wy: number) { return { x: wx * es.zoom + es.panX, y: wy * es.zoom + es.panY }; }
function maybeSnap(v: number) { return es.snapEnabled ? Math.round(v / es.gridSize) * es.gridSize : v; }

// ---------------------------------------------------------------------------
// Prefab helpers
// ---------------------------------------------------------------------------

function expandObject(obj: MapObject): Wall[] {
  try {
    return expandMapObjects({ id: "t", width: es.mapWidth, height: es.mapHeight, walls: [], spawnPoints: [], objects: [obj] }).walls;
  } catch { return []; }
}

function getObjectAABB(obj: MapObject): { x: number; y: number; width: number; height: number } | null {
  const walls = expandObject(obj);
  if (!walls.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const w of walls) {
    minX = Math.min(minX, w.x); minY = Math.min(minY, w.y);
    maxX = Math.max(maxX, w.x + w.width); maxY = Math.max(maxY, w.y + w.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// ---------------------------------------------------------------------------
// Resize handles
// ---------------------------------------------------------------------------

const HANDLE_R = 6;

function getHandlePositions(w: Wall) {
  const sx = w.x * es.zoom + es.panX, sy = w.y * es.zoom + es.panY;
  const sw = w.width * es.zoom, sh = w.height * es.zoom;
  return [
    { handle: "tl" as ResizeHandle, sx, sy },
    { handle: "tm" as ResizeHandle, sx: sx + sw/2, sy },
    { handle: "tr" as ResizeHandle, sx: sx + sw, sy },
    { handle: "ml" as ResizeHandle, sx, sy: sy + sh/2 },
    { handle: "mr" as ResizeHandle, sx: sx + sw, sy: sy + sh/2 },
    { handle: "bl" as ResizeHandle, sx, sy: sy + sh },
    { handle: "bm" as ResizeHandle, sx: sx + sw/2, sy: sy + sh },
    { handle: "br" as ResizeHandle, sx: sx + sw, sy: sy + sh },
  ];
}

function hitTestHandle(sx: number, sy: number, w: Wall): ResizeHandle | null {
  for (const h of getHandlePositions(w)) {
    if (Math.hypot(sx - h.sx, sy - h.sy) <= HANDLE_R + 2) return h.handle;
  }
  return null;
}

function applyResize(h: ResizeHandle, dx: number, dy: number, init: Wall): Wall {
  const w = { ...init };
  switch (h) {
    case "tl": w.x = init.x+dx; w.y = init.y+dy; w.width = init.width-dx; w.height = init.height-dy; break;
    case "tm": w.y = init.y+dy; w.height = init.height-dy; break;
    case "tr": w.y = init.y+dy; w.width = init.width+dx; w.height = init.height-dy; break;
    case "ml": w.x = init.x+dx; w.width = init.width-dx; break;
    case "mr": w.width = init.width+dx; break;
    case "bl": w.x = init.x+dx; w.width = init.width-dx; w.height = init.height+dy; break;
    case "bm": w.height = init.height+dy; break;
    case "br": w.width = init.width+dx; w.height = init.height+dy; break;
  }
  const MIN = 5;
  if (w.width  < MIN) { w.width  = MIN; if (h.includes("l")) w.x = init.x + init.width  - MIN; }
  if (w.height < MIN) { w.height = MIN; if (h.includes("t")) w.y = init.y + init.height - MIN; }
  return w;
}

// ---------------------------------------------------------------------------
// Symmetry helpers
// ---------------------------------------------------------------------------

function mirrorWall(w: Wall): Wall[] {
  const fH = (): Wall => ({ ...w, x: es.mapWidth  - (w.x + w.width),  rotation: w.rotation != null ? -w.rotation : undefined });
  const fV = (): Wall => ({ ...w, y: es.mapHeight - (w.y + w.height), rotation: w.rotation != null ? -w.rotation : undefined });
  const fP = (): Wall => ({ ...w, x: es.mapWidth  - (w.x + w.width),  y: es.mapHeight - (w.y + w.height) });
  if (es.symmetryMode === "h") return [fH()];
  if (es.symmetryMode === "v") return [fV()];
  if (es.symmetryMode === "point") return [fP()];
  return [];
}

function mirrorObject(o: MapObject): MapObject[] {
  const fH = (): MapObject => ({ ...o, x: es.mapWidth  - o.x, rotation: o.rotation != null ? -o.rotation : undefined });
  const fV = (): MapObject => ({ ...o, y: es.mapHeight - o.y, rotation: o.rotation != null ? -o.rotation : undefined });
  const fP = (): MapObject => ({ ...o, x: es.mapWidth  - o.x, y: es.mapHeight - o.y });
  if (es.symmetryMode === "h") return [fH()];
  if (es.symmetryMode === "v") return [fV()];
  if (es.symmetryMode === "point") return [fP()];
  return [];
}

function mirrorSpawn(sp: SpawnPoint): SpawnPoint[] {
  const other = sp.team === "red" ? "blue" : "red";
  if (es.symmetryMode === "h") return [{ ...sp, x: es.mapWidth  - sp.x, team: other }];
  if (es.symmetryMode === "v") return [{ ...sp, y: es.mapHeight - sp.y, team: other }];
  if (es.symmetryMode === "point") return [{ ...sp, x: es.mapWidth - sp.x, y: es.mapHeight - sp.y, team: other }];
  return [];
}

function mirrorFlag(f: FlagPosition): FlagPosition[] {
  const other = f.team === "red" ? "blue" : "red";
  if (es.symmetryMode === "h") return [{ ...f, x: es.mapWidth  - f.x, team: other }];
  if (es.symmetryMode === "v") return [{ ...f, y: es.mapHeight - f.y, team: other }];
  if (es.symmetryMode === "point") return [{ ...f, x: es.mapWidth - f.x, y: es.mapHeight - f.y, team: other }];
  return [];
}

function mirrorItem(i: ItemSpawn): ItemSpawn[] {
  if (es.symmetryMode === "h") return [{ ...i, x: es.mapWidth  - i.x }];
  if (es.symmetryMode === "v") return [{ ...i, y: es.mapHeight - i.y }];
  if (es.symmetryMode === "point") return [{ ...i, x: es.mapWidth - i.x, y: es.mapHeight - i.y }];
  return [];
}

// ---------------------------------------------------------------------------
// Wall colors
// ---------------------------------------------------------------------------

const WALL_COLORS: Record<WallType, string> = {
  wall:   "#c4b4a0",
  bush:   "rgba(90,120,50,0.75)",
  water:  "rgba(50,90,140,0.75)",
  house:  "#c4a070",
  oneway: "rgba(180,140,40,0.75)",
  river:  "rgba(50,90,140,0.75)",
  bridge: "rgba(120,130,145,0.85)",
};

// ---------------------------------------------------------------------------
// River elbow arc rendering (smooth sector, not overlapping rects)
// ---------------------------------------------------------------------------

const RIVER_ELBOW_RADII: Partial<Record<PrefabType, number>> = {
  "river-elbow-gentle-s": 300,
  "river-elbow-gentle-l": 500,
  "river-elbow-mid-s":    200,
  "river-elbow-mid-l":    350,
  "river-elbow-sharp-s":  120,
  "river-elbow-sharp-l":  180,
};

/** Draw a river elbow as a smooth arc sector on the canvas. */
function drawRiverElbow(obj: MapObject, alpha: number) {
  if (!ctx) return;
  const radius = RIVER_ELBOW_RADII[obj.type];
  if (radius == null) return;

  const RIVER_WIDTH = 80;
  const objRotRad = ((obj.rotation ?? 0) * Math.PI) / 180;

  // Center of curvature in local (unrotated) coords: (0, -radius)
  // Rotate by objRotRad then translate to world
  const cos = Math.cos(objRotRad), sin = Math.sin(objRotRad);
  const wcx = obj.x + (0 * cos - (-radius) * sin);
  const wcy = obj.y + (0 * sin + (-radius) * cos);

  // Screen coords
  const scx = wcx * es.zoom + es.panX;
  const scy = wcy * es.zoom + es.panY;
  const sInner = (radius - RIVER_WIDTH / 2) * es.zoom;
  const sOuter = (radius + RIVER_WIDTH / 2) * es.zoom;

  // Arc: start=π/2, end=π/4, anticlockwise (CCW), rotated by objRotRad
  const aStart = Math.PI / 2 + objRotRad;
  const aEnd   = Math.PI / 4 + objRotRad;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = WALL_COLORS["river"];
  ctx.beginPath();
  ctx.arc(scx, scy, sOuter, aStart, aEnd, true);   // outer edge, CCW
  ctx.arc(scx, scy, sInner, aEnd, aStart, false);  // inner edge, CW
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Canvas rendering
// ---------------------------------------------------------------------------

function drawWall(w: Wall, alpha = 1.0, tint?: string) {
  if (!ctx) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const sx = w.x * es.zoom + es.panX, sy = w.y * es.zoom + es.panY;
  const sw = w.width * es.zoom,        sh = w.height * es.zoom;
  ctx.translate(sx + sw/2, sy + sh/2);
  if (w.rotation) ctx.rotate((w.rotation * Math.PI) / 180);
  ctx.fillStyle = tint ?? (WALL_COLORS[w.type ?? "wall"] ?? "#c4b4a0");
  ctx.fillRect(-sw/2, -sh/2, sw, sh);
  ctx.strokeStyle = "rgba(0,0,0,0.2)";
  ctx.lineWidth = 1;
  ctx.strokeRect(-sw/2, -sh/2, sw, sh);
  ctx.restore();
}

function drawResizeHandles(w: Wall) {
  if (!ctx) return;
  ctx.save();
  for (const { sx, sy } of getHandlePositions(w)) {
    ctx.fillStyle = "#fff"; ctx.strokeStyle = "#c9a030"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sx, sy, HANDLE_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function drawSpawn(sp: SpawnPoint, alpha = 1.0) {
  if (!ctx) return;
  ctx.save(); ctx.globalAlpha = alpha;
  const { x: sx, y: sy } = worldToScreen(sp.x, sp.y);
  const r = Math.max(6, (sp.radius ?? 50) * es.zoom);
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fillStyle = sp.team === "red" ? "rgba(196,64,64,0.3)" : "rgba(74,106,138,0.3)"; ctx.fill();
  ctx.strokeStyle = sp.team === "red" ? "#c44040" : "#4a6a8a"; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = sp.team === "red" ? "#c44040" : "#4a6a8a";
  ctx.font = `bold ${Math.max(10, 14 * es.zoom)}px monospace`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(sp.team === "red" ? "R" : "B", sx, sy);
  ctx.restore();
}

function drawFlag(f: FlagPosition, alpha = 1.0) {
  if (!ctx) return;
  ctx.save(); ctx.globalAlpha = alpha;
  const { x: sx, y: sy } = worldToScreen(f.x, f.y);
  const size = Math.max(8, 14 * es.zoom);
  ctx.beginPath();
  ctx.moveTo(sx, sy - size); ctx.lineTo(sx + size * 0.8, sy + size * 0.6); ctx.lineTo(sx - size * 0.8, sy + size * 0.6); ctx.closePath();
  ctx.fillStyle = f.team === "red" ? "rgba(196,64,64,0.85)" : "rgba(74,106,138,0.85)"; ctx.fill();
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}

function drawItem(item: ItemSpawn, alpha = 1.0) {
  if (!ctx) return;
  ctx.save(); ctx.globalAlpha = alpha;
  const { x: sx, y: sy } = worldToScreen(item.x, item.y);
  const r = Math.max(5, 10 * es.zoom);
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(200,160,40,0.85)"; ctx.fill();
  ctx.strokeStyle = "#c9a030"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.fillStyle = "#3a2a0a";
  ctx.font = `${Math.max(7, 9 * es.zoom)}px monospace`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(item.type.slice(0, 2).toUpperCase(), sx, sy);
  ctx.restore();
}

function drawSelectionHighlight(idx: SelectedIdx) {
  if (!ctx) return;
  ctx.save(); ctx.strokeStyle = "#f0c030"; ctx.lineWidth = 2;
  if (idx.category === "wall") {
    const w = es.walls[idx.index]; if (!w) { ctx.restore(); return; }
    const sx = w.x * es.zoom + es.panX, sy = w.y * es.zoom + es.panY;
    ctx.strokeRect(sx - 2, sy - 2, w.width * es.zoom + 4, w.height * es.zoom + 4);
    drawResizeHandles(w);
  } else if (idx.category === "spawn") {
    const sp = es.spawnPoints[idx.index]; if (!sp) { ctx.restore(); return; }
    const { x: sx, y: sy } = worldToScreen(sp.x, sp.y);
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(6, (sp.radius ?? 50) * es.zoom) + 4, 0, Math.PI * 2); ctx.stroke();
  } else if (idx.category === "flag") {
    const f = es.flagPositions[idx.index]; if (!f) { ctx.restore(); return; }
    const { x: sx, y: sy } = worldToScreen(f.x, f.y);
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(8, 14 * es.zoom) + 5, 0, Math.PI * 2); ctx.stroke();
  } else if (idx.category === "item") {
    const item = es.itemSpawns[idx.index]; if (!item) { ctx.restore(); return; }
    const { x: sx, y: sy } = worldToScreen(item.x, item.y);
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(5, 10 * es.zoom) + 4, 0, Math.PI * 2); ctx.stroke();
  } else if (idx.category === "object") {
    const obj = es.objects[idx.index]; if (!obj) { ctx.restore(); return; }
    const bb = getObjectAABB(obj);
    if (bb) {
      const { x: sx, y: sy } = worldToScreen(bb.x, bb.y);
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(sx - 3, sy - 3, bb.width * es.zoom + 6, bb.height * es.zoom + 6);
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

function renderCanvas() {
  if (!ctx || !canvas) return;
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = "#d0c8bc"; ctx.fillRect(0, 0, W, H);

  // Map area
  const mo = worldToScreen(0, 0), me = worldToScreen(es.mapWidth, es.mapHeight);
  ctx.fillStyle = "#f5ede0";
  ctx.fillRect(mo.x, mo.y, me.x - mo.x, me.y - mo.y);

  // Grid
  if (es.zoom > 0.15) {
    ctx.save(); ctx.strokeStyle = "rgba(168,148,104,0.18)"; ctx.lineWidth = 0.5;
    for (let wx = 0; wx <= es.mapWidth; wx += es.gridSize) {
      const sx = wx * es.zoom + es.panX;
      if (sx < mo.x - 1 || sx > me.x + 1) continue;
      ctx.beginPath(); ctx.moveTo(sx, mo.y); ctx.lineTo(sx, me.y); ctx.stroke();
    }
    for (let wy = 0; wy <= es.mapHeight; wy += es.gridSize) {
      const sy = wy * es.zoom + es.panY;
      if (sy < mo.y - 1 || sy > me.y + 1) continue;
      ctx.beginPath(); ctx.moveTo(mo.x, sy); ctx.lineTo(me.x, sy); ctx.stroke();
    }
    ctx.restore();
  }

  // Map border
  ctx.strokeStyle = "rgba(168,148,104,0.8)"; ctx.lineWidth = 2;
  ctx.strokeRect(mo.x, mo.y, me.x - mo.x, me.y - mo.y);

  // Symmetry guides
  if (es.symmetryMode !== "none") {
    ctx.save(); ctx.strokeStyle = "rgba(200,80,80,0.4)"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
    if (es.symmetryMode === "h" || es.symmetryMode === "point") {
      const cx = worldToScreen(es.mapWidth / 2, 0);
      ctx.beginPath(); ctx.moveTo(cx.x, mo.y); ctx.lineTo(cx.x, me.y); ctx.stroke();
    }
    if (es.symmetryMode === "v" || es.symmetryMode === "point") {
      const cy = worldToScreen(0, es.mapHeight / 2);
      ctx.beginPath(); ctx.moveTo(mo.x, cy.y); ctx.lineTo(me.x, cy.y); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();
  }

  // Prefab objects
  for (let i = 0; i < es.objects.length; i++) {
    const obj = es.objects[i];
    const alpha = (es.selectedIdx?.category === "object" && es.selectedIdx.index === i) ? 1.0 : 0.85;
    if (obj.type in RIVER_ELBOW_RADII) {
      drawRiverElbow(obj, alpha);
    } else {
      for (const w of expandObject(obj)) drawWall(w, alpha, undefined);
    }
  }

  // Manual walls
  for (let i = 0; i < es.walls.length; i++) drawWall(es.walls[i], 0.9);

  // Spawns, flags, items
  for (const sp of es.spawnPoints) drawSpawn(sp);
  for (const f of es.flagPositions) drawFlag(f);
  for (const item of es.itemSpawns) drawItem(item);

  // Selection highlight (on top)
  if (es.selectedIdx) drawSelectionHighlight(es.selectedIdx);

  // Rubber-band wall draw
  if (es.isDrawing && es.drawStartWorld && es.activeTool?.kind === "wall") {
    const ex = maybeSnap(es.mouseWorldX), ey = maybeSnap(es.mouseWorldY);
    const wx = Math.min(es.drawStartWorld.x, ex), wy = Math.min(es.drawStartWorld.y, ey);
    const ww = Math.abs(ex - es.drawStartWorld.x), wh = Math.abs(ey - es.drawStartWorld.y);
    if (ww > 0 && wh > 0) {
      drawWall({ x: wx, y: wy, width: ww, height: wh, type: es.activeTool.wallType, rotation: es.activeRotation || undefined }, 0.55);
      for (const mw of mirrorWall({ x: wx, y: wy, width: ww, height: wh, type: es.activeTool.wallType })) drawWall(mw, 0.3);
    }
  }

  // Placement preview (non-wall tools)
  if (!es.isDrawing && es.activeTool && es.activeTool.kind !== "wall") {
    const wx = maybeSnap(es.mouseWorldX), wy = maybeSnap(es.mouseWorldY);
    const tool = es.activeTool;
    if (tool.kind === "spawn") {
      const p: SpawnPoint = { team: tool.team, x: wx, y: wy, radius: 50 };
      drawSpawn(p, 0.5); for (const m of mirrorSpawn(p)) drawSpawn(m, 0.3);
    } else if (tool.kind === "flag") {
      const f: FlagPosition = { team: tool.team, x: wx, y: wy };
      drawFlag(f, 0.5); for (const m of mirrorFlag(f)) drawFlag(m, 0.3);
    } else if (tool.kind === "item") {
      const it: ItemSpawn = { x: wx, y: wy, type: tool.itemType };
      drawItem(it, 0.5); for (const m of mirrorItem(it)) drawItem(m, 0.3);
    } else if (tool.kind === "prefab") {
      const obj: MapObject = { type: tool.prefabType, x: wx, y: wy, rotation: es.activeRotation || undefined };
      if (obj.type in RIVER_ELBOW_RADII) {
        drawRiverElbow(obj, 0.45);
        for (const m of mirrorObject(obj)) drawRiverElbow(m, 0.25);
      } else {
        for (const w of expandObject(obj)) drawWall(w, 0.45);
        for (const m of mirrorObject(obj)) for (const w of expandObject(m)) drawWall(w, 0.25);
      }
    }
  }
}

function renderLoop() { renderCanvas(); es.rafId = requestAnimationFrame(renderLoop); }

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

function hitTest(wx: number, wy: number): SelectedIdx | null {
  for (let i = es.itemSpawns.length - 1; i >= 0; i--)
    if (Math.hypot(wx - es.itemSpawns[i].x, wy - es.itemSpawns[i].y) <= 20) return { category: "item", index: i };
  for (let i = es.flagPositions.length - 1; i >= 0; i--)
    if (Math.hypot(wx - es.flagPositions[i].x, wy - es.flagPositions[i].y) <= 20) return { category: "flag", index: i };
  for (let i = es.spawnPoints.length - 1; i >= 0; i--) {
    const sp = es.spawnPoints[i];
    if (Math.hypot(wx - sp.x, wy - sp.y) <= (sp.radius ?? 50)) return { category: "spawn", index: i };
  }
  for (let i = es.objects.length - 1; i >= 0; i--) {
    for (const w of expandObject(es.objects[i]))
      if (wx >= w.x && wx <= w.x + w.width && wy >= w.y && wy <= w.y + w.height) return { category: "object", index: i };
  }
  for (let i = es.walls.length - 1; i >= 0; i--) {
    const w = es.walls[i];
    if (wx >= w.x && wx <= w.x + w.width && wy >= w.y && wy <= w.y + w.height) return { category: "wall", index: i };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Delete / rotate
// ---------------------------------------------------------------------------

function deleteSelected() {
  if (!es.selectedIdx) return;
  saveSnapshot();
  const { category, index } = es.selectedIdx;
  if (category === "wall")   es.walls.splice(index, 1);
  else if (category === "spawn")  es.spawnPoints.splice(index, 1);
  else if (category === "flag")   es.flagPositions.splice(index, 1);
  else if (category === "item")   es.itemSpawns.splice(index, 1);
  else if (category === "object") es.objects.splice(index, 1);
  es.selectedIdx = null; updatePropertiesPanel();
}

function rotateSelected(delta: number) {
  if (!es.selectedIdx) {
    es.activeRotation = (es.activeRotation + delta + 360) % 360;
    updateRotationDisplay(); return;
  }
  saveSnapshot();
  if (es.selectedIdx.category === "wall") {
    const w = es.walls[es.selectedIdx.index];
    if (w) w.rotation = ((w.rotation ?? 0) + delta + 360) % 360;
  } else if (es.selectedIdx.category === "object") {
    const o = es.objects[es.selectedIdx.index];
    if (o) o.rotation = ((o.rotation ?? 0) + delta + 360) % 360;
  }
  updateRotationDisplay();
}

// ---------------------------------------------------------------------------
// Mouse events
// ---------------------------------------------------------------------------

function onMouseDown(e: MouseEvent) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

  if (e.button === 1 || (e.button === 0 && es.spaceDown)) {
    es.isPanning = true; es.panLastX = sx; es.panLastY = sy;
    canvas.style.cursor = "grabbing"; e.preventDefault(); return;
  }
  if (e.button !== 0) return;

  const world = screenToWorld(sx, sy);

  if (es.activeTool?.kind === "wall") {
    es.isDrawing = true;
    es.drawStartWorld = { x: maybeSnap(world.x), y: maybeSnap(world.y) };
    es.selectedIdx = null; return;
  }

  if (es.activeTool) {
    saveSnapshot(); placeActiveTool(maybeSnap(world.x), maybeSnap(world.y)); return;
  }

  // Resize handle check (selected wall)
  if (es.selectedIdx?.category === "wall") {
    const w = es.walls[es.selectedIdx.index];
    if (w) {
      const handle = hitTestHandle(sx, sy, w);
      if (handle) {
        saveSnapshot();
        es.activeInteraction = { type: "resize", wallIndex: es.selectedIdx.index, handle, initialWall: { ...w }, initMx: world.x, initMy: world.y };
        return;
      }
    }
  }

  // Hit test → drag or select
  const hit = hitTest(world.x, world.y);
  if (hit) {
    es.selectedIdx = hit; updatePropertiesPanel();
    saveSnapshot();
    if (hit.category === "wall") {
      const w = es.walls[hit.index];
      es.activeInteraction = { type: "move", idx: hit, offsetX: world.x - w.x, offsetY: world.y - w.y };
    } else if (hit.category === "spawn") {
      const sp = es.spawnPoints[hit.index];
      es.activeInteraction = { type: "move", idx: hit, offsetX: world.x - sp.x, offsetY: world.y - sp.y };
    } else if (hit.category === "flag") {
      const f = es.flagPositions[hit.index];
      es.activeInteraction = { type: "move", idx: hit, offsetX: world.x - f.x, offsetY: world.y - f.y };
    } else if (hit.category === "item") {
      const it = es.itemSpawns[hit.index];
      es.activeInteraction = { type: "move", idx: hit, offsetX: world.x - it.x, offsetY: world.y - it.y };
    } else if (hit.category === "object") {
      const o = es.objects[hit.index];
      es.activeInteraction = { type: "move", idx: hit, offsetX: world.x - o.x, offsetY: world.y - o.y };
    }
  } else {
    es.selectedIdx = null; updatePropertiesPanel();
  }
}

function onMouseMove(e: MouseEvent) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

  if (es.isPanning) {
    es.panX += sx - es.panLastX; es.panY += sy - es.panLastY;
    es.panLastX = sx; es.panLastY = sy; return;
  }

  const world = screenToWorld(sx, sy);
  es.mouseWorldX = world.x; es.mouseWorldY = world.y;
  es.mouseScreenX = sx; es.mouseScreenY = sy;

  const ia = es.activeInteraction;
  if (!ia) { updateCursor(sx, sy, world.x, world.y); return; }

  if (ia.type === "move") {
    const nx = world.x - ia.offsetX, ny = world.y - ia.offsetY;
    const { category, index } = ia.idx;
    if (category === "wall")   { es.walls[index].x = nx; es.walls[index].y = ny; }
    else if (category === "spawn")  { es.spawnPoints[index].x = nx + ia.offsetX; es.spawnPoints[index].y = ny + ia.offsetY; }
    else if (category === "flag")   { es.flagPositions[index].x = nx + ia.offsetX; es.flagPositions[index].y = ny + ia.offsetY; }
    else if (category === "item")   { es.itemSpawns[index].x = nx + ia.offsetX; es.itemSpawns[index].y = ny + ia.offsetY; }
    else if (category === "object") { es.objects[index].x = nx + ia.offsetX; es.objects[index].y = ny + ia.offsetY; }
  } else if (ia.type === "resize") {
    es.walls[ia.wallIndex] = applyResize(ia.handle, world.x - ia.initMx, world.y - ia.initMy, ia.initialWall);
  }
}

function onMouseUp(e: MouseEvent) {
  if (!canvas) return;
  if (es.isPanning) {
    es.isPanning = false;
    canvas.style.cursor = es.spaceDown ? "grab" : (es.activeTool ? "crosshair" : "default"); return;
  }
  if (e.button !== 0) return;

  if (es.isDrawing && es.drawStartWorld && es.activeTool?.kind === "wall") {
    es.isDrawing = false;
    const rect = canvas.getBoundingClientRect();
    const world = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const ex = maybeSnap(world.x), ey = maybeSnap(world.y);
    const wx = Math.min(es.drawStartWorld.x, ex), wy = Math.min(es.drawStartWorld.y, ey);
    const ww = Math.abs(ex - es.drawStartWorld.x), wh = Math.abs(ey - es.drawStartWorld.y);
    if (ww >= 5 && wh >= 5) {
      saveSnapshot();
      const nw: Wall = { x: wx, y: wy, width: ww, height: wh, type: es.activeTool.wallType, rotation: es.activeRotation || undefined };
      es.walls.push(nw);
      for (const mw of mirrorWall(nw)) es.walls.push(mw);
    }
    es.drawStartWorld = null;
  }
  es.activeInteraction = null;
}

function updateCursor(sx: number, sy: number, wx: number, wy: number) {
  if (!canvas || es.activeTool) return;
  if (es.selectedIdx?.category === "wall") {
    const w = es.walls[es.selectedIdx.index];
    if (w) {
      const handle = hitTestHandle(sx, sy, w);
      if (handle) {
        const cursors: Record<ResizeHandle, string> = { tl: "nw-resize", tm: "n-resize", tr: "ne-resize", ml: "w-resize", mr: "e-resize", bl: "sw-resize", bm: "s-resize", br: "se-resize" };
        canvas.style.cursor = cursors[handle]; return;
      }
    }
  }
  canvas.style.cursor = hitTest(wx, wy) ? "grab" : "default";
}

function onWheel(e: WheelEvent) {
  e.preventDefault();
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
  const factor = e.deltaY > 0 ? 0.9 : 1.1;
  const newZ = Math.min(4, Math.max(0.08, es.zoom * factor));
  es.panX = sx - (sx - es.panX) * (newZ / es.zoom);
  es.panY = sy - (sy - es.panY) * (newZ / es.zoom);
  es.zoom = newZ; updateFooterZoom();
}

function onKeyDown(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.code === "Space") { e.preventDefault(); es.spaceDown = true; if (canvas) canvas.style.cursor = "grab"; return; }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); redo(); return; }
  if (e.key === "Escape") {
    es.activeTool = null; es.isDrawing = false; es.drawStartWorld = null; es.activeInteraction = null; es.selectedIdx = null;
    updatePaletteHighlight(null); updatePropertiesPanel();
    if (canvas) canvas.style.cursor = "default";
  }
  if ((e.key === "Delete" || e.key === "Backspace") && es.selectedIdx) { e.preventDefault(); deleteSelected(); }
  if (e.key === "r" || e.key === "R") rotateSelected(15);
  if (e.key === "q" || e.key === "Q") rotateSelected(-15);
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code === "Space") { es.spaceDown = false; if (canvas) canvas.style.cursor = es.activeTool ? "crosshair" : "default"; }
}

// ---------------------------------------------------------------------------
// Place active tool
// ---------------------------------------------------------------------------

function placeActiveTool(wx: number, wy: number) {
  const tool = es.activeTool;
  if (!tool) return;
  if (tool.kind === "spawn") {
    const sp: SpawnPoint = { team: tool.team, x: wx, y: wy, radius: 50 };
    es.spawnPoints.push(sp); for (const m of mirrorSpawn(sp)) es.spawnPoints.push(m);
  } else if (tool.kind === "flag") {
    const f: FlagPosition = { team: tool.team, x: wx, y: wy };
    es.flagPositions.push(f); for (const m of mirrorFlag(f)) es.flagPositions.push(m);
  } else if (tool.kind === "item") {
    const it: ItemSpawn = { x: wx, y: wy, type: tool.itemType };
    es.itemSpawns.push(it); for (const m of mirrorItem(it)) es.itemSpawns.push(m);
  } else if (tool.kind === "prefab") {
    const o: MapObject = { type: tool.prefabType, x: wx, y: wy, rotation: es.activeRotation || undefined };
    es.objects.push(o); for (const m of mirrorObject(o)) es.objects.push(m);
  }
}

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function updatePaletteHighlight(tool: PaletteTool | null) {
  document.querySelectorAll(".me-palette-item").forEach((el) => el.classList.remove("active"));
  if (!tool) return;
  let id = "";
  if (tool.kind === "wall")   id = `me-tool-wall-${tool.wallType}`;
  else if (tool.kind === "spawn")  id = `me-tool-spawn-${tool.team}`;
  else if (tool.kind === "flag")   id = `me-tool-flag-${tool.team}`;
  else if (tool.kind === "item")   id = `me-tool-item-${tool.itemType}`;
  else if (tool.kind === "prefab") id = `me-tool-pfb-${tool.prefabType}`;
  document.querySelector(`#${id}`)?.classList.add("active");
}

function updateRotationDisplay() {
  const el = document.querySelector("#me-rotation-val") as HTMLElement | null;
  if (!el) return;
  if (es.selectedIdx?.category === "wall") {
    el.textContent = `${Math.round(es.walls[es.selectedIdx.index]?.rotation ?? 0)}°`;
  } else if (es.selectedIdx?.category === "object") {
    el.textContent = `${Math.round(es.objects[es.selectedIdx.index]?.rotation ?? 0)}°`;
  } else {
    el.textContent = `${es.activeRotation}°`;
  }
}

function updatePropertiesPanel() {
  const selEl = document.querySelector("#me-selected-label") as HTMLElement | null;
  const deleteBtn = document.querySelector("#me-delete-btn") as HTMLButtonElement | null;
  if (!selEl) return;
  if (!es.selectedIdx) { selEl.textContent = "(none)"; if (deleteBtn) deleteBtn.disabled = true; return; }
  if (deleteBtn) deleteBtn.disabled = false;
  const { category, index } = es.selectedIdx;
  if (category === "wall")   selEl.textContent = `wall (${es.walls[index]?.type ?? "wall"})`;
  else if (category === "spawn")  selEl.textContent = `spawn (${es.spawnPoints[index]?.team})`;
  else if (category === "flag")   selEl.textContent = `flag (${es.flagPositions[index]?.team})`;
  else if (category === "item")   selEl.textContent = `item (${es.itemSpawns[index]?.type})`;
  else if (category === "object") selEl.textContent = `prefab (${es.objects[index]?.type})`;
  updateRotationDisplay();
}

function updateFooterZoom() {
  const el = document.querySelector("#me-zoom-val") as HTMLElement | null;
  if (el) el.textContent = `${Math.round(es.zoom * 100)}%`;
}

function updateSymmetryButtons() {
  (["none", "h", "v", "point"] as SymmetryMode[]).forEach((mode) => {
    document.querySelector(`#me-sym-${mode}`)?.classList.toggle("active", es.symmetryMode === mode);
  });
}

// ---------------------------------------------------------------------------
// Export / import / play test
// ---------------------------------------------------------------------------

function buildMapData(): MapData {
  const md: MapData = {
    id: "custom",
    width: es.mapWidth, height: es.mapHeight,
    walls: es.walls.map((w) => {
      const out: Wall = { x: Math.round(w.x), y: Math.round(w.y), width: Math.max(1, Math.round(w.width)), height: Math.max(1, Math.round(w.height)) };
      if (w.type && w.type !== "wall") out.type = w.type;
      if (w.rotation) out.rotation = Math.round(w.rotation);
      if (w.passable) out.passable = true;
      return out;
    }),
    spawnPoints: es.spawnPoints.map((sp) => ({ team: sp.team, x: Math.round(sp.x), y: Math.round(sp.y), radius: sp.radius })),
  };
  if (es.objects.length > 0) {
    md.objects = es.objects.map((o) => {
      const out: MapObject = { type: o.type, x: Math.round(o.x), y: Math.round(o.y) };
      if (o.rotation) out.rotation = Math.round(o.rotation);
      return out;
    });
  }
  if (es.flagPositions.length > 0) md.flagPositions = es.flagPositions.map((f) => ({ team: f.team, x: Math.round(f.x), y: Math.round(f.y) }));
  if (es.itemSpawns.length > 0) { md.itemMode = "manual"; md.itemSpawns = es.itemSpawns.map((i) => ({ x: Math.round(i.x), y: Math.round(i.y), type: i.type })); }
  return md;
}

function loadMapData(data: MapData) {
  saveSnapshot();
  es.mapWidth  = data.width; es.mapHeight = data.height;
  es.walls         = (data.walls ?? []).map((w) => ({ ...w }));
  es.spawnPoints   = (data.spawnPoints ?? []).map((sp) => ({ team: sp.team as "red" | "blue", x: sp.x, y: sp.y, radius: (sp as any).radius ?? 50 }));
  es.flagPositions = (data.flagPositions ?? []).map((f) => ({ team: f.team as "red" | "blue", x: f.x, y: f.y }));
  es.itemSpawns    = (data.itemSpawns ?? []).map((i) => ({ ...i }));
  es.objects       = (data.objects ?? []).map((o) => ({ ...o }));
  es.selectedIdx   = null;
  fitMapInView();
  updatePropertiesPanel();
  const titleEl = document.querySelector(".me-title");
  if (titleEl) titleEl.innerHTML = `TANK TAKTIX &nbsp;—&nbsp; <span style="color:#c99a30;">MAP EDITING</span> &nbsp;(${es.mapWidth}×${es.mapHeight})`;
}

function showExportOverlay() {
  const json = JSON.stringify(buildMapData(), null, 2);
  document.querySelector("#me-export-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "me-export-overlay"; overlay.className = "me-export-overlay";
  overlay.innerHTML = `
    <div class="me-export-card">
      <h3 style="margin:0 0 12px 0;font-family:monospace;color:#d4c4a8;">EXPORT MAP JSON</h3>
      <p style="font-size:12px;color:#a09080;margin:0 0 8px 0;">Copy and save the JSON below. Paste into "Custom Map (Paste JSON)" when creating a room.</p>
      <textarea id="me-export-textarea" readonly style="width:100%;height:220px;font-size:11px;font-family:monospace;background:#1a1a0a;color:#d4c4a8;border:1px solid rgba(168,148,104,0.4);border-radius:4px;padding:8px;box-sizing:border-box;resize:vertical;">${json}</textarea>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button id="me-copy-btn" class="lobby-btn primary">Copy to Clipboard</button>
        <button id="me-export-close-btn" class="lobby-btn">Close</button>
      </div>
    </div>`;
  document.querySelector("#map-editor-container")?.appendChild(overlay);
  overlay.querySelector("#me-copy-btn")?.addEventListener("click", () => {
    const ta = overlay.querySelector("#me-export-textarea") as HTMLTextAreaElement;
    navigator.clipboard.writeText(ta?.value ?? "").then(() => {
      const btn = overlay.querySelector("#me-copy-btn") as HTMLButtonElement;
      if (btn) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Copy to Clipboard"; }, 2000); }
    });
  });
  overlay.querySelector("#me-export-close-btn")?.addEventListener("click", () => overlay.remove());
  const ta = overlay.querySelector("#me-export-textarea") as HTMLTextAreaElement | null;
  ta?.focus(); ta?.select();
}

function showLoadOverlay() {
  document.querySelector("#me-load-overlay")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "me-load-overlay"; overlay.className = "me-export-overlay";
  overlay.innerHTML = `
    <div class="me-export-card">
      <h3 style="margin:0 0 12px 0;font-family:monospace;color:#d4c4a8;">LOAD MAP JSON</h3>
      <p style="font-size:12px;color:#a09080;margin:0 0 8px 0;">Paste a previously exported map JSON to resume editing.</p>
      <textarea id="me-load-textarea" style="width:100%;height:220px;font-size:11px;font-family:monospace;background:#1a1a0a;color:#d4c4a8;border:1px solid rgba(168,148,104,0.4);border-radius:4px;padding:8px;box-sizing:border-box;resize:vertical;" placeholder='{"id":"custom","width":1600,"height":1200,...}'></textarea>
      <div id="me-load-status" style="font-size:11px;min-height:16px;margin-top:4px;"></div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button id="me-load-confirm-btn" class="lobby-btn primary">LOAD</button>
        <button id="me-load-close-btn" class="lobby-btn">Cancel</button>
      </div>
    </div>`;
  document.querySelector("#map-editor-container")?.appendChild(overlay);
  const statusEl = overlay.querySelector("#me-load-status") as HTMLElement;
  const ta = overlay.querySelector("#me-load-textarea") as HTMLTextAreaElement;
  ta?.addEventListener("input", () => {
    try {
      const d = JSON.parse(ta.value);
      if (!d.width || !d.height || !Array.isArray(d.walls) || !Array.isArray(d.spawnPoints)) {
        statusEl.textContent = "✗ Required: width, height, walls[], spawnPoints[]"; statusEl.style.color = "#e07070";
      } else {
        statusEl.textContent = `✓ Valid — ${d.width}×${d.height}, ${d.walls.length} walls, ${d.spawnPoints.length} spawns${(d.objects?.length ?? 0) > 0 ? `, ${d.objects.length} prefabs` : ""}`;
        statusEl.style.color = "#7bc67a";
      }
    } catch { statusEl.textContent = "✗ Invalid JSON"; statusEl.style.color = "#e07070"; }
  });
  overlay.querySelector("#me-load-confirm-btn")?.addEventListener("click", () => {
    try {
      const d = JSON.parse(ta.value) as MapData;
      if (!d.width || !d.height || !Array.isArray(d.walls) || !Array.isArray(d.spawnPoints)) {
        statusEl.textContent = "✗ Required fields missing"; statusEl.style.color = "#e07070"; return;
      }
      loadMapData(d); overlay.remove();
    } catch { statusEl.textContent = "✗ Invalid JSON"; statusEl.style.color = "#e07070"; }
  });
  overlay.querySelector("#me-load-close-btn")?.addEventListener("click", () => overlay.remove());
  ta?.focus();
}

function playTest() {
  const md = buildMapData();
  const json = JSON.stringify(md);
  closeMapEditor();
  // Open create room modal with custom map pre-filled
  const createModal = document.querySelector("#create-room-modal") as HTMLElement | null;
  const mapSelect   = document.querySelector("#map-select") as HTMLSelectElement | null;
  const customArea  = document.querySelector("#custom-map-area") as HTMLElement | null;
  const customJson  = document.querySelector("#custom-map-json") as HTMLTextAreaElement | null;
  if (mapSelect)  mapSelect.value = "custom";
  if (customArea) customArea.classList.remove("hidden");
  if (customJson) { customJson.value = json; customJson.dispatchEvent(new Event("input")); }
  if (createModal) createModal.classList.remove("hidden");
}

// ---------------------------------------------------------------------------
// Build HTML
// ---------------------------------------------------------------------------

function buildPaletteItem(id: string, label: string, color?: string): string {
  const style = color ? `border-left: 4px solid ${color};` : "";
  return `<div class="me-palette-item" id="${id}" style="${style}">${label}</div>`;
}

function buildEditorHtml(): string {
  const wallTypes: WallType[] = ["wall", "bush", "house", "oneway", "river", "bridge"];
  const wallItems = wallTypes.map((t) => buildPaletteItem(`me-tool-wall-${t}`, t, WALL_COLORS[t])).join("");

  const spawnItems = buildPaletteItem("me-tool-spawn-red", "● Red Spawn", "#c44040") + buildPaletteItem("me-tool-spawn-blue", "● Blue Spawn", "#4a6a8a");
  const flagItems  = buildPaletteItem("me-tool-flag-red",  "▲ Red Flag",  "#c44040") + buildPaletteItem("me-tool-flag-blue",  "▲ Blue Flag",  "#4a6a8a");

  const itemTypes: ItemType[] = ["medic", "ammo", "heart", "bomb", "rope", "boots", "smoke"];
  const itemItems = itemTypes.map((t) => buildPaletteItem(`me-tool-item-${t}`, t, "rgba(200,160,40,0.9)")).join("");

  // Prefab groups
  const pfbColor = "rgba(100,130,180,0.8)";
  const houseItems = (["house-s", "house-m", "house-l"] as PrefabType[]).map((t) => buildPaletteItem(`me-tool-pfb-${t}`, t, pfbColor)).join("");
  const baseItems  = (["base-1open", "base-2open-opposite", "base-2open-adjacent", "base-3open"] as PrefabType[]).map((t) => buildPaletteItem(`me-tool-pfb-${t}`, t.replace("base-","b-"), pfbColor)).join("");
  const riverItems = (["river-s", "river-m", "river-l", "river-elbow-gentle-s", "river-elbow-gentle-l", "river-elbow-mid-s", "river-elbow-mid-l", "river-elbow-sharp-s", "river-elbow-sharp-l"] as PrefabType[]).map((t) => buildPaletteItem(`me-tool-pfb-${t}`, t.replace("river-","rv-"), pfbColor)).join("");
  const bridgeItems = (["bridge-s", "bridge-l", "oneway", "bush"] as PrefabType[]).map((t) => buildPaletteItem(`me-tool-pfb-${t}`, t, pfbColor)).join("");

  return `
    <div class="me-header">
      <span class="me-title">TANK TAKTIX &nbsp;—&nbsp; <span style="color:#c99a30;">MAP EDITING</span> &nbsp;(${es.mapWidth}×${es.mapHeight})</span>
      <div style="display:flex;gap:6px;">
        <button id="me-load-btn" class="lobby-btn">LOAD JSON</button>
        <button id="me-back-btn" class="lobby-btn">← BACK</button>
      </div>
    </div>
    <div class="me-body">
      <div class="me-palette">
        <div class="me-palette-section">WALLS</div>${wallItems}
        <div class="me-palette-section">SPAWN</div>${spawnItems}
        <div class="me-palette-section">FLAGS</div>${flagItems}
        <div class="me-palette-section">ITEMS</div>${itemItems}
        <div class="me-palette-section" style="color:#6882b4;">PREFABS ▼</div>
        <div class="me-palette-section" style="font-size:9px;margin-top:2px;">Houses</div>${houseItems}
        <div class="me-palette-section" style="font-size:9px;margin-top:2px;">Bases</div>${baseItems}
        <div class="me-palette-section" style="font-size:9px;margin-top:2px;">Rivers</div>${riverItems}
        <div class="me-palette-section" style="font-size:9px;margin-top:2px;">Bridge/Other</div>${bridgeItems}
      </div>
      <div class="me-canvas-wrap">
        <canvas id="me-canvas"></canvas>
      </div>
      <div class="me-props">
        <div class="me-props-section">ROTATION</div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:12px;">
          <button class="me-props-btn" id="me-rot-ccw">◄</button>
          <span id="me-rotation-val" style="font-family:monospace;min-width:36px;text-align:center;">0°</span>
          <button class="me-props-btn" id="me-rot-cw">►</button>
        </div>
        <div class="me-props-section">SYMMETRY</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px;">
          <button class="me-props-btn active" id="me-sym-none">None</button>
          <button class="me-props-btn" id="me-sym-h">↔ H</button>
          <button class="me-props-btn" id="me-sym-v">↕ V</button>
          <button class="me-props-btn" id="me-sym-point">⊕ Pt</button>
        </div>
        <div class="me-props-section">SELECTED</div>
        <div id="me-selected-label" style="font-family:monospace;font-size:11px;color:#8a7348;margin-bottom:8px;">(none)</div>
        <button class="me-props-btn danger" id="me-delete-btn" disabled>Delete</button>
        <div style="margin-top:16px;font-size:11px;color:#8a7348;line-height:1.7;">
          <b>Keys:</b><br>
          R / Q: rotate ±15°<br>
          Ctrl+Z / Y: undo/redo<br>
          Del: delete<br>
          Scroll: zoom<br>
          Space+drag: pan<br>
          Esc: deselect
        </div>
      </div>
    </div>
    <div class="me-footer">
      <label style="font-size:12px;color:#8a7348;display:flex;align-items:center;gap:4px;cursor:pointer;">
        <input type="checkbox" id="me-snap-toggle" ${es.snapEnabled ? "checked" : ""}> Grid Snap
      </label>
      <span style="font-size:12px;color:#8a7348;">Zoom: <span id="me-zoom-val">100%</span></span>
      <div style="flex:1;"></div>
      <button class="lobby-btn" id="me-clear-btn">CLEAR ALL</button>
      <button class="lobby-btn" id="me-playtest-btn" style="background:rgba(80,140,80,0.3);border-color:rgba(80,140,80,0.6);">▶ PLAY TEST</button>
      <button class="lobby-btn primary" id="me-export-btn">EXPORT JSON</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// Attach events
// ---------------------------------------------------------------------------

function attachEditorEvents() {
  const container = document.querySelector("#map-editor-container") as HTMLElement;
  if (!container) return;

  container.querySelector("#me-back-btn")?.addEventListener("click", closeMapEditor);
  container.querySelector("#me-load-btn")?.addEventListener("click", showLoadOverlay);

  container.querySelectorAll(".me-palette-item").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.id;
      let tool: PaletteTool | null = null;
      if (id.startsWith("me-tool-wall-"))  tool = { kind: "wall",   wallType: id.replace("me-tool-wall-", "") as WallType };
      else if (id.startsWith("me-tool-spawn-")) tool = { kind: "spawn",  team: id.replace("me-tool-spawn-", "") as "red" | "blue" };
      else if (id.startsWith("me-tool-flag-"))  tool = { kind: "flag",   team: id.replace("me-tool-flag-", "") as "red" | "blue" };
      else if (id.startsWith("me-tool-item-"))  tool = { kind: "item",   itemType: id.replace("me-tool-item-", "") as ItemType };
      else if (id.startsWith("me-tool-pfb-"))   tool = { kind: "prefab", prefabType: id.replace("me-tool-pfb-", "") as PrefabType };
      if (tool) { es.activeTool = tool; updatePaletteHighlight(tool); if (canvas) canvas.style.cursor = "crosshair"; }
    });
  });

  container.querySelector("#me-rot-ccw")?.addEventListener("click", () => rotateSelected(-15));
  container.querySelector("#me-rot-cw")?.addEventListener("click", () => rotateSelected(15));

  (["none", "h", "v", "point"] as SymmetryMode[]).forEach((mode) => {
    container.querySelector(`#me-sym-${mode}`)?.addEventListener("click", () => {
      es.symmetryMode = mode; updateSymmetryButtons();
    });
  });

  container.querySelector("#me-delete-btn")?.addEventListener("click", deleteSelected);

  container.querySelector("#me-snap-toggle")?.addEventListener("change", (e) => {
    es.snapEnabled = (e.target as HTMLInputElement).checked;
  });

  container.querySelector("#me-clear-btn")?.addEventListener("click", () => {
    if (!confirm("Clear all placed objects?")) return;
    saveSnapshot();
    es.walls = []; es.spawnPoints = []; es.flagPositions = []; es.itemSpawns = []; es.objects = [];
    es.selectedIdx = null; updatePropertiesPanel();
  });

  container.querySelector("#me-export-btn")?.addEventListener("click", showExportOverlay);
  container.querySelector("#me-playtest-btn")?.addEventListener("click", playTest);

  canvas = container.querySelector("#me-canvas") as HTMLCanvasElement;
  if (!canvas) return;
  ctx = canvas.getContext("2d");
  if (!ctx) return;

  const wrap = container.querySelector(".me-canvas-wrap") as HTMLElement;
  new ResizeObserver(() => {
    if (canvas && wrap) { canvas.width = wrap.clientWidth; canvas.height = wrap.clientHeight; }
  }).observe(wrap);
  canvas.width = wrap.clientWidth; canvas.height = wrap.clientHeight;
  fitMapInView();

  canvas.addEventListener("mousedown", onMouseDown);
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);

  if (es.rafId !== null) cancelAnimationFrame(es.rafId);
  renderLoop();
}

function fitMapInView() {
  if (!canvas) return;
  const pad = 48;
  const zx = (canvas.width  - pad * 2) / es.mapWidth;
  const zy = (canvas.height - pad * 2) / es.mapHeight;
  es.zoom = Math.min(zx, zy, 1);
  es.panX = (canvas.width  - es.mapWidth  * es.zoom) / 2;
  es.panY = (canvas.height - es.mapHeight * es.zoom) / 2;
  updateFooterZoom();
}

// ---------------------------------------------------------------------------
// Size selection
// ---------------------------------------------------------------------------

function buildSizeSelectionHtml(): string {
  return `
    <div class="me-header">
      <span class="me-title">TANK TAKTIX &nbsp;—&nbsp; <span style="color:#c99a30;">MAP EDITOR</span></span>
      <button id="me-back-btn" class="lobby-btn">← BACK</button>
    </div>
    <div class="me-size-screen">
      <div class="me-size-card">
        <h2 style="font-family:monospace;margin:0 0 8px 0;">SELECT MAP SIZE</h2>
        <p style="color:#8a7348;font-size:13px;margin:0 0 24px 0;">Choose a preset or enter custom dimensions. You can also load an existing JSON after entering the editor.</p>
        <div class="me-size-grid">
          <button class="me-size-btn" data-w="800"  data-h="600" >Small<br><span style="font-size:11px;color:#8a7348;">800 × 600</span></button>
          <button class="me-size-btn" data-w="1200" data-h="900" >Medium<br><span style="font-size:11px;color:#8a7348;">1200 × 900</span></button>
          <button class="me-size-btn" data-w="1600" data-h="1200">Large<br><span style="font-size:11px;color:#8a7348;">1600 × 1200</span></button>
          <button class="me-size-btn" data-w="2000" data-h="1400">Extra Large<br><span style="font-size:11px;color:#8a7348;">2000 × 1400</span></button>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:16px;flex-wrap:wrap;justify-content:center;">
          <label style="font-size:12px;color:#8a7348;">Custom:</label>
          <input id="me-custom-w" type="number" value="1600" min="200" max="4000" step="50" style="width:70px;padding:4px;font-family:monospace;background:#1a1a0a;color:#d4c4a8;border:1px solid rgba(168,148,104,0.4);border-radius:4px;text-align:center;" />
          <span style="color:#8a7348;">×</span>
          <input id="me-custom-h" type="number" value="1200" min="200" max="4000" step="50" style="width:70px;padding:4px;font-family:monospace;background:#1a1a0a;color:#d4c4a8;border:1px solid rgba(168,148,104,0.4);border-radius:4px;text-align:center;" />
          <button class="lobby-btn primary" id="me-start-custom">START EDITING →</button>
        </div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function openMapEditor() {
  const container = document.querySelector("#map-editor-container") as HTMLElement | null;
  const layout    = document.querySelector(".lobby-layout") as HTMLElement | null;
  if (!container || !layout) return;

  es.walls = []; es.spawnPoints = []; es.flagPositions = []; es.itemSpawns = []; es.objects = [];
  es.activeTool = null; es.selectedIdx = null; es.symmetryMode = "none"; es.activeRotation = 0;
  es.isDrawing = false; es.drawStartWorld = null; es.activeInteraction = null;
  es.undoStack = []; es.redoStack = [];
  es.zoom = 1; es.panX = 0; es.panY = 0;
  canvas = null; ctx = null;
  if (es.rafId !== null) { cancelAnimationFrame(es.rafId); es.rafId = null; }

  layout.classList.add("hidden");
  container.classList.remove("hidden");
  container.innerHTML = buildSizeSelectionHtml();

  container.querySelector("#me-back-btn")?.addEventListener("click", closeMapEditor);

  container.querySelectorAll(".me-size-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      startEditor(parseInt((btn as HTMLElement).dataset.w ?? "1600"), parseInt((btn as HTMLElement).dataset.h ?? "1200"));
    });
  });

  container.querySelector("#me-start-custom")?.addEventListener("click", () => {
    const w = Math.max(200, Math.min(4000, parseInt((container.querySelector("#me-custom-w") as HTMLInputElement).value) || 1600));
    const h = Math.max(200, Math.min(4000, parseInt((container.querySelector("#me-custom-h") as HTMLInputElement).value) || 1200));
    startEditor(w, h);
  });
}

function startEditor(w: number, h: number) {
  es.mapWidth = w; es.mapHeight = h;
  const container = document.querySelector("#map-editor-container") as HTMLElement | null;
  if (!container) return;
  container.innerHTML = buildEditorHtml();
  attachEditorEvents();
}

export function closeMapEditor() {
  if (es.rafId !== null) { cancelAnimationFrame(es.rafId); es.rafId = null; }
  document.removeEventListener("keydown", onKeyDown);
  document.removeEventListener("keyup", onKeyUp);
  document.querySelector("#map-editor-container")?.classList.add("hidden");
  document.querySelector(".lobby-layout")?.classList.remove("hidden");
}
