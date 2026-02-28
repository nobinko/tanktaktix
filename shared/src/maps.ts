import type { MapData, WallType, Wall } from "./index.js";

function createBase(x: number, y: number, size: number, entranceType: "top-bottom" | "1-way" | "adjacent" | "3-way" | "open-right" | "open-left" | "open-top" | "open-bottom", thickness: number = 40, type: WallType = "wall"): Wall[] {
    const walls: Wall[] = [];
    const g = 100; // Entrance gap size
    const s2 = size / 2;
    const hg = g / 2; // half gap

    const addWall = (wx: number, wy: number, w: number, h: number) => walls.push({ x: wx, y: wy, width: w, height: h, type });

    // Top
    if (entranceType !== "open-top") {
        if (entranceType === "top-bottom" || entranceType === "3-way") {
            addWall(x, y, s2 - hg, thickness);
            addWall(x + s2 + hg, y, s2 - hg, thickness);
        } else {
            addWall(x, y, size, thickness);
        }
    }

    // Bottom
    if (entranceType !== "open-bottom") {
        if (entranceType === "top-bottom" || entranceType === "1-way" || entranceType === "adjacent" || entranceType === "3-way") {
            addWall(x, y + size - thickness, s2 - hg, thickness);
            addWall(x + s2 + hg, y + size - thickness, s2 - hg, thickness);
        } else {
            addWall(x, y + size - thickness, size, thickness);
        }
    }

    // Left
    if (entranceType !== "open-left") {
        if (entranceType === "3-way") {
            addWall(x, y + thickness, thickness, s2 - hg - thickness);
            addWall(x, y + s2 + hg, thickness, s2 - hg - thickness);
        } else {
            addWall(x, y + thickness, thickness, size - thickness * 2);
        }
    }

    // Right
    if (entranceType !== "open-right") {
        if (entranceType === "adjacent") {
            addWall(x + size - thickness, y + thickness, thickness, s2 - hg - thickness);
            addWall(x + size - thickness, y + s2 + hg, thickness, s2 - hg - thickness);
        } else {
            addWall(x + size - thickness, y + thickness, thickness, size - thickness * 2);
        }
    }

    return walls;
}

/** alpha — クラシック: 縦壁2本＋角カバー＋中央アイランド */
export const MAP_ALPHA: MapData = {
    id: "alpha",
    width: 1800,
    height: 1040,
    walls: [
        { x: 600, y: 200, width: 60, height: 440 },  // 左縦壁
        { x: 1140, y: 400, width: 60, height: 440 },  // 右縦壁（下寄せ）
        { x: 180, y: 160, width: 220, height: 60 },  // 左上カバー
        { x: 1400, y: 820, width: 220, height: 60 },  // 右下カバー
        { x: 840, y: 460, width: 120, height: 120 },  // 中央アイランド
    ],
    spawnPoints: [
        { team: "red", x: 120, y: 520 },
        { team: "blue", x: 1680, y: 520 },
    ],
    flagPositions: [
        { team: "red", x: 120, y: 520 },
        { team: "blue", x: 1680, y: 520 },
    ],
};

/** beta — アーバン: 6本縦ピラーで3コリドー＋左右カバー */
export const MAP_BETA: MapData = {
    id: "beta",
    width: 1800,
    height: 1040,
    walls: [
        { x: 400, y: 180, width: 60, height: 280 },  // 左上ピラー
        { x: 400, y: 580, width: 60, height: 280 },  // 左下ピラー
        { x: 870, y: 120, width: 60, height: 340 },  // 中央上ピラー
        { x: 870, y: 580, width: 60, height: 340 },  // 中央下ピラー
        { x: 1340, y: 180, width: 60, height: 280 },  // 右上ピラー
        { x: 1340, y: 580, width: 60, height: 280 },  // 右下ピラー
        { x: 160, y: 460, width: 180, height: 60 },  // 左横カバー
        { x: 1460, y: 520, width: 180, height: 60 },  // 右横カバー
    ],
    spawnPoints: [
        { team: "red", x: 80, y: 520 },
        { team: "blue", x: 1720, y: 520 },
    ],
    flagPositions: [
        { team: "red", x: 80, y: 520 },
        { team: "blue", x: 1720, y: 520 },
    ],
};

/** gamma — フォート: 中央要塞＋外側カバー2個 */
export const MAP_GAMMA: MapData = {
    id: "gamma",
    width: 1800,
    height: 1040,
    walls: [
        { x: 560, y: 200, width: 60, height: 260 },  // 要塞 左上縦
        { x: 1180, y: 200, width: 60, height: 260 },  // 要塞 右上縦
        { x: 560, y: 580, width: 60, height: 260 },  // 要塞 左下縦
        { x: 1180, y: 580, width: 60, height: 260 },  // 要塞 右下縦
        { x: 620, y: 200, width: 560, height: 60 },  // 要塞 上辺
        { x: 620, y: 780, width: 560, height: 60 },  // 要塞 下辺
        { x: 200, y: 440, width: 240, height: 60 },  // 左外カバー
        { x: 1360, y: 540, width: 240, height: 60 },  // 右外カバー
    ],
    spawnPoints: [
        { team: "red", x: 100, y: 520 },
        { team: "blue", x: 1700, y: 520 },
    ],
    flagPositions: [
        { team: "red", x: 100, y: 520 },
        { team: "blue", x: 1700, y: 520 },
    ],
};

