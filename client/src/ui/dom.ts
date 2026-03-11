import { MAPS } from "@tanktaktix/shared";
import type { RoomSummary } from "@tanktaktix/shared";
import { state, type Phase } from "../state";

export const initAppHtml = () => {
  const app = document.querySelector<HTMLDivElement>("#app");
  if (!app) throw new Error("Missing #app container");
  app.innerHTML = `
  <section id="login-screen" class="screen active">
    <canvas id="title-bg"></canvas>
    <div class="login-overlay-panel">
      <div class="title-logo-block">
        <h1 class="title-logo">TANK TAKTIX</h1>
        <p class="title-subtitle">TACTICAL TANK BATTLE</p>
      </div>
      <div class="login-card">
        <p class="notice">Enter a player name or roll a random 4-digit callsign.</p>
        <div class="grid two">
          <input id="name-input" placeholder="Player name" maxlength="16" />
          <button id="random-name">Random 4-digit</button>
        </div>
        <div style="margin-top: 16px;">
          <button id="login-btn" class="login-enter-btn">ENTER LOBBY</button>
        </div>
      </div>
    </div>
  </section>
  <section id="lobby-screen" class="screen">
    <div class="lobby-layout">
      <header class="lobby-header">
        <div class="lobby-header-left">
          <h1 class="lobby-title">TANK TAKTIX</h1>
          <select id="lobby-select" class="lobby-select"></select>
        </div>
        <span id="lobby-stats" class="lobby-stats"></span>
      </header>

      <main class="lobby-main">
        <section class="lobby-rooms">
          <h3 class="lobby-section-title">ROOMS <span id="room-count"></span></h3>
          <ul id="room-list" class="room-list"></ul>
        </section>

        <section class="lobby-bottom">
          <div class="lobby-players">
            <h3 class="lobby-section-title">PLAYERS <span id="player-count"></span></h3>
            <ul id="lobby-player-list" class="lobby-player-list"></ul>
          </div>
          <div class="lobby-chat">
            <h3 class="lobby-section-title">CHAT</h3>
            <div id="lobby-chat-log" class="lobby-chat-log"></div>
            <input id="lobby-chat-input" class="lobby-chat-input" placeholder="Type and Enter..." />
          </div>
        </section>
      </main>

      <footer class="lobby-footer">
        <button id="new-game-btn" class="lobby-btn primary">+ NEW GAME</button>
        <button id="lobby-help" class="lobby-btn">HELP</button>
        <button id="lobby-setting" class="lobby-btn">SETTING</button>
        <button id="lobby-exit" class="lobby-btn">EXIT</button>
        <button id="map-editor-btn" class="lobby-btn">MAP EDITOR</button>
      </footer>
    </div>

    <!-- Map Editor -->
    <div id="map-editor-container" class="hidden"></div>

    <!-- Create Room モーダル -->
    <div id="create-room-modal" class="lobby-modal hidden">
      <div class="lobby-modal-overlay"></div>
      <div class="lobby-modal-content">
        <h3>CREATE ROOM</h3>
        <div class="create-room-form">
          <div class="cr-row">
            <label class="cr-label">Room ID
              <input id="room-id" placeholder="(auto)" />
            </label>
            <label class="cr-label">Comment
              <input id="room-name" placeholder="(optional)" />
            </label>
          </div>
          <div class="cr-row">
            <label class="cr-label">Max Players <span class="cr-hint">2–100, even</span>
              <input id="max-players" value="4" type="number" min="2" max="100" step="2" />
            </label>
            <label class="cr-label">Time Limit (sec) <span class="cr-hint">30–3600</span>
              <input id="time-limit" value="240" type="number" min="30" max="3600" step="30" />
            </label>
          </div>
          <div class="cr-row">
            <label class="cr-label">Game Mode
              <select id="game-mode">
                <option value="ctf" selected>Flag (CTF)</option>
                <option value="deathmatch">Deathmatch</option>
              </select>
            </label>
            <label class="cr-label">Map
              <select id="map-select">
                <option value="riverside" selected>Riverside (River)</option>
                <option value="fortress">Fortress (Bases)</option>
                <option value="custom">Custom Map (Paste JSON)</option>
              </select>
            </label>
          </div>
          <div id="custom-map-area" class="hidden" style="margin-bottom: 8px;">
            <label class="cr-label">Map JSON
              <textarea id="custom-map-json" rows="5" placeholder='{"id":"my-map","width":1600,"height":1200,"walls":[...],"spawnPoints":[...]}' style="width:100%;font-size:11px;font-family:monospace;resize:vertical;background:#1a1a1a;color:#d4c4a8;border:1px solid rgba(168,148,104,0.4);border-radius:4px;padding:6px;box-sizing:border-box;"></textarea>
            </label>
            <span id="custom-map-status" style="font-size:11px;"></span>
          </div>
          <label class="cr-label">Password <span class="cr-hint">optional</span>
            <input id="room-password" placeholder="Leave blank for public" />
          </label>
          <div class="cr-options-box" style="margin: 12px 0; padding: 12px; border: 1px solid rgba(168, 148, 104, 0.4); border-radius: 4px;">
            <p style="margin:0 0 8px 0; font-size:12px; font-weight:bold; color:#d4c4a8;">OPTIONS (Rules)</p>
            <div class="cr-row" style="gap: 12px; align-items: center; margin-bottom: 6px;">
              <label style="font-size: 12px; display: flex; align-items: center; gap: 4px; color:#d4c4a8; cursor:pointer;"><input type="checkbox" id="opt-team-select"> Team Select</label>
              <label style="font-size: 12px; display: flex; align-items: center; gap: 4px; color:#d4c4a8; cursor:pointer;"><input type="checkbox" id="opt-instant-kill"> Instant Kill (HP20開始)</label>
            </div>
            <div class="cr-row" style="gap: 12px; align-items: center;">
              <label style="font-size: 12px; display: flex; align-items: center; gap: 4px; color:#d4c4a8; cursor:pointer;"><input type="checkbox" id="opt-no-item-respawn"> No Item Respawn</label>
              <label style="font-size: 12px; display: flex; align-items: center; gap: 4px; color:#d4c4a8; cursor:pointer;"><input type="checkbox" id="opt-no-shooting"> No Shooting (Item Only)</label>
            </div>
          </div>
          <div class="create-room-actions">
            <button id="create-room-cancel" class="lobby-btn">CANCEL</button>
            <button id="create-room" class="lobby-btn primary">CREATE</button>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Join Room モーダル (Password/Team Select対応) -->
    <div id="join-room-modal" class="lobby-modal hidden">
      <div class="lobby-modal-overlay"></div>
      <div class="lobby-modal-content">
        <h3>JOIN ROOM</h3>
        <div class="create-room-form">
          <p id="join-room-name" style="color: #e5dcd0; margin-bottom: 12px; font-family: monospace;"></p>
          <div id="join-pw-container" class="hidden">
            <label class="cr-label">Password
              <input id="join-room-password" placeholder="Enter password" type="password" />
            </label>
          </div>
          <div class="create-room-actions" style="margin-top: 16px;">
            <button id="join-room-cancel" class="lobby-btn">CANCEL</button>
            <button id="join-room-confirm" class="lobby-btn primary">JOIN</button>
          </div>
        </div>
      </div>
    </div>
  </section>
  <section id="room-screen" class="screen">
    <div class="panel relative-panel">
      <!-- Team Select Overlay -->
      <div id="team-select-overlay" class="result-overlay hidden">
        <div class="result-content" style="max-width: 500px; text-align: center;">
          <h2 style="margin-bottom: 24px;">CHOOSE YOUR TEAM</h2>
          <div style="display: flex; gap: 20px; justify-content: center; margin-bottom: 24px;">
            <div id="ts-red-card" style="background:#4a2a2a; border:2px solid #c44040; border-radius:8px; padding:20px; width:180px; cursor:pointer; transition:all 0.2s;">
              <h3 style="color:#e45050; margin:0 0 8px 0;">RED TEAM</h3>
              <p id="ts-red-count" style="font-size:24px; color:#fff; margin:0;">0</p>
            </div>
            <div id="ts-blue-card" style="background:#2a3a4a; border:2px solid #4a6a8a; border-radius:8px; padding:20px; width:180px; cursor:pointer; transition:all 0.2s;">
              <h3 style="color:#508be4; margin:0 0 8px 0;">BLUE TEAM</h3>
              <p id="ts-blue-count" style="font-size:24px; color:#fff; margin:0;">0</p>
            </div>
          </div>
        </div>
      </div>
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
  lobbySelect: () => document.querySelector("#lobby-select") as HTMLSelectElement,
  lobbyChatInput: () => document.querySelector("#lobby-chat-input") as HTMLInputElement,
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
    const select = dom.lobbySelect();
    if (select && state.availableLobbies.length > 0) {
      select.innerHTML = state.availableLobbies.map(l => `<option value="${l}" ${l === state.lobbyId ? "selected" : ""}>${l}</option>`).join("");
    }
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
  ctx.fillStyle = "rgba(229, 220, 208, 0.9)";
  ctx.fillRect(0, 0, w, h);
  if (mapData.walls) for (const wall of mapData.walls) {
    const type = wall.type || "wall";
    if (type === "bush") ctx.fillStyle = "rgba(90, 120, 50, 0.6)";
    else if (type === "water") ctx.fillStyle = "rgba(70, 100, 120, 0.6)";
    else if (type === "house") ctx.fillStyle = "#c4a070";
    else if (type === "oneway") ctx.fillStyle = "rgba(180, 140, 40, 0.6)";
    else if (type === "river") ctx.fillStyle = "rgba(50, 90, 140, 0.6)";
    else if (type === "bridge") ctx.fillStyle = "rgba(120, 130, 145, 0.75)";
    else ctx.fillStyle = "#c4b4a0";
    ctx.fillRect(wall.x * scaleX, wall.y * scaleY, Math.max(1, wall.width * scaleX), Math.max(1, wall.height * scaleY));
  }
  if (mapData.spawnPoints) for (const sp of mapData.spawnPoints) {
    ctx.fillStyle = sp.team === "red" ? "rgba(196, 64, 64, 0.6)" : "rgba(74, 106, 138, 0.6)";
    ctx.beginPath(); ctx.arc(sp.x * scaleX, sp.y * scaleY, 4, 0, Math.PI * 2); ctx.fill();
  }
};

export const renderRooms = (rooms: RoomSummary[], sendMessage: (msg: any) => void, requestJoinInfo: (room: RoomSummary, isSpectate: boolean) => Promise<{ password?: string, team?: "red" | "blue" } | null>) => {
  const roomList = dom.roomList();
  const countEl = document.querySelector("#room-count") as HTMLElement | null;
  roomList.innerHTML = "";

  // インジケーター更新
  if (countEl) countEl.textContent = `(${rooms.length})`;

  if (rooms.length === 0) {
    const emptyLi = document.createElement("li");
    emptyLi.style.cssText = "padding:24px;text-align:center;color:#8a7348;font-family:'Share Tech Mono',monospace;font-size:0.85em;";
    emptyLi.textContent = "No rooms yet. Hit + NEW GAME to start!";
    roomList.appendChild(emptyLi);
    return;
  }

  rooms.forEach((room) => {
    const li = document.createElement("li");
    li.className = "room-card";
    const spectCount = (room as any).spectatorCount ?? 0;
    const spectLabel = spectCount > 0 ? `• 👁 ${spectCount}` : "";
    const playerCount = (room as any).players?.length ?? (room as any).playerCount ?? 0;
    const toMMSS = (sec: number) => `${Math.floor(sec / 60).toString().padStart(2, "0")}:${(sec % 60).toString().padStart(2, "0")}`;
    const timeLeft = Math.max(0, Math.ceil(((room as any).endsAt - Date.now()) / 1000));
    const timeLimitSec = (room as any).timeLimitSec ?? 0;
    const timerHtml = timeLeft <= 0
      ? `<span class="room-card-ended">ENDED</span>`
      : `<span class="room-card-timer">${toMMSS(timeLeft)}</span><span class="rc-timelimit"> / ${toMMSS(timeLimitSec)}</span>`;
    const lockIcon = room.passwordProtected ? `🔒 ` : "";
    const modeLabel = (room as any).gameMode === "ctf" ? "CTF" : "DM";
    const mapLabel = (room as any).mapId ?? "";
    const hostName = (room as any).hostName ?? "";
    const displayId = `Room ${room.id}`;
    const comment = (room.name && room.name !== room.id) ? room.name : "(no comment)";

    // オプションタグ
    const optTags = [];
    if (room.options) {
      if (room.options.teamSelect) optTags.push(`<span class="rc-tag" style="background:#4a6a8a; border-color:#6a8aba; color:#fff;" title="Team Select">Team</span>`);
      if (room.options.instantKill) optTags.push(`<span class="rc-tag" style="background:#c44040; border-color:#e46060; color:#fff;" title="Instant Kill">1Hit</span>`);
      if (room.options.noItemRespawn) optTags.push(`<span class="rc-tag" style="background:#bd954e; border-color:#ddb56e; color:#fff;" title="No Item Respawn">NoItem</span>`);
      if (room.options.noShooting) optTags.push(`<span class="rc-tag" style="background:#666; border-color:#888; color:#fff;" title="No Shooting">NoShoot</span>`);
    }
    const tagsHtml = optTags.join(" ");

    // チームスコア・人数情報
    let teamStatsHtml = "";
    const tStats = (room as any).teamStats;
    if (tStats) {
      const rs = tStats.red;
      const bs = tStats.blue;
      teamStatsHtml = `
      <div class="rc-teamstats" style="display:flex; gap:8px; font-size:11.5px; align-items:center; margin-left:4px;">
        <span style="color:#d45555; font-weight:bold;">RED: ${rs.score} (👤${rs.count})</span>
        <span style="color:#6a92c8; font-weight:bold;">BLUE: ${bs.score} (👤${bs.count})</span>
      </div>`;
    }

    li.innerHTML = `
      <div class="room-card-thumb-wrap"><canvas class="room-thumbnail"></canvas></div>
      <div style="display:flex; align-items:center; gap:8px; flex: 1; flex-wrap:wrap;">
        <span class="rc-name">${lockIcon}${displayId}</span>
        <span class="rc-comment">${comment}</span>
        <span class="rc-tag">${modeLabel}</span>
        <span class="rc-tag">${mapLabel}</span>
        ${tagsHtml}
        ${teamStatsHtml}
      </div>
      <span class="rc-tag">${playerCount}/${room.maxPlayers}${spectLabel ? ` 👁${spectCount}` : ""}</span>
      <span class="rc-time">${timerHtml}</span>
      ${hostName ? `<span class="rc-host">by ${hostName}</span>` : ""}
      <div class="rc-actions">
        <button class="join room-card-btn-join">JOIN</button>
        <button class="watch room-card-btn-watch">WATCH</button>
      </div>`;
    const thumbCanvas = li.querySelector(".room-thumbnail") as HTMLCanvasElement;
    const mapMeta = room.mapData || MAPS[(room as any).mapId];
    if (thumbCanvas && mapMeta) drawMapDataThumbnail(thumbCanvas, mapMeta as any);
    (li.querySelector(".join") as HTMLButtonElement).addEventListener("click", async () => {
      const info = await requestJoinInfo(room, false);
      if (info === null) return;
      state.isSpectator = false;
      state.leavingRoomId = "";
      sendMessage({ type: "joinRoom", payload: { roomId: room.id, password: info.password, requestedTeam: info.team } });
    });
    (li.querySelector(".watch") as HTMLButtonElement).addEventListener("click", async () => {
      const info = await requestJoinInfo(room, true);
      if (info === null) return;
      state.isSpectator = true;
      state.leavingRoomId = "";
      sendMessage({ type: "spectateRoom", payload: { roomId: room.id, password: info.password } });
    });
    roomList.appendChild(li);
  });
};
