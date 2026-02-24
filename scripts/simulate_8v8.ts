
import { WebSocket } from 'ws';

type ServerMsg = { type: string; payload?: any };
type Vector2 = { x: number; y: number };

const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;
const ROOM_ID = "sim_8v8_battle";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

class Bot {
    id: string = "";
    team: string = "";
    ws: WebSocket;
    pos: Vector2 = { x: 0, y: 0 };
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
        this.ws.send(JSON.stringify({ type: "login", payload: { name: this.name } }));
        await this.waitForType("welcome", (payload) => {
            this.id = payload.id;
        });

        if (this.name === "Bot1") {
            this.ws.send(JSON.stringify({
                type: "createRoom",
                payload: { roomId: ROOM_ID, name: "8v8 Battle Sim", maxPlayers: 16 }
            }));
            await sleep(100);
        }

        this.ws.send(JSON.stringify({
            type: "joinRoom",
            payload: { roomId: ROOM_ID }
        }));

        await this.waitForType("room", (payload) => {
            const me = payload.players.find((p: any) => p.id === this.id);
            if (me) {
                this.team = me.team;
                this.pos = { x: me.x, y: me.y };
                console.log(`${this.logPrefix} Joined. Team: ${this.team.toUpperCase()}`);
            }
        });
    }

    private messageQueue: { type: string, resolver: (payload: any) => void }[] = [];

    onMessage(data: any) {
        try {
            const msg = JSON.parse(data.toString()) as ServerMsg;
            const idx = this.messageQueue.findIndex(q => q.type === msg.type);
            if (idx >= 0) {
                const q = this.messageQueue[idx];
                this.messageQueue.splice(idx, 1);
                q.resolver(msg.payload);
            }
            if (msg.type === "room") {
                const me = msg.payload.players.find((p: any) => p.id === this.id);
                if (me) {
                    this.pos = { x: me.x, y: me.y };
                    this.alive = me.hp > 0;
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

    async act(bots: Bot[]) {
        if (!this.alive) return;
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
            this.ws.send(JSON.stringify({ type: "shoot", payload: { target: targetEnemy.pos } }));
        } else {
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
    console.log("Initializing 16 Bots for 8v8 Combat Simulation...");
    const bots: Bot[] = [];

    for (let i = 0; i < 16; i++) {
        const bot = new Bot(i + 1);
        bots.push(bot);
        await bot.connect();
        await bot.loginAndJoin();
        await sleep(50);
    }

    const reds = bots.filter(b => b.team === "red").length;
    const blues = bots.filter(b => b.team === "blue").length;
    console.log(`\nTeam Balance: Red=${reds}, Blue=${blues} (Expected 8v8)`);

    if (Math.abs(reds - blues) <= 1) {
        console.log("✅ Team Balance Confirmed.");
    } else {
        console.error("❌ Team Balance Failed!");
    }

    console.log("\nStarting 8v8 Combat Simulation (20 seconds)...");
    const interval = setInterval(() => {
        bots.forEach(b => b.act(bots));
    }, 1000);

    await sleep(20000);
    clearInterval(interval);

    console.log("\nSimulation Ended. Disconnecting...");
    bots.forEach(b => b.ws.close());
}

runSimulation();
