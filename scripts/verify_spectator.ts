
import { WebSocket } from 'ws';

type ServerMsg = { type: string; payload?: any };

const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;
const ROOM_ID = "spec_test_room";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

class Client {
    id: string = "";
    ws: WebSocket;
    name: string;
    logPrefix: string;
    private messageQueue: { type: string, resolver: (payload: any) => void }[] = [];
    lastRoomPayload: any = null;

    constructor(name: string) {
        this.name = name;
        this.logPrefix = `[${name}]`;
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
            const msg = JSON.parse(data.toString()) as ServerMsg;
            if (msg.type === "room") {
                this.lastRoomPayload = msg.payload;
            }
            const idx = this.messageQueue.findIndex(q => q.type === msg.type);
            if (idx >= 0) {
                const q = this.messageQueue[idx];
                this.messageQueue.splice(idx, 1);
                q.resolver(msg.payload);
            }
        } catch (e) { }
    }

    waitForType(type: string, timeoutMs = 5000): Promise<any> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
            this.messageQueue.push({
                type,
                resolver: (payload) => {
                    clearTimeout(timer);
                    resolve(payload);
                }
            });
        });
    }

    send(msg: any) {
        this.ws.send(JSON.stringify(msg));
    }

    close() {
        this.ws.close();
    }
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
    if (condition) {
        console.log(`  ✅ ${message}`);
        passed++;
    } else {
        console.error(`  ❌ ${message}`);
        failed++;
    }
}

