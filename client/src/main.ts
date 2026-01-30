import "./style.css";
import {
  type Envelope,
  type LobbyStatePayload,
  type RoomStatePayload,
  type Team,
  formatEnvelope,
  parseEnvelope
} from "@tanktaktix/shared";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App container not found");
}

app.innerHTML = `
  <main class="layout">
    <header class="header">
      <div>
        <h1>TankTaktix Lobby</h1>
        <p>Connect to the lobby, create rooms, and coordinate teams.</p>
      </div>
      <div class="status-row">
        <span class="status" data-connection>Status: Connecting...</span>
        <div class="name-row">
          <input name="playerName" data-name-input type="text" placeholder="Your name" maxlength="24" />
          <button type="button" data-name-save>Set Name</button>
        </div>
      </div>
    </header>

    <section class="panel" data-lobby-panel>
      <h2>Lobby</h2>
      <form class="row" data-create-form>
        <input name="roomName" type="text" placeholder="Room name" maxlength="32" />
        <button type="submit">Create Room</button>
      </form>
      <div class="room-list" data-room-list></div>
    </section>

    <section class="panel" data-room-panel hidden>
      <div class="room-header">
        <div>
          <h2 data-room-title>Room</h2>
          <p data-room-meta></p>
        </div>
        <button type="button" data-leave-room>Leave</button>
      </div>
      <div class="team-actions" data-team-actions>
        <button type="button" data-team="A">Team A</button>
        <button type="button" data-team="B">Team B</button>
        <button type="button" data-team="none">No Team</button>
        <button type="button" data-ready-toggle>Toggle Ready</button>
      </div>
      <ul class="player-list" data-player-list></ul>
    </section>

    <section class="panel">
      <h2>Incoming Messages</h2>
      <ul class="log" data-log></ul>
    </section>
  </main>
`;

const connectionEl = app.querySelector<HTMLSpanElement>("[data-connection]");
const nameInput = app.querySelector<HTMLInputElement>("[data-name-input]");
const nameSaveButton = app.querySelector<HTMLButtonElement>("[data-name-save]");
const createForm = app.querySelector<HTMLFormElement>("[data-create-form]");
const roomList = app.querySelector<HTMLDivElement>("[data-room-list]");
const lobbyPanel = app.querySelector<HTMLElement>("[data-lobby-panel]");
const roomPanel = app.querySelector<HTMLElement>("[data-room-panel]");
const roomTitle = app.querySelector<HTMLHeadingElement>("[data-room-title]");
const roomMeta = app.querySelector<HTMLParagraphElement>("[data-room-meta]");
const playerList = app.querySelector<HTMLUListElement>("[data-player-list]");
const leaveRoomButton = app.querySelector<HTMLButtonElement>("[data-leave-room]");
const teamActions = app.querySelector<HTMLDivElement>("[data-team-actions]");
const readyToggle = app.querySelector<HTMLButtonElement>("[data-ready-toggle]");
const logEl = app.querySelector<HTMLUListElement>("[data-log]");

if (
  !connectionEl ||
  !nameInput ||
  !nameSaveButton ||
  !createForm ||
  !roomList ||
  !lobbyPanel ||
  !roomPanel ||
  !roomTitle ||
  !roomMeta ||
  !playerList ||
  !leaveRoomButton ||
  !teamActions ||
  !readyToggle ||
  !logEl
) {
  throw new Error("Required elements not found");
}

let socket: WebSocket | null = null;
let reconnectAttempts = 0;
let lobbyState: LobbyStatePayload | null = null;
let roomState: RoomStatePayload | null = null;
let sid: string | null = null;

const storedName = window.localStorage.getItem("tanktaktix.name") ?? "";
nameInput.value = storedName;

connect();
render();

nameSaveButton.addEventListener("click", () => {
  const name = nameInput.value.trim();
  window.localStorage.setItem("tanktaktix.name", name);
  if (socket && socket.readyState === WebSocket.OPEN && !roomState) {
    send({ type: "HELLO", payload: { name: name || "Guest" } });
  }
});

createForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = createForm.elements.namedItem("roomName") as HTMLInputElement | null;
  if (!input) {
    return;
  }
  const name = input.value.trim();
  if (!name) {
    return;
  }
  send({ type: "CREATE_ROOM", payload: { name } });
  input.value = "";
});

leaveRoomButton.addEventListener("click", () => {
  send({ type: "LEAVE_ROOM", payload: {} });
});

teamActions.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  if (!target || !target.dataset.team) {
    return;
  }
  const teamValue = target.dataset.team;
  const team: Team = teamValue === "A" ? "A" : teamValue === "B" ? "B" : null;
  send({ type: "SET_TEAM", payload: { team } });
});

readyToggle.addEventListener("click", () => {
  const selfPlayer = roomState?.players.find((player) => player.sid === sid);
  send({ type: "SET_READY", payload: { ready: !selfPlayer?.ready } });
});

