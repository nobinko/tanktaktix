import http from "http";
import { WebSocketServer } from "ws";
import { PORT, TICK_MS } from "./constants";
import { createHttpApp } from "./network/httpApp";
import { registerWsHandlers } from "./network/handlers";
import { tick } from "./tick";

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

setInterval(() => tick(), TICK_MS);

const app = createHttpApp();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
registerWsHandlers(wss);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
