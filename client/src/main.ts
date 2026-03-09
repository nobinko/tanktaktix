import "./style.css";
import { createRenderer } from "./render/renderer";
import { state } from "./state";
import type { MapData } from "@tanktaktix/shared";
import { initAppHtml, dom, getCanvasAndCtx, renderRooms, setScreen } from "./ui/dom";
import { connectWs, sendWsMessage, waitForWsOpen, closeWs } from "./net/wsClient";
import { handleServerMessage } from "./net/handlers";
import { attachKeyboardInput } from "./input/keyboard";
import { attachMouseInput } from "./input/mouse";
import { initModalHandlers, showConfirmDialog, showInfoDialog, showModal, showPromptDialog } from "./ui/modal";
import { startTitleRenderer, stopTitleRenderer } from "./render/titleRenderer";
import { soundManager } from "./audio/SoundManager";

initAppHtml();
initModalHandlers();
startTitleRenderer();

// Phase 5: Initialize SoundManager on first user interaction
const initSound = () => {
  soundManager.init();
  document.removeEventListener("click", initSound);
  document.removeEventListener("keydown", initSound);
};
document.addEventListener("click", initSound);
document.addEventListener("keydown", initSound);

// Phase 5: Global UI sounds
document.addEventListener("mouseover", (e) => {
  const target = (e.target as HTMLElement).closest("button");
  if (target && !target.disabled) {
    soundManager.play("ui_hover", 0.3);
  }
});
document.addEventListener("mousedown", (e) => {
  const target = (e.target as HTMLElement).closest("button");
  if (target && !target.disabled) {
    soundManager.play("ui_click", 0.5);
  }
});

const { canvas, ctx } = getCanvasAndCtx();
const leaveBtn = document.querySelector("#game-leave-btn") as HTMLButtonElement;
if (leaveBtn) {
  leaveBtn.onclick = () => {
    // Instant leave as requested by user
    handleLeave(false);
  };
}

const resizeObserver = new ResizeObserver(() => {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
});
resizeObserver.observe(canvas);

// Real-time lobby room list timer
setInterval(() => {
  if (state.phase === "lobby") {
    renderRooms(state.rooms, sendWsMessage, requestJoinInfo);
  }
}, 1000);

// Ping measurement (every 10 seconds)
setInterval(() => {
  if (state.selfId) {
    sendWsMessage({ type: "ping", payload: { timestamp: Date.now() } });
  }
}, 10000);

const chatInput = dom.chatInput();
const getSelf = () => state.players.find((p) => p.id === state.selfId);

const renderLobbyPlayers = () => {
  const list = document.querySelector("#lobby-player-list") as HTMLUListElement;
  const countEl = document.querySelector("#player-count") as HTMLElement | null;
  if (!list) return;
  list.innerHTML = "";
  if (countEl) countEl.textContent = `(${state.onlinePlayers.length})`;
  state.onlinePlayers.forEach((p) => {
    const li = document.createElement("li");
    const pingText = p.ping != null ? `(${p.ping}ms)` : "";
    li.innerHTML = `<span class="lp-name">${p.name}</span><span class="lp-ping"> ${pingText}</span>`;
    list.appendChild(li);
  });
};

const renderLobbyChat = () => {
  const log = document.querySelector("#lobby-chat-log") as HTMLDivElement;
  if (!log) return;
  log.innerHTML = "";
  state.lobbyChat.forEach((msg) => {
    const div = document.createElement("div");
    div.innerHTML = `<span class="chat-from">${msg.from}: </span><span>${msg.message}</span>`;
    log.appendChild(div);
  });
  log.scrollTop = log.scrollHeight;
};

const setupRoom = () => {
  // Mouse input is now attached once globally
};

const showHelp = () => showModal({
  title: "Help",
  bodyHtml: `
    <p><strong>操作:</strong> 左クリック移動、右クリックAIM、Tでチャット、矢印キーでカメラ、+/-でズーム</p>
    <p><strong>AIM派生:</strong> R=ロープ / A=アモ投擲 / H=ヘルス投擲 / F=フラッグ投げ</p>
    <p><strong>アイテム:</strong> heart(全回復), bomb(次弾強化), rope(遠隔取得), boots(3回移動加速)</p>
    <p><strong>CTF:</strong> 敵旗を持ち帰ると得点。落ちた旗は接触で回収。</p>
    <p><strong>キーバインド:</strong> Q/E 回転, Esc でキャンセル系操作（環境依存）</p>
  `,
  confirmText: "Close",
});

