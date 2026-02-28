import type { ServerToClientMessage } from "@tanktaktix/shared";
import { mapSize, state } from "../state";

export type HandlerDeps = {
  setScreen: (phase: "login" | "lobby" | "room") => void;
  renderRooms: () => void;
  renderLobbyPlayers: () => void;
  renderLobbyChat: () => void;
  renderRoomMeta: () => void;
  setupRoom: () => void;
  showGameResult: (payload: any) => void;
};

export const handleServerMessage = (message: ServerToClientMessage, deps: HandlerDeps) => {
  switch (message.type) {
    case "welcome":
      state.selfId = message.payload.id;
      localStorage.setItem("tt_id", message.payload.id);
      break;
    case "lobby":
      if (state.phase === "room") break;
      state.rooms = message.payload.rooms;
      if ((message.payload as any).onlinePlayers) {
        state.onlinePlayers = (message.payload as any).onlinePlayers;
        deps.renderLobbyPlayers();
      }
      deps.renderRooms();
      if (state.phase !== "lobby") {
        deps.setScreen("lobby");
        state.roomId = "";
        state.players = [];
        state.bullets = [];
        state.explosions = [];
      }
      break;
    case "room": {
      const payload = message.payload;
      if (payload.roomId === state.leavingRoomId) return;
      const isFirstRoomMessage = !state.roomId;
      mapSize.width = payload.mapData.width;
      mapSize.height = payload.mapData.height;
      if (isFirstRoomMessage) {
        if (state.isSpectator) {
          state.camera.x = 0; state.camera.y = 0;
        } else {
          const me = payload.players.find((p) => p.id === state.selfId);
          if (me) {
            state.camera.x = me.position.x - mapSize.width / 2;
            state.camera.y = me.position.y - mapSize.height / 2;
          }
        }
        state.camera.zoom = 1;
        state.camera.rotation = 0;
      }
      state.roomId = payload.roomId;
      state.players = payload.players;
      state.timeLeftSec = payload.timeLeftSec;
      state.bullets = payload.bullets;
      state.explosions = payload.explosions.map((e) => ({ ...e, startedAt: Date.now() }));
      state.mapData = payload.mapData;
      state.teamScores = payload.teamScores;
      state.items = payload.items;
      state.flags = payload.flags || [];
      if (state.phase !== "room") {
        deps.setScreen("room");
        deps.setupRoom();
      }
      deps.renderRoomMeta();
      break;
    }
    case "chat":
      if (state.phase === "lobby") {
        state.lobbyChat.push(message.payload);
        if (state.lobbyChat.length > 50) state.lobbyChat.shift();
        deps.renderLobbyChat();
      } else {
        state.chat.unshift(message.payload);
        if (state.chat.length > 50) state.chat.pop();
      }
      break;
    case "gameEnd":
      deps.showGameResult(message.payload);
      break;
    case "error":
      alert(message.payload.message);
      break;
    case "explosion":
      state.explosions.push({ ...message.payload, startedAt: Date.now() });
      break;
    default:
      break;
  }
};
