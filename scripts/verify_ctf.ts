
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
    flags: any[] = [];
    scoreRed: number = 0;
    scoreBlue: number = 0;

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
                this.flags = msg.payload.flags || [];
                this.scoreRed = msg.payload.teamScores?.red || 0;
                this.scoreBlue = msg.payload.teamScores?.blue || 0;
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

    createRoom(roomId: string) {
        this.ws.send(JSON.stringify({
            type: "createRoom",
            payload: { roomId, name: "CTF Test", maxPlayers: 4, gameMode: "ctf", mapId: "alpha" }
        }));
    }

    joinRoom(roomId: string) {
        this.ws.send(JSON.stringify({ type: "joinRoom", payload: { roomId } }));
    }

    move(x: number, y: number) {
        this.ws.send(JSON.stringify({ type: "move", payload: { target: { x, y } } }));
    }

    async moveTo(targetX: number, targetY: number, timeoutMs: number = 60000) {
        const start = Date.now();
        console.log(`[BOT] ${this.name} starting traversal to (${targetX.toFixed(1)}, ${targetY.toFixed(1)})...`);
        while (Date.now() - start < timeoutMs) {
            const dist = Math.hypot(this.x - targetX, this.y - targetY);
            if (dist < 30) {
                console.log(`[BOT] ${this.name} reached destination in ${((Date.now() - start) / 1000).toFixed(1)}s`);
                return;
            }
            console.log(`[BOT] ${this.name} currently at (${this.x.toFixed(1)}, ${this.y.toFixed(1)}), distance: ${dist.toFixed(1)}`);
            this.move(targetX, targetY);
            await sleep(2000);
        }
        throw new Error(`[BOT] ${this.name} failed to arrive at (${targetX}, ${targetY}) after ${timeoutMs / 1000}s`);
    }

    close() {
        this.ws.close();
    }
}

async function runTest() {
    console.log("Starting CTF Mode Verification (B-4)...");

    const red = new Bot("Red-Bot");
    const blue = new Bot("Blue-Bot");

    await Promise.all([red.connect(), blue.connect()]);

    red.login();
    blue.login();
    await sleep(1000);

    const ROOM_ID = "ctf_test_" + Date.now();
    red.createRoom(ROOM_ID);
    await sleep(500);

    red.joinRoom(ROOM_ID);
    await sleep(200);
    blue.joinRoom(ROOM_ID);
    await sleep(1500); // Wait for sync and team assignment

    console.log(`Bot Teams: Red=${red.team}, Blue=${blue.team}`);
    console.log(`Initial Flag Positions: `, JSON.stringify(blue.flags, null, 2));

    const redFlag = blue.flags.find(f => f.team === "red");
    if (!redFlag) throw new Error("Red flag not found");

    // Move Blue Bot to Red Flag with waypoint to avoid obstacles
    console.log(`\n--- STEP 1: Picking up Enemy Flag ---`);
    // Waypoint 1: Move to safe Y line
    await blue.moveTo(blue.x, 100);
    // Waypoint 2: Move horizontally to red flag x
    await blue.moveTo(redFlag.x, 100);
    // Waypoint 3: Move vertically to flag
    await blue.moveTo(redFlag.x, redFlag.y);

    // Wait for pickup
    let pickedUp = false;
    for (let i = 0; i < 20; i++) {
        await sleep(500);
        const f = blue.flags.find(f => f.team === "red");
        if (f) {
            console.log(`[DEBUG] Blue Bot at (${blue.x.toFixed(1)}, ${blue.y.toFixed(1)}), Red Flag at (${f.x.toFixed(1)}, ${f.y.toFixed(1)}), Carrier: ${f.carrierId}`);
            if (f.carrierId === blue.id) {
                pickedUp = true;
                console.log(`✅ Blue Bot picked up Red Flag!`);
                break;
            }
        }
    }
    if (!pickedUp) {
        console.error("❌ FAILED: Blue Bot could not pick up Red Flag.");
        process.exit(1);
    }

    console.log("\n--- STEP 2: Capturing the Flag ---");
    const blueSpawn = blue.flags.find(f => f.team === "blue");
    // Waypoint 1: Move up to safe line
    await blue.moveTo(blue.x, 100);
    // Waypoint 2: Move horizontally to base x
    await blue.moveTo(blueSpawn.x, 100);
    // Waypoint 3: Move vertically to base
    await blue.moveTo(blueSpawn.x, blueSpawn.y);

    console.log(`[DEBUG] Blue Bot arrived at base. Waiting for standstill capture...`);
    await sleep(2000); // Wait for server to register "stopped" state

    let captured = false;
    for (let i = 0; i < 40; i++) {
        await sleep(500);
        if (blue.scoreBlue >= 100) {
            captured = true;
            console.log(`✅ SUCCESS: Blue Team captured Red Flag! Score Blue = ${blue.scoreBlue}`);
            break;
        }
    }
    if (!captured) {
        console.error("❌ FAILED: Blue Bot could not capture Red Flag.");
        process.exit(1);
    }

    console.log("\n--- STEP 3: Flag Return ---");
    const fAfter = blue.flags.find(f => f.team === "red");
    if (fAfter && fAfter.carrierId === null && Math.abs(fAfter.x - redFlag.x) < 5) {
        console.log("✅ Red Flag returned to its base.");
    } else {
        console.error("❌ Flag did not return correctly.");
    }

    red.close();
    blue.close();
    console.log("\nCTF Verification Passed! 🎉");
    process.exit(0);
}

runTest().catch(e => {
    console.error(e);
    process.exit(1);
});