const showSetting = async () => {
  const currentName = localStorage.getItem("tt_name") ?? state.name;

  const handleSettingClicks = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.id === "toggle-se-btn") {
      const isMuted = soundManager.toggleMute();
      target.textContent = `Sound Effects (SE): ${isMuted ? 'OFF 🔇' : 'ON 🔊'}`;
    }
  };
  document.addEventListener('click', handleSettingClicks);

  const result = await showModal({
    title: "Setting",
    bodyHtml: `
      <div style="margin-bottom: 20px;">
        <p style="margin-bottom: 10px; font-weight: bold; color: #aaa;">Audio</p>
        <button id="toggle-se-btn" style="width: 100%; padding: 10px; background: #2a2a2a; border: 1px solid #444; color: #eee; border-radius: 4px; cursor: pointer; text-align: left; transition: 0.2s;">
            Sound Effects (SE): ${soundManager.isMuted() ? 'OFF 🔇' : 'ON 🔊'}
        </button>
      </div>
      <p style="margin-bottom: 10px; font-weight: bold; color: #aaa;">Profile</p>
    `,
    inputPlaceholder: "Player name",
    initialValue: currentName,
    confirmText: "Save",
    cancelText: "Close",
    showCancel: true,
  });

  document.removeEventListener('click', handleSettingClicks);

  if (!result.confirmed) return;
  const name = result.value.trim();
  if (!name) return;
  state.name = name;
  localStorage.setItem("tt_name", name);
  await showInfoDialog("Setting", "表示名を保存しました。次回ログイン時に利用されます。");
};

const handleServerMsg = (message: any) => handleServerMessage(message, {
  setScreen,
  renderRooms: () => renderRooms(state.rooms, sendWsMessage, requestJoinInfo),
  renderLobbyPlayers,
  renderLobbyChat,
  renderRoomMeta: () => undefined, // Info moved to HUD
  setupRoom,
  showGameResult: (payload: any) => {
    const overlay = document.querySelector("#result-overlay") as HTMLElement;
    if (!overlay) return;

    // Winner表示
    const winnerEl = document.querySelector("#result-winner") as HTMLElement;
    if (winnerEl) {
      if (payload.winners === "draw") {
        winnerEl.textContent = "🤝 Draw!";
        winnerEl.style.color = "#c9b07a";
      } else {
        const winColor = payload.winners === "red" ? "#c44040" : "#4a6a8a";
        const winLabel = payload.winners === "red" ? "🔴 Red Team Wins!" : "🔵 Blue Team Wins!";
        winnerEl.textContent = winLabel;
        winnerEl.style.color = winColor;
      }
    }

    // スコアテーブル描画
    const tbody = document.querySelector("#result-body") as HTMLElement;
    if (tbody && payload.results) {
      const sorted = [...payload.results].sort((a: any, b: any) => b.score - a.score);
      tbody.innerHTML = sorted.map((p: any) => {
        const acc = p.fired > 0 ? Math.round((p.hits / p.fired) * 100) : 0;
        const teamColor = p.team === "red" ? "#c44040" : "#4a6a8a";
        const highlight = p.id === state.selfId ? " style=\"background:rgba(200,180,100,0.15);\"" : "";
        return `<tr${highlight}><td style="color:${teamColor};font-weight:bold;">${p.name}</td><td>${p.score}</td><td>${p.kills} / ${p.deaths}</td><td>${acc}%</td></tr>`;
      }).join("");
    }

    // Copy Resultボタン
    const copyBtn = document.querySelector("#copy-result") as HTMLButtonElement;
    if (copyBtn) {
      copyBtn.onclick = () => {
        const sorted = [...(payload.results ?? [])].sort((a: any, b: any) => b.score - a.score);
        const lines = sorted.map((p: any) => {
          const acc = p.fired > 0 ? Math.round((p.hits / p.fired) * 100) : 0;
          return `${p.name} (${p.team}) Score:${p.score} K/D:${p.kills}/${p.deaths} Acc:${acc}%`;
        });
        const text = `[TankTaktix Result] ${payload.winners === "draw" ? "Draw" : payload.winners + " wins"}\n` + lines.join("\n");
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = "Copied!";
          setTimeout(() => { copyBtn.textContent = "Copy Result"; }, 2000);
        });
      };
    }

    overlay.classList.remove("hidden");
  },
  showError: (msg: string) => showInfoDialog("Error", msg),
});

