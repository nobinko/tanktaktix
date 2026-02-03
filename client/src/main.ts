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
            <input id="map-id" placeholder="Map ID" value="alpha" />
            <input id="max-players" type="number" min="2" max="8" value="4" />
            <input id="time-limit" type="number" min="60" max="900" value="240" />
            <input id="room-password" placeholder="Password (optional)" />
            <button id="create-room">Create</button>
          </div>
        </div>
      </div>
    </div>
  </section>
  <section id="room-screen" class="screen">
    <div class="panel">
      <div class="hud">
        <div>
          <h3 id="room-title">Room</h3>
          <div id="room-meta" class="notice"></div>
        </div>
        <div>
          <div id="cooldown" class="badge"></div>
        </div>
        <div>
          <button id="leave-room" class="secondary">Leave Room</button>
        </div>
      </div>
      <div class="canvas-wrap" style="height: 520px; margin-top: 16px;">
        <canvas id="game-canvas" width="900" height="520"></canvas>
        <div id="chat-log" class="chat-log"></div>
        <input id="chat-input" class="chat-input" placeholder="Type message..." />
      </div>
      <div id="scoreboard" class="notice" style="margin-top: 12px;"></div>
    </div>
  </section>
`;

const loginScreen = document.querySelector("#login-screen") as HTMLElement;
const lobbyScreen = document.querySelector("#lobby-screen") as HTMLElement;
const roomScreen = document.querySelector("#room-screen") as HTMLElement;
const roomList = document.querySelector("#room-list") as HTMLUListElement;
const roomTitle = document.querySelector("#room-title") as HTMLHeadingElement;
const roomMeta = document.querySelector("#room-meta") as HTMLDivElement;
const cooldownEl = document.querySelector("#cooldown") as HTMLDivElement;
const scoreboardEl = document.querySelector("#scoreboard") as HTMLDivElement;
const chatLog = document.querySelector("#chat-log") as HTMLDivElement;
const chatInput = document.querySelector("#chat-input") as HTMLInputElement;
const canvas = document.querySelector("#game-canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) {
  throw new Error("Canvas not supported");
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
  aimPoint: null as Vector2 | null
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
    case "room":
      state.roomId = message.payload.roomId;
      state.players = message.payload.players;
      state.timeLeftSec = message.payload.timeLeftSec;
      state.leaderboard = null;
      renderRoom();
      break;
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
    roomList.innerHTML = "<li>No rooms yet. Create one!</li>";
    return;
  }
  state.rooms.forEach((room) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div>
        <strong>${room.id}</strong> · Map ${room.mapId}<br />
        <span class="notice">${room.players.length}/${room.maxPlayers} players · ${room.timeLimitSec}s</span>
      </div>
    `;
    const joinBtn = document.createElement("button");
    joinBtn.textContent = "Join";
    joinBtn.addEventListener("click", () => {
      const password = room.passwordProtected ? prompt("Password?") ?? undefined : undefined;
      sendMessage({ type: "joinRoom", payload: { roomId: room.id, password } });
      setScreen("room");
    });
    li.appendChild(joinBtn);
    roomList.appendChild(li);
  });
};

const renderRoom = () => {
  setScreen("room");
  roomTitle.textContent = `Room ${state.roomId}`;
  roomMeta.textContent = `Time left: ${state.timeLeftSec}s · Players: ${state.players.length}`;
  renderLeaderboard();
};

const renderLeaderboard = () => {
  const list = state.leaderboard ?? state.players;
  const summary = list
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((player) => `${player.name} (${player.score})`)
    .join(" · ");
  scoreboardEl.textContent = state.leaderboard ? `Final Scores: ${summary}` : `Scores: ${summary}`;
};

const renderChat = () => {
  chatLog.innerHTML = "";
  state.chat.forEach((msg) => {
    const bubble = document.createElement("div");
    bubble.className = "chat-bubble";
    bubble.textContent = `${msg.from}: ${msg.message}`;
    chatLog.appendChild(bubble);
  });
};

const getSelf = () => state.players.find((player) => player.id === state.selfId);

const clampVector = (value: Vector2) => ({
  x: Math.max(0, Math.min(mapSize.width, value.x)),
  y: Math.max(0, Math.min(mapSize.height, value.y))
});

const getCanvasPoint = (event: MouseEvent): Vector2 => {
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * mapSize.width;
  const y = ((event.clientY - rect.top) / rect.height) * mapSize.height;
  return clampVector({ x, y });
};

const isMouseOnTank = (point: Vector2, tank: Vector2) => {
  const dx = point.x - tank.x;
  const dy = point.y - tank.y;
  return Math.hypot(dx, dy) <= 22;
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

  state.players.forEach((player) => {
    const { x, y } = player.position;
    ctx.fillStyle = player.id === state.selfId ? "#4cc9f0" : "#f72585";
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0b0f1f";
    ctx.fillRect(x - 8, y - 4, 16, 8);
    ctx.fillStyle = "#e8f1ff";
    ctx.fillText(player.name, x + 24, y + 4);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(x - 20, y - 28, (player.hp / 100) * 40, 4);
    ctx.fillStyle = "#f97316";
    ctx.fillRect(x - 20, y - 22, (player.ammo / 20) * 40, 4);
  });

  if (state.aiming && state.aimPoint) {
    const self = getSelf();
    if (self) {
      ctx.strokeStyle = "rgba(76, 201, 240, 0.8)";
      ctx.beginPath();
      ctx.moveTo(self.position.x, self.position.y);
      ctx.lineTo(state.aimPoint.x, state.aimPoint.y);
      ctx.stroke();
    }
  }

  const self = getSelf();
  if (self) {
    const remaining = Math.max(0, Math.ceil((self.nextActionAt - Date.now()) / 1000));
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
  const createBtn = document.querySelector("#create-room") as HTMLButtonElement;
  createBtn.addEventListener("click", () => {
    const roomIdInput = document.querySelector("#room-id") as HTMLInputElement;
    const mapIdInput = document.querySelector("#map-id") as HTMLInputElement;
    const maxPlayersInput = document.querySelector("#max-players") as HTMLInputElement;
    const timeLimitInput = document.querySelector("#time-limit") as HTMLInputElement;
    const passwordInput = document.querySelector("#room-password") as HTMLInputElement;

    const payload = {
      roomId: roomIdInput.value.trim() || `room-${Math.floor(Math.random() * 999)}`,
      mapId: mapIdInput.value.trim() || "alpha",
      maxPlayers: Number(maxPlayersInput.value) || 4,
      timeLimitSec: Number(timeLimitInput.value) || 240,
      password: passwordInput.value.trim() || undefined
    };
    sendMessage({ type: "createRoom", payload });
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
    if (isMouseOnTank(point, self.position)) {
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
      const dx = point.x - self.position.x;
      const dy = point.y - self.position.y;
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
