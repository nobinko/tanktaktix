import { WebSocket } from "ws";
import type { PlayerRuntime, Room, ServerMsg } from "./types.js";

export const players = new Map<string, PlayerRuntime>();
export const rooms = new Map<string, Room>();

export function send(ws: WebSocket | null, msg: ServerMsg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}