// Keyboard and Mouse input are attached here once
attachKeyboardInput({ chatInput, sendMessage: sendWsMessage });
attachMouseInput({ canvas, chatInput, getSelf, sendMessage: sendWsMessage });

const nameInput = document.querySelector("#name-input") as HTMLInputElement;
let savedName = localStorage.getItem("tt_name");
if (!savedName) {
  savedName = `GP-${Math.floor(1000 + Math.random() * 9000)}`;
}
nameInput.value = savedName;

(document.querySelector("#random-name") as HTMLButtonElement).addEventListener("click", () => {
  nameInput.value = `GP-${Math.floor(1000 + Math.random() * 9000)}`;
});

(document.querySelector("#login-btn") as HTMLButtonElement).addEventListener("click", () => {
  const name = nameInput.value.trim() || `GP-${Math.floor(1000 + Math.random() * 9000)}`;
  state.name = name;
  localStorage.setItem("tt_name", name);
  const savedId = localStorage.getItem("tt_id");
  stopTitleRenderer();
  connectWs(handleServerMsg, (msg) => showInfoDialog("Connection", msg));
  waitForWsOpen(() => {
    sendWsMessage({ type: "login", payload: { name, id: savedId ?? undefined } });
    sendWsMessage({ type: "requestLobby" });
  });
});

const requestJoinInfo = (room: any, isSpectate: boolean): Promise<{ password?: string } | null> => {
  return new Promise((resolve) => {
    const isPw = room.passwordProtected;

    if (!isPw) {
      return resolve({});
    }

    const modal = document.querySelector("#join-room-modal") as HTMLElement;
    const nameEl = document.querySelector("#join-room-name") as HTMLElement;
    const pwContainer = document.querySelector("#join-pw-container") as HTMLElement;
    const pwInput = document.querySelector("#join-room-password") as HTMLInputElement;
    const cancelBtn = document.querySelector("#join-room-cancel") as HTMLButtonElement;
    const confirmBtn = document.querySelector("#join-room-confirm") as HTMLButtonElement;
    nameEl.textContent = "Joining: Room " + room.id;
    pwContainer.classList.toggle("hidden", !isPw);
    pwInput.value = "";

    modal.classList.remove("hidden");

    const cleanup = () => {
      cancelBtn.onclick = null;
      confirmBtn.onclick = null;
      modal.classList.add("hidden");
    };

    cancelBtn.onclick = () => {
      cleanup();
      resolve(null);
    };

    confirmBtn.onclick = () => {
      cleanup();
      resolve({
        password: isPw ? pwInput.value.trim() : undefined,
      });
    };
  });
};

// New Game モーダル開閉
const createRoomModal = document.querySelector("#create-room-modal") as HTMLElement;
(document.querySelector("#new-game-btn") as HTMLButtonElement)?.addEventListener("click", () => {
  createRoomModal?.classList.remove("hidden");
});
(document.querySelector("#create-room-cancel") as HTMLButtonElement)?.addEventListener("click", () => {
  createRoomModal?.classList.add("hidden");
});
(document.querySelector(".lobby-modal-overlay") as HTMLElement)?.addEventListener("click", () => {
  createRoomModal?.classList.add("hidden");
});

// Custom map JSON
const customMapArea = document.querySelector("#custom-map-area") as HTMLElement;
const customMapJson = document.querySelector("#custom-map-json") as HTMLTextAreaElement;
const customMapStatus = document.querySelector("#custom-map-status") as HTMLSpanElement;
(document.querySelector("#map-select") as HTMLSelectElement)?.addEventListener("change", (e) => {
  customMapArea?.classList.toggle("hidden", (e.target as HTMLSelectElement).value !== "custom");
});
function validateCustomMapJson(json: string): { valid: boolean; data?: MapData; error?: string } {
  try {
    const parsed = JSON.parse(json);
    if (!parsed.width || !parsed.height || !Array.isArray(parsed.walls) || !Array.isArray(parsed.spawnPoints)) {
      return { valid: false, error: "Required: width, height, walls[], spawnPoints[]" };
    }
    if (parsed.spawnPoints.length < 2) {
      return { valid: false, error: "spawnPoints needs at least 2 entries" };
    }
    return { valid: true, data: parsed as MapData };
  } catch {
    return { valid: false, error: "Invalid JSON" };
  }
}
customMapJson?.addEventListener("input", () => {
  const result = validateCustomMapJson(customMapJson.value);
  customMapStatus.textContent = result.valid ? "✓ Valid" : `✗ ${result.error}`;
  customMapStatus.style.color = result.valid ? "#7bc67a" : "#e07070";
});

