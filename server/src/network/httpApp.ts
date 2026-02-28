import * as fs from "fs";
import express from "express";
import * as path from "path";

function resolvePublicDir(): string {
  const candidates = [
    path.resolve(process.cwd(), "client", "dist"),
    path.resolve(__dirname, "../../client/dist"),
    path.resolve(__dirname, "../../../client/dist"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "index.html"))) return c;
  }
  return candidates[0];
}

export function createHttpApp() {
  const PUBLIC_DIR = resolvePublicDir();
  const PUBLIC_INDEX = path.join(PUBLIC_DIR, "index.html");
  const app = express();
  app.use(express.json());
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.use(express.static(PUBLIC_DIR, { index: false }));
  app.get("/", (_req, res) => {
    if (fs.existsSync(PUBLIC_INDEX)) return res.sendFile(PUBLIC_INDEX);
    return res.status(503).send("Client not built. Build client first.");
  });
  app.use((req, res, next) => {
    if (req.path.startsWith("/ws")) return next();
    if (req.method === "GET" && fs.existsSync(PUBLIC_INDEX)) return res.sendFile(PUBLIC_INDEX);
    return next();
  });
  return app;
}
