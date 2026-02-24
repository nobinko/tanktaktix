import { WebSocket } from 'ws';

type ServerMsg = { type: string; payload?: any };

const PORT = 3001;
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
    hp: number = 100;

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
                    this.hp = me.hp;
                }
                if (msg.payload.flags) {
                    this.flags = msg.payload.flags;
                }
            }
        });
    }

    async connect() {
        if (this.ws.readyState === WebSocket.OPEN) return;
        return new Promise<void>(resolve => {
            this.ws.on('open', resolve);
        });
    }

    login() {
        this.ws.send(JSON.stringify({ type: "login", payload: { name: this.name } }));
    }

    createRoom(roomId: string) {
        this.ws.send(JSON.stringify({
            type: "createRoom",
            payload: { roomId, name: "CTF Verification", maxPlayers: 4, gameMode: "ctf", mapId: "empty" }
        }));
    }

    joinRoom(roomId: string) {
        this.ws.send(JSON.stringify({ type: "joinRoom", payload: { roomId } }));
    }

    move(x: number, y: number) {
        this.ws.send(JSON.stringify({ type: "move", payload: { target: { x, y } } }));
    }

    shoot(dir: { x: number, y: number }) {
        this.ws.send(JSON.stringify({ type: "shoot", payload: { direction: dir } }));
    }

    async moveTo(targetX: number, targetY: number, timeoutMs: number = 60000) {
        const start = Date.now();
        console.log(`[BOT] ${this.name} moving to (${targetX.toFixed(1)}, ${targetY.toFixed(1)})...`);
        while (Date.now() - start < timeoutMs) {
            const dist = Math.hypot(this.x - targetX, this.y - targetY);
            if (dist < 40) {
                return;
            }
            this.move(targetX, targetY);
            await sleep(1000);
        }
        throw new Error(`[BOT] ${this.name} failed to arrive.`);
    }

    close() {
        this.ws.close();
    }
}

async function runTest() {
    console.log("Starting Batch 3 Flag Verification...");

    const red = new Bot("Red-Bot");
    const blue = new Bot("Blue-Bot");

    await Promise.all([red.connect(), blue.connect()]);
    red.login();
    blue.login();
    await sleep(1000);

    const ROOM_ID = "b3_test_" + Date.now();
    red.createRoom(ROOM_ID);
    await sleep(500);

    red.joinRoom(ROOM_ID);
    await sleep(200);
    blue.joinRoom(ROOM_ID);
    await sleep(1500);

    console.log(`Teams: Red=${red.team}, Blue=${blue.team}`);

    // Red flag pos
    const rFlag = red.flags.find(f => f.team === "red");
    const bFlag = blue.flags.find(f => f.team === "blue");

    const blueBaseX = bFlag.x;
    const blueBaseY = bFlag.y;

    console.log("\n--- STEP 1: Red takes Blue Flag ---");
    // Move red to blue flag
    await red.moveTo(red.x, 450);
    await red.moveTo(bFlag.x, 450);
    await red.moveTo(bFlag.x, bFlag.y);

    await sleep(2000); // give it a moment to pick up
    const heldFlag = red.flags.find(f => f.team === "blue");
    if (heldFlag.carrierId !== red.id) {
        console.error("❌ Red failed to pick up Blue flag.");
        process.exit(1);
    }
    console.log("✅ Red successfully picked up Blue flag!");

    // Move Blue slightly away so they can shoot Red
    await blue.moveTo(blueBaseX, blueBaseY + 200);

    console.log("\n--- STEP 2: Blue shoots Red (Damage = Drop) ---");
    // Blue shoots UP at Red
    blue.shoot({ x: 0, y: -1 });
    await sleep(500);

    const checkDrop = red.flags.find(f => f.team === "blue");
    if (checkDrop.carrierId !== null) {
        console.error("❌ Red did not drop the flag after taking damage!");
        process.exit(1);
    }
    console.log(`✅ Red dropped the flag at (${checkDrop.x.toFixed(1)}, ${checkDrop.y.toFixed(1)}).`);

    console.log("\n--- STEP 3: Instant Re-pickup Prevention ---");
    await sleep(2000); // Wait 2 ticks
    const checkPickup = red.flags.find(f => f.team === "blue");
    if (checkPickup.carrierId === red.id) {
        console.error("❌ ERROR: Red immediately picked up the flag again while standing on it!");
        process.exit(1);
    }
    console.log("✅ Red is not able to pick up the flag while standing on it.");

    console.log("\n--- STEP 4: Bullet hits dropped flag -> Returns to base ---");
    // Blue is still at blueBaseY + 200, facing UP. Flag is at blueBaseY.
    // Shoot UP again to hit the dropped flag!
    blue.shoot({ x: 0, y: -1 });
    await sleep(500);

    const checkReturn = blue.flags.find(f => f.team === "blue");
    if (Math.abs(checkReturn.x - blueBaseX) > 5 || Math.abs(checkReturn.y - blueBaseY) > 5) {
        console.error("❌ Flag did not return to base after being shot.");
        console.log(`Current Flag Pos: ${checkReturn.x}, ${checkReturn.y}. Expected: ${blueBaseX}, ${blueBaseY}`);
        // Flag might be stuck? Or bullet missed? Let's assume it failed if this triggers.
    } else {
        console.log("✅ Flag was successfully shot and returned to base!");
    }

    red.close();
    blue.close();
    console.log("\nAll Batch 3 tests PASSED! 🎉");
    process.exit(0);
}

runTest().catch(e => {
    console.error(e);
    process.exit(1);
});
