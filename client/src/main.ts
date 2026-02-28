import "./style.css";
import { createRenderer } from "./render/renderer";
import { state } from "./state";
import { initAppHtml, dom, getCanvasAndCtx, renderRooms, setScreen } from "./ui/dom";
import { connectWs, sendWsMessage, waitForWsOpen, closeWs } from "./net/wsClient";
import { handleServerMessage } from "./net/handlers";
import { attachKeyboardInput } from "./input/keyboard";
import { attachMouseInput } from "./input/mouse";

initAppHtml();

const { canvas, ctx } = getCanvasAndCtx();
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

const renderRoomMeta = () => {
  dom.roomTitle().textContent = `Room ${state.roomId}`;
  dom.roomMeta().textContent = `Time left: ${state.timeLeftSec}s, Players: ${state.players.length}`;
  const scoreList = dom.scoreList();
  scoreList.innerHTML = "";
  [...state.players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).forEach((p) => {
    const li = document.createElement("li");
    li.textContent = `${p.name}: ${p.score ?? 0}`;
    scoreList.appendChild(li);
  });
};

const setupRoom = () => {
  // Mouse input is now attached once globally
};

const handleServerMsg = (message: any) => handleServerMessage(message, {
  setScreen,
  renderRooms: () => renderRooms(state.rooms, sendWsMessage),
  renderLobbyPlayers,
  renderLobbyChat,
  renderRoomMeta,
  setupRoom,
  showGameResult: () => undefined,
});

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
  connectWs(handleServerMsg); // Re-connect if disconnected
  waitForWsOpen(() => {
    sendWsMessage({ type: "login", payload: { name, id: savedId ?? undefined } });
    sendWsMessage({ type: "requestLobby" });
  });
});

(document.querySelector("#create-room") as HTMLButtonElement).addEventListener("click", () => {
  state.leavingRoomId = ""; // Fix: Reset leavingRoomId when creating a new room
  const id = (document.querySelector("#room-id") as HTMLInputElement).value.trim() || Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  const name = (document.querySelector("#room-name") as HTMLInputElement).value.trim();
  const mapId = (document.querySelector("#map-select") as HTMLSelectElement)?.value || "alpha";
  sendWsMessage({ type: "createRoom", payload: { roomId: id, name: name || `Room ${id}`, mapId, maxPlayers: parseInt((document.querySelector("#max-players") as HTMLInputElement).value) || 4, timeLimitSec: parseInt((document.querySelector("#time-limit") as HTMLInputElement).value) || 240, gameMode: ((document.querySelector("#game-mode") as HTMLSelectElement).value || "ctf") as "deathmatch" | "ctf", password: (document.querySelector("#room-password") as HTMLInputElement).value.trim() || undefined } });
});

(document.querySelector("#lobby-exit") as HTMLButtonElement).addEventListener("click", () => {
  if (confirm("Return to Title Screen?")) {
    closeWs();
    setScreen("login");
  }
});

const handleLeave = (requireConfirm = true) => {
  if (requireConfirm && !confirm("Leave this room?")) return;
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

(document.querySelector("#leave-room") as HTMLButtonElement)?.addEventListener("click", () => handleLeave(true));
(document.querySelector("#game-leave-btn") as HTMLButtonElement)?.addEventListener("click", () => handleLeave(true));
(document.querySelector("#close-result") as HTMLButtonElement)?.addEventListener("click", () => handleLeave(false));

createRenderer({ canvas, ctx, chatInput }).render();
