import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { WebSocketServer } from "ws";

const port = Number(process.env.PORT ?? 3000);
const clientDistDir = path.resolve(__dirname, "../../client/dist");

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

wss.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "welcome", message: "WebSocket connected" }));

  socket.on("message", (data) => {
    const text = data.toString();
    socket.send(JSON.stringify({ type: "echo", message: text }));
  });
});

server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

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