function connect() {
  const socketUrl = resolveWebSocketUrl();
  socket = new WebSocket(socketUrl);

  setStatus("connecting", `Connecting to ${socketUrl}...`);

  socket.addEventListener("open", () => {
    reconnectAttempts = 0;
    setStatus("open", `Connected to ${socketUrl}`);
    const name = nameInput.value.trim() || "Guest";
    send({ type: "HELLO", payload: { name } });
  });

  socket.addEventListener("close", () => {
    setStatus("reconnecting", "Reconnecting...");
    lobbyState = null;
    roomState = null;
    render();
    scheduleReconnect();
  });

  socket.addEventListener("message", (event) => {
    const envelope = parseEnvelope(event.data);
    if (!envelope) {
      appendLog(`Invalid message: ${event.data}`);
      return;
    }
    handleEnvelope(envelope);
    appendLog(JSON.stringify(envelope));
  });
}

function scheduleReconnect() {
  reconnectAttempts += 1;
  const delay = Math.min(10_000, 500 * 2 ** reconnectAttempts);
  window.setTimeout(() => {
    connect();
  }, delay);
}

function handleEnvelope(envelope: Envelope) {
  switch (envelope.type) {
    case "WELCOME": {
      const payload = envelope.payload as { sid?: string; name?: string };
      sid = payload.sid ?? null;
      return;
    }
    case "LOBBY_STATE": {
      lobbyState = envelope.payload as LobbyStatePayload;
      roomState = null;
      render();
      return;
    }
    case "ROOM_STATE": {
      roomState = envelope.payload as RoomStatePayload;
      lobbyState = null;
      render();
      return;
    }
    case "ERROR": {
      const payload = envelope.payload as { code?: string; message?: string };
      appendLog(`ERROR ${payload.code ?? ""}: ${payload.message ?? ""}`);
      return;
    }
    case "PONG": {
      return;
    }
    default:
      return;
  }
}

function render() {
  if (roomState) {
    lobbyPanel.hidden = true;
    roomPanel.hidden = false;
    renderRoom(roomState);
    return;
  }

  lobbyPanel.hidden = false;
  roomPanel.hidden = true;
  renderLobby(lobbyState);
}

function renderLobby(state: LobbyStatePayload | null) {
  if (!state) {
    roomList.innerHTML = `<p class="muted">Waiting for lobby state...</p>`;
    return;
  }

  if (state.rooms.length === 0) {
    roomList.innerHTML = `<p class="muted">No rooms yet. Create one!</p>`;
    return;
  }

  roomList.innerHTML = "";
  for (const room of state.rooms) {
    const card = document.createElement("div");
    card.className = "room-card";
    card.innerHTML = `
      <div>
        <strong>${room.name}</strong>
        <div class="muted">${room.counts.total}/8 · A ${room.counts.a} / B ${room.counts.b} ${room.inProgress ? "· In progress" : ""}</div>
      </div>
      <button type="button" data-room-id="${room.roomId}">Join</button>
    `;
    const button = card.querySelector<HTMLButtonElement>("button");
    button?.addEventListener("click", () => {
      send({ type: "JOIN_ROOM", payload: { roomId: room.roomId } });
    });
    roomList.appendChild(card);
  }
}

function renderRoom(state: RoomStatePayload) {
  roomTitle.textContent = state.name;
  roomMeta.textContent = `${state.players.length}/8 players`;
  playerList.innerHTML = "";

  const sortedPlayers = [...state.players].sort((a, b) => a.joinedAt - b.joinedAt);
  for (const player of sortedPlayers) {
    const li = document.createElement("li");
    li.className = "player-card";
    const isSelf = player.sid === sid;
    li.innerHTML = `
      <div>
        <strong>${player.name}${isSelf ? " (you)" : ""}</strong>
        <div class="muted">Team: ${player.team ?? "None"}</div>
      </div>
      <span class="badge ${player.ready ? "ready" : ""}">${player.ready ? "Ready" : "Not ready"}</span>
    `;
    playerList.appendChild(li);
  }

  const selfPlayer = state.players.find((player) => player.sid === sid);
  readyToggle.textContent = selfPlayer?.ready ? "Set Not Ready" : "Set Ready";
}

function send(envelope: Envelope) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    appendLog("Cannot send message: socket not connected.");
    return;
  }
  socket.send(formatEnvelope(envelope));
}

function setStatus(state: "connecting" | "open" | "reconnecting", text: string) {
  connectionEl.textContent = text;
  connectionEl.dataset.state = state;
}

function appendLog(message: string) {
  const li = document.createElement("li");
  li.textContent = message;
  logEl.prepend(li);
}

function resolveWebSocketUrl() {
  const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${wsProtocol}://${window.location.host}/ws`;
}
