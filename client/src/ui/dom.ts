import { MAPS } from "@tanktaktix/shared";
import type { RoomSummary } from "@tanktaktix/shared";
import { state, type Phase } from "../state";

export const initAppHtml = () => {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("Missing #app container");
  app.innerHTML = `
  <section id="login-screen" class="screen active">
    <div class="panel">
      <h1>Tank Taktix</h1>
      <p class="notice">Enter a player name or roll a random 4-digit callsign.</p>
      <div class="grid two">
        <input id="name-input" placeholder="Player name" maxlength="16" />
        <button id="random-name">Random 4-digit</button>
      </div>
      <div style="margin-top: 16px; display: flex; gap: 12px;">
        <button id="login-btn">Enter Lobby</button>
      </div>
    </div>
  </section>
  <section id="lobby-screen" class="screen"><div class="panel"><div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;"><h2 id="lobby-header" style="margin: 0;">Lobby</h2><div style="display: flex; gap: 8px;"><button id="lobby-help" class="secondary" style="padding: 4px 12px; font-size: 0.9em;">Help</button><button id="lobby-setting" class="secondary" style="padding: 4px 12px; font-size: 0.9em;">Setting</button><button id="lobby-exit" class="secondary" style="padding: 4px 12px; font-size: 0.9em;">Exit</button></div></div><div class="grid three" style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem;"><div><h3>Rooms</h3><ul id="room-list" class="room-list"></ul></div><div><h3>Create Room</h3><div class="grid"><input id="room-id" placeholder="Room ID" /><input id="room-name" placeholder="Room name (optional)" /><input id="max-players" placeholder="Max players" value="4" /><input id="time-limit" placeholder="Time limit (sec)" value="240" /><select id="game-mode"><option value="ctf" selected>Flag (CTF)</option><option value="deathmatch">Deathmatch</option></select><select id="map-select"><option value="alpha">Alpha (Classic)</option><option value="beta">Beta (Urban)</option><option value="gamma">Gamma (Fort)</option><option value="delta">Delta (Nature)</option><option value="epsilon">Epsilon (Obstacles)</option><option value="test-s">Test Map S (1000x1000)</option><option value="test-m">Test Map M (1200x1200)</option><option value="test-l">Test Map L (1500x1500)</option></select><input id="room-password" placeholder="Password (optional)" /><button id="create-room">Create</button></div></div><div><h3>Lobby Chat</h3><div id="lobby-chat-log" style="height: 200px; overflow-y: auto; background: rgba(0,0,0,0.3); border: 1px solid #444; padding: 4px; margin-bottom: 8px; font-size: 0.9em; font-family: monospace;"></div><input id="lobby-chat-input" placeholder="Type here..." style="width: 100%; box-sizing: border-box;" /><h3 style="margin-top: 12px;">Players</h3><ul id="lobby-player-list" style="height: 120px; overflow-y: auto; list-style: none; padding: 0; background: rgba(0,0,0,0.2);"></ul></div></div></div>
  </section>
  <section id="room-screen" class="screen">
    <div class="panel relative-panel">
      <div id="result-overlay" class="result-overlay hidden">
        <div class="result-content">
          <h2>Game Result</h2>
          <h3 id="result-winner">Winner: ---</h3>
          <div class="table-container">
            <table id="result-table">
              <thead><tr><th>Name</th><th>Score</th><th>K / D</th><th>Acc %</th></tr></thead>
              <tbody id="result-body"></tbody>
            </table>
          </div>
          <div class="actions">
            <button id="copy-result" class="secondary">Copy Result</button>
            <button id="close-result">Leave Room</button>
          </div>
        </div>
      </div>
      <div class="game-container" style="position: relative; width: 100%; height: 100%;">
        <canvas id="map"></canvas>
        <button id="game-leave-btn" class="overlay-btn top-right">Leave</button>
      </div>
      <div class="chat-container">
        <div id="chat-log" class="chat-log"></div>
        <div class="chat-input-row">
          <select id="chat-channel">
            <option value="global">All</option>
            <option value="team">Team</option>
          </select>
          <input id="chat-input" placeholder="Type message..." />
        </div>
      </div>
    </div>
  </section>
  <div id="app-modal" class="app-modal hidden"><div class="app-modal-card"><h3 id="app-modal-title">Modal</h3><div id="app-modal-body" class="app-modal-body"></div><input id="app-modal-input" class="hidden" /><div class="app-modal-actions"><button id="app-modal-cancel" class="secondary">Cancel</button><button id="app-modal-confirm">OK</button></div></div></div>`;
};

export const dom = {
  loginScreen: () => document.querySelector("#login-screen") as HTMLElement,
  lobbyScreen: () => document.querySelector("#lobby-screen") as HTMLElement,
  roomScreen: () => document.querySelector("#room-screen") as HTMLElement,
  roomList: () => document.querySelector("#room-list") as HTMLUListElement,
  scoreList: () => document.querySelector("#score-list") as HTMLUListElement,
  chatInput: () => document.querySelector("#chat-input") as HTMLInputElement,
  chatChannel: () => document.querySelector("#chat-channel") as HTMLSelectElement,
  chatContainer: () => document.querySelector(".chat-container") as HTMLElement,
};

