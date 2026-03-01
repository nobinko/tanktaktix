import { CAMERA_SPEED, keysDown, ROTATION_STEP, state, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "../state";
import { drawEntities } from "./entities";
import { drawEffects } from "./effects";
import { drawHud } from "./hud";
import { drawWorld, finishWorld } from "./world";

export const createRenderer = (deps: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; chatInput: HTMLInputElement }) => {
  const { canvas, ctx, chatInput } = deps;

  const resize = () => {
    const parent = canvas.parentElement;
    if (parent) {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    }
  };
  window.addEventListener("resize", resize);
  resize();

  const render = () => {
    requestAnimationFrame(render);
    if (state.phase !== "room") return;

    // Ensure canvas matches its container
    if (canvas.parentElement && (canvas.width !== canvas.parentElement.clientWidth || canvas.height !== canvas.parentElement.clientHeight)) {
      resize();
    }

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

    // Clamp camera within map boundaries (account for zoom and viewport size)
    // Add 25% margin on each side (total 50% extra freedom) as requested by the user
    const vw = canvas.width / state.camera.zoom;
    const vh = canvas.height / state.camera.zoom;
    const marginX = vw * 0.25;
    const marginY = vh * 0.25;
    const limitX = Math.max(0, (state.mapSize.width - vw) / 2) + marginX;
    const limitY = Math.max(0, (state.mapSize.height - vh) / 2) + marginY;

    state.camera.x = Math.max(-limitX, Math.min(limitX, state.camera.x));
    state.camera.y = Math.max(-limitY, Math.min(limitY, state.camera.y));

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
