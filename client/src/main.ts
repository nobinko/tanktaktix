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
  bullets: [] as any[]
};

let ws: WebSocket | null = null;

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
  const x = ((event.clientX - rect.left) / rect.width) * mapSize.width;
  const y = ((event.clientY - rect.top) / rect.height) * mapSize.height;
  return { x, y };
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

  state.players.forEach((player) => {
    const { x, y } = (player as any).position ?? { x: (player as any).x, y: (player as any).y };
    ctx.fillStyle = player.id === state.selfId ? "#4cc9f0" : "#f72585";
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
  });

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

  const self = getSelf();
  if (self) {
    const remaining = Math.max(0, Math.ceil((((self as any).nextActionAt ?? Date.now()) - Date.now()) / 1000));
    cooldownEl.textContent = remaining > 0 ? `Cooldown: ${remaining}s` : "Ready";
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
      const dx = point.x - (self as any).position.x;
      const dy = point.y - (self as any).position.y;
      const length = Math.hypot(dx, dy);
      if (length > 0) {
        sendMessage({ type: "shoot", payload: { direction: { x: dx / length, y: dy / length } } });
      }
    } else {
      sendMessage({ type: "move", payload: { target: point } });
    }
    state.aiming = false;
    state.aimPoint = null;
  });

  window.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "t" && state.phase === "room") {
      chatInput.classList.add("active");
      chatInput.focus();
    }
  });

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