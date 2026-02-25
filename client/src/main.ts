import "./style.css";
import type {
  BulletPublic,
  ChatMessage,
  ClientToServerMessage,
  Explosion,
  Item,
  MapData,
  PlayerSummary,
  RoomSummary,
  ServerToClientMessage,
  Vector2,
  Flag
} from "@tanktaktix/shared";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Missing #app container");
}

app.innerHTML = `
  <section id="login-screen" class="screen active">
    <div class="panel">
      <h1>Tank Taktix</h1>
      <p class="notice">Enter a commander name or roll a random 4-digit callsign.</p>
      <div class="grid two">
        <input id="name-input" placeholder="Commander name" maxlength="16" />
        <button id="random-name">Random 4-digit</button>
      </div>
      <div style="margin-top: 16px; display: flex; gap: 12px;">
        <button id="login-btn">Enter Lobby</button>
      </div>
    </div>
  </section>
  <section id="lobby-screen" class="screen">
    <div class="panel">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
        <h2 style="margin: 0;">Lobby</h2>
        <div style="display: flex; gap: 8px;">
          <button id="lobby-help" class="secondary" style="padding: 4px 12px; font-size: 0.9em;">Help</button>
          <button id="lobby-setting" class="secondary" style="padding: 4px 12px; font-size: 0.9em;">Setting</button>
          <button id="lobby-exit" class="secondary" style="padding: 4px 12px; font-size: 0.9em;">Exit</button>
        </div>
      </div>
      <div class="grid three" style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem;">
        <div>
          <h3>Rooms</h3>
          <ul id="room-list" class="room-list"></ul>
        </div>
        <div>
          <h3>Create Room</h3>
          <div class="grid">
            <input id="room-id" placeholder="Room ID" />
            <input id="room-name" placeholder="Room name (optional)" />
            <input id="max-players" placeholder="Max players" value="4" />
            <input id="time-limit" placeholder="Time limit (sec)" value="240" />
            <select id="game-mode">
              <option value="ctf" selected>Flag (CTF)</option>
              <option value="deathmatch">Deathmatch</option>
            </select>
            <select id="map-select">
              <option value="alpha">Alpha (Classic)</option>
              <option value="beta">Beta (Urban)</option>
              <option value="gamma">Gamma (Fort)</option>
              <option value="delta">Delta (Nature)</option>
              <option value="epsilon">Epsilon (Obstacles)</option>
            </select>
            <input id="room-password" placeholder="Password (optional)" />
            <button id="create-room">Create</button>
          </div>
        </div>
        <div>
          <h3>Lobby Chat</h3>
          <div id="lobby-chat-log" style="height: 200px; overflow-y: auto; background: rgba(0,0,0,0.3); border: 1px solid #444; padding: 4px; margin-bottom: 8px; font-size: 0.9em; font-family: monospace;"></div>
          <input id="lobby-chat-input" placeholder="Type here..." style="width: 100%; box-sizing: border-box;" />
          
          <h3 style="margin-top: 12px;">Commanders</h3>
          <ul id="lobby-player-list" style="height: 120px; overflow-y: auto; list-style: none; padding: 0; background: rgba(0,0,0,0.2);"></ul>
        </div>
      </div>
    </div>
  </section>
  <section id="room-screen" class="screen">
    <div class="panel relative-panel">
      <!-- Result Overlay -->
      <!-- Result Overlay -->
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

      <!-- In-Game Leave Button -->
      <button id="game-leave-btn" class="overlay-btn top-right">Leave</button>

      <div class="room-header">
        <div>
          <h2 id="room-title">Room</h2>
          <p id="room-meta">Time left: --, Players: --</p>
        </div>
        <div class="room-actions">
          <span id="cooldown">Ready</span>
          <button id="leave-room">Leave Room</button>
        </div>
      </div>
      <canvas id="map" width="1200" height="675"></canvas>
      <div class="hud">
        <div>
          <h3>Scores</h3>
          <ul id="score-list" class="score-list"></ul>
        </div>
        <div>
          <h3>Chat</h3>
          <div class="chat">
            <input id="chat-input" placeholder="Press T to chat" />
            <div id="chat-log" class="chat-log"></div>
          </div>
        </div>
      </div>
    </div>
  </section>
`;

const loginScreen = document.querySelector("#login-screen") as HTMLElement;
const lobbyScreen = document.querySelector("#lobby-screen") as HTMLElement;
const roomScreen = document.querySelector("#room-screen") as HTMLElement;

const roomList = document.querySelector("#room-list") as HTMLUListElement;
const roomIdInput = document.querySelector("#room-id") as HTMLInputElement;
const roomNameInput = document.querySelector("#room-name") as HTMLInputElement;
const maxPlayersInput = document.querySelector("#max-players") as HTMLInputElement;
const timeLimitInput = document.querySelector("#time-limit") as HTMLInputElement;
const gameModeSelect = document.querySelector("#game-mode") as HTMLSelectElement;
const passwordInput = document.querySelector("#room-password") as HTMLInputElement;
const createRoomBtn = document.querySelector("#create-room") as HTMLButtonElement;

const roomTitle = document.querySelector("#room-title") as HTMLElement;
const roomMeta = document.querySelector("#room-meta") as HTMLElement;
const scoreList = document.querySelector("#score-list") as HTMLUListElement;
const cooldownEl = document.querySelector("#cooldown") as HTMLElement;

const chatInput = document.querySelector("#chat-input") as HTMLInputElement;
const chatLog = document.querySelector("#chat-log") as HTMLDivElement;

const resultOverlay = document.querySelector("#result-overlay") as HTMLElement;
const resultWinner = document.querySelector("#result-winner") as HTMLElement;
const resultBody = document.querySelector("#result-body") as HTMLElement;
const copyResultBtn = document.querySelector("#copy-result") as HTMLButtonElement;
const closeResultBtn = document.querySelector("#close-result") as HTMLButtonElement;
const gameLeaveBtn = document.querySelector("#game-leave-btn") as HTMLButtonElement;

const canvas = document.querySelector("#map") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) {
  throw new Error("Missing canvas context");
}

const state = {
  phase: "login" as "login" | "lobby" | "room",
  selfId: "",
  name: "",
  rooms: [] as RoomSummary[],
  roomId: "" as string | "",
  players: [] as PlayerSummary[],
  timeLeftSec: 0,
  chat: [] as ChatMessage[],
  aiming: false,
  aimPoint: null as Vector2 | null,
  bullets: [] as BulletPublic[],
  explosions: [] as (Explosion & { startedAt: number })[],
  mapData: null as MapData | null,
  teamScores: { red: 0, blue: 0 } as { red: number; blue: number },
  camera: { x: 0, y: 0, zoom: 1, rotation: 0 },
  // Lobby Ext
  lobbyChat: [] as { from: string, message: string }[],
  onlinePlayers: [] as { id: string, name: string }[],
  items: [] as Item[], // New: store items for rendering
  flags: [] as Flag[], // New: store flags for CTF
  isSpectator: false, // Spectator mode flag

  // Phase 4-6: Damage Flash System
  lastHpMap: {} as Record<string, number>,
  hitFlashes: {} as Record<string, number>,

  // Phase 4-8: Floating Combat Text
  floatingTexts: [] as { id: string, text: string, color: string, x: number, y: number, startedAt: number }[],

  // Phase 4-8: Hit Particles
  particles: [] as { x: number, y: number, vx: number, vy: number, life: number, maxLife: number, color: string }[],
};

let ws: WebSocket | null = null;

const keysDown = new Set<string>();
const CAMERA_SPEED = 8;
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3.0;
const ROTATION_STEP = Math.PI / 36; // 5 degrees

let mapSize = { width: 1800, height: 1040 }; // updated when mapData arrives

