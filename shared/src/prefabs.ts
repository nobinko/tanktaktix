/**
 * プレハブ定義と展開ロジック
 *
 * プレハブは再利用可能なマップオブジェクトの「型紙」。
 * MapData.objects[] にプレハブの配置を記述し、ゲーム開始時に
 * expandMapObjects() で Wall[] にフラット展開する。
 */
import type { PrefabType, Wall, WallType, MapData, MapObject } from "./index.js";

// ---------------------------------------------------------------------------
// プレハブ内パーツ定義（ローカル座標、中心 = (0,0)）
// ---------------------------------------------------------------------------

export type PrefabPart = {
    dx: number;        // 中心からのオフセットX
    dy: number;        // 中心からのオフセットY
    width: number;
    height: number;
    wallType: WallType;
    passable?: boolean;
};

export type PrefabDefinition = {
    type: PrefabType;
    parts: PrefabPart[];
};

// ---------------------------------------------------------------------------
// House（家）— 中身詰まった長方形ブロック
// ---------------------------------------------------------------------------

const HOUSE_S: PrefabDefinition = {
    type: "house-s",
    parts: [{ dx: 0, dy: 0, width: 60, height: 40, wallType: "house" }],
};

const HOUSE_M: PrefabDefinition = {
    type: "house-m",
    parts: [{ dx: 0, dy: 0, width: 120, height: 70, wallType: "house" }],
};

const HOUSE_L: PrefabDefinition = {
    type: "house-l",
    parts: [{ dx: 0, dy: 0, width: 180, height: 100, wallType: "house" }],
};

// ---------------------------------------------------------------------------
// Base（基地）— 壁で囲まれた空間、開口部あり
// 外寸 200x200、壁厚 20、開口幅 60（タンク1.5台分）
// ---------------------------------------------------------------------------

function createBaseParts(openings: ("north" | "south" | "east" | "west")[]): PrefabPart[] {
    const SIZE = 200;
    const THICK = 20;
    const GAP = 60;
    const HALF = SIZE / 2;
    const HALF_GAP = GAP / 2;
    const parts: PrefabPart[] = [];

    // 北壁 (top)
    if (!openings.includes("north")) {
        parts.push({ dx: 0, dy: -HALF + THICK / 2, width: SIZE, height: THICK, wallType: "wall" });
    } else {
        // 左半分
        parts.push({ dx: -(HALF_GAP + (HALF - HALF_GAP) / 2), dy: -HALF + THICK / 2, width: HALF - HALF_GAP, height: THICK, wallType: "wall" });
        // 右半分
        parts.push({ dx: (HALF_GAP + (HALF - HALF_GAP) / 2), dy: -HALF + THICK / 2, width: HALF - HALF_GAP, height: THICK, wallType: "wall" });
    }

    // 南壁 (bottom)
    if (!openings.includes("south")) {
        parts.push({ dx: 0, dy: HALF - THICK / 2, width: SIZE, height: THICK, wallType: "wall" });
    } else {
        parts.push({ dx: -(HALF_GAP + (HALF - HALF_GAP) / 2), dy: HALF - THICK / 2, width: HALF - HALF_GAP, height: THICK, wallType: "wall" });
        parts.push({ dx: (HALF_GAP + (HALF - HALF_GAP) / 2), dy: HALF - THICK / 2, width: HALF - HALF_GAP, height: THICK, wallType: "wall" });
    }

    // 西壁 (left) — 上下端の壁厚ぶんを引く
    const SIDE_HEIGHT = SIZE - THICK * 2;
    if (!openings.includes("west")) {
        parts.push({ dx: -HALF + THICK / 2, dy: 0, width: THICK, height: SIDE_HEIGHT, wallType: "wall" });
    } else {
        const segH = (SIDE_HEIGHT - GAP) / 2;
        parts.push({ dx: -HALF + THICK / 2, dy: -(GAP / 2 + segH / 2), width: THICK, height: segH, wallType: "wall" });
        parts.push({ dx: -HALF + THICK / 2, dy: (GAP / 2 + segH / 2), width: THICK, height: segH, wallType: "wall" });
    }

    // 東壁 (right)
    if (!openings.includes("east")) {
        parts.push({ dx: HALF - THICK / 2, dy: 0, width: THICK, height: SIDE_HEIGHT, wallType: "wall" });
    } else {
        const segH = (SIDE_HEIGHT - GAP) / 2;
        parts.push({ dx: HALF - THICK / 2, dy: -(GAP / 2 + segH / 2), width: THICK, height: segH, wallType: "wall" });
        parts.push({ dx: HALF - THICK / 2, dy: (GAP / 2 + segH / 2), width: THICK, height: segH, wallType: "wall" });
    }

    return parts;
}

const BASE_1OPEN: PrefabDefinition = {
    type: "base-1open",
    parts: createBaseParts(["south"]),  // 配置時の rotation で方向指定
};

const BASE_2OPEN_OPPOSITE: PrefabDefinition = {
    type: "base-2open-opposite",
    parts: createBaseParts(["north", "south"]),
};

