import { defineConfig } from "vite";

const backendPort = process.env.BACKEND_PORT ?? "3000";
const clientPort = Number(process.env.CLIENT_PORT ?? 5173);

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: clientPort,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true
      },
      "/ws": {
        target: `http://127.0.0.1:${backendPort}`,
        ws: true,
        changeOrigin: true
      }
    }
  }
});