async function run() {
    console.log("=== Spectator Mode Verification ===\n");

    // --- Setup: Create room with 2 players ---
    console.log("[Setup] Creating room and adding 2 players...");

    const player1 = new Client("Player1");
    await player1.connect();
    player1.send({ type: "login", payload: { name: "Player1" } });
    const welcome1 = await player1.waitForType("welcome");
    player1.id = welcome1.id;

    // Create room
    player1.send({
        type: "createRoom",
        payload: { roomId: ROOM_ID, name: "Spec Test", maxPlayers: 4, timeLimitSec: 120, gameMode: "ctf" }
    });
    await sleep(200);

    // Player1 joins
    player1.send({ type: "joinRoom", payload: { roomId: ROOM_ID } });
    await player1.waitForType("room");

    const player2 = new Client("Player2");
    await player2.connect();
    player2.send({ type: "login", payload: { name: "Player2" } });
    const welcome2 = await player2.waitForType("welcome");
    player2.id = welcome2.id;

    // Player2 joins
    player2.send({ type: "joinRoom", payload: { roomId: ROOM_ID } });
    await player2.waitForType("room");

    await sleep(300); // Let game state settle

    console.log(`  Player1 ID: ${player1.id}`);
    console.log(`  Player2 ID: ${player2.id}\n`);

    // --- Test 1: Spectator joins via spectateRoom ---
    console.log("[Test 1] Spectator joins room via spectateRoom message");

    const spectator = new Client("Spectator");
    await spectator.connect();
    spectator.send({ type: "login", payload: { name: "Spectator" } });
    const welcomeS = await spectator.waitForType("welcome");
    spectator.id = welcomeS.id;

    spectator.send({ type: "spectateRoom", payload: { roomId: ROOM_ID } });
    const roomPayload = await spectator.waitForType("room");

    assert(roomPayload.roomId === ROOM_ID, "Spectator received room state");
    assert(Array.isArray(roomPayload.players), "Room state contains players array");

    // --- Test 2: Spectator sees ALL players (including hidden ones) ---
    console.log("\n[Test 2] Spectator receives all players");
    const playerIds = roomPayload.players.map((p: any) => p.id);
    assert(playerIds.includes(player1.id), "Spectator sees Player1");
    assert(playerIds.includes(player2.id), "Spectator sees Player2");
    // Spectator itself should NOT appear in player list
    assert(!playerIds.includes(spectator.id), "Spectator is NOT in player list");

    // --- Test 3: Spectator's actions are rejected ---
    console.log("\n[Test 3] Spectator's move/shoot actions are ignored");

    // Try to move
    spectator.send({ type: "move", payload: { target: { x: 500, y: 500 } } });
    await sleep(500);

    // Try to shoot
    spectator.send({ type: "shoot", payload: { direction: { x: 1, y: 0 } } });
    await sleep(500);

    // Check that spectator is still not in the player list
    const latestPayload = spectator.lastRoomPayload;
    if (latestPayload) {
        const pIds = latestPayload.players.map((p: any) => p.id);
        assert(!pIds.includes(spectator.id), "Spectator still NOT in player list after actions");
    } else {
        assert(false, "No room state received for verification");
    }

    // --- Test 4: Spectator doesn't consume player slot ---
    console.log("\n[Test 4] Spectator does not consume maxPlayers slot");
    // Room has maxPlayers=4, 2 players + 1 spectator
    // Add 2 more players — should succeed
    const player3 = new Client("Player3");
    await player3.connect();
    player3.send({ type: "login", payload: { name: "Player3" } });
    const welcome3 = await player3.waitForType("welcome");
    player3.id = welcome3.id;
    player3.send({ type: "joinRoom", payload: { roomId: ROOM_ID } });
    const joined3 = await player3.waitForType("room");
    assert(!!joined3, "Player3 joined (spectator doesn't block)");

    const player4 = new Client("Player4");
    await player4.connect();
    player4.send({ type: "login", payload: { name: "Player4" } });
    const welcome4 = await player4.waitForType("welcome");
    player4.id = welcome4.id;
    player4.send({ type: "joinRoom", payload: { roomId: ROOM_ID } });
    const joined4 = await player4.waitForType("room");
    assert(!!joined4, "Player4 joined (room at max capacity)");

    // --- Test 5: Room full but spectator can still join ---
    console.log("\n[Test 5] Another spectator can join when room is full");
    const spectator2 = new Client("Spectator2");
    await spectator2.connect();
    spectator2.send({ type: "login", payload: { name: "Spectator2" } });
    const welcomeS2 = await spectator2.waitForType("welcome");
    spectator2.id = welcomeS2.id;
    spectator2.send({ type: "spectateRoom", payload: { roomId: ROOM_ID } });
    const roomPayload2 = await spectator2.waitForType("room");
    assert(!!roomPayload2, "Second spectator joins full room");

    // --- Test 5.5: Spectator chat ---
    console.log("\n[Test 5.5] Spectator can chat with 👁 prefix");

    // Player1 listens for chat
    const chatPromise = player1.waitForType("chat", 3000);

    // Spectator2 sends chat
    spectator2.send({ type: "chat", payload: { message: "Hello from spectator!" } });

    try {
        const chatPayload = await chatPromise;
        assert(!!chatPayload, "Chat message received by player");
        assert(chatPayload.from.includes("👁"), `Chat name has 👁 prefix (got: "${chatPayload.from}")`);
        assert(chatPayload.message === "Hello from spectator!", "Chat message content is correct");
    } catch {
        assert(false, "Chat message not received (timeout)");
    }

    // --- Test 6: Spectator leaves and lobby updates ---
    console.log("\n[Test 6] Spectator leaves room");
    spectator.send({ type: "leaveRoom" });
    const lobbyAfterLeave = await spectator.waitForType("lobby");
    assert(!!lobbyAfterLeave, "Spectator returned to lobby");

    // Check spectatorCount updated
    const roomInLobby = lobbyAfterLeave.rooms?.find((r: any) => r.id === ROOM_ID);
    if (roomInLobby) {
        assert(roomInLobby.spectatorCount === 1, `Spectator count is 1 after one spectator left (got ${roomInLobby.spectatorCount})`);
    }

    // --- Cleanup ---
    console.log("\n[Cleanup] Disconnecting all clients...");
    player1.close();
    player2.close();
    player3.close();
    player4.close();
    spectator.close();
    spectator2.close();

    // --- Summary ---
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
