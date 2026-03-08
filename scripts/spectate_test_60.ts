import { WebSocket } from 'ws';

const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;
const ROOM_ID = "70_player_test";
const NUM_CLIENTS = 60; // 30vs30
// テスト時間: ワンゲームやり通す想定 (+ ボットの自動キルによるゲーム終了を待つ)
// ボットは3分(180秒)間動き続ける
const TEST_DURATION_MS = 180 * 1000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

class TestClient {
    id: string = "";
    ws: WebSocket;
    name: string;

    constructor(name: string) {
        this.name = name;
        this.ws = new WebSocket(WS_URL);
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.ws.on('open', () => resolve());
            this.ws.on('error', (e) => reject(e));
            this.ws.on('message', (data) => this.onMessage(data));
        });
    }

    onMessage(data: any) {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.type === "welcome") {
                this.id = msg.payload.id;
            }
        } catch (e) { }
    }

    send(msg: any) {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    close() {
        this.ws.close();
    }
}

async function run() {
    console.log(`=== 30vs30 (60 Players) Full Game Spectate Test ===\n`);

    const host = new TestClient("HostBot");
    await host.connect();
    host.send({ type: "login", payload: { name: "HostBot" } });
    await sleep(200);

    console.log("[Setup] Creating room '30vs30 Test' (Deathmatch, 3 minutes)...");
    host.send({
        type: "createRoom",
        payload: { roomId: ROOM_ID, name: "30vs30 Test + You", maxPlayers: 70, timeLimitSec: 180, gameMode: "deathmatch" }
    });
    await sleep(500);

    host.send({ type: "joinRoom", payload: { roomId: ROOM_ID } });
    await sleep(500);

    console.log(`[Connecting] Spawning ${NUM_CLIENTS - 1} more clients...`);
    const clients: TestClient[] = [host];

    // Connect clients in batches to avoid overwhelming the port exhaustion
    for (let i = 1; i < NUM_CLIENTS; i++) {
        const c = new TestClient(`Bot_${i}`);
        await c.connect();
        c.send({ type: "login", payload: { name: `Bot_${i}` } });
        c.send({ type: "joinRoom", payload: { roomId: ROOM_ID } });
        clients.push(c);

        if (i % 10 === 0) {
            console.log(`  Connected ${i} clients...`);
            await sleep(100);
        }
    }

    console.log(`\n======================================================`);
    console.log(`[Ready] All ${NUM_CLIENTS} bots are in the room!`);
    console.log(`[User Action] Please open your browser, enter the lobby,`);
    console.log(`and click 'WATCH' on 'Room ${ROOM_ID}' to spectate.`);
    console.log(`The bots will fight for ${TEST_DURATION_MS / 1000} seconds.`);
    console.log(`======================================================\n`);

    const intervalId = setInterval(() => {
        for (const c of clients) {
            // Randomly move or shoot every 300ms
            if (Math.random() > 0.4) {
                // Bots tend to move towards center (approx 900, 500)
                const tx = 900 + (Math.random() * 800 - 400);
                const ty = 500 + (Math.random() * 600 - 300);
                c.send({ type: "move", payload: { target: { x: tx, y: ty } } });
            }
            if (Math.random() > 0.6) {
                c.send({ type: "shoot", payload: { direction: { x: Math.random() * 2 - 1, y: Math.random() * 2 - 1 } } });
            }
        }
    }, 300);

    // Let the bots fight until the game ends naturally
    await sleep(TEST_DURATION_MS + 2000); // Wait for match time limit + padding
    clearInterval(intervalId);

    console.log("\n[Cleanup] Test finished. Disconnecting all bots...");
    for (const c of clients) {
        c.close();
    }
    await sleep(500);
    console.log("Done.");
    process.exit(0);
}

run().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
