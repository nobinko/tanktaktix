
import { WebSocket } from 'ws';

type ServerMsg = { type: string; payload?: any };
type Vector2 = { x: number; y: number };

const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;
const ROOM_ID = "sim_4v4_battle";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

class Bot {
    id: string = "";
    team: string = "";
    ws: WebSocket;
    pos: Vector2 = { x: 0, y: 0 };
    nextActionTime: number = 0;
    alive: boolean = true;
    name: string;
    logPrefix: string;

    constructor(index: number) {
        this.name = `Bot${index}`;
        this.logPrefix = `[${this.name}]`;
        this.ws = new WebSocket(WS_URL);
    }

    async connect(): Promise<void> {
        return new Promise(resolve => {
            this.ws.on('open', () => resolve());
            this.ws.on('message', (data) => this.onMessage(data));
        });
    }

    async loginAndJoin(): Promise<void> {
        // Login
        this.ws.send(JSON.stringify({ type: "login", payload: { name: this.name } }));
        await this.waitForType("welcome", (payload) => {
            this.id = payload.id;
        });

        // Creates or Joins
        if (this.name === "Bot1") {
            this.ws.send(JSON.stringify({
                type: "createRoom",
                payload: { roomId: ROOM_ID, name: "4v4 Battle Sim", maxPlayers: 8 }
            }));
        } else {
            this.ws.send(JSON.stringify({
                type: "joinRoom",
                payload: { roomId: ROOM_ID }
            }));
        }

        // Wait for room state to get team
        await this.waitForType("room", (payload) => {
            const me = payload.players.find((p: any) => p.id === this.id);
            if (me) {
                this.team = me.team;
                this.pos = { x: me.x, y: me.y };
                console.log(`${this.logPrefix} Joined. Team: ${this.team.toUpperCase()} @ (${me.x.toFixed(0)}, ${me.y.toFixed(0)})`);
            }
        });
    }

    private messageQueue: { type: string, resolver: (payload: any) => void }[] = [];

    onMessage(data: any) {
        try {
            const msg = JSON.parse(data.toString()) as ServerMsg;

            // Check waiters
            const idx = this.messageQueue.findIndex(q => q.type === msg.type);
            if (idx >= 0) {
                const q = this.messageQueue[idx];
                this.messageQueue.splice(idx, 1);
                q.resolver(msg.payload);
            }

            // Update state
            if (msg.type === "room") {
                const me = msg.payload.players.find((p: any) => p.id === this.id);
                if (me) {
                    this.pos = { x: me.x, y: me.y };
                    this.alive = me.hp > 0;
                    // Auto-respawn check (basic)
                }
            }

        } catch (e) { }
    }

    waitForType(type: string, callback?: (payload: any) => void): Promise<void> {
        return new Promise(resolve => {
            this.messageQueue.push({
                type,
                resolver: (payload) => {
                    if (callback) callback(payload);
                    resolve();
                }
            });
        });
    }

    // AI Logic
    async act(bots: Bot[]) {
        if (!this.alive) return;

        // Find nearest enemy
        let targetEnemy: Bot | null = null;
        let minDist = 9999;

        for (const other of bots) {
            if (other.id === this.id || !other.alive || other.team === this.team) continue;
            const dx = other.pos.x - this.pos.x;
            const dy = other.pos.y - this.pos.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < minDist) {
                minDist = d;
                targetEnemy = other;
            }
        }

        if (targetEnemy && Math.random() < 0.3) {
            // Shoot at enemy
            // Add some randomness/lead? No, just aim directly for now
            this.ws.send(JSON.stringify({ type: "shoot", payload: { target: targetEnemy.pos } }));
            // console.log(`${this.logPrefix} Shooting at ${targetEnemy.name}`);
        } else {
            // Move randomly
            const angle = Math.random() * Math.PI * 2;
            const dist = 50 + Math.random() * 100;
            const target = {
                x: this.pos.x + Math.cos(angle) * dist,
                y: this.pos.y + Math.sin(angle) * dist
            };
            this.ws.send(JSON.stringify({ type: "move", payload: { target } }));
        }
    }
}

async function runSimulation() {
    console.log("Initializing 8 Bots for 4v4 Combat Simulation...");
    const bots: Bot[] = [];

    for (let i = 0; i < 8; i++) {
        const bot = new Bot(i + 1);
        bots.push(bot);
        await bot.connect();
        await bot.loginAndJoin();
        await sleep(50);
    }

    // Verify Teams
    const reds = bots.filter(b => b.team === "red").length;
    const blues = bots.filter(b => b.team === "blue").length;
    console.log(`\nTeam Balance: Red=${reds}, Blue=${blues} (Expected 4v4)`);
    if (reds === 4 && blues === 4) {
        console.log("✅ Team Balance Confirmed (4 vs 4).");
    } else {
        console.error("❌ Team Balance Failed!");
    }

    // TEST: Room Full
    console.log("\n[Test: Room Capacity]");
    const bot9 = new Bot(9);
    await bot9.connect();
    // Login
    bot9.ws.send(JSON.stringify({ type: "login", payload: { name: "Bot9" } }));
    await new Promise<void>(r => bot9.ws.once('message', r));

    // Try Join
    console.log("[Bot9] Attempting to join full room...");
    bot9.ws.send(JSON.stringify({ type: "joinRoom", payload: { roomId: ROOM_ID } }));

    // Expect error
    const joinResult = await new Promise<string>(resolve => {
        bot9.ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === "error") resolve(msg.payload.message);
            if (msg.type === "room") resolve("SUCCESS");
        });
        setTimeout(() => resolve("TIMEOUT"), 2000);
    });

    if (joinResult === "Room is full.") {
        console.log("✅ Room Full Rejection Confirmed: 'Room is full.'");
    } else {
        console.error(`❌ Room Full Test Failed: Got '${joinResult}'`);
    }
    bot9.ws.close();

    console.log("\nStarting Combat Simulation (15 seconds)...");

    let totalHits = 0;
    // Monitor logic? We can just check logs or monitor HP changes via one bot's view

    const interval = setInterval(() => {
        bots.forEach(b => b.act(bots));
    }, 1500);

    await sleep(15000);
    clearInterval(interval);

    console.log("\nSimulation Ended. Disconnecting...");
    bots.forEach(b => b.ws.close());
}

runSimulation();
