import "./style.css";
import type { Envelope } from "../../shared/src/protocol";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App container not found");
}

app.innerHTML = `
  <main class="layout">
    <header>
      <h1>TankTaktix</h1>
      <p>Vite + TypeScript client with WebSocket echo.</p>
    </header>
    <section class="panel">
      <h2>WebSocket</h2>
      <div class="status" data-status>Connecting...</div>
      <form class="row" data-form>
        <input name="message" type="text" placeholder="Type a message" autocomplete="off" />
        <button type="submit">Send</button>
      </form>
      <ul class="log" data-log></ul>
    </section>
  </main>
`;

const statusEl = app.querySelector<HTMLDivElement>("[data-status]");
const formEl = app.querySelector<HTMLFormElement>("[data-form]");
const logEl = app.querySelector<HTMLUListElement>("[data-log]");

if (!statusEl || !formEl || !logEl) {
  throw new Error("Required elements not found");
}

const socketUrl = resolveWebSocketUrl();
const socket = new WebSocket(socketUrl);

socket.addEventListener("open", () => {
  statusEl.textContent = `Connected to ${socketUrl}`;
  statusEl.dataset.state = "open";
});

socket.addEventListener("close", () => {
  statusEl.textContent = "Disconnected";
  statusEl.dataset.state = "closed";
});

socket.addEventListener("message", (event) => {
  appendLog(`Server: ${event.data}`);
});

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const input = formEl.elements.namedItem("message") as HTMLInputElement | null;
  if (!input || !input.value.trim()) {
    return;
  }
  const message = input.value.trim();
  socket.send(message);
  appendLog(`You: ${message}`);
  input.value = "";
});

function appendLog(message: string) {
  const li = document.createElement("li");
  li.textContent = message;
  logEl.prepend(li);
}

function safeParseEnvelope(raw: string): Envelope | null {
  try {
    const parsed = JSON.parse(raw) as Envelope;
    return parsed;
  } catch (error) {
    return null;
  }
}

void safeParseEnvelope;

function resolveWebSocketUrl() {
  const { protocol, hostname, port } = window.location;
  const wsProtocol = protocol === "https:" ? "wss" : "ws";
  const wsPort = port || "3000";
  return `${wsProtocol}://${hostname}:${wsPort}/ws`;
}
