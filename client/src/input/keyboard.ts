import type { ClientToServerMessage } from "@tanktaktix/shared";
import { keysDown, mapSize, state, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "../state";

export const attachKeyboardInput = (deps: {
  chatInput: HTMLInputElement;
  sendMessage: (m: ClientToServerMessage) => void;
}) => {
  const { chatInput, sendMessage } = deps;

  window.addEventListener("keydown", (event) => {
    keysDown.add(event.key.toLowerCase());
    if (state.phase !== "room") return;
    const key = event.key.toLowerCase();
    if (key === "t" && document.activeElement !== chatInput) {
      chatInput.classList.add("active");
      chatInput.focus();
      event.preventDefault();
      return;
    }
    if (key === "z" && document.activeElement !== chatInput && !state.isSpectator) {
      sendMessage({ type: "moveCancelOne" });
      return;
    }
    if (key === " " && document.activeElement !== chatInput) {
      const me = state.players.find((p) => p.id === state.selfId);
      if (me) {
        state.camera.x = me.position.x - mapSize.width / 2;
        state.camera.y = me.position.y - mapSize.height / 2;
      } else {
        state.camera.x = 0;
        state.camera.y = 0;
      }
      state.camera.zoom = 1;
      state.camera.rotation = 0;
      event.preventDefault();
    }
  });

  window.addEventListener("keyup", (event) => keysDown.delete(event.key.toLowerCase()));
  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const message = chatInput.value.trim();
      if (message) sendMessage({ type: "chat", payload: { message } });
      chatInput.value = "";
      chatInput.classList.remove("active");
    }
    if (event.key === "Escape") {
      chatInput.value = "";
      chatInput.classList.remove("active");
    }
  });
  const canvas = document.querySelector("#map") as HTMLCanvasElement;
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (event.deltaY < 0) state.camera.zoom = Math.min(ZOOM_MAX, state.camera.zoom + ZOOM_STEP);
    else state.camera.zoom = Math.max(ZOOM_MIN, state.camera.zoom - ZOOM_STEP);
  }, { passive: false });
};
