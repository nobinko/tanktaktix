import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
<<<<<<< HEAD
import { WebSocket, WebSocketServer } from "ws";
import type { Envelope, ErrorPayload, HelloPayload, LobbyStatePayload } from "../../shared/src/protocol";

const port = Number(process.env.PORT ?? 3000);
const clientDistDir = path.resolve(__dirname, "../../client/dist");
let sequence = 0;
=======
import { WebSocketServer } from "ws";

const port = Number(process.env.PORT ?? 3000);
const clientDistDir = path.resolve(__dirname, "../../client/dist");
>>>>>>> origin/main

const server = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }

  if (req.url.startsWith("/ws")) {
    res.writeHead(426);
    res.end("Upgrade Required");
    return;
  }

  const requestPath = req.url.split("?")[0];
  const filePath = path.join(clientDistDir, requestPath === "/" ? "/index.html" : requestPath);

  try {
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const data = await readFile(filePath);
    res.writeHead(200, {
      "Content-Type": contentTypeForPath(filePath)
    });
    res.end(data);
  } catch (error) {
    try {
      const indexHtml = await readFile(path.join(clientDistDir, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(indexHtml);
    } catch (fallbackError) {
      res.writeHead(404);
      res.end("Not Found");
    }
  }
});

const wss = new WebSocketServer({ server, path: "/ws" });
<<<<<<< HEAD
const sockets = new Set<string>();

wss.on("connection", (socket) => {
  const sid = `sid-${Math.random().toString(36).slice(2, 10)}`;
  sockets.add(sid);

  const welcome: Envelope = {
    t: "WELCOME",
    v: 1,
    sid,
    seq: nextSequence(),
    ts: Date.now(),
    p: { message: "WebSocket connected" }
  };
  socket.send(JSON.stringify(welcome));

  broadcastLobbyState();

  socket.on("message", (data) => {
    const raw = data.toString();
    let message: Envelope;

    try {
      message = JSON.parse(raw) as Envelope;
    } catch (error) {
      sendError(socket, sid, "BAD_JSON", "Invalid JSON payload");
      return;
    }

    if (message.t === "PING") {
      socket.send(JSON.stringify(buildEnvelope("PONG", sid, { ts: Date.now() })));
      return;
    }

    if (message.t === "HELLO") {
      const payload = message.p as HelloPayload;
      socket.send(
        JSON.stringify(buildEnvelope("WELCOME", sid, { message: `Hello ${payload?.name ?? "guest"}` }))
      );
      return;
    }

    sendError(socket, sid, "UNKNOWN_TYPE", `Unsupported message type: ${message.t}`);
  });

  socket.on("close", () => {
    sockets.delete(sid);
    broadcastLobbyState();
=======

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "welcome", message: "WebSocket connected" }));

  socket.on("message", (data) => {
    const text = data.toString();
    socket.send(JSON.stringify({ type: "echo", message: text }));
>>>>>>> origin/main
  });
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

<<<<<<< HEAD
function broadcastLobbyState() {
  const payload: LobbyStatePayload = { online: sockets.size };
  const envelope = buildEnvelope("LOBBY_STATE", undefined, payload);
  const data = JSON.stringify(envelope);
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(data);
    }
  });
}

function sendError(socket: WebSocket, sid: string, code: string, message: string) {
  const payload: ErrorPayload = { code, message };
  socket.send(JSON.stringify(buildEnvelope("ERROR", sid, payload)));
}

function buildEnvelope<TPayload>(t: Envelope<TPayload>["t"], sid: string | undefined, p: TPayload): Envelope<TPayload> {
  return {
    t,
    v: 1,
    sid,
    seq: nextSequence(),
    ts: Date.now(),
    p
  };
}

function nextSequence() {
  sequence += 1;
  return sequence;
}

=======
>>>>>>> origin/main
function contentTypeForPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html";
    case ".js":
      return "text/javascript";
    case ".css":
      return "text/css";
    case ".json":
      return "application/json";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}