export const getCanvasAndCtx = () => {
  const canvas = document.querySelector("#map") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Missing canvas context");
  return { canvas, ctx };
};

export const setScreen = (phase: Phase) => {
  if (phase === "room" && !state.roomId) return;
  state.phase = phase;
  if (phase === "lobby") {
    state.chat = [];
    const header = document.querySelector("#lobby-header") as HTMLElement;
    if (header) header.textContent = `Lobby - Logged in as: ${state.name}`;
  }
  dom.loginScreen().classList.toggle("active", phase === "login");
  dom.lobbyScreen().classList.toggle("active", phase === "lobby");
  dom.roomScreen().classList.toggle("active", phase === "room");
  const hud = document.querySelector(".hud") as HTMLElement;
  if (hud) hud.classList.toggle("hidden", phase !== "room");
};

export const drawMapDataThumbnail = (canvas: HTMLCanvasElement, mapData: { width: number; height: number; walls: any[]; spawnPoints: any[] }) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const maxW = 48;
  const maxH = 48;
  const mapW = mapData.width || 1800;
  const mapH = mapData.height || 1040;
  let w = maxW;
  let h = (maxW / mapW) * mapH;
  if (h > maxH) {
    h = maxH;
    w = (maxH / mapH) * mapW;
  }
  canvas.width = w;
  canvas.height = h;
  const scaleX = w / mapW;
  const scaleY = h / mapH;
  ctx.fillStyle = "rgba(10, 20, 40, 0.9)";
  ctx.fillRect(0, 0, w, h);
  if (mapData.walls) for (const wall of mapData.walls) {
    const type = wall.type || "wall";
    if (type === "bush") ctx.fillStyle = "rgba(34, 197, 94, 0.6)";
    else if (type === "water") ctx.fillStyle = "rgba(59, 130, 246, 0.6)";
    else if (type === "house") ctx.fillStyle = "#8b4513";
    else if (type === "oneway") ctx.fillStyle = "rgba(255, 140, 0, 0.6)";
    else ctx.fillStyle = "rgba(100, 120, 140, 0.6)";
    ctx.fillRect(wall.x * scaleX, wall.y * scaleY, Math.max(1, wall.width * scaleX), Math.max(1, wall.height * scaleY));
  }
  if (mapData.spawnPoints) for (const sp of mapData.spawnPoints) {
    ctx.fillStyle = sp.team === "red" ? "rgba(239, 68, 68, 0.6)" : "rgba(59, 130, 246, 0.6)";
    ctx.beginPath(); ctx.arc(sp.x * scaleX, sp.y * scaleY, 4, 0, Math.PI * 2); ctx.fill();
  }
};

export const renderRooms = (rooms: RoomSummary[], sendMessage: (msg: any) => void, requestPassword: () => Promise<string | null>) => {
  const roomList = dom.roomList();
  roomList.innerHTML = "";
  if (rooms.length === 0) {
    roomList.innerHTML = `<li class="room empty">No rooms yet. Create one!</li>`;
    return;
  }
  rooms.forEach((room) => {
    const li = document.createElement("li");
    li.className = "room";
    const spectCount = (room as any).spectatorCount ?? 0;
    const spectLabel = spectCount > 0 ? ` • 👁 ${spectCount}` : "";
    const timeLeft = Math.max(0, Math.ceil(((room as any).endsAt - Date.now()) / 1000));
    const timerHtml = timeLeft <= 0 ? `<span style="color: #ef4444;">Ended</span>` : `(Left: ${timeLeft}s)`;
    li.innerHTML = `<div class="room-row" style="display: flex; gap: 12px; align-items: center;"><canvas class="room-thumbnail" style="border-radius: 4px; border: 1px solid #444; flex-shrink: 0;"></canvas><div style="flex-grow: 1;"><strong>${room.name ?? (room as any).roomName ?? room.id}</strong><div class="meta">${(room as any).players?.length ?? (room as any).playerCount ?? 0}/${room.maxPlayers} players${spectLabel} • ${room.timeLimitSec}s ${timerHtml}</div></div><div style="display: flex; gap: 4px;"><button class="join">Join</button><button class="watch" style="background: #6b7280; color: #fff; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 0.85em;">Watch</button></div></div>`;
    const thumbCanvas = li.querySelector(".room-thumbnail") as HTMLCanvasElement;
    const mapMeta = room.mapData || MAPS[(room as any).mapId];
    if (thumbCanvas && mapMeta) drawMapDataThumbnail(thumbCanvas, mapMeta as any);
    (li.querySelector(".join") as HTMLButtonElement).addEventListener("click", async () => {
      const pw = room.passwordProtected ? await requestPassword() : "";
      if (pw === null) return;
      state.isSpectator = false;
      state.leavingRoomId = "";
      sendMessage({ type: "joinRoom", payload: { roomId: room.id, password: pw } });
    });
    (li.querySelector(".watch") as HTMLButtonElement).addEventListener("click", async () => {
      const pw = room.passwordProtected ? await requestPassword() : "";
      if (pw === null) return;
      state.isSpectator = true;
      state.leavingRoomId = "";
      sendMessage({ type: "spectateRoom", payload: { roomId: room.id, password: pw } });
    });
    roomList.appendChild(li);
  });
};
