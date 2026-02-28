import { CAMERA_SPEED, keysDown, ROTATION_STEP, state, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "../state";
import { drawEntities } from "./entities";
import { drawEffects } from "./effects";
import { drawHud } from "./hud";
import { drawWorld, finishWorld } from "./world";

export const createRenderer = (deps: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; chatInput: HTMLInputElement }) => {
  const { canvas, ctx, chatInput } = deps;
  const render = () => {
    requestAnimationFrame(render);
    if (state.phase !== "room") return;

    const camCos = Math.cos(state.camera.rotation);
    const camSin = Math.sin(state.camera.rotation);
    const spd = CAMERA_SPEED / state.camera.zoom;
    const chatActive = document.activeElement === chatInput;
    let camDx = 0, camDy = 0;
    if (keysDown.has("arrowleft") && !chatActive) camDx -= spd;
    if (keysDown.has("arrowright") && !chatActive) camDx += spd;
    if (keysDown.has("arrowup") && !chatActive) camDy -= spd;
    if (keysDown.has("arrowdown") && !chatActive) camDy += spd;
    state.camera.x += camDx * camCos + camDy * camSin;
    state.camera.y += -camDx * camSin + camDy * camCos;
    if (keysDown.has("=") || keysDown.has("+")) state.camera.zoom = Math.min(ZOOM_MAX, state.camera.zoom + ZOOM_STEP * 0.3);
    if (keysDown.has("-")) state.camera.zoom = Math.max(ZOOM_MIN, state.camera.zoom - ZOOM_STEP * 0.3);
    if (keysDown.has("q") && !chatActive) state.camera.rotation -= ROTATION_STEP * 0.3;
    if (keysDown.has("e") && !chatActive) state.camera.rotation += ROTATION_STEP * 0.3;

    drawWorld(ctx, canvas);
    drawEntities(ctx);
    drawEffects(ctx);
    finishWorld(ctx);
    drawHud(ctx, canvas);
  };
  return { render };
};
