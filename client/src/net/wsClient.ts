import type { ClientToServerMessage, ServerToClientMessage } from "@tanktaktix/shared";

let ws: WebSocket | null = null;

export const connectWs = (onMessage: (message: ServerToClientMessage) => void, onClose: (message: string) => void) => {
  if (ws) return;
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
  ws.addEventListener("message", (event) => {
    onMessage(JSON.parse(event.data) as ServerToClientMessage);
  });
  ws.addEventListener("close", () => {
    ws = null;
    onClose("Connection closed. Refresh to reconnect.");
  });
};

export const sendWsMessage = (message: ClientToServerMessage) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
};

export const waitForWsOpen = (callback: () => void) => {
  const tick = () => {
    if (!ws) return;
    if (ws.readyState === WebSocket.OPEN) {
      callback();
      return;
    }
    requestAnimationFrame(tick);
  };
  tick();
};

export const closeWs = () => {
  if (ws) ws.close();
};
