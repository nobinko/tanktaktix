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
    <div class="panel">
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
      state.chat = state.chat.slice(0, 6);
      renderChat();
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
  chatLog.innerHTML = "";
  state.chat.forEach((msg) => {
    const div = document.createElement("div");
    div.className = "chat-line";
    div.textContent = `${(msg as any).from ?? "?"}: ${(msg as any).message ?? ""}`;
    chatLog.appendChild(div);
  });
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

  // Camera movement (arrow keys, no auto-follow)
  if (keysDown.has("arrowleft")) state.camera.x -= CAMERA_SPEED / state.camera.zoom;
  if (keysDown.has("arrowright")) state.camera.x += CAMERA_SPEED / state.camera.zoom;
  if (keysDown.has("arrowup")) state.camera.y -= CAMERA_SPEED / state.camera.zoom;
  if (keysDown.has("arrowdown")) state.camera.y += CAMERA_SPEED / state.camera.zoom;

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

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0b0f1f";
    ctx.fillRect(x - 8, y - 4, 16, 8);
    ctx.fillStyle = "#e8f1ff";
    ctx.fillText(player.name, x + 24, y + 4);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(x - 20, y - 28, ((player as any).hp / 100) * 40, 4);
    ctx.fillStyle = "#f97316";
    ctx.fillRect(x - 20, y - 22, ((player as any).ammo / 20) * 40, 4);

    // Action lock countdown (5→0) above tank — self only
    const lockStep = (player as any).actionLockStep ?? 0;
    if (lockStep > 0 && player.id === state.selfId) {
      const display = Math.min(5, lockStep); // clamp to 5 max display
      ctx.font = "bold 16px monospace";
      ctx.fillStyle = "#f97316";
      ctx.textAlign = "center";
      ctx.fillText(`${display}`, x, y - 34);
      ctx.textAlign = "start"; // reset
    }
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
      ctx.strokeStyle = "rgba(76, 201, 240, 0.8)";
      ctx.beginPath();
      ctx.moveTo((self as any).position.x, (self as any).position.y);
      ctx.lineTo(state.aimPoint.x, state.aimPoint.y);
      ctx.stroke();
    }
  }

  // End camera transform
  ctx.restore();

  const self2 = getSelf();
  if (self2) {
    const lockStep = (self2 as any).actionLockStep ?? 0;
    if (lockStep > 0) {
      cooldownEl.textContent = `LOCK ${Math.min(5, lockStep)}`;
      cooldownEl.style.color = "#f97316";
    } else {
      cooldownEl.textContent = "READY";
      cooldownEl.style.color = "#22c55e";
    }
  }
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
  createRoomBtn.addEventListener("click", () => {
    const roomId = roomIdInput.value.trim();
    const name = roomNameInput.value.trim();
    const maxPlayers = Number(maxPlayersInput.value) || 4;
    const timeLimitSec = Number(timeLimitInput.value) || 240;
    const password = passwordInput.value.trim();

    sendMessage({
      type: "createRoom",
      payload: {
        roomId,
        name,
        maxPlayers,
        timeLimitSec,
        password,
        mapId: "alpha",
      },
    });
    setScreen("room");
  });
};

const setupRoom = () => {
  const leaveBtn = document.querySelector("#leave-room") as HTMLButtonElement;
  leaveBtn.addEventListener("click", () => {
    sendMessage({ type: "leaveRoom" });
    sendMessage({ type: "requestLobby" });
    state.roomId = "";
    state.players = [];
    state.bullets = [];
    setScreen("lobby");
  });

  canvas.addEventListener("mousedown", (event) => {
    if (state.phase !== "room") {
      return;
    }
    const self = getSelf();
    if (!self) {
      return;
    }
    const point = getCanvasPoint(event);
    if (isMouseOnTank(point, (self as any).position)) {
      state.aiming = true;
      state.aimPoint = point;
      return;
    }
  });

  canvas.addEventListener("mousemove", (event) => {
    if (!state.aiming) {
      return;
    }
    state.aimPoint = getCanvasPoint(event);
  });

  canvas.addEventListener("mouseup", (event) => {
    const self = getSelf();
    if (!self) {
      state.aiming = false;
      state.aimPoint = null;
      return;
    }
    const point = getCanvasPoint(event);
    if (state.aiming) {
      // Block AIM/Shoot if Cooldown
      const nextActionAt = (self as any).nextActionAt ?? 0;
      if (nextActionAt > Date.now()) {
        state.aiming = false;
        state.aimPoint = null;
        return;
      }
      const dx = point.x - (self as any).position.x;
      const dy = point.y - (self as any).position.y;
      const length = Math.hypot(dx, dy);
      if (length > 0) {
        sendMessage({ type: "shoot", payload: { direction: { x: dx / length, y: dy / length } } });
      }
    } else {
      // Move click always sent — server decides if it queues or ignores
      sendMessage({ type: "move", payload: { target: point } });
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