const setScreen = (phase: "login" | "lobby" | "room") => {
  console.log(`[DEBUG] setScreen("${phase}") called.`);
  console.trace(); // Trace caller
  // Guard: Prevent switching to room if we don't have a roomId yet
  if (phase === "room" && !state.roomId) {
    console.warn("[setScreen] Blocked switch to 'room' because state.roomId is missing.");
    return;
  }

  // Cleanup room listeners if leaving room
  if (phase !== "room" && roomAbortController) {
    roomAbortController.abort();
    roomAbortController = null;
  }

  state.phase = phase;
  loginScreen.classList.toggle("active", phase === "login");
  lobbyScreen.classList.toggle("active", phase === "lobby");
  roomScreen.classList.toggle("active", phase === "room");
};

const connect = () => {
  if (ws) {
    return;
  }
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const url = `${protocol}://${window.location.host}/ws`;
  ws = new WebSocket(url);
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data) as ServerToClientMessage;
    handleServerMessage(message);
  });
  ws.addEventListener("close", () => {
    ws = null;
    alert("Connection closed. Refresh to reconnect.");
  });
};

const sendMessage = (message: ClientToServerMessage) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  ws.send(JSON.stringify(message));
};

const handleServerMessage = (message: ServerToClientMessage) => {
  switch (message.type) {
    case "welcome":
      state.selfId = message.payload.id;
      localStorage.setItem("tt_id", message.payload.id); // Save for reconnection (B-3)
      break;
    case "lobby":
      // Guard: If we are in 'room' phase, ignore lobby updates to prevent flicker/reset
      if (state.phase === "room") break;

      state.rooms = message.payload.rooms;

      // Update online players
      if ((message.payload as any).onlinePlayers) {
        state.onlinePlayers = (message.payload as any).onlinePlayers;
        renderLobbyPlayers();
      }

      renderRooms();

      if (state.phase !== "lobby") {
        setScreen("lobby");
        // Reset game state for lobby
        state.roomId = "";
        state.players = [];
        state.bullets = [];
        state.explosions = [];
      }
      break;
    case "room": {
      const payload = message.payload;
      const isFirstRoomMessage = !state.roomId; // check before state.roomId is set

      // Update map size first (needed for camera init calculation below)
      mapSize.width = payload.mapData.width;
      mapSize.height = payload.mapData.height;

      // Camera init: on first room message, jump camera to player's spawn position
      if (isFirstRoomMessage) {
        if (state.isSpectator) {
          // Spectators start at map center
          state.camera.x = 0;
          state.camera.y = 0;
        } else {
          const me = payload.players.find(p => p.id === state.selfId);
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
      state.explosions = message.payload.explosions.map(e => ({ ...e, startedAt: Date.now() }));
      state.mapData = message.payload.mapData;
      state.teamScores = message.payload.teamScores;
      state.items = message.payload.items;
      state.flags = message.payload.flags || [];

      // Phase 4-6: Check for HP drops to trigger damage flashes
      const now = Date.now();
      for (const p of payload.players) {
        const lastHp = state.lastHpMap[p.id];
        if (lastHp !== undefined) {
          if (p.hp < lastHp && p.hp > 0) {
            // HP dropped -> Trigger flash (duration: 150ms)
            state.hitFlashes[p.id] = now + 150;
            // Add Damage FCT
            state.floatingTexts.push({ id: Math.random().toString(), text: `-${lastHp - p.hp}`, color: "#ff6b6b", x: p.position.x, y: p.position.y - 25, startedAt: now });
          } else if (p.hp > lastHp) {
            // Add Heal FCT
            state.floatingTexts.push({ id: Math.random().toString(), text: `+${p.hp - lastHp}`, color: "#4ade80", x: p.position.x, y: p.position.y - 25, startedAt: now });
          }
        }
        state.lastHpMap[p.id] = p.hp; // Update for next frame
      }

      // Ensure we switch to room screen if not already there
      if (state.phase !== "room") {
        setScreen("room");
        setupRoom();
      }

      renderRoom();
      break;
    }
    case "chat":
      if (state.phase === "lobby") {
        state.lobbyChat.push(message.payload);
        if (state.lobbyChat.length > 50) state.lobbyChat.shift();
        renderLobbyChat();
      } else {
        state.chat.unshift(message.payload);
        if (state.chat.length > 50) state.chat.pop();
        // renderChat is Canvas-based now, called in loop
      }
      break;

    case "gameEnd":
      if ((message.payload as any).roomId && (message.payload as any).roomId !== state.roomId) {
        return;
      }
      // Show Result
      resultOverlay.classList.remove("hidden");
      const { winners, results } = message.payload;

      const winnerText = (!winners || winners === "draw") ? "Draw Game!" : `${winners.toUpperCase()} Team Wins!`;
      resultWinner.textContent = winnerText;
      resultWinner.style.color = winners === "red" ? "#ff6b6b" : (winners === "blue" ? "#60a5fa" : "#ccc");

      // Sort by score desc
      results.sort((a, b) => b.score - a.score);

      resultBody.innerHTML = "";
      results.forEach(p => {
        const tr = document.createElement("tr");
        const hitRate = p.fired > 0 ? Math.floor((p.hits / p.fired) * 100) : 0;
        tr.innerHTML = `
          <td>${p.name}</td>
          <td>${p.score}</td>
          <td>${p.kills} / ${p.deaths}</td>
          <td>${hitRate}%</td>
        `;
        resultBody.appendChild(tr);
      });
      break;
    case "error":
      alert(message.payload.message);
      break;
    case "explosion":
      // Add to local VFX list
      state.explosions.push({
        ...message.payload,
        startedAt: Date.now()
      });
      // Phase 4-8: Generate Hit Particles (Sparks)
      const numParticles = message.payload.radius > 30 ? 12 : 6; // More sparks for Bomb
      for (let i = 0; i < numParticles; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 4 + 2;
        state.particles.push({
          x: message.payload.x,
          y: message.payload.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1.0,
          maxLife: Math.random() * 0.5 + 0.3, // 0.3~0.8 seconds
          color: Math.random() > 0.5 ? "#fde047" : "#f97316" // Yellow or Orange
        });
      }
      break;
    default:
      break;
  }
};

const renderRooms = () => {
  roomList.innerHTML = "";
  if (state.rooms.length === 0) {
    roomList.innerHTML = `<li class="room empty">No rooms yet. Create one!</li>`;
    return;
  }
  state.rooms.forEach((room) => {
    const li = document.createElement("li");
    li.className = "room";
    const spectCount = (room as any).spectatorCount ?? 0;
    const spectLabel = spectCount > 0 ? ` • 👁 ${spectCount}` : "";
    li.innerHTML = `
      <div class="room-row">
        <div>
          <strong>${room.name ?? (room as any).roomName ?? room.id}</strong>
          <div class="meta">${(room as any).players?.length ?? (room as any).playerCount ?? 0}/${room.maxPlayers} players${spectLabel} • ${room.timeLimitSec}s</div>
        </div>
        <div style="display: flex; gap: 4px;">
          <button class="join">Join</button>
          <button class="watch" style="background: #6b7280; color: #fff; border: none; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-size: 0.85em;">Watch</button>
        </div>
      </div>
    `;
    const joinBtn = li.querySelector(".join") as HTMLButtonElement;
    joinBtn.addEventListener("click", () => {
      const pw = room.passwordProtected ? prompt("Password?") ?? "" : "";
      state.isSpectator = false;
      sendMessage({ type: "joinRoom", payload: { roomId: room.id, password: pw } });
    });
    const watchBtn = li.querySelector(".watch") as HTMLButtonElement;
    watchBtn.addEventListener("click", () => {
      const pw = room.passwordProtected ? prompt("Password?") ?? "" : "";
      state.isSpectator = true;
      sendMessage({ type: "spectateRoom" as any, payload: { roomId: room.id, password: pw } });
    });
    roomList.appendChild(li);
  });
};

const renderLobbyPlayers = () => {
  const list = document.querySelector("#lobby-player-list") as HTMLUListElement;
  if (!list) return;
  list.innerHTML = "";
  state.onlinePlayers.forEach(p => {
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
  state.lobbyChat.forEach(msg => {
    const div = document.createElement("div");
    const nameSpan = document.createElement("span");
    nameSpan.textContent = msg.from + ": ";
    nameSpan.style.color = "#aaa";
    nameSpan.style.fontWeight = "bold";

    const msgSpan = document.createElement("span");
    msgSpan.textContent = msg.message;
    msgSpan.style.color = "#fff";

    div.appendChild(nameSpan);
    div.appendChild(msgSpan);
    div.style.marginBottom = "2px";
    log.appendChild(div);
  });
  log.scrollTop = log.scrollHeight;
};

const renderRoom = () => {
  roomTitle.textContent = `Room ${state.roomId}`;
  roomMeta.textContent = `Time left: ${state.timeLeftSec}s, Players: ${state.players.length}`;
  renderScores();
  renderChat();
};

const renderScores = () => {
  scoreList.innerHTML = "";
  const sorted = [...state.players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  sorted.forEach((p) => {
    const li = document.createElement("li");
    li.textContent = `${p.name}: ${p.score ?? 0}`;
    scoreList.appendChild(li);
  });
};

const renderChat = () => {
  // Chat is drawn on canvas via drawHUD
};

const getSelf = () => state.players.find((p) => p.id === state.selfId);

const getCanvasPoint = (event: MouseEvent): Vector2 => {
  const rect = canvas.getBoundingClientRect();
  // Screen coords relative to canvas center (use intrinsic canvas size, not world mapSize)
  let sx = ((event.clientX - rect.left) / rect.width) * canvas.width - canvas.width / 2;
  let sy = ((event.clientY - rect.top) / rect.height) * canvas.height - canvas.height / 2;
  // Inverse zoom
  sx /= state.camera.zoom;
  sy /= state.camera.zoom;
  // Inverse rotation
  const cos = Math.cos(-state.camera.rotation);
  const sin = Math.sin(-state.camera.rotation);
  const rx = sx * cos - sy * sin;
  const ry = sx * sin + sy * cos;
  // Add camera offset + viewport center
  return { x: rx + state.camera.x + mapSize.width / 2, y: ry + state.camera.y + mapSize.height / 2 };
};

const isMouseOnTank = (point: Vector2, tankPos: Vector2) => {
  const dx = point.x - tankPos.x;
  const dy = point.y - tankPos.y;
  return Math.hypot(dx, dy) <= 18;
};

const drawItemSprite = (ctx: CanvasRenderingContext2D, type: string) => {
  if (type === "medic") {
    ctx.fillStyle = "#16a34a";
    ctx.fillRect(-10, -10, 20, 20);
    ctx.fillStyle = "#fff";
    ctx.fillRect(-7, -2, 14, 4);
    ctx.fillRect(-2, -7, 4, 14);
  } else if (type === "ammo") {
    ctx.fillStyle = "#ca8a04";
    ctx.fillRect(-10, -10, 20, 20);
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(-7, 2, 8, 5);
  } else if (type === "heart") {
    ctx.fillStyle = "#ec4899";
    ctx.beginPath();
    ctx.moveTo(0, 4);
    ctx.bezierCurveTo(-10, -6, -14, 2, 0, 12);
    ctx.bezierCurveTo(14, 2, 10, -6, 0, 4);
    ctx.fill();
  } else if (type === "bomb") {
    ctx.fillStyle = "#374151";
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f97316";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(5, -8);
    ctx.lineTo(8, -14);
    ctx.stroke();
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.arc(8, -14, 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === "rope") {
    ctx.strokeStyle = "#a3752c";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 1.5);
    ctx.stroke();
    ctx.fillStyle = "#a3752c";
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(4, -4);
    ctx.lineTo(-4, -4);
    ctx.closePath();
    ctx.fill();
  } else if (type === "boots") {
    ctx.fillStyle = "#6366f1";
    ctx.fillRect(-8, -4, 10, 12);
    ctx.fillRect(-8, 4, 16, 6);
    ctx.strokeStyle = "#a5b4fc";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-12, 0); ctx.lineTo(-16, 0);
    ctx.moveTo(-12, 4); ctx.lineTo(-18, 4);
    ctx.moveTo(-12, 8); ctx.lineTo(-15, 8);
    ctx.stroke();
  }
};

const drawFlagSprite = (ctx: CanvasRenderingContext2D, team: string) => {
  ctx.fillStyle = "#fff";
  ctx.fillRect(-1, -20, 2, 40);
  ctx.fillStyle = team === "red" ? "#dc2626" : "#2563eb";
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.lineTo(25, -10);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 10px Arial";
  ctx.textAlign = "center";
  ctx.fillText(team.toUpperCase(), 0, 30);
};

const draw = () => {
  requestAnimationFrame(draw);
  if (state.phase !== "room") {
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0b132b";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Camera movement (Arrow keys, rotated to match view; disabled while chat is open)
  const camCos = Math.cos(state.camera.rotation);
  const camSin = Math.sin(state.camera.rotation);
  const spd = CAMERA_SPEED / state.camera.zoom;
  const chatActive = document.activeElement === chatInput;
  let camDx = 0, camDy = 0;
  if (keysDown.has("arrowleft") && !chatActive) { camDx -= spd; }
  if (keysDown.has("arrowright") && !chatActive) { camDx += spd; }
  if (keysDown.has("arrowup") && !chatActive) { camDy -= spd; }
  if (keysDown.has("arrowdown") && !chatActive) { camDy += spd; }
  // Rotate movement direction by camera rotation
  state.camera.x += camDx * camCos + camDy * camSin;
  state.camera.y += -camDx * camSin + camDy * camCos;

  // Zoom keys (+/-)
  if (keysDown.has("=") || keysDown.has("+")) {
    state.camera.zoom = Math.min(ZOOM_MAX, state.camera.zoom + ZOOM_STEP * 0.3);
  }
  if (keysDown.has("-")) {
    state.camera.zoom = Math.max(ZOOM_MIN, state.camera.zoom - ZOOM_STEP * 0.3);
  }

  // Rotation keys (Q/E)
  if (keysDown.has("q") && !chatActive) {
    state.camera.rotation -= ROTATION_STEP * 0.3;
  }
  if (keysDown.has("e") && !chatActive) {
    state.camera.rotation += ROTATION_STEP * 0.3;
  }

  // Apply camera transform: translate center, rotate, zoom, offset
  ctx.save();
  ctx.translate(canvas.width / 2, canvas.height / 2); // viewport center = canvas center (NOT mapSize)
  ctx.rotate(state.camera.rotation);
  ctx.scale(state.camera.zoom, state.camera.zoom);
  ctx.translate(-state.camera.x - mapSize.width / 2, -state.camera.y - mapSize.height / 2);

  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  for (let x = 0; x < mapSize.width; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, mapSize.height);
    ctx.stroke();
  }
  for (let y = 0; y < mapSize.height; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(mapSize.width, y);
    ctx.stroke();
  }

  // Walls
  if (state.mapData && state.mapData.walls) {
    for (const w of state.mapData.walls) {
      const type = w.type || "wall";
      if (type === "bush") {
        ctx.fillStyle = "rgba(34, 197, 94, 0.4)"; // Greenish bush
      } else if (type === "water") {
        ctx.fillStyle = "rgba(59, 130, 246, 0.4)"; // Bluish water
      } else if (type === "house") {
        ctx.fillStyle = "#8b4513"; // SaddleBrown
      } else if (type === "oneway") {
        ctx.fillStyle = "rgba(255, 140, 0, 0.4)"; // Orange
      } else {
        ctx.fillStyle = "#4a5568"; // Default wall
      }

      ctx.fillRect(w.x, w.y, w.width, w.height);

      if (type === "wall") {
        // Bevel/Border only for real walls
        ctx.strokeStyle = "#718096";
        ctx.lineWidth = 2;
        ctx.strokeRect(w.x, w.y, w.width, w.height);
      } else if (type === "house") {
        ctx.strokeStyle = "#5c2e0b";
        ctx.lineWidth = 4;
        ctx.strokeRect(w.x, w.y, w.width, w.height);
        ctx.beginPath();
        ctx.moveTo(w.x, w.y);
        ctx.lineTo(w.x + w.width, w.y + w.height);
        ctx.moveTo(w.x + w.width, w.y);
        ctx.lineTo(w.x, w.y + w.height);
        ctx.stroke();
      } else if (type === "oneway") {
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        const dir = (w as any).direction;
        const cx = w.x + w.width / 2;
        const cy = w.y + w.height / 2;

        ctx.save();
        ctx.translate(cx, cy);
        if (dir === "up") ctx.rotate(-Math.PI / 2);
        else if (dir === "down") ctx.rotate(Math.PI / 2);
        else if (dir === "left") ctx.rotate(Math.PI);
        // "right" is 0 rad

        ctx.beginPath();
        ctx.moveTo(-10, -10);
        ctx.lineTo(10, 0);
        ctx.lineTo(-10, 10);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // --- Spawn Points (base zones) ---
  if (state.mapData && state.mapData.spawnPoints) {
    const now = Date.now();
    const pulse = Math.sin(now * 0.004) * 0.5 + 0.5; // 0..1 pulsating
    const ZONE_W = 200;
    const ZONE_H = 200;

    for (const sp of state.mapData.spawnPoints) {
      const spColor = sp.team === "red" ? "#ef4444" : sp.team === "blue" ? "#3b82f6" : "#aaa";
      const spColorRgb = sp.team === "red" ? "239,68,68" : sp.team === "blue" ? "59,130,246" : "170,170,170";

      const zx = sp.x - ZONE_W / 2;
      const zy = sp.y - ZONE_H / 2;

      // Pulsating outer border
      ctx.save();
      ctx.strokeStyle = `rgba(${spColorRgb}, ${0.15 + pulse * 0.25})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(zx - 4 - pulse * 3, zy - 4 - pulse * 3, ZONE_W + 8 + pulse * 6, ZONE_H + 8 + pulse * 6);
      ctx.restore();

      // Filled zone rectangle
      ctx.fillStyle = `rgba(${spColorRgb}, 0.15)`;
      ctx.fillRect(zx, zy, ZONE_W, ZONE_H);

      // Border
      ctx.strokeStyle = spColor;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(zx, zy, ZONE_W, ZONE_H);

      // Corner brackets for a tactical look
      const cb = 8; // bracket length
      ctx.strokeStyle = `rgba(${spColorRgb}, 0.7)`;
      ctx.lineWidth = 2;
      // Top-left
      ctx.beginPath();
      ctx.moveTo(zx, zy + cb); ctx.lineTo(zx, zy); ctx.lineTo(zx + cb, zy);
      ctx.stroke();
      // Top-right
      ctx.beginPath();
      ctx.moveTo(zx + ZONE_W - cb, zy); ctx.lineTo(zx + ZONE_W, zy); ctx.lineTo(zx + ZONE_W, zy + cb);
      ctx.stroke();
      // Bottom-left
      ctx.beginPath();
      ctx.moveTo(zx, zy + ZONE_H - cb); ctx.lineTo(zx, zy + ZONE_H); ctx.lineTo(zx + cb, zy + ZONE_H);
      ctx.stroke();
      // Bottom-right
      ctx.beginPath();
      ctx.moveTo(zx + ZONE_W - cb, zy + ZONE_H); ctx.lineTo(zx + ZONE_W, zy + ZONE_H); ctx.lineTo(zx + ZONE_W, zy + ZONE_H - cb);
      ctx.stroke();

      // "SPAWN" label (counter-rotate so it stays upright)
      ctx.save();
      ctx.translate(sp.x, sp.y);
      ctx.rotate(-state.camera.rotation);
      ctx.font = "bold 9px 'Segoe UI', Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.fillStyle = `rgba(${spColorRgb}, 0.6)`;
      ctx.fillText("SPAWN", 0, 4);
      ctx.restore();
    }
  }

  // bullets（サーバ権威の projectile）
  if (state.bullets.length > 0) {
    for (const b of state.bullets) {
      ctx.save();
      const bAny = b as any;
      if (bAny.isRope) {
        // Rope projectile: brown squiggly line from shooter
        const sx = bAny.startX ?? b.position.x;
        const sy = bAny.startY ?? b.position.y;

        ctx.strokeStyle = "#a3752c";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(sx, sy);

        // Draw wavy line to current pos
        const dx = b.position.x - sx;
        const dy = b.position.y - sy;
        const dist = Math.hypot(dx, dy);
        const segments = Math.max(1, Math.floor(dist / 10));

        if (dist > 0) {
          const perpX = -dy / dist;
          const perpY = dx / dist;

          for (let i = 1; i <= segments; i++) {
            const t = i / segments;
            const wave = Math.sin(t * Math.PI * 4) * 4; // wave amplitude
            ctx.lineTo(sx + dx * t + perpX * wave, sy + dy * t + perpY * wave);
          }
        }
        ctx.stroke();

        // Draw end hook
        ctx.fillStyle = "#8b5a2b";
        ctx.beginPath();
        ctx.arc(b.position.x, b.position.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }

      if (bAny.isAmmoPass) {
        ctx.translate(b.position.x, b.position.y);
        ctx.rotate(-state.camera.rotation);
        drawItemSprite(ctx, "ammo");
        ctx.restore();
        continue;
      }

      if (bAny.isHealPass) {
        ctx.translate(b.position.x, b.position.y);
        ctx.rotate(-state.camera.rotation);
        drawItemSprite(ctx, "medic");
        ctx.restore();
        continue;
      }

      if (bAny.isFlagPass) {
        ctx.translate(b.position.x, b.position.y);
        ctx.rotate(-state.camera.rotation);
        drawFlagSprite(ctx, bAny.flagTeam || "red");
        ctx.restore();
        continue;
      }

      // Normal Bullet or Bomb
      if (bAny.isBomb) {
        ctx.fillStyle = "#ef4444";
      } else {
        ctx.fillStyle = "#fde047";
      }
      ctx.beginPath();
      ctx.arc(b.position.x, b.position.y, b.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // Explosions VFX
  state.explosions = state.explosions.filter(e => Date.now() - e.startedAt < 500); // 0.5s duration
  for (const e of state.explosions) {
    const start = e.startedAt;
    const progress = (Date.now() - start) / 500;
    if (progress > 1) continue;

    const r = e.radius || 40;

    ctx.fillStyle = `rgba(255, 165, 0, ${1 - progress})`;
    ctx.beginPath();
    ctx.arc(e.x, e.y, r * (0.5 + progress * 0.5), 0, Math.PI * 2);
    ctx.fill();

    // Ring
    ctx.strokeStyle = `rgba(255, 69, 0, ${1 - progress})`;
    ctx.lineWidth = 4 * (1 - progress);
    ctx.stroke();
  }

  // Phase 4-8: Particles VFX
  const dt = 1 / 60; // Approximate delta time for 60FPS
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.life -= dt / p.maxLife;

    if (p.life <= 0) {
      state.particles.splice(i, 1);
      continue;
    }

    // Move
    p.x += p.vx;
    p.y += p.vy;
    // Friction
    p.vx *= 0.92;
    p.vy *= 0.92;

    const alpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1.0;
  }

  // --- Items ---
  state.items.forEach(item => {
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(-state.camera.rotation);

    drawItemSprite(ctx, item.type);
    ctx.restore();
  });

  // --- Flags (CTF) ---
  if (state.flags) {
    state.flags.forEach(f => {
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(-state.camera.rotation);

      if (f.team) {
        drawFlagSprite(ctx, f.team);
      }

      ctx.restore();
    });
  }

  state.players.forEach((player) => {
    const { x, y } = (player as any).position ?? { x: (player as any).x, y: (player as any).y };
    // Team Colors
    let color = "#f72585"; // default enemy (pink/magenta)

    const pTeam = (player as any).team;
    if (pTeam === "red") {
      color = "#ef4444"; // Red Team
    } else if (pTeam === "blue") {
      color = "#3b82f6"; // Blue Team
    } else if (player.id === state.selfId) {
      color = "#4cc9f0"; // Self (no team / FFA)
    }

    // Phase 4-6: Apply Damage Flash override
    const now = Date.now();
    const isFlashing = state.hitFlashes[player.id] && state.hitFlashes[player.id] > now;
    if (isFlashing) {
      color = "#ffffff"; // Flash white
    }

    const hullAngle = (player as any).hullAngle ?? 0;
    const turretAngle = (player as any).turretAngle ?? 0;

    // === Hull (TankMatch style: simple box) ===
    ctx.save();

    // Apply transparency if in respawn cooldown
    const isInvincible = (player as any).respawnCooldownUntil && (player as any).respawnCooldownUntil > now;
    if (isInvincible) {
      ctx.globalAlpha = 0.5;
    }

    ctx.translate(x, y);
    ctx.rotate(hullAngle);

    // Body outline (dark border - turns white if flashing)
    ctx.fillStyle = isFlashing ? "#ffffff" : "#1a1a2e";
    ctx.fillRect(-13, -10, 26, 20);

    // Body fill (team color or flash)
    ctx.fillStyle = color;
    ctx.fillRect(-11, -8, 22, 16);

    // Front direction indicator (small triangle)
    ctx.fillStyle = isFlashing ? "#ff0000" : "#fff"; // Turn red when flashing for contrast
    ctx.globalAlpha = isInvincible ? 0.35 : 0.7; // Scale down alpha if already transparent
    ctx.beginPath();
    ctx.moveTo(11, -3);
    ctx.lineTo(15, 0);
    ctx.lineTo(11, 3);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = isInvincible ? 0.5 : 1.0;

    // Phase 4: Draw bomb on tank back if hasBomb
    if ((player as any).hasBomb) {
      ctx.fillStyle = "#1a1a2e";
      ctx.beginPath();
      ctx.arc(-8, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      // Fuse
      ctx.strokeStyle = "#f97316";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-8, -5);
      ctx.lineTo(-6, -8);
      ctx.stroke();
      // Spark
      ctx.fillStyle = "#fde047";
      ctx.beginPath();
      ctx.arc(-6, -8, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // === Turret (TankMatch style: white circle + thin barrel) ===
    ctx.save();

    if (isInvincible) {
      ctx.globalAlpha = 0.5;
    }

    ctx.translate(x, y);
    if (state.aiming && player.id === state.selfId && state.aimPoint) {
      // Aim Angle: Opposite to drag direction (Tank - Mouse)
      const aimAngle = Math.atan2(y - state.aimPoint.y, x - state.aimPoint.x);
      ctx.rotate(aimAngle);
    } else {
      ctx.rotate(turretAngle);
    }
    // Turret base (white filled circle)
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.fill();
    // Barrel (thin dark line)
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(5, -1.5, 14, 3);
    ctx.restore();

    // Counter-rotate text/bars so they stay upright
    ctx.save();

    if (isInvincible) {
      ctx.globalAlpha = 0.5;
    }

    ctx.translate(x, y);
    ctx.rotate(-state.camera.rotation);

    ctx.fillStyle = "#e8f1ff";
    ctx.fillText(player.name, 24, 4);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(-20, -28, ((player as any).hp / 100) * 40, 4);
    ctx.fillStyle = "#f97316";
    ctx.fillRect(-20, -22, ((player as any).ammo / 20) * 40, 4);

    // Action lock countdown (5→0) above tank — self only
    const lockStep = (player as any).actionLockStep ?? 0;
    if (lockStep > 0 && player.id === state.selfId) {
      const display = lockStep;
      ctx.font = "bold 16px monospace";
      ctx.fillStyle = "#f97316";
      ctx.textAlign = "center";
      ctx.fillText(`${display}`, 0, -34);
      ctx.textAlign = "start";
    }

    // Flag Indicator
    const hasFlag = state.flags.find(f => f.carrierId === player.id);
    if (hasFlag) {
      ctx.fillStyle = hasFlag.team === "red" ? "#ef4444" : "#3b82f6";
      ctx.font = "bold 16px Arial";
      ctx.textAlign = "center";
      ctx.fillText("🚩", 0, -38);
    }

    ctx.restore();
  });

  // Draw move queue markers for self
  const selfPlayer = getSelf();
  if (selfPlayer) {
    const queue = (selfPlayer as any).moveQueue as Vector2[] ?? [];
    queue.forEach((pt, i) => {
      const alpha = 0.3 + (i === 0 ? 0.4 : 0);
      ctx.strokeStyle = `rgba(76, 201, 240, ${alpha})`;
      ctx.lineWidth = 2;
      // Cross marker
      const sz = 8;
      ctx.beginPath();
      ctx.moveTo(pt.x - sz, pt.y);
      ctx.lineTo(pt.x + sz, pt.y);
      ctx.moveTo(pt.x, pt.y - sz);
      ctx.lineTo(pt.x, pt.y + sz);
      ctx.stroke();
      // Queue number
      ctx.fillStyle = `rgba(76, 201, 240, ${alpha})`;
      ctx.font = "10px monospace";
      ctx.fillText(`${i + 1}`, pt.x + sz + 2, pt.y - 2);
    });
  }

  if (state.aiming && state.aimPoint) {
    const self = getSelf();
    if (self) {
      const sx = (self as any).position.x;
      const sy = (self as any).position.y;
      const dragX = state.aimPoint.x - sx;
      const dragY = state.aimPoint.y - sy;
      const dragDist = Math.hypot(dragX, dragY);

      const CANCEL_DIST = 18; // Tank radius

      // Slingshot: Shoot direction is OPPOSITE to drag
      // Guide Line
      ctx.save();

      if (dragDist <= CANCEL_DIST) {
        // Cancel indicator
        ctx.fillStyle = "rgba(255, 100, 100, 0.7)";
        ctx.font = "bold 12px monospace";
        ctx.textAlign = "center";
        ctx.fillText("CANCEL", sx, sy - 28);
        ctx.textAlign = "start";
      } else {
        // Draw Slingshot Guide (Fixed Length)
        const aimX = -dragX;
        const aimY = -dragY;
        const aimLen = Math.hypot(aimX, aimY);
        const ndx = aimX / aimLen;
        const ndy = aimY / aimLen;

        const FIXED_GUIDE_LEN = 54; // Fixed length ~ 3x radius (18*3=54) or user said "half of too long (108)" -> 54.
        const guideLen = FIXED_GUIDE_LEN;

        const gx = sx + ndx * guideLen;
        const gy = sy + ndy * guideLen;

        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "rgba(76, 201, 240, 0.8)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(gx, gy);
        ctx.stroke();
        ctx.setLineDash([]);

        // Arrow head at end of guide
        ctx.fillStyle = "rgba(76, 201, 240, 0.8)";
        ctx.beginPath();
        ctx.arc(gx, gy, 4, 0, Math.PI * 2);
        ctx.fill();

        // Show "Crosshair" at max range? Or just the arrow?
        // User requested "Show launch guide in the direction of fire".
        // The arrow head is good enough.
      }
      ctx.restore();
    }
  }

  // Phase 4-8: Floating Combat Text
  const FCT_DURATION = 1000; // 1 second
  state.floatingTexts = state.floatingTexts.filter(ft => Date.now() - ft.startedAt < FCT_DURATION);
  for (const ft of state.floatingTexts) {
    const progress = (Date.now() - ft.startedAt) / FCT_DURATION;
    const currentY = ft.y - (progress * 30); // Float up

    ctx.save();
    ctx.translate(ft.x, currentY);
    ctx.rotate(-state.camera.rotation); // keep upright

    ctx.globalAlpha = 1 - Math.pow(progress, 1.5); // fade out (non-linear)
    ctx.font = "bold 16px 'Segoe UI', Arial, sans-serif";
    ctx.textAlign = "center";

    // Black outline
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#000";
    ctx.strokeText(ft.text, 0, 0);

    // Colored Text
    ctx.fillStyle = ft.color;
    ctx.fillText(ft.text, 0, 0);

    ctx.restore();
  }

  // End camera transform
  ctx.restore();

  // ─── HUD (screen-space, drawn after camera restore) ───
  drawHUD(ctx);
};

/** Draw the in-game HUD directly on the canvas (screen-space). */
function drawHUD(ctx: CanvasRenderingContext2D) {
  const W = canvas.width; // HUD is screen-space, use canvas intrinsic width
  const self = getSelf();

  // ── Top bar ──
  const barH = 28;
  ctx.fillStyle = "rgba(200, 200, 200, 0.85)";

  // Respawn CD visual indicator for self
  const now = Date.now();
  const respawnCD = self ? (self as any).respawnCooldownUntil ?? 0 : 0;
  if (respawnCD > now) {
    // Make top bar slightly flashing or yellow during invincibility?
    // Let's make it a noticeable blue/cyan tint
    ctx.fillStyle = "rgba(100, 200, 255, 0.85)";
  }

  ctx.fillRect(0, 0, W, barH);
  ctx.strokeStyle = "rgba(160, 160, 160, 0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, barH);
  ctx.lineTo(W, barH);
  ctx.stroke();

  ctx.font = "bold 13px 'Segoe UI', Arial, sans-serif";

  // HP
  const hp = self ? (self as any).hp ?? 0 : 0;
  const hpColor = hp > 60 ? "#16a34a" : hp > 20 ? "#d97706" : "#dc2626";
  ctx.fillStyle = "#333";
  ctx.textAlign = "left";
  ctx.fillText("❤️", 12, 19);
  ctx.fillStyle = hpColor;
  ctx.fillText(`${hp}%`, 32, 19);

  // Ammo
  const ammo = self ? (self as any).ammo ?? 0 : 0;
  ctx.fillStyle = "#333";
  ctx.fillText("🔫", 88, 19);
  ctx.fillStyle = ammo > 5 ? "#333" : "#dc2626";
  ctx.fillText(`${ammo}`, 108, 19);

  // Hidden Indicator (B-2/B-5)
  if (self && (self as any).isHidden) {
    ctx.fillStyle = "#16a34a"; // Green
    ctx.font = "bold 12px 'Segoe UI', Arial, sans-serif";
    ctx.fillText("🕵️ HIDDEN", 138, 19);
  }

  // Phase 4: Item Indicators
  if (self && !state.isSpectator) {
    let itemX = 240;
    const iy = 19;
    ctx.font = "bold 11px 'Segoe UI', Arial, sans-serif";
    ctx.textAlign = "left";

    if ((self as any).hasBomb) {
      ctx.fillStyle = "#f97316";
      ctx.fillText("💣BOMB", itemX, iy);
      itemX += 58;
    }
    if ((self as any).ropeCount > 0) {
      ctx.fillStyle = "#a3752c";
      ctx.fillText(`🪢×${(self as any).ropeCount}`, itemX, iy);
      itemX += 42;
    }
    if ((self as any).bootsCharges > 0) {
      ctx.fillStyle = "#818cf8";
      ctx.fillText(`👢×${(self as any).bootsCharges}`, itemX, iy);
      itemX += 42;
    }
  }

  // Spectator Badge
  if (state.isSpectator) {
    ctx.fillStyle = "#a855f7"; // Purple
    ctx.font = "bold 12px 'Segoe UI', Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("📺 SPECTATING", 138, 19);
  }

  // Timer (center)
  const mins = Math.floor(state.timeLeftSec / 60).toString().padStart(2, "0");
  const secs = (state.timeLeftSec % 60).toString().padStart(2, "0");
  ctx.fillStyle = "#111";
  ctx.textAlign = "center";
  ctx.font = "bold 14px 'Segoe UI', Arial, sans-serif";
  ctx.fillText(`${mins}:${secs}`, W / 2, 19);

  // Team scores or individual score
  const isTeamMode = state.players.some((p) => (p as any).team != null);
  ctx.font = "bold 12px 'Segoe UI', Arial, sans-serif";
  if (isTeamMode) {
    // Use persistent scores from server
    const scores = state.teamScores;
    const redTotal = scores.red;
    const blueTotal = scores.blue;

    ctx.textAlign = "right";
    ctx.fillStyle = "#dc2626";
    ctx.fillText(`Red:${redTotal}`, W / 2 + 120, 19);
    ctx.fillStyle = "#2563eb";
    ctx.fillText(`Blue:${blueTotal}`, W / 2 + 200, 19);
  } else {
    // Individual score
    const myScore = self ? (self as any).score ?? 0 : 0;
    ctx.textAlign = "right";
    ctx.fillStyle = "#333";
    ctx.fillText(`Score:${myScore}`, W / 2 + 140, 19);
  }

  // Status (READY / LOCK) — hide for spectators
  if (!state.isSpectator) {
    const lockStep = self ? ((self as any).actionLockStep ?? 0) : 0;
    ctx.textAlign = "right";
    if (lockStep > 0) {
      ctx.fillStyle = "#f97316";
      ctx.fillText(`LOCK ${lockStep}`, W - 12, 19);
      cooldownEl.textContent = `LOCK ${lockStep}`;
      cooldownEl.style.color = "#f97316";
    } else {
      ctx.fillStyle = "#16a34a";
      ctx.fillText("READY", W - 12, 19);
      cooldownEl.textContent = "READY";
      cooldownEl.style.color = "#22c55e";
    }
  }

  // ── Minimap (bottom-right) ──
  drawMinimap(ctx);

  // ── Chat (bottom-left) ──
  drawChat(ctx);

  // Reset text alignment
  ctx.textAlign = "start";
};

/** Draw a minimap in the bottom-right corner. */
const drawMinimap = (ctx: CanvasRenderingContext2D) => {
  const mmW = 160;
  const mmH = 92;
  const mmX = canvas.width - mmW - 8;  // screen-space: canvas intrinsic width
  const mmY = canvas.height - mmH - 8; // screen-space: canvas intrinsic height
  const scaleX = mmW / mapSize.width;
  const scaleY = mmH / mapSize.height;

  // Background
  ctx.fillStyle = "rgba(10, 20, 40, 0.75)";
  ctx.fillRect(mmX, mmY, mmW, mmH);
  ctx.strokeStyle = "rgba(120, 150, 255, 0.4)";
  ctx.lineWidth = 1;
  ctx.strokeRect(mmX, mmY, mmW, mmH);

  // Walls
  if (state.mapData && state.mapData.walls) {
    for (const w of state.mapData.walls) {
      const type = w.type || "wall";
      if (type === "bush") ctx.fillStyle = "rgba(34, 197, 94, 0.6)";
      else if (type === "water") ctx.fillStyle = "rgba(59, 130, 246, 0.6)";
      else if (type === "house") ctx.fillStyle = "#8b4513";
      else if (type === "oneway") ctx.fillStyle = "rgba(255, 140, 0, 0.6)";
      else ctx.fillStyle = "rgba(100, 120, 140, 0.6)";

      ctx.fillRect(
        mmX + w.x * scaleX,
        mmY + w.y * scaleY,
        Math.max(1, w.width * scaleX),
        Math.max(1, w.height * scaleY)
      );
    }
  }

  // Bullets
  const bullets = (state as any).bullets ?? [];
  ctx.fillStyle = "#fde047";
  for (const b of bullets) {
    const bx = b.x ?? (b.position?.x ?? 0);
    const by = b.y ?? (b.position?.y ?? 0);
    ctx.fillRect(mmX + bx * scaleX - 1, mmY + by * scaleY - 1, 2, 2);
  }

  // Items on Minimap (color by type)
  const itemColors: Record<string, string> = {
    medic: "#22c55e", ammo: "#facc15", heart: "#ec4899",
    bomb: "#6b7280", rope: "#a3752c", boots: "#818cf8",
  };
  for (const item of state.items) {
    ctx.fillStyle = itemColors[item.type] ?? "#fff";
    ctx.fillRect(mmX + item.x * scaleX - 1, mmY + item.y * scaleY - 1, 3, 3);
  }

  // Flags on Minimap
  if (state.flags) {
    for (const f of state.flags) {
      ctx.fillStyle = f.team === "red" ? "#ef4444" : "#3b82f6";
      ctx.beginPath();
      ctx.arc(mmX + f.x * scaleX, mmY + f.y * scaleY, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Players
  const self = getSelf();
  for (const p of state.players) {
    const px = (p as any).position?.x ?? (p as any).x ?? 0;
    const py = (p as any).position?.y ?? (p as any).y ?? 0;
    const isSelf = p.id === state.selfId;
    const team = (p as any).team;

    // Color by team
    if (team === "red") ctx.fillStyle = isSelf ? "#ff6b6b" : "#dc2626";
    else if (team === "blue") ctx.fillStyle = isSelf ? "#60a5fa" : "#2563eb";
    else ctx.fillStyle = isSelf ? "#4cc9f0" : "#9ca3af";

    const dotSize = isSelf ? 4 : 2;
    ctx.fillRect(
      mmX + px * scaleX - dotSize / 2,
      mmY + py * scaleY - dotSize / 2,
      dotSize,
      dotSize
    );
  }

  // Camera viewport indicator (canvas intrinsic size determines visible area)
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 1;
  const vpX = mmX + state.camera.x * scaleX;
  const vpY = mmY + state.camera.y * scaleY;
  const vpW = canvas.width * scaleX / state.camera.zoom;   // viewport = canvas pixels / zoom
  const vpH = canvas.height * scaleY / state.camera.zoom;
  ctx.strokeRect(vpX, vpY, vpW, vpH);
};

const drawChat = (ctx: CanvasRenderingContext2D) => {
  const messages = state.chat.slice(-8); // Show last 8 messages
  const lineHeight = 16;
  const bottomY = canvas.height - 40; // Leave space for input (screen-space)
  const startX = 10;

  ctx.font = "12px 'Segoe UI', Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";

  messages.forEach((msg, i) => {
    const y = bottomY - ((messages.length - 1 - i) * lineHeight);
    // Background for readability
    const text = `${msg.from}: ${msg.message}`;
    const width = ctx.measureText(text).width;

    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(startX - 2, y - lineHeight + 2, width + 4, lineHeight);

    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillText(text, startX, y);
  });

  ctx.textBaseline = "alphabetic";
};

const setupLogin = () => {
  const nameInput = document.querySelector("#name-input") as HTMLInputElement;
  const randomBtn = document.querySelector("#random-name") as HTMLButtonElement;
  const loginBtn = document.querySelector("#login-btn") as HTMLButtonElement;

  // UX: Restore last used name
  const savedName = localStorage.getItem("tt_name");
  if (savedName) nameInput.value = savedName;

  randomBtn.addEventListener("click", () => {
    const random = Math.floor(1000 + Math.random() * 9000);
    nameInput.value = `Cmdr-${random}`;
  });

  loginBtn.addEventListener("click", () => {
    const name = nameInput.value.trim() || `Cmdr-${Math.floor(1000 + Math.random() * 9000)}`;
    state.name = name;
    localStorage.setItem("tt_name", name); // UX

    // B-3 RECONNECTION
    const savedId = localStorage.getItem("tt_id");

    connect();
    const waitForOpen = () => {
      if (!ws) {
        return;
      }
      if (ws.readyState === WebSocket.OPEN) {
        // Send previous ID if we have one to reclaim session
        sendMessage({ type: "login", payload: { name, id: savedId ?? undefined } });
        sendMessage({ type: "requestLobby" });
        // We stay on login screen briefly until 'lobby' or 'room' message arrives
        // (Actually setScreen("lobby") here is fine but might flicker if re-joining room)
        return;
      }
      requestAnimationFrame(waitForOpen);
    };
    waitForOpen();
  });
};

const setupLobby = () => {
  const createRoomBtn = document.querySelector("#create-room") as HTMLButtonElement;
  const roomIdInput = document.querySelector("#room-id") as HTMLInputElement;
  const roomNameInput = document.querySelector("#room-name") as HTMLInputElement;
  const maxPlayersInput = document.querySelector("#max-players") as HTMLInputElement;
  const timeLimitInput = document.querySelector("#time-limit") as HTMLInputElement;
  const gameModeSelect = document.querySelector("#game-mode") as HTMLSelectElement;
  const passwordInput = document.querySelector("#room-password") as HTMLInputElement;

  createRoomBtn.addEventListener("click", (e) => {
    console.log("[DEBUG] Create Room Button Clicked", e);
    const id = roomIdInput.value.trim();
    const name = roomNameInput.value.trim();
    const maxP = parseInt(maxPlayersInput.value) || 4;
    const time = parseInt(timeLimitInput.value) || 240;
    const gm = gameModeSelect.value || "ctf";
    const pw = passwordInput.value.trim();
    const mapSelect = document.querySelector("#map-select") as HTMLSelectElement;
    const mapId = mapSelect?.value || "alpha";

    let finalId = id;
    if (!finalId) {
      finalId = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    }

    sendMessage({
      type: "createRoom",
      payload: {
        roomId: finalId,
        name: name || `Room ${finalId}`, // Auto-fill name using ID
        mapId,
        maxPlayers: maxP,
        timeLimitSec: time,
        gameMode: gm as "deathmatch" | "ctf",
        password: pw || undefined,
      },
    });
    // Do not switch screen optimistically. Wait for join.
    // setupRoom(); 
    // setScreen("room");
  });

  const lobbyChatInput = document.querySelector("#lobby-chat-input") as HTMLInputElement;
  lobbyChatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const message = lobbyChatInput.value.trim();
      if (message) {
        sendMessage({ type: "chat", payload: { message } });
      }
      lobbyChatInput.value = "";
    }
  });

  document.querySelector("#lobby-help")?.addEventListener("click", () => {
    alert("Help:\n- WASD: Camera movement  Q/E: Rotate  Space: Reset view\n- Left-click on map: Move tank\n- Drag from tank: Aim & shoot  T: Chat\n- Objective: Kill enemies to score points for your team!");
  });

  document.querySelector("#lobby-setting")?.addEventListener("click", () => {
    alert("Settings: \n(Volume and Quality settings coming soon)");
  });

  document.querySelector("#lobby-exit")?.addEventListener("click", () => {
    if (confirm("Return to Title Screen?")) {
      if (ws) ws.close();
      setScreen("login");
    }
  });
};

// Controller for room event listeners
let roomAbortController: AbortController | null = null;

const setupRoom = () => {
  // Clear previous listeners if any
  if (roomAbortController) {
    roomAbortController.abort();
  }
  roomAbortController = new AbortController();
  const { signal } = roomAbortController;
  // Hide DOM HUD elements (except chat-input) to use Canvas HUD
  const roomHeader = document.querySelector(".room-header") as HTMLElement;
  if (roomHeader) roomHeader.style.display = "none";

  const scoreList = document.querySelector("#score-list") as HTMLElement;
  if (scoreList) scoreList.style.display = "none";

  // Hide Chat Log DOM (we draw it on canvas)
  const domChatLog = document.querySelector("#chat-log") as HTMLElement;
  if (domChatLog) domChatLog.style.display = "none";

  // Hide H3 headers in HUD
  const h3s = document.querySelectorAll(".hud h3");
  h3s.forEach((h3) => (h3 as HTMLElement).style.display = "none");

  // Leave Room Logic
  const handleLeave = () => {
    sendMessage({ type: "leaveRoom" });
    sendMessage({ type: "requestLobby" });
    state.roomId = "";
    state.players = [];
    state.bullets = [];
    state.isSpectator = false; // Reset spectator flag
    resultOverlay.classList.add("hidden"); // Hide result overlay
    if (roomAbortController) {
      roomAbortController.abort();
      roomAbortController = null;
    }
    setScreen("lobby");
  };

  const leaveBtn = document.querySelector("#leave-room") as HTMLButtonElement;
  leaveBtn.addEventListener("click", handleLeave, { signal });
  gameLeaveBtn.addEventListener("click", handleLeave, { signal });
  closeResultBtn.addEventListener("click", handleLeave, { signal });

  copyResultBtn.addEventListener("click", () => {
    // Copy result to clipboard
    const text = Array.from(resultBody.querySelectorAll("tr")).map(tr => {
      const cols = Array.from(tr.querySelectorAll("td")).map(td => td.textContent).join("\t");
      return cols;
    }).join("\n");
    const header = `Winner: ${resultWinner.textContent}\nName\tScore\tK/D\tAcc%\n`;
    navigator.clipboard.writeText(header + text).then(() => {
      const original = copyResultBtn.textContent;
      copyResultBtn.textContent = "Copied!";
      setTimeout(() => copyResultBtn.textContent = original, 2000);
    });
  }, { signal });

  // Chat button in top bar (virtual click on canvas button check in mousedown?)
  // For now we just use T key or need a DOM button?
  // User HUD spec says "Chat/Exit buttons exist".
  // We can't click canvas buttons easily without raycasting UI.
  // For MVP, T key and Exit button (leaveBtn) are enough?
  // Let's rely on T key for chat.

  // Prevent context menu (right click) on canvas
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  }, { signal });

  canvas.addEventListener("mousedown", (event) => {
    if (state.phase !== "room") {
      return;
    }
    // Spectators: only allow camera interactions, not game actions
    if (state.isSpectator) return;
    // A-11: all actions blocked while chat is open
    if (document.activeElement === chatInput) return;
    const self = getSelf();
    if (!self) {
      return;
    }

    // Check UI clicks on Canvas?
    // Not implemented yet. Focus on gameplay.

    // Check click on minimap?
    // Convert CSS pixels to canvas intrinsic pixels for accurate hit detection
    const rect = canvas.getBoundingClientRect();
    const mx = (event.clientX - rect.left) * canvas.width / rect.width;
    const my = (event.clientY - rect.top) * canvas.height / rect.height;

    // Minimap click -> move command?
    const mmW = 160, mmH = 92;
    const mmX = canvas.width - mmW - 8;   // canvas-pixel-space
    const mmY = canvas.height - mmH - 8;

    if (mx >= mmX && mx <= mmX + mmW && my >= mmY && my <= mmY + mmH) {
      // Minimap click
      const scaleX = mapSize.width / mmW;
      const scaleY = mapSize.height / mmH;
      const tx = (mx - mmX) * scaleX;
      const ty = (my - mmY) * scaleY;
      sendMessage({ type: "move", payload: { target: { x: tx, y: ty } } });
      return;
    }

    if (event.button === 0) { // Left click
      // If AIMing, shoot
      if (state.aiming) {
        // Shoot happens on mouseup usually, or mousedown?
        // Drag logic: mousedown -> start aim, mouseup -> fire.
        // Wait, aim logic is: click (mark target) or drag?
        // Previous logic:
        // Click on self -> start aim, mouseup -> fire.
        // Screen click -> move.
        const point = getCanvasPoint(event);
        if (isMouseOnTank(point, (self as any).position)) {
          state.aiming = true;
          state.aimPoint = point;
          return;
        }

        // Move
        sendMessage({ type: "move", payload: { target: point } });
      } else {
        const point = getCanvasPoint(event);
        if (isMouseOnTank(point, (self as any).position)) {
          state.aiming = true;
          state.aimPoint = point;
          return;
        }
        // Move
        sendMessage({ type: "move", payload: { target: point } });
      }
    }
  }, { signal });

  window.addEventListener("mousemove", (event) => {
    if (!state.aiming) return;
    // Map external mouse to canvas coordinates
    state.aimPoint = getCanvasPoint(event);
  }, { signal });

  window.addEventListener("mouseup", (event) => {
    if (!state.aiming) return;
    if (state.phase !== "room") return;

    const self = getSelf();
    if (!self) {
      state.aiming = false;
      return;
    }

    const point = getCanvasPoint(event);
    const selfPos = (self as any).position;
    // Check cancel (close to self)
    if (isMouseOnTank(point, selfPos)) {
      state.aiming = false;
      state.aimPoint = null;
      return;
    }

    // Shoot
    // Shoot (Slingshot: Opposite to drag vector)
    const dragX = point.x - selfPos.x;
    const dragY = point.y - selfPos.y;
    // Shoot direction
    const shootX = -dragX;
    const shootY = -dragY;
    const len = Math.hypot(shootX, shootY);

    // Only shoot if pulled far enough (CANCEL check is done above but good to double check or just trigger)
    // The cancel check above `isMouseOnTank(point, selfPos)` handles the "return to self" logic.
    // If we are here, we are outside tank radius (mostly).

    if (len > 0) {
      // Normal shoot
      sendMessage({ type: "shoot", payload: { direction: { x: shootX / len, y: shootY / len } } });
      state.aiming = false;
      state.aimPoint = null;
    }
  }, { signal });

  window.addEventListener("keydown", (event) => {
    keysDown.add(event.key.toLowerCase());
    if (state.phase !== "room") return;
    const key = event.key.toLowerCase();

    // Chat open (spectators can also chat)
    if (key === "t" && document.activeElement !== chatInput) {
      chatInput.classList.add("active");
      chatInput.focus();
      event.preventDefault();
      return;
    }

    // Z key — cancel last move reservation (not for spectators)
    if (key === "z" && document.activeElement !== chatInput && !state.isSpectator) {
      sendMessage({ type: "moveCancelOne" });
      return;
    }

    // R/A/H/F keys — use item / pass actions
    const aimKeys = ["r", "a", "h", "f"];
    if (aimKeys.includes(key) && document.activeElement !== chatInput && !state.isSpectator) {
      event.preventDefault();
      const self = getSelf();
      if (self) {
        let dirX = 0, dirY = 0;
        if (state.aiming && state.aimPoint) {
          // If aiming: slingshot direction (opposite of drag)
          const selfPos = (self as any).position;
          dirX = -(state.aimPoint.x - selfPos.x);
          dirY = -(state.aimPoint.y - selfPos.y);
        } else {
          // Not aiming: use turret direction
          const ta = (self as any).turretAngle || 0;
          dirX = Math.cos(ta);
          dirY = Math.sin(ta);
        }
        const len = Math.hypot(dirX, dirY);
        let itemName = "rope";
        if (key === "a") itemName = "ammo";
        if (key === "h") itemName = "heal";
        if (key === "f") itemName = "flag";

        if (len > 0) {
          sendMessage({ type: "useItem", payload: { item: itemName, direction: { x: dirX / len, y: dirY / len } } });
        }
      }
      return;
    }

    // Space — snap camera to own tank (or map center if not found)
    if (key === " " && document.activeElement !== chatInput) {
      const me = state.players.find(p => p.id === state.selfId);
      if (me) {
        state.camera.x = me.position.x - mapSize.width / 2;
        state.camera.y = me.position.y - mapSize.height / 2;
      } else {
        state.camera.x = 0;
        state.camera.y = 0;
      }
      state.camera.zoom = 1;
      state.camera.rotation = 0;
      event.preventDefault();
      return;
    }
  }, { signal });

  window.addEventListener("keyup", (event) => {
    keysDown.delete(event.key.toLowerCase());
  }, { signal });

  // Mouse wheel zoom
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (event.deltaY < 0) {
      state.camera.zoom = Math.min(ZOOM_MAX, state.camera.zoom + ZOOM_STEP);
    } else {
      state.camera.zoom = Math.max(ZOOM_MIN, state.camera.zoom - ZOOM_STEP);
    }
  }, { passive: false, signal });

  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      const message = chatInput.value.trim();
      if (message) {
        sendMessage({ type: "chat", payload: { message } });
      }
      chatInput.value = "";
      chatInput.classList.remove("active");
    }
    if (event.key === "Escape") {
      chatInput.value = "";
      chatInput.classList.remove("active");
    }
  }, { signal });
};

setupLogin();
setupLobby();
// setupRoom(); // Removed: call on join/create instead
requestAnimationFrame(draw);