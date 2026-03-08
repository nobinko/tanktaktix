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

/** riverside — 川戦場  点対称中心: (800, 600) */
export const MAP_RIVERSIDE: MapData = {
    id: "riverside",
    width: 1600,
    height: 1200,
    walls: [
        // === 川 ===
        { x: 760, y: 0, width: 80, height: 350, type: "river" },
        { x: 760, y: 450, width: 80, height: 300, type: "river" },
        { x: 760, y: 850, width: 80, height: 350, type: "river" },
        // === 橋 ===
        { x: 740, y: 330, width: 120, height: 140, type: "bridge", passable: true },
        { x: 740, y: 730, width: 120, height: 140, type: "bridge", passable: true },
        // === 遮蔽（点対称ペア）===
        { x: 200, y: 150, width: 120, height: 70, type: "house" },
        { x: 1280, y: 980, width: 120, height: 70, type: "house" },
        { x: 200, y: 980, width: 120, height: 70, type: "house" },
        { x: 1280, y: 150, width: 120, height: 70, type: "house" },
        { x: 450, y: 530, width: 60, height: 140, type: "wall" },
        { x: 1090, y: 530, width: 60, height: 140, type: "wall" },
        // === 橋付近ブッシュ（橋のy/高さに揃える）===
        { x: 620, y: 330, width: 100, height: 140, type: "bush" },   // 北橋の西
        { x: 880, y: 730, width: 100, height: 140, type: "bush" },   // 南橋の東（点対称）
        { x: 880, y: 330, width: 100, height: 140, type: "bush" },   // 北橋の東
        { x: 620, y: 730, width: 100, height: 140, type: "bush" },   // 南橋の西（点対称）
        // === 小カバー ===
        { x: 550, y: 200, width: 60, height: 40, type: "house" },
        { x: 990, y: 960, width: 60, height: 40, type: "house" },
        // === ワンウェイ（斜め、大ハウスと小ハウスの間）===
        { x: 465, y: 65, width: 20, height: 120, type: "oneway", rotation: 37, direction: "right" },
        { x: 1115, y: 1015, width: 20, height: 120, type: "oneway", rotation: 37, direction: "left" },
    ],
    spawnPoints: [
        { team: "red", x: 150, y: 600, radius: 120 },
        { team: "blue", x: 1450, y: 600, radius: 120 },
    ],
    flagPositions: [
        { team: "red", x: 550, y: 600 },
        { team: "blue", x: 1050, y: 600 },
    ],
};

/** fortress — 二つの砦  点対称中心: (900, 600) */
export const MAP_FORTRESS: MapData = {
    id: "fortress",
    width: 1800,
    height: 1200,
    walls: [
        // === Red基地(左,右開口) ↔ Blue基地(右,左開口) ===
        { x: 50, y: 400, width: 200, height: 20, type: "wall" },
        { x: 1550, y: 780, width: 200, height: 20, type: "wall" },
        { x: 50, y: 780, width: 200, height: 20, type: "wall" },
        { x: 1550, y: 400, width: 200, height: 20, type: "wall" },
        { x: 50, y: 420, width: 20, height: 130, type: "wall" },
        { x: 1730, y: 650, width: 20, height: 130, type: "wall" },
        { x: 50, y: 650, width: 20, height: 130, type: "wall" },
        { x: 1730, y: 420, width: 20, height: 130, type: "wall" },
        // === 中央 ===
        { x: 840, y: 540, width: 120, height: 120, type: "house" },
        // === カバー ===
        { x: 600, y: 300, width: 60, height: 40, type: "house" },
        { x: 1140, y: 860, width: 60, height: 40, type: "house" },
        { x: 600, y: 860, width: 60, height: 40, type: "house" },
        { x: 1140, y: 300, width: 60, height: 40, type: "house" },
        // === ブッシュ ===
        { x: 750, y: 150, width: 300, height: 120, type: "bush" },
        { x: 750, y: 930, width: 300, height: 120, type: "bush" },
        // === 水場 ===
        { x: 0, y: 0, width: 200, height: 150, type: "water" },
        { x: 1600, y: 1050, width: 200, height: 150, type: "water" },
        { x: 1600, y: 0, width: 200, height: 150, type: "water" },
        { x: 0, y: 1050, width: 200, height: 150, type: "water" },
        // === 前哨 ===
        { x: 320, y: 550, width: 80, height: 100, type: "wall" },
        { x: 1400, y: 550, width: 80, height: 100, type: "wall" },
        // === ワンウェイ ===
        { x: 850, y: 380, width: 100, height: 20, type: "oneway", direction: "down" },
        { x: 850, y: 800, width: 100, height: 20, type: "oneway", direction: "up" },

    ],
    spawnPoints: [
        { team: "red", x: 150, y: 600, radius: 120 },
        { team: "blue", x: 1650, y: 600, radius: 120 },
    ],
    flagPositions: [
        { team: "red", x: 730, y: 190 },
        { team: "red", x: 300, y: 400 },
        { team: "blue", x: 1070, y: 1010 },
        { team: "blue", x: 1500, y: 800 },
    ],
};


export const MAPS: Record<string, MapData> = {
    riverside: MAP_RIVERSIDE,
    fortress: MAP_FORTRESS,
};

