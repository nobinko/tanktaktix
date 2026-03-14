import { compileMapGeometry, MAPS } from "@tanktaktix/shared";
import { drawGeometryFlat } from "./terrain.js";

// タイトル画面背景描画モジュール
// MAPS["alpha"] のワールドをゆっくりスクロールさせるフォールバック映像を提供する

let animFrameId = 0;
let running = false;

// 仮想カメラ状態
const cam = {
    x: 0,
    y: 0,
    vx: 0.1,
    vy: 0.06,
    zoom: 0.55,
};

const DEMO_MAP_KEY = "alpha";

export const startTitleRenderer = () => {
    const canvas = document.querySelector("#title-bg") as HTMLCanvasElement | null;
    if (!canvas) return;

    running = true;

    const resize = () => {
        canvas.width = canvas.clientWidth || window.innerWidth;
        canvas.height = canvas.clientHeight || window.innerHeight;
    };
    window.addEventListener("resize", resize, { once: false });
    resize();

    const mapData = (MAPS as any)[DEMO_MAP_KEY];
    if (!mapData) return;
    const geometry = compileMapGeometry(mapData);

    const mapW: number = mapData.width || 1800;
    const mapH: number = mapData.height || 1040;

    const tick = () => {
        if (!running) return;
        animFrameId = requestAnimationFrame(tick);

        const w = canvas.width;
        const h = canvas.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // カメラをゆっくりパン（端に達したら反転）
        const viewW = w / cam.zoom;
        const viewH = h / cam.zoom;
        const limitX = mapW - viewW;
        const limitY = mapH - viewH;

        cam.x += cam.vx;
        cam.y += cam.vy;

        if (limitX > 0) {
            if (cam.x < 0) { cam.x = 0; cam.vx = Math.abs(cam.vx); }
            if (cam.x > limitX) { cam.x = limitX; cam.vx = -Math.abs(cam.vx); }
        } else {
            cam.x = 0;
        }
        if (limitY > 0) {
            if (cam.y < 0) { cam.y = 0; cam.vy = Math.abs(cam.vy); }
            if (cam.y > limitY) { cam.y = limitY; cam.vy = -Math.abs(cam.vy); }
        } else {
            cam.y = 0;
        }

        // 背景塗り
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = "#2a2018";
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.scale(cam.zoom, cam.zoom);
        ctx.translate(-cam.x, -cam.y);

        // グリッド
        ctx.strokeStyle = "rgba(180, 150, 80, 0.06)";
        ctx.lineWidth = 1;
        for (let x = 0; x < mapW; x += 60) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, mapH); ctx.stroke();
        }
        for (let y = 0; y < mapH; y += 60) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(mapW, y); ctx.stroke();
        }

        // 壁・地形
        drawGeometryFlat(ctx, geometry);

        // スポーンゾーン（暗い色で）
        if (mapData.spawnPoints) {
            for (const sp of mapData.spawnPoints as any[]) {
                const rgb = sp.team === "red" ? "160,50,50" : "50,80,120";
                ctx.fillStyle = `rgba(${rgb}, 0.18)`;
                ctx.fillRect(sp.x - 100, sp.y - 100, 200, 200);
            }
        }

        ctx.restore();

        // 薄い暗幕オーバーレイ（UIパネルの読みやすさ向上）
        ctx.fillStyle = "rgba(10, 6, 2, 0.45)";
        ctx.fillRect(0, 0, w, h);
    };

    animFrameId = requestAnimationFrame(tick);
};

export const stopTitleRenderer = () => {
    running = false;
    if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = 0;
    }
};
