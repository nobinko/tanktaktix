import { defineConfig } from "vite";

export default defineConfig({
  server: {
<<<<<<< HEAD
    port: 5173,
    fs: {
      allow: [".."]
    }
  }
=======
    proxy: {
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
>>>>>>> origin/main
});
