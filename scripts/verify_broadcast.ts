
import { WebSocket } from 'ws';
import path from 'path';

// Define minimal types for verification
type ClientMsg = { type: string; payload?: any };
type ServerMsg = { type: string; payload?: any };

const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class TestClient {
    ws: WebSocket;
    messages: ServerMsg[] = [];
    id: string = "";
    name: string;

    constructor(name: string) {
        this.name = name;
        this.ws = new WebSocket(WS_URL);
        this.ws.on('message', (data) => {
            const msg = JSON.parse(data.toString()) as ServerMsg;
            if (msg.type === 'welcome') {
                this.id = msg.payload.id;
                console.log(`[${this.name}] Connected, ID: ${this.id}`);
            }
            this.messages.push(msg);
            // specific check for gameEnd
            if (msg.type === 'gameEnd') {
                console.log(`[${this.name}] ⚠️ RECEIVED gameEnd for Room: ${msg.payload.roomId}`);
            }
            if (msg.type === 'room') {
                // console.log(`[${this.name}] Received Room State update`);
            }
        });

        this.ws.on('open', () => {
            this.send({ type: "login", payload: { name: this.name } });
        });
    }

    send(msg: ClientMsg) {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        }
    }

    async waitForMessage(type: string, timeoutMs = 2000): Promise<ServerMsg | null> {
        const end = Date.now() + timeoutMs;
        while (Date.now() < end) {
            const found = this.messages.find(m => m.type === type);
            if (found) return found;
            await sleep(100);
        }
        return null;
    }

    clearMessages() {
        this.messages = [];
    }

    close() {
        this.ws.close();
    }
}

async function runTest() {
    console.log("Starting Verification Test for Game Result Broadcast...");

    const clientA = new TestClient("ClientA");
    const clientB = new TestClient("ClientB");

    // Wait for connection
    await sleep(1000);

    // Client A creates Room "Room1"
    console.log("A is creating Room1...");
    clientA.send({
        type: "createRoom",
        payload: {
            roomId: "room1",
            name: "Room 1",
            maxPlayers: 4,
            timeLimitSec: 5 // Short game for testing
        }
    });

    await sleep(500);

    // Client B joins Room1
    console.log("B is joining Room1...");
    clientB.send({
        type: "joinRoom",
        payload: { roomId: "room1" }
    });

    await sleep(500);

    // Verify both are in room (A should see B in room state)
    // We can assume join worked if no error.

    // Now B leaves room1
    console.log("B is leaving Room1 (Returning to Lobby)...");
    clientB.send({ type: "leaveRoom" });

    await sleep(500);

    // Verify B is back in lobby (should receive 'lobby' message)
    const lobbyMsg = clientB.messages.find(m => m.type === 'lobby');
    if (lobbyMsg) {
        console.log("✅ B received lobby message (Left room successfully)");
    } else {
        console.error("❌ B did not receive lobby message!");
    }

    clientB.clearMessages(); // Clear history to check for NEW messages

    // Wait for game end in Room1 (A is still there)
    console.log("Waiting for Game End in Room1 (approx 5s)...");

    // To ensure game ends, we wait > timeLimitSec
    await sleep(6000);

    // Check if B received gameEnd message
    const broadcastLeak = clientB.messages.find(m => m.type === 'gameEnd');

    if (broadcastLeak) {
        console.error("❌ FAILURE: Client B received gameEnd message despite leaving the room!");
        console.error("Received payload:", JSON.stringify(broadcastLeak.payload, null, 2));
    } else {
        console.log("✅ SUCCESSS: Client B did NOT receive gameEnd message.");
    }

    // Cleanup
    clientA.close();
    clientB.close();
    process.exit(0);
}

runTest().catch(console.error);
