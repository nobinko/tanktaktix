import { WebSocket } from 'ws';

const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;
const ROOM_ID = "load_test_room";
const NUM_CLIENTS = 100;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

class TestClient {
    id: string = "";
    ws: WebSocket;
    name: string;
    metrics = {
        tickIntervals: [] as number[],
        lastTickTime: 0
    };

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
            } else if (msg.type === "room") {
                const now = Date.now();
                if (this.metrics.lastTickTime > 0) {
                    this.metrics.tickIntervals.push(now - this.metrics.lastTickTime);
                }
                this.metrics.lastTickTime = now;
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
    console.log(`=== 50vs50 (100 Players) Load Test ===\n`);

    const host = new TestClient("HostBot");
    await host.connect();
    host.send({ type: "login", payload: { name: "HostBot" } });
    await sleep(200);

    console.log("[Setup] Creating room...");
    host.send({
        type: "createRoom",
        payload: { roomId: ROOM_ID, name: "Load Test", maxPlayers: NUM_CLIENTS, timeLimitSec: 300, gameMode: "deathmatch" }
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

    console.log(`[Running] All ${NUM_CLIENTS} clients connected. Starting random movement/shooting for 10 seconds...`);

    const intervalId = setInterval(() => {
        for (const c of clients) {
            // Randomly move or shoot
            if (Math.random() > 0.5) {
                c.send({ type: "move", payload: { target: { x: Math.random() * 2000, y: Math.random() * 2000 } } });
            }
            if (Math.random() > 0.8) {
                c.send({ type: "shoot", payload: { direction: { x: Math.random() * 2 - 1, y: Math.random() * 2 - 1 } } });
            }
        }
    }, 200); // Clients send actions roughly every 200ms

    // Let the test run for 10 seconds
    await sleep(10000);
    clearInterval(intervalId);

    console.log("\n[Results] Processing metrics from HostBot...");
    const intervals = host.metrics.tickIntervals;
    if (intervals.length === 0) {
        console.error("  ❌ No tick intervals recorded!");
    } else {
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const max = Math.max(...intervals);
        const min = Math.min(...intervals);
        console.log(`  Ticks Received: ${intervals.length}`);
        console.log(`  Average Tick Interval: ${avg.toFixed(2)} ms (Ideal is 50ms)`);
        console.log(`  Max Tick Interval (Worst Spike): ${max} ms`);
        console.log(`  Min Tick Interval: ${min} ms`);

        if (avg < 70) {
            console.log("  ✅ Load test PASSED! Server maintains reasonable tick rate under 100-player load.");
        } else {
            console.log("  ⚠️ Load test completed, but average tick interval is higher than expected.");
        }
    }

    console.log("\n[Cleanup] Disconnecting all clients...");
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
