import type { ClientToServerMessage, Vector2 } from "@tanktaktix/shared";
import { state } from "../state.js";

const isMouseOnTank = (point: Vector2, tankPos: Vector2) => Math.hypot(point.x - tankPos.x, point.y - tankPos.y) <= 18;

export const getCanvasPoint = (event: MouseEvent, canvas: HTMLCanvasElement): Vector2 => {
  const rect = canvas.getBoundingClientRect();
  let sx = ((event.clientX - rect.left) / rect.width) * canvas.width - canvas.width / 2;
  let sy = ((event.clientY - rect.top) / rect.height) * canvas.height - canvas.height / 2;
  sx /= state.camera.zoom;
  sy /= state.camera.zoom;
  const cos = Math.cos(-state.camera.rotation);
  const sin = Math.sin(-state.camera.rotation);
  const rx = sx * cos - sy * sin;
  const ry = sx * sin + sy * cos;
  return { x: rx + state.camera.x + state.mapSize.width / 2, y: ry + state.camera.y + state.mapSize.height / 2 };
};

export const attachMouseInput = (deps: {
  canvas: HTMLCanvasElement;
  chatInput: HTMLInputElement;
  getSelf: () => any;
  sendMessage: (m: ClientToServerMessage) => void;
}) => {
  const { canvas, chatInput, getSelf, sendMessage } = deps;
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("mousedown", (event) => {
    if (state.phase !== "room" || state.isSpectator || document.activeElement === chatInput) return;
    const self = getSelf();
    if (!self) return;
    const point = getCanvasPoint(event, canvas);
    if (event.button === 0) {
      if (isMouseOnTank(point, (self as any).position)) {
        state.aiming = true;
        state.aimPoint = point;
        return;
      }
      sendMessage({ type: "move", payload: { target: point } });
    }
  });
  window.addEventListener("mousemove", (event) => {
    if (!state.aiming) return;
    state.aimPoint = getCanvasPoint(event, canvas);
  });
  window.addEventListener("mouseup", (event) => {
    if (!state.aiming || state.phase !== "room") return;
    const self = getSelf();
    if (!self) {
      state.aiming = false;
      return;
    }
    const point = getCanvasPoint(event, canvas);
    const selfPos = (self as any).position;
    if (isMouseOnTank(point, selfPos)) {
      state.aiming = false;
      state.aimPoint = null;
      return;
    }
    const shootX = -(point.x - selfPos.x);
    const shootY = -(point.y - selfPos.y);
    const len = Math.hypot(shootX, shootY);
    if (len > 0) sendMessage({ type: "shoot", payload: { direction: { x: shootX / len, y: shootY / len } } });
    state.aiming = false;
    state.aimPoint = null;
  });
};
