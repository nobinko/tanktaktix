
import { WebSocket } from 'ws';

type ServerMsg = { type: string; payload?: any };

const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

class Bot {
    ws: WebSocket;
    name: string;
    id: string = "";
    team: string = "";
    x: number = 0;
    y: number = 0;
    roomId: string = "";

    constructor(name: string) {
        this.name = name;
        this.ws = new WebSocket(WS_URL);
        this.ws.on('message', (data) => {
            const msg = JSON.parse(data.toString()) as ServerMsg;
            if (msg.type === "welcome") {
                this.id = msg.payload.id;
            }
            if (msg.type === "room") {
                const me = msg.payload.players?.find((p: any) => p.id === this.id);
                if (me) {
                    this.team = me.team;
                    this.x = me.x;
                    this.y = me.y;
                    this.roomId = msg.payload.roomId;
                }
            }
        });
    }

    async connect() {
        if (this.ws.readyState === WebSocket.Open) return;
        return new Promise<void>(resolve => this.ws.on('open', resolve));
    }

    login() {
        this.ws.send(JSON.stringify({ type: "login", payload: { name: this.name } }));
    }

    createRoom(roomId: string) {
        this.ws.send(JSON.stringify({
            type: "createRoom",
            payload: { roomId, name: "Team Test", maxPlayers: 4 }
        }));
    }

    joinRoom(roomId: string) {
        this.ws.send(JSON.stringify({ type: "joinRoom", payload: { roomId } }));
    }

    close() {
        this.ws.close();
    }
}

async function runTest() {
    console.log("Starting Team Division Verification (A-9)...");

    const bots: Bot[] = [];
    for (let i = 0; i < 4; i++) {
        bots.push(new Bot(`Bot-${i}`));
    }

    // Connect all
    await Promise.all(bots.map(b => b.connect()));

    // Login all
    bots.forEach(b => b.login());
    await sleep(500);

    // Bot 0 creates room
    const ROOM_ID = "team_test_1";
    bots[0].createRoom(ROOM_ID);
    await sleep(500);

    // Others join
    for (let i = 1; i < 4; i++) {
        bots[i].joinRoom(ROOM_ID);
        await sleep(200);
    }

    await sleep(1000); // Wait for sync

    // Check Teams
    let redCount = 0;
    let blueCount = 0;
    const redSpawns: { x: number, y: number }[] = [];
    const blueSpawns: { x: number, y: number }[] = [];

    console.log("\n--- Team Assignments ---");
    for (const b of bots) {
        console.log(`${b.name}: Team=${b.team}, Pos=(${b.x.toFixed(1)}, ${b.y.toFixed(1)})`);
        if (b.team === "red") {
            redCount++;
            redSpawns.push({ x: b.x, y: b.y });
        } else if (b.team === "blue") {
            blueCount++;
            blueSpawns.push({ x: b.x, y: b.y });
        }
    }

    // Validate Counts
    if (redCount === 2 && blueCount === 2) {
        console.log(`✅ Team Balance Correct: Red=${redCount}, Blue=${blueCount}`);
    } else {
        console.error(`❌ Team Balance FAILED: Red=${redCount}, Blue=${blueCount} (Expected 2 each)`);
    }

    // Validate Spawns (Roughly)
    // Map A spawns: Red approx x=80, Blue approx x=820
    let redSpawnOk = true;
    for (const p of redSpawns) {
        if (p.x > 300) redSpawnOk = false; // Should be on left side
    }
    let blueSpawnOk = true;
    for (const p of blueSpawns) {
        if (p.x < 600) blueSpawnOk = false; // Should be on right side
    }

    if (redSpawnOk && blueSpawnOk) {
        console.log(`✅ Spawn Positions Correct (Red on Left, Blue on Right)`);
    } else {
        console.error(`❌ Spawn Positions FAILED`);
        if (!redSpawnOk) console.error("   Red players spawned too far right.");
        if (!blueSpawnOk) console.error("   Blue players spawned too far left.");
    }

    bots.forEach(b => b.close());
    process.exit(0);
}

runTest().catch(console.error);
