# Tank Taktix (MVP0)

A Render-ready monorepo with a Vite client, an Express + `ws` server, and shared TypeScript types. The server hosts HTTP + WebSocket on the same port and serves the client build in production.

## Local Development (Windows PowerShell)

```powershell
# From the repo root
npm install

# Run client + server in dev mode
npm run dev
```

- Client: http://localhost:5173
- Server (HTTP + WebSocket): http://localhost:3000

## Local Production Build (Windows PowerShell)

```powershell
npm install
npm run build
npm run start
```

Then open http://localhost:3000

## Render Deployment

This repo ships with a `render.yaml` Blueprint for a single web service. On Render:

1. Create a new **Blueprint** from this repo.
2. Render will read `render.yaml` and configure the build/start commands.
3. Deploy.

Health checks hit `GET /health` on the same service/port.

## Gameplay Notes

- **Login:** enter a name or generate a random 4-digit callsign.
- **Lobby:** create or join rooms, with optional passwords.
- **Room:** top-down 2D with click-to-move, click-and-drag to aim and fire.
- **Cooldown:** after any action, a short cooldown applies; movement can be queued.
- **Ammo:** starts at 20, each shot costs 1.
- **HP:** starts at 100; hits deal 20. On 0 HP, you respawn with full HP/ammo.
- **Scoring:** hit +1, kill +1, death -5. End of time limit shows leaderboard.
- **Chat:** press `T` to open chat, `Enter` to send.

