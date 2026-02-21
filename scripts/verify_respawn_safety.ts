
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
                }
            }
        });
    }

    async connect() {
        if (this.ws.readyState === WebSocket.OPEN) return;
        return new Promise<void>(resolve => this.ws.on('open', resolve));
    }

    login() {
        this.ws.send(JSON.stringify({ type: "login", payload: { name: this.name } }));
    }

    joinRoom(roomId: string) {
        this.ws.send(JSON.stringify({ type: "joinRoom", payload: { roomId } }));
    }

    close() {
        this.ws.close();
    }
}

async function runTest() {
    console.log("Starting Respawn Safety Verification...");

    const bots: Bot[] = [];
    for (let i = 0; i < 6; i++) {
        bots.push(new Bot(`Bot-${i}`));
    }

    await Promise.all(bots.map(b => b.connect()));
    bots.forEach(b => b.login());
    await sleep(1000);

    // One bot creates a room
    const ROOM_ID = "respawn_test_" + Date.now();
    bots[0].ws.send(JSON.stringify({
        type: "createRoom",
        payload: { roomId: ROOM_ID, name: "Respawn Test", maxPlayers: 10, gameMode: "ctf" }
    }));
    await sleep(500);

    // Others join
    bots.forEach(b => b.joinRoom(ROOM_ID));
    await sleep(2000); // Wait for spawns

    console.log("\n--- Checking Initial Positions ---");
    for (let i = 0; i < bots.length; i++) {
        for (let j = i + 1; j < bots.length; j++) {
            const b1 = bots[i];
            const b2 = bots[j];
            if (b1.team === b2.team) {
                const dist = Math.hypot(b1.x - b2.x, b1.y - b2.y);
                console.log(`${b1.name} vs ${b2.name} (Team ${b1.team}): Dist = ${dist.toFixed(1)}`);
                if (dist < 36) { // TANK_SIZE * 2
                    console.error(`❌ FAILED: Overlap detected between ${b1.name} and ${b2.name}!`);
                    process.exit(1);
                }
            }
        }
    }

    console.log("\n✅ SUCCESS: No overlaps detected among 6 spawning bots.");
    bots.forEach(b => b.close());
    process.exit(0);
}

runTest().catch(console.error);
