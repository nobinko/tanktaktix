import type { ClientToServerMessage } from "@tanktaktix/shared";
import { keysDown, state, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "../state.js";
import { dom } from "../ui/dom.js";

export const attachKeyboardInput = (deps: {
  chatInput: HTMLInputElement;
  sendMessage: (m: ClientToServerMessage) => void;
}) => {
  const { chatInput, sendMessage } = deps;

  window.addEventListener("keydown", (event) => {
    keysDown.add(event.key.toLowerCase());
    if (state.phase !== "room") return;

    const key = event.key.toLowerCase();
    const isChatActive = document.activeElement === chatInput;

    // Chat Focus
    if (key === "t" && !isChatActive) {
      dom.chatContainer().classList.add("active");
      chatInput.focus();
      event.preventDefault();
      return;
    }

    if (isChatActive) {
      if (key === "enter") {
        const message = chatInput.value.trim();
        const channel = dom.chatChannel().value as "global" | "team";
        if (message) sendMessage({ type: "chat", payload: { message, channel: (channel as any) } });
        chatInput.value = "";
        dom.chatContainer().classList.remove("active");
        chatInput.blur();
      } else if (key === "escape") {
        chatInput.value = "";
        dom.chatContainer().classList.remove("active");
        chatInput.blur();
      }
      return;
    }

    // Move Cancel
    if (key === "z" && !state.isSpectator) {
      sendMessage({ type: "moveCancelOne" });
      return;
    }

    // Item / Flag Actions (R, A, H, F)
    const aimKeys = ["r", "a", "h", "f"];
    if (aimKeys.includes(key) && !state.isSpectator) {
      event.preventDefault();
      const me = state.players.find((p) => p.id === state.selfId);
      if (me) {
        let dirX = 0, dirY = 0;
        if (state.aiming && state.aimPoint) {
          // Slingshot: Opposite of drag vector
          dirX = -(state.aimPoint.x - me.position.x);
          dirY = -(state.aimPoint.y - me.position.y);
        } else {
          // Regular: Turret direction
          const ta = (me as any).turretAngle || 0;
          dirX = Math.cos(ta);
          dirY = Math.sin(ta);
        }
        const len = Math.hypot(dirX, dirY);
        let itemName = "rope";
        if (key === "a") itemName = "ammo";
        if (key === "h") itemName = "heal";
        if (key === "f") itemName = "flag";

        if (len > 0) {
          sendMessage({ type: "useItem", payload: { item: itemName, direction: { x: dirX / len, y: dirY / len } } });
        }
      }
      return;
    }

    // Snap Camera
    if (key === " ") {
      const me = state.players.find((p) => p.id === state.selfId);
      if (me) {
        state.camera.x = me.position.x - state.mapSize.width / 2;
        state.camera.y = me.position.y - state.mapSize.height / 2;
      } else {
        state.camera.x = 0; state.camera.y = 0;
      }
      state.camera.zoom = 1;
      state.camera.rotation = 0;
      event.preventDefault();
    }
  });

  window.addEventListener("keyup", (event) => keysDown.delete(event.key.toLowerCase()));

  const canvas = document.querySelector("#map") as HTMLCanvasElement;
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (event.deltaY < 0) state.camera.zoom = Math.min(ZOOM_MAX, state.camera.zoom + ZOOM_STEP);
    else state.camera.zoom = Math.max(ZOOM_MIN, state.camera.zoom - ZOOM_STEP);
  }, { passive: false });
};