/** delta — 自然: ブッシュと水場が点対称に配置 */
export const MAP_DELTA: MapData = {
    id: "delta",
    width: 1800,
    height: 1040,
    walls: [
        // 左上ブッシュ (Red側隠れ家)
        { x: 250, y: 170, width: 250, height: 300, type: "bush" },
        // 左下水場
        { x: 250, y: 570, width: 250, height: 300, type: "water" },
        // 右下ブッシュ (Blue側隠れ家) — 点対称
        { x: 1300, y: 570, width: 250, height: 300, type: "bush" },
        // 右上水場 — 点対称
        { x: 1300, y: 170, width: 250, height: 300, type: "water" },
        // 中央壁（上下対称）
        { x: 850, y: 100, width: 100, height: 280, type: "wall" },
        { x: 850, y: 660, width: 100, height: 280, type: "wall" },
    ],
    spawnPoints: [
        { team: "red", x: 100, y: 520 },
        { team: "blue", x: 1700, y: 520 },
    ],
    flagPositions: [
        { team: "red", x: 100, y: 520 },
        { team: "blue", x: 1700, y: 520 },
    ],
};

/** epsilon — テスト: 障害物検証用マップ (Playable & Symmetric) */
export const MAP_EPSILON: MapData = {
    id: "epsilon",
    width: 1800,
    height: 1040,
    walls: [
        // Red Base Protections ( [ shaped )
        ...createBase(25, 420, 200, "open-right", 30, "house"),

        // Blue Base Protections (Point Symmetric to Red, ] shaped )
        ...createBase(1575, 420, 200, "open-left", 30, "house"),

        // Central One-Way Corridors
        { x: 800, y: 300, width: 20, height: 150, type: "oneway", direction: "right" },
        { x: 980, y: 590, width: 20, height: 150, type: "oneway", direction: "left" },
        { x: 800, y: 700, width: 150, height: 20, type: "oneway", direction: "up" },
        { x: 850, y: 320, width: 150, height: 20, type: "oneway", direction: "down" },

        // Obstacles
        { x: 860, y: 480, width: 80, height: 80, type: "house" }, // Center block
        { x: 350, y: 150, width: 200, height: 60, type: "wall" }, // Top structure
        { x: 1250, y: 830, width: 200, height: 60, type: "wall" }, // Bottom structure

        // Additional symmetry covers
        { x: 450, y: 750, width: 60, height: 150, type: "bush" },
        { x: 1290, y: 140, width: 60, height: 150, type: "bush" },
    ],
    spawnPoints: [
        { team: "red", x: 125, y: 520 },
        { team: "blue", x: 1675, y: 520 },
    ],
    flagPositions: [
        { team: "red", x: 100, y: 520 },
        { team: "blue", x: 1700, y: 520 },
    ],
};

export const MAP_TEST_S: MapData = {
    id: "test-s",
    width: 1000,
    height: 1000,
    walls: [],
    spawnPoints: [
        { team: "red", x: 100, y: 500 },
        { team: "blue", x: 900, y: 500 },
    ],
    flagPositions: [
        { team: "red", x: 100, y: 500 },
        { team: "blue", x: 900, y: 500 },
    ],
};

export const MAP_TEST_M: MapData = {
    id: "test-m",
    width: 1200,
    height: 1200,
    walls: [],
    spawnPoints: [
        { team: "red", x: 100, y: 600 },
        { team: "blue", x: 1100, y: 600 },
    ],
    flagPositions: [
        { team: "red", x: 100, y: 600 },
        { team: "blue", x: 1100, y: 600 },
    ],
};

export const MAP_TEST_L: MapData = {
    id: "test-l",
    width: 1500,
    height: 1500,
    walls: [],
    spawnPoints: [
        { team: "red", x: 100, y: 750 },
        { team: "blue", x: 1400, y: 750 },
    ],
    flagPositions: [
        { team: "red", x: 100, y: 750 },
        { team: "blue", x: 1400, y: 750 },
    ],
};

export const MAPS: Record<string, MapData> = {
    alpha: MAP_ALPHA,
    beta: MAP_BETA,
    gamma: MAP_GAMMA,
    delta: MAP_DELTA,
    epsilon: MAP_EPSILON,
    "test-s": MAP_TEST_S,
    "test-m": MAP_TEST_M,
    "test-l": MAP_TEST_L,
};