const BASE_2OPEN_ADJACENT: PrefabDefinition = {
    type: "base-2open-adjacent",
    parts: createBaseParts(["north", "east"]),
};

const BASE_3OPEN: PrefabDefinition = {
    type: "base-3open",
    parts: createBaseParts(["north", "east", "south"]),
};

// ---------------------------------------------------------------------------
// River（川）— 通行不可の帯、幅80
// ---------------------------------------------------------------------------

const RIVER_S: PrefabDefinition = {
    type: "river-s",
    parts: [{ dx: 0, dy: 0, width: 200, height: 80, wallType: "river" }],
};

const RIVER_M: PrefabDefinition = {
    type: "river-m",
    parts: [{ dx: 0, dy: 0, width: 400, height: 80, wallType: "river" }],
};

const RIVER_L: PrefabDefinition = {
    type: "river-l",
    parts: [{ dx: 0, dy: 0, width: 600, height: 80, wallType: "river" }],
};

// ---------------------------------------------------------------------------
// River Elbow（川の曲がり）— セグメント分割でなめらかに表現
// 川幅80のまま45度曲がる。セグメント数で滑らかさが変わる。
// ---------------------------------------------------------------------------

function createRiverElbowParts(radius: number, segments: number): PrefabPart[] {
    const parts: PrefabPart[] = [];
    const RIVER_WIDTH = 80;
    // 45度 arc を segments 分割
    const totalAngle = Math.PI / 4; // 45 degrees
    const angleStep = totalAngle / segments;

    for (let i = 0; i < segments; i++) {
        const angle = i * angleStep;
        const nextAngle = (i + 1) * angleStep;
        const midAngle = (angle + nextAngle) / 2;

        // セグメント中心（弧の中心点）
        const cx = radius * Math.cos(midAngle);
        const cy = -radius * Math.sin(midAngle);

        // セグメントの長さ = 弧の長さの近似
        const arcLen = radius * angleStep;
        // 回転角度（度）— セグメントの接線方向
        const rotDeg = -(midAngle * 180 / Math.PI) + 90;

        parts.push({
            dx: cx,
            dy: cy,
            width: RIVER_WIDTH,
            height: arcLen,
            wallType: "river",
        });
        // Note: 展開時に個別の rotation を付与する必要がある
        // → PrefabPart に partRotation を追加
    }
    return parts;
}

// エルボーは複雑なので、シンプルなセグメント配列で近似する
// gentle: 大きな半径（緩やかなカーブ）
// mid: 中程度の半径
// sharp: 小さな半径（急カーブ）

function createRiverElbowSegments(radius: number, segments: number): PrefabPart[] {
    const parts: PrefabPart[] = [];
    const RIVER_WIDTH = 80;
    const totalAngle = Math.PI / 4; // 45度
    const angleStep = totalAngle / segments;

    for (let i = 0; i < segments; i++) {
        const angle = i * angleStep;
        const nextAngle = (i + 1) * angleStep;
        const midAngle = (angle + nextAngle) / 2;
        const cx = radius * Math.sin(midAngle);
        const cy = -radius * (1 - Math.cos(midAngle));
        const arcLen = radius * angleStep + 10; // 少しオーバーラップさせて隙間防止

        parts.push({
            dx: cx,
            dy: cy,
            width: RIVER_WIDTH,
            height: Math.max(arcLen, RIVER_WIDTH),
            wallType: "river",
        });
    }
    return parts;
}

const RIVER_ELBOW_GENTLE_S: PrefabDefinition = {
    type: "river-elbow-gentle-s",
    parts: createRiverElbowSegments(300, 5),
};

const RIVER_ELBOW_GENTLE_L: PrefabDefinition = {
    type: "river-elbow-gentle-l",
    parts: createRiverElbowSegments(500, 8),
};

const RIVER_ELBOW_MID_S: PrefabDefinition = {
    type: "river-elbow-mid-s",
    parts: createRiverElbowSegments(200, 3),
};

const RIVER_ELBOW_MID_L: PrefabDefinition = {
    type: "river-elbow-mid-l",
    parts: createRiverElbowSegments(350, 6),
};

const RIVER_ELBOW_SHARP_S: PrefabDefinition = {
    type: "river-elbow-sharp-s",
    parts: createRiverElbowSegments(120, 2),
};

const RIVER_ELBOW_SHARP_L: PrefabDefinition = {
    type: "river-elbow-sharp-l",
    parts: createRiverElbowSegments(180, 4),
};

// ---------------------------------------------------------------------------
// Bridge（橋）— 川の上に配置して通行可能にする
// ---------------------------------------------------------------------------

const BRIDGE_S: PrefabDefinition = {
    type: "bridge-s",
    parts: [{ dx: 0, dy: 0, width: 100, height: 150, wallType: "bridge", passable: true }],
};

const BRIDGE_L: PrefabDefinition = {
    type: "bridge-l",
    parts: [{ dx: 0, dy: 0, width: 100, height: 250, wallType: "bridge", passable: true }],
};

