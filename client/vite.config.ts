import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@tanktaktix/shared": path.resolve(__dirname, "../shared/src")
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true
      },
      "/ws": {
        target: "http://localhost:3000",
        ws: true,
        changeOrigin: true
      }
    }
  }
});
