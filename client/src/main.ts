import "./style.css";
import type {
  ChatMessage,
  ClientToServerMessage,
  PlayerSummary,
  RoomSummary,
  ServerToClientMessage,
  Vector2
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
      <h2>Lobby</h2>
      <div class="grid two">
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
            <input id="room-password" placeholder="Password (optional)" />
            <button id="create-room">Create</button>
          </div>
        </div>
      </div>
    </div>
  </section>
  <section id="room-screen" class="screen">
    <div class="panel relative-panel">
      <!-- Result Overlay -->
      <div id="result-overlay" class="result-overlay hidden">
        <h2>Game Result</h2>
        <h3 id="result-winner">Winner: ---</h3>
        <div class="table-container">
          <table id="result-table">
            <thead><tr><th>Name</th><th>Score</th><th>K / D</th><th>Acc %</th></tr></thead>
            <tbody id="result-body"></tbody>
          </table>
        </div>
        <div class="actions">
           <button id="copy-result">Copy Result</button>
           <button id="close-result">Leave Room</button>
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
      <canvas id="map" width="900" height="520"></canvas>
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
  leaderboard: null as PlayerSummary[] | null,
  aiming: false,
  aimPoint: null as Vector2 | null,
  bullets: [] as any[],
  explosions: [] as any[], // Local VFX
  mapData: null as any,
  camera: { x: 0, y: 0, zoom: 1, rotation: 0 },
};

let ws: WebSocket | null = null;

const keysDown = new Set<string>();
const CAMERA_SPEED = 8;
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3.0;
const ROTATION_STEP = Math.PI / 36; // 5 degrees

const mapSize = { width: 900, height: 520 };

const setScreen = (phase: "login" | "lobby" | "room") => {
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
      break;
    case "lobby":
      state.rooms = message.payload.rooms;
      renderRooms();
      break;
    case "room": {
      const payloadAny = message.payload as any;
      state.roomId = payloadAny.roomId;
      state.players = payloadAny.players;
      state.timeLeftSec = payloadAny.timeLeftSec;
      state.bullets = payloadAny.bullets ?? payloadAny.projectiles ?? [];

      // Update Map Data if provided (or if missing and in room)
      if (payloadAny.room?.mapData) {
        state.mapData = payloadAny.room.mapData;
      }

      state.leaderboard = null;
      renderRoom();
      break;
    }
    case "chat":
      state.chat.unshift(message.payload);
      // Remove old messages
      if (state.chat.length > 50) state.chat.pop();
      // renderChat is Canvas-based now, called in loop
      break;

    case "gameEnd":
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
    case "leaderboard":
      state.leaderboard = message.payload.players;
      renderLeaderboard();
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
    li.innerHTML = `
      <div class="room-row">
        <div>
          <strong>${room.name ?? (room as any).roomName ?? room.id}</strong>
          <div class="meta">${(room as any).players?.length ?? (room as any).playerCount ?? 0}/${room.maxPlayers} players • ${room.timeLimitSec}s</div>
        </div>
        <button class="join">Join</button>
      </div>
    `;
    const joinBtn = li.querySelector(".join") as HTMLButtonElement;
    joinBtn.addEventListener("click", () => {
      const pw = room.passwordProtected ? prompt("Password?") ?? "" : "";
      sendMessage({ type: "joinRoom", payload: { roomId: room.id, password: pw } });
      setScreen("room");
    });
    roomList.appendChild(li);
  });
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

const renderLeaderboard = () => {
  // optional
};

const getSelf = () => state.players.find((p) => p.id === state.selfId);

