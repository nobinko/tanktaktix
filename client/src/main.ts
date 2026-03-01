import "./style.css";
import { createRenderer } from "./render/renderer";
import { state } from "./state";
import { initAppHtml, dom, getCanvasAndCtx, renderRooms, setScreen } from "./ui/dom";
import { connectWs, sendWsMessage, waitForWsOpen, closeWs } from "./net/wsClient";
import { handleServerMessage } from "./net/handlers";
import { attachKeyboardInput } from "./input/keyboard";
import { attachMouseInput } from "./input/mouse";
import { initModalHandlers, showConfirmDialog, showInfoDialog, showModal, showPromptDialog } from "./ui/modal";
import { startTitleRenderer, stopTitleRenderer } from "./render/titleRenderer";

initAppHtml();
initModalHandlers();
startTitleRenderer();

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
    renderRooms(state.rooms, sendWsMessage, () => showPromptDialog("Room Password", "パスワード付きルームです。", "Password"));
  }
}, 1000);

const chatInput = dom.chatInput();
const getSelf = () => state.players.find((p) => p.id === state.selfId);

const renderLobbyPlayers = () => {
  const list = document.querySelector("#lobby-player-list") as HTMLUListElement;
  if (!list) return;
  list.innerHTML = "";
  state.onlinePlayers.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = p.name;
    li.style.padding = "2px 4px";
    li.style.borderBottom = "1px solid #444";
    li.style.fontSize = "0.9em";
    li.style.color = "#ccc";
    list.appendChild(li);
  });
};

const renderLobbyChat = () => {
  const log = document.querySelector("#lobby-chat-log") as HTMLDivElement;
  if (!log) return;
  log.innerHTML = "";
  state.lobbyChat.forEach((msg) => {
    const div = document.createElement("div");
    div.innerHTML = `<span style="color:#aaa;font-weight:bold;">${msg.from}: </span><span style="color:#fff;">${msg.message}</span>`;
    div.style.marginBottom = "2px";
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
  const result = await showModal({
    title: "Setting",
    bodyHtml: `<p>将来拡張用: 音量・表示設定の受け皿です。</p><p style="font-size:12px;color:#9fb;">BGM/SEスライダーはプレースホルダ実装です。</p>`,
    inputPlaceholder: "Player name",
    initialValue: currentName,
    confirmText: "Save",
    cancelText: "Close",
    showCancel: true,
  });
  if (!result.confirmed) return;
  const name = result.value.trim();
  if (!name) return;
  state.name = name;
  localStorage.setItem("tt_name", name);
  await showInfoDialog("Setting", "表示名を保存しました。次回ログイン時に利用されます。");
};

const handleServerMsg = (message: any) => handleServerMessage(message, {
  setScreen,
  renderRooms: () => renderRooms(state.rooms, sendWsMessage, () => showPromptDialog("Room Password", "パスワード付きルームです。", "Password")),
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

(document.querySelector("#create-room") as HTMLButtonElement).addEventListener("click", () => {
  state.leavingRoomId = "";
  const id = (document.querySelector("#room-id") as HTMLInputElement).value.trim() || Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  const name = (document.querySelector("#room-name") as HTMLInputElement).value.trim();
  const mapId = (document.querySelector("#map-select") as HTMLSelectElement)?.value || "alpha";
  sendWsMessage({ type: "createRoom", payload: { roomId: id, name: name || `Room ${id}`, mapId, maxPlayers: parseInt((document.querySelector("#max-players") as HTMLInputElement).value) || 4, timeLimitSec: parseInt((document.querySelector("#time-limit") as HTMLInputElement).value) || 240, gameMode: ((document.querySelector("#game-mode") as HTMLSelectElement).value || "ctf") as "deathmatch" | "ctf", password: (document.querySelector("#room-password") as HTMLInputElement).value.trim() || undefined } });
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

const handleLeave = async (requireConfirm = true) => {
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
  document.querySelector("#result-overlay")?.classList.add("hidden");
  setScreen("lobby");
};

(document.querySelector("#leave-room") as HTMLButtonElement)?.addEventListener("click", () => void handleLeave(false));
(document.querySelector("#game-leave-btn") as HTMLButtonElement)?.addEventListener("click", () => void handleLeave(false));
(document.querySelector("#close-result") as HTMLButtonElement)?.addEventListener("click", () => void handleLeave(false));

createRenderer({ canvas, ctx, chatInput }).render();
