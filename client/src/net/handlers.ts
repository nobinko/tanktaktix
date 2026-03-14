import { compileMapGeometry, type ServerToClientMessage } from "@tanktaktix/shared";
import { state } from "../state.js";
import { soundManager } from "../audio/SoundManager";
import { interpolationBuffers, clearInterpolationBuffers, StateBuffer } from "../render/interpolation";

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
        state.mapData = null;
        state.mapGeometry = null;
        clearInterpolationBuffers();
      }
      break;
    case "roomInit": {
      const payload = message.payload;
      state.roomId = payload.roomId;

      // Store map data which is only sent once
      state.mapData = payload.mapData;
      state.mapGeometry = compileMapGeometry(payload.mapData);
      state.mapSize.width = payload.mapData.width;
      state.mapSize.height = payload.mapData.height;

      // Reset dynamic arrays for safety
      state.players = [];
      state.bullets = [];
      state.explosions = [];
      state.items = [];
      state.flags = [];
      clearInterpolationBuffers();

      if (state.isSpectator) {
        state.camera.x = 0; state.camera.y = 0;
      }
      state.camera.zoom = 1;
      state.camera.rotation = 0;

      deps.setScreen("room");
      deps.setupRoom();
      break;
    }
    case "room": {
      const payload = message.payload;
      if (payload.roomId === state.leavingRoomId) return;

      state.roomId = payload.roomId;
      state.players = payload.players;
      state.timeLeftSec = payload.timeLeftSec;
      // Phase 5: SFX hook for new bullets (shooting)
      const oldBulletIds = new Set(state.bullets?.map(b => b.id) || []);
      const newBullets = payload.bullets.filter(b => !oldBulletIds.has(b.id) && !b.isRope && !b.isAmmoPass && !b.isHealPass && !b.isFlagPass && !b.isSmoke);
      if (newBullets.length > 0) {
        soundManager.play("shoot", 0.6); // slight volume reduction for spam
      }

      // Phase 5: SFX hook for Item and Flag pickup by self
      const oldMe = state.players?.find(p => p.id === state.selfId);
      const newMe = payload.players.find(p => p.id === state.selfId);
      if (oldMe && newMe) {
        const ammoPicked = newMe.ammo > oldMe.ammo && !((oldMe as any).respawnCooldownUntil > Date.now());
        const bombPicked = newMe.hasBomb && !oldMe.hasBomb;
        const ropePicked = (newMe.ropeCount || 0) > (oldMe.ropeCount || 0);
        const bootsPicked = (newMe.bootsCharges || 0) > 0 && (oldMe.bootsCharges || 0) === 0;
        const smokePicked = newMe.hasSmoke && !oldMe.hasSmoke;
        if (ammoPicked || bombPicked || ropePicked || bootsPicked || smokePicked) {
          soundManager.play("item_pickup");
        }
      }

      // Phase 5: SFX hook for flag pickup
      if (payload.flags && state.flags && newMe) {
        payload.flags.forEach(newFlag => {
          const oldFlag = state.flags!.find(f => f.team === newFlag.team && f.baseX === newFlag.baseX && f.baseY === newFlag.baseY);
          if (oldFlag && oldFlag.carrierId !== state.selfId && newFlag.carrierId === state.selfId) {
            soundManager.play("item_pickup"); // Using item pickup sound for grabbing the flag
          }
        });
      }

      // Phase 5: SFX hook for flag score (return)
      if (state.teamScores && payload.teamScores) {
        if (payload.teamScores.red > state.teamScores.red || payload.teamScores.blue > state.teamScores.blue) {
          soundManager.play("flag_pickup"); // Using flag pickup sound for scoring
        }
      }

      state.bullets = payload.bullets;
      state.explosions = payload.explosions.map((e: any) => ({ ...e, startedAt: Date.now() }));
      state.teamScores = payload.teamScores;
      state.items = payload.items;
      state.flags = payload.flags || [];
      state.room = payload.room;
      if (state.room) {
        state.room.smokeClouds = payload.smokeClouds;
      }

      // Update Interpolation Buffers
      const serverTime = Date.now();
      state.lastServerUpdateTime = serverTime;

      for (const p of payload.players) {
        let buf = interpolationBuffers.players.get(p.id);
        if (!buf) {
          buf = new StateBuffer();
          interpolationBuffers.players.set(p.id, buf);
        }
        buf.addState({ x: p.position.x, y: p.position.y, angle: p.hullAngle }, serverTime);
      }

      for (const b of payload.bullets) {
        let buf = interpolationBuffers.bullets.get(b.id);
        if (!buf) {
          buf = new StateBuffer();
          interpolationBuffers.bullets.set(b.id, buf);
        }
        buf.addState({ x: b.position.x, y: b.position.y }, serverTime);
      }

      // Cleanup stale buffers
      const activePlayerIds = new Set(payload.players.map((p: any) => p.id));
      for (const id of interpolationBuffers.players.keys()) {
        if (!activePlayerIds.has(id)) interpolationBuffers.players.delete(id);
      }
      const activeBulletIds = new Set(payload.bullets.map((b: any) => b.id));
      for (const id of interpolationBuffers.bullets.keys()) {
        if (!activeBulletIds.has(id)) interpolationBuffers.bullets.delete(id);
      }

      // Phase 4-6: Check for HP drops to trigger damage flashes
      const now = Date.now();
      for (const p of payload.players) {
        const lastHp = state.lastHpMap[p.id];
        if (lastHp === undefined) {
          state.lastHpMap[p.id] = p.hp;
          continue;
        }
        if (p.hp < lastHp && p.hp > 0) {
          state.hitFlashes[p.id] = now + 150;
          state.floatingTexts.push({ id: Math.random().toString(), text: `-${lastHp - p.hp}`, color: "#d45555", x: p.position.x, y: p.position.y - 25, startedAt: now });
        } else if (p.hp > lastHp) {
          const isRespawn = (p as any).respawnCooldownUntil > now;
          const isFirstSpawn = lastHp === 0 && p.team !== null;
          if (!isRespawn && !isFirstSpawn) {
            state.floatingTexts.push({ id: Math.random().toString(), text: `+${p.hp - lastHp}`, color: "#7aad55", x: p.position.x, y: p.position.y - 25, startedAt: now });
            if (p.id === state.selfId) {
              soundManager.play("item_pickup");
            }
          }
        }

        // Item Pickup floating text (Phase 5 + Smoke)
        const oldMe = state.players?.find(op => op.id === p.id);
        if (oldMe) {
          if (p.hasBomb && !oldMe.hasBomb) state.floatingTexts.push({ id: Math.random().toString(), text: "+BOMB", color: "#d4a843", x: p.position.x, y: p.position.y - 40, startedAt: now });
          if ((p.ropeCount || 0) > (oldMe.ropeCount || 0)) state.floatingTexts.push({ id: Math.random().toString(), text: "+ROPE", color: "#a3752c", x: p.position.x, y: p.position.y - 40, startedAt: now });
          if ((p.bootsCharges || 0) > 0 && (oldMe.bootsCharges || 0) === 0) state.floatingTexts.push({ id: Math.random().toString(), text: "+BOOTS", color: "#a8a8c8", x: p.position.x, y: p.position.y - 40, startedAt: now });
          if (p.hasSmoke && !oldMe.hasSmoke) state.floatingTexts.push({ id: Math.random().toString(), text: "+SMOKE", color: "#cccccc", x: p.position.x, y: p.position.y - 40, startedAt: now });
        }

        state.lastHpMap[p.id] = p.hp;
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
      soundManager.play("explosion");
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
