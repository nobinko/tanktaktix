import type { ServerToClientMessage } from "@tanktaktix/shared";
import { state } from "../state.js";

export type HandlerDeps = {
  setScreen: (phase: "login" | "lobby" | "room") => void;
  renderRooms: () => void;
  renderLobbyPlayers: () => void;
  renderLobbyChat: () => void;
  renderRoomMeta: () => void;
  setupRoom: () => void;
  showGameResult: (payload: any) => void;
  showError: (message: string) => void;
};

export const handleServerMessage = (message: ServerToClientMessage, deps: HandlerDeps) => {
  switch (message.type) {
    case "welcome":
      state.selfId = message.payload.id;
      localStorage.setItem("tt_id", message.payload.id);
      break;
    case "lobby":
      if (state.phase === "room") break;
      {
        const newLobbyId = (message.payload as any).currentLobbyId;
        if (newLobbyId && newLobbyId !== state.lobbyId) {
          // ロビーが変わったらチャット履歴をクリアしてUIも更新
          state.lobbyChat = [];
          deps.renderLobbyChat();
        }
        state.lobbyId = newLobbyId;
        // ドロップダウンの選択値も同期
        const sel = document.querySelector("#lobby-select") as HTMLSelectElement;
        if (sel && newLobbyId) sel.value = newLobbyId;
      }
      state.rooms = message.payload.rooms;
      state.availableLobbies = (message.payload as any).availableLobbies;
      if (message.payload.onlinePlayers) {
        state.onlinePlayers = message.payload.onlinePlayers;
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
      state.mapSize.width = payload.mapData.width;
      state.mapSize.height = payload.mapData.height;
      if (isFirstRoomMessage) {
        if (state.isSpectator) {
          state.camera.x = 0; state.camera.y = 0;
        } else {
          // Camera logic moved to render loop or per-frame update,
          // but if we want instant snap on join/team-select:
          const me = payload.players.find((p) => p.id === state.selfId);
          if (me && me.team !== null) {
            state.camera.x = me.position.x - state.mapSize.width / 2;
            state.camera.y = me.position.y - state.mapSize.height / 2;
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

      // Phase 4-6: Check for HP drops to trigger damage flashes
      const now = Date.now();
      for (const p of payload.players) {
        if (isFirstRoomMessage) {
          state.lastHpMap[p.id] = p.hp;
          continue;
        }
        const lastHp = state.lastHpMap[p.id];
        if (lastHp !== undefined) {
          if (p.hp < lastHp && p.hp > 0) {
            state.hitFlashes[p.id] = now + 150;
            state.floatingTexts.push({ id: Math.random().toString(), text: `-${lastHp - p.hp}`, color: "#d45555", x: p.position.x, y: p.position.y - 25, startedAt: now });
          } else if (p.hp > lastHp) {
            // respawnCooldownUntilが未来ならリスポーン直後 → +テキスト出さない
            const isRespawn = (p as any).respawnCooldownUntil > now;
            // チーム未所属(0)から所属(100/20)への変化も回復ではないので出さない
            const isFirstSpawn = lastHp === 0 && p.team !== null;
            if (!isRespawn && !isFirstSpawn) {
              state.floatingTexts.push({ id: Math.random().toString(), text: `+${p.hp - lastHp}`, color: "#7aad55", x: p.position.x, y: p.position.y - 25, startedAt: now });
            }
          }
        }
        state.lastHpMap[p.id] = p.hp;

      }

      if (state.phase !== "room") {
        deps.setScreen("room");
        deps.setupRoom();
      }

      // Phase 5-12: Team Select Overlay
      const me = payload.players.find((p) => p.id === state.selfId);
      const tsOverlay = document.querySelector("#team-select-overlay") as HTMLElement;
      if (me && me.team === null && !state.isSpectator) {
        tsOverlay.classList.remove("hidden");
        const redCount = document.querySelector("#ts-red-count");
        const blueCount = document.querySelector("#ts-blue-count");
        if (redCount) redCount.textContent = payload.players.filter(p => p.team === "red").length.toString();
        if (blueCount) blueCount.textContent = payload.players.filter(p => p.team === "blue").length.toString();
      } else {
        tsOverlay.classList.add("hidden");
        // Update camera continuously if we are alive and have a team
        if (me && me.team !== null && !state.isSpectator) {
          // We might want to snap camera if it's the very first time we got a team
          const previouslyHadTeam = (state as any)._hadTeam;
          if (!previouslyHadTeam) {
            state.camera.x = me.position.x - state.mapSize.width / 2;
            state.camera.y = me.position.y - state.mapSize.height / 2;
            (state as any)._hadTeam = true;
          }
        }
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
      deps.showError(message.payload.message);
      break;
    case "explosion": {
      state.explosions.push({ ...message.payload, startedAt: Date.now() });
      const numParticles = message.payload.radius > 30 ? 12 : 6;
      for (let i = 0; i < numParticles; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 4 + 2;
        state.particles.push({
          x: message.payload.x,
          y: message.payload.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1.0,
          maxLife: Math.random() * 0.5 + 0.3,
          color: Math.random() > 0.5 ? "#d4a843" : "#c47030"
        });
      }
      break;
    }
    case "pong": {
      const ping = Date.now() - message.payload.timestamp;
      // Report ping to server
      import("./wsClient").then(({ sendWsMessage }) => {
        sendWsMessage({ type: "reportPing", payload: { ping } });
      });
      break;
    }
    default:
      break;
  }
};