const getCanvasPoint = (event: MouseEvent): Vector2 => {
  const rect = canvas.getBoundingClientRect();
  // Screen coords relative to canvas center
  let sx = ((event.clientX - rect.left) / rect.width) * mapSize.width - mapSize.width / 2;
  let sy = ((event.clientY - rect.top) / rect.height) * mapSize.height - mapSize.height / 2;
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

const draw = () => {
  requestAnimationFrame(draw);
  if (state.phase !== "room") {
    return;
  }
  ctx.clearRect(0, 0, mapSize.width, mapSize.height);
  ctx.fillStyle = "#0b132b";
  ctx.fillRect(0, 0, mapSize.width, mapSize.height);

  // Camera movement (arrow keys, rotated to match view)
  const camCos = Math.cos(state.camera.rotation);
  const camSin = Math.sin(state.camera.rotation);
  const spd = CAMERA_SPEED / state.camera.zoom;
  let camDx = 0, camDy = 0;
  if (keysDown.has("arrowleft")) { camDx -= spd; }
  if (keysDown.has("arrowright")) { camDx += spd; }
  if (keysDown.has("arrowup")) { camDy -= spd; }
  if (keysDown.has("arrowdown")) { camDy += spd; }
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
  if (keysDown.has("q") && document.activeElement !== chatInput) {
    state.camera.rotation -= ROTATION_STEP * 0.3;
  }
  if (keysDown.has("e") && document.activeElement !== chatInput) {
    state.camera.rotation += ROTATION_STEP * 0.3;
  }

  // Apply camera transform: translate center, rotate, zoom, offset
  ctx.save();
  ctx.translate(mapSize.width / 2, mapSize.height / 2);
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
    ctx.fillStyle = "#4a5568";
    for (const w of state.mapData.walls) {
      ctx.fillRect(w.x, w.y, w.width, w.height);

      // Bevel/Border for visibility
      ctx.strokeStyle = "#718096";
      ctx.lineWidth = 2;
      ctx.strokeRect(w.x, w.y, w.width, w.height);
    }
  }

  // bullets（サーバ権威の projectile）
  const bullets = (state as any).bullets ?? [];
  if (bullets.length > 0) {
    ctx.fillStyle = "#fde047";
    for (const b of bullets) {
      const pos = b.position ?? { x: b.x, y: b.y };
      const r = typeof b.radius === "number" ? b.radius : 3;
      if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") continue;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Explosions VFX
  state.explosions = state.explosions.filter(e => Date.now() - (e.startedAt || e.at) < 500); // 0.5s duration
  for (const e of state.explosions) {
    const start = e.startedAt || e.at || Date.now();
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

  state.players.forEach((player) => {
    const { x, y } = (player as any).position ?? { x: (player as any).x, y: (player as any).y };
    // Team Colors
    let color = "#f72585"; // default enemy
    if (player.id === state.selfId) {
      color = "#4cc9f0"; // self
    } else {
      const pTeam = (player as any).team;
      if (pTeam === "red") color = "#ef4444";
      if (pTeam === "blue") color = "#3b82f6";
    }

    const hullAngle = (player as any).hullAngle ?? 0;
    const turretAngle = (player as any).turretAngle ?? 0;

    // === Hull (TankMatch style: simple box) ===
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(hullAngle);

    // Body outline (dark border)
    ctx.fillStyle = "#1a1a2e";
    ctx.fillRect(-13, -10, 26, 20);

    // Body fill (team color)
    ctx.fillStyle = color;
    ctx.fillRect(-11, -8, 22, 16);

    // Front direction indicator (small triangle)
    ctx.fillStyle = "#fff";
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.moveTo(11, -3);
    ctx.lineTo(15, 0);
    ctx.lineTo(11, 3);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1.0;

    ctx.restore();

    // === Turret (TankMatch style: white circle + thin barrel) ===
    ctx.save();
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
      const display = Math.min(5, lockStep);
      ctx.font = "bold 16px monospace";
      ctx.fillStyle = "#f97316";
      ctx.textAlign = "center";
      ctx.fillText(`${display}`, 0, -34);
      ctx.textAlign = "start";
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

  // End camera transform
  ctx.restore();

  // ─── HUD (screen-space, drawn after camera restore) ───
  drawHUD(ctx);
};

/** Draw the in-game HUD directly on the canvas (screen-space). */
const drawHUD = (ctx: CanvasRenderingContext2D) => {
  const W = mapSize.width;
  const self = getSelf();

  // ── Top bar ──
  const barH = 28;
  ctx.fillStyle = "rgba(200, 200, 200, 0.85)";
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
    const redTotal = state.players
      .filter((p) => (p as any).team === "red")
      .reduce((s, p) => s + (p.score ?? 0), 0);
    const blueTotal = state.players
      .filter((p) => (p as any).team === "blue")
      .reduce((s, p) => s + (p.score ?? 0), 0);
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

  // Status (READY / LOCK)
  const lockStep = self ? ((self as any).actionLockStep ?? 0) : 0;
  ctx.textAlign = "right";
  if (lockStep > 0) {
    ctx.fillStyle = "#f97316";
    ctx.fillText(`LOCK ${Math.min(5, lockStep)}`, W - 12, 19);
    // Also update the DOM element for backward compat
    cooldownEl.textContent = `LOCK ${Math.min(5, lockStep)}`;
    cooldownEl.style.color = "#f97316";
  } else {
    ctx.fillStyle = "#16a34a";
    ctx.fillText("READY", W - 12, 19);
    cooldownEl.textContent = "READY";
    cooldownEl.style.color = "#22c55e";
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
  const mmX = mapSize.width - mmW - 8;
  const mmY = mapSize.height - mmH - 8;
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
    ctx.fillStyle = "rgba(100, 120, 140, 0.6)";
    for (const w of state.mapData.walls) {
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

  // Camera viewport indicator
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 1;
  const vpX = mmX + state.camera.x * scaleX;
  const vpY = mmY + state.camera.y * scaleY;
  const vpW = mapSize.width * scaleX / state.camera.zoom;
  const vpH = mapSize.height * scaleY / state.camera.zoom;
  ctx.strokeRect(vpX, vpY, vpW, vpH);
};

const drawChat = (ctx: CanvasRenderingContext2D) => {
  const messages = state.chat.slice(-8); // Show last 8 messages
  const lineHeight = 16;
  const bottomY = mapSize.height - 40; // Leave space for input
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

  randomBtn.addEventListener("click", () => {
    const random = Math.floor(1000 + Math.random() * 9000);
    nameInput.value = `Cmdr-${random}`;
  });

  loginBtn.addEventListener("click", () => {
    const name = nameInput.value.trim() || `Cmdr-${Math.floor(1000 + Math.random() * 9000)}`;
    state.name = name;
    connect();
    const waitForOpen = () => {
      if (!ws) {
        return;
      }
      if (ws.readyState === WebSocket.OPEN) {
        sendMessage({ type: "login", payload: { name } });
        sendMessage({ type: "requestLobby" });
        setScreen("lobby");
        return;
      }
      requestAnimationFrame(waitForOpen);
    };
    waitForOpen();
  });
};

const setupLobby = () => {
  const createRoomBtn = document.querySelector("#create-room") as HTMLButtonElement;
  createRoomBtn.addEventListener("click", () => {
    const id = roomIdInput.value.trim();
    const name = roomNameInput.value.trim();
    const maxP = parseInt(maxPlayersInput.value) || 4;
    const time = parseInt(timeLimitInput.value) || 240;
    const pw = passwordInput.value.trim();

    if (!id) {
      alert("Room ID is required");
      return;
    }

    sendMessage({
      type: "createRoom",
      payload: {
        roomId: id,
        name: name || `Room ${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`, // Auto-fill
        mapId: "alpha", // Fix to alpha for now
        maxPlayers: maxP,
        timeLimitSec: time,
        password: pw || undefined,
      },
    });
    setScreen("room");
  });
};

const setupRoom = () => {
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
    resultOverlay.classList.add("hidden"); // Hide result overlay
    setScreen("lobby");
  };

  const leaveBtn = document.querySelector("#leave-room") as HTMLButtonElement;
  leaveBtn.addEventListener("click", handleLeave);
  gameLeaveBtn.addEventListener("click", handleLeave);
  closeResultBtn.addEventListener("click", handleLeave);

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
  });

  // Chat button in top bar (virtual click on canvas button check in mousedown?)
  // For now we just use T key or need a DOM button?
  // User HUD spec says "Chat/Exit buttons exist".
  // We can't click canvas buttons easily without raycasting UI.
  // For MVP, T key and Exit button (leaveBtn) are enough?
  // Let's rely on T key for chat.

  canvas.addEventListener("mousedown", (event) => {
    if (state.phase !== "room") {
      return;
    }
    const self = getSelf();
    if (!self) {
      return;
    }

    // Check UI clicks on Canvas?
    // Not implemented yet. Focus on gameplay.

    // Check click on minimap?
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;

    // Minimap click -> move command?
    const mmW = 160, mmH = 92;
    const mmX = mapSize.width - mmW - 8;
    const mmY = mapSize.height - mmH - 8;

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
  });

  window.addEventListener("mousemove", (event) => {
    if (!state.aiming) return;
    // Map external mouse to canvas coordinates
    state.aimPoint = getCanvasPoint(event);
  });

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
      sendMessage({ type: "shoot", payload: { direction: { x: shootX / len, y: shootY / len } } });
    }
    state.aiming = false;
    state.aimPoint = null;
  });

  window.addEventListener("keydown", (event) => {
    keysDown.add(event.key.toLowerCase());
    if (state.phase !== "room") return;
    const key = event.key.toLowerCase();

    // Chat open
    if (key === "t" && document.activeElement !== chatInput) {
      chatInput.classList.add("active");
      chatInput.focus();
      event.preventDefault();
      return;
    }

    // Z key — cancel last move reservation
    if (key === "z" && document.activeElement !== chatInput) {
      sendMessage({ type: "moveCancelOne" });
      return;
    }

    // Space — reset camera
    if (key === " " && document.activeElement !== chatInput) {
      state.camera.x = 0;
      state.camera.y = 0;
      state.camera.zoom = 1;
      state.camera.rotation = 0;
      event.preventDefault();
      return;
    }
  });

  window.addEventListener("keyup", (event) => {
    keysDown.delete(event.key.toLowerCase());
  });

  // Mouse wheel zoom
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    if (event.deltaY < 0) {
      state.camera.zoom = Math.min(ZOOM_MAX, state.camera.zoom + ZOOM_STEP);
    } else {
      state.camera.zoom = Math.max(ZOOM_MIN, state.camera.zoom - ZOOM_STEP);
    }
  }, { passive: false });

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
  });
};

setupLogin();
setupLobby();
setupRoom();
requestAnimationFrame(draw);