// Create Room
(document.querySelector("#create-room") as HTMLButtonElement).addEventListener("click", () => {
  state.leavingRoomId = "";
  const id = (document.querySelector("#room-id") as HTMLInputElement).value.trim() || Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  const name = (document.querySelector("#room-name") as HTMLInputElement).value.trim();
  const mapId = (document.querySelector("#map-select") as HTMLSelectElement)?.value || "riverside";
  let customMapData: MapData | undefined;
  if (mapId === "custom") {
    const result = validateCustomMapJson(customMapJson.value.trim());
    if (!result.valid) {
      customMapStatus.textContent = `✗ ${result.error}`;
      customMapStatus.style.color = "#e07070";
      return;
    }
    customMapData = result.data;
  }
  const options = {
    teamSelect: (document.querySelector("#opt-team-select") as HTMLInputElement).checked,
    instantKill: (document.querySelector("#opt-instant-kill") as HTMLInputElement).checked,
    noItemRespawn: (document.querySelector("#opt-no-item-respawn") as HTMLInputElement).checked,
    noShooting: (document.querySelector("#opt-no-shooting") as HTMLInputElement).checked,
  };
  sendWsMessage({ type: "createRoom", payload: { roomId: id, name: name, mapId, customMapData, maxPlayers: parseInt((document.querySelector("#max-players") as HTMLInputElement).value) || 4, timeLimitSec: parseInt((document.querySelector("#time-limit") as HTMLInputElement).value) || 240, gameMode: ((document.querySelector("#game-mode") as HTMLSelectElement).value || "ctf") as "deathmatch" | "ctf", password: (document.querySelector("#room-password") as HTMLInputElement).value.trim() || undefined, options } });
  createRoomModal?.classList.add("hidden");
});

(document.querySelector("#lobby-help") as HTMLButtonElement).addEventListener("click", () => void showHelp());
(document.querySelector("#lobby-setting") as HTMLButtonElement).addEventListener("click", () => void showSetting());

dom.lobbySelect()?.addEventListener("change", (e) => {
  const lobbyId = (e.target as HTMLSelectElement).value;
  sendWsMessage({ type: "switchLobby", payload: { lobbyId } } as any);
});

// Lobby Chat Input
dom.lobbyChatInput()?.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const input = dom.lobbyChatInput();
  const message = input?.value.trim();
  if (!message) return;
  sendWsMessage({ type: "chat", payload: { message } } as any);
  if (input) input.value = "";
});

(document.querySelector("#lobby-exit") as HTMLButtonElement).addEventListener("click", async () => {
  if (await showConfirmDialog("Exit", "Return to Title Screen?", "Exit", "Cancel")) {
    closeWs();
    setScreen("login");
  }
});

// Team Select Overlay Event
const handleTeamSelect = (team: "red" | "blue") => {
  sendWsMessage({ type: "selectTeam", payload: { team } } as any);
};
(document.querySelector("#ts-red-card") as HTMLElement)?.addEventListener("click", () => handleTeamSelect("red"));
(document.querySelector("#ts-blue-card") as HTMLElement)?.addEventListener("click", () => handleTeamSelect("blue"));

async function handleLeave(requireConfirm = true) {
  if (requireConfirm && !(await showConfirmDialog("Leave Room", "Leave this room?", "Leave", "Stay"))) return;
  if (!state.roomId) return;
  state.leavingRoomId = state.roomId;
  sendWsMessage({ type: "leaveRoom" });
  sendWsMessage({ type: "requestLobby" });
  state.roomId = "";
  state.players = [];
  state.bullets = [];
  state.explosions = [];
  state.isSpectator = false;
  (state as any)._hadTeam = false;
  document.querySelector("#result-overlay")?.classList.add("hidden");
  document.querySelector("#team-select-overlay")?.classList.add("hidden");
  setScreen("lobby");
};

(document.querySelector("#leave-room") as HTMLButtonElement)?.addEventListener("click", () => void handleLeave(false));
(document.querySelector("#game-leave-btn") as HTMLButtonElement)?.addEventListener("click", () => void handleLeave(false));
(document.querySelector("#close-result") as HTMLButtonElement)?.addEventListener("click", () => void handleLeave(false));

createRenderer({ canvas, ctx, chatInput }).render();