// ---------------------------------------------------------------------------
// Oneway（一方通行壁）
// ---------------------------------------------------------------------------

const ONEWAY: PrefabDefinition = {
    type: "oneway",
    parts: [{ dx: 0, dy: 0, width: 120, height: 20, wallType: "oneway" }],
};

// ---------------------------------------------------------------------------
// Bush（動的ブッシュ）— 円形、半径40 → 80x80の正方形で近似
// ---------------------------------------------------------------------------

const BUSH: PrefabDefinition = {
    type: "bush",
    parts: [{ dx: 0, dy: 0, width: 80, height: 80, wallType: "bush" }],
};

// ---------------------------------------------------------------------------
// レジストリ
// ---------------------------------------------------------------------------

export const PREFAB_REGISTRY: Record<PrefabType, PrefabDefinition> = {
    "house-s": HOUSE_S,
    "house-m": HOUSE_M,
    "house-l": HOUSE_L,
    "base-1open": BASE_1OPEN,
    "base-2open-opposite": BASE_2OPEN_OPPOSITE,
    "base-2open-adjacent": BASE_2OPEN_ADJACENT,
    "base-3open": BASE_3OPEN,
    "river-s": RIVER_S,
    "river-m": RIVER_M,
    "river-l": RIVER_L,
    "river-elbow-gentle-s": RIVER_ELBOW_GENTLE_S,
    "river-elbow-gentle-l": RIVER_ELBOW_GENTLE_L,
    "river-elbow-mid-s": RIVER_ELBOW_MID_S,
    "river-elbow-mid-l": RIVER_ELBOW_MID_L,
    "river-elbow-sharp-s": RIVER_ELBOW_SHARP_S,
    "river-elbow-sharp-l": RIVER_ELBOW_SHARP_L,
    "bridge-s": BRIDGE_S,
    "bridge-l": BRIDGE_L,
    "oneway": ONEWAY,
    "bush": BUSH,
};

// ---------------------------------------------------------------------------
// 展開ロジック
// ---------------------------------------------------------------------------

import { MAX_OBJECTS, MAX_WALLS_TOTAL } from "./validation.js";

/**
 * 度をラジアンに変換
 */
function degToRad(deg: number): number {
    return (deg * Math.PI) / 180;
}

/**
 * 点 (px, py) を原点中心に angle ラジアン回転
 */
function rotatePoint(px: number, py: number, angle: number): { x: number; y: number } {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
        x: px * cos - py * sin,
        y: px * sin + py * cos,
    };
}

/**
 * MapData の objects[] を展開して walls[] に追加する。
 * 元の walls[] はそのまま維持（併用）。
 * 動的ブッシュは dynamicBushes[] として別管理。
 *
 * @returns 展開済みの MapData（walls[] が拡張されたもの）
 */
export function expandMapObjects(mapData: MapData): MapData {
    const objects = mapData.objects;
    if (!objects || objects.length === 0) {
        return mapData;
    }

    if (objects.length > MAX_OBJECTS) {
        console.warn(`[prefabs] オブジェクト数 ${objects.length} が上限 ${MAX_OBJECTS} を超えています。先頭 ${MAX_OBJECTS} 個のみ展開します。`);
    }

    const expandedWalls: Wall[] = [...mapData.walls];
    const dynamicBushes: { x: number; y: number }[] = [...(mapData.dynamicBushes || [])];

    const objectsToExpand = objects.slice(0, MAX_OBJECTS);

    for (const obj of objectsToExpand) {
        const def = PREFAB_REGISTRY[obj.type];
        if (!def) {
            console.warn(`[prefabs] 未知のプレハブタイプ: ${obj.type}`);
            continue;
        }

        // 動的ブッシュは別管理
        if (obj.type === "bush") {
            dynamicBushes.push({ x: obj.x, y: obj.y });
            continue;
        }

        const objRotRad = degToRad(obj.rotation || 0);

        for (const part of def.parts) {
            // パーツの中心をオブジェクトの座標に回転配置
            const rotated = rotatePoint(part.dx, part.dy, objRotRad);

            const wall: Wall = {
                x: obj.x + rotated.x - part.width / 2,
                y: obj.y + rotated.y - part.height / 2,
                width: part.width,
                height: part.height,
                type: part.wallType,
                rotation: obj.rotation || 0,
            };

            if (part.passable) {
                wall.passable = true;
            }

            expandedWalls.push(wall);
        }
    }

    // 上限チェック
    if (expandedWalls.length > MAX_WALLS_TOTAL) {
        console.warn(`[prefabs] 展開後の Wall 総数 ${expandedWalls.length} が上限 ${MAX_WALLS_TOTAL} を超えています。${MAX_WALLS_TOTAL} 個に制限します。`);
        expandedWalls.length = MAX_WALLS_TOTAL;
    }

    return {
        ...mapData,
        walls: expandedWalls,
        dynamicBushes: dynamicBushes.length > 0 ? dynamicBushes : undefined,
    };
}
