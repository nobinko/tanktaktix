
const WebSocket = require('ws');

// Define minimal types for verification
const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

class TestClient {
    constructor(name) {
        this.name = name;
        this.messages = [];
        this.id = "";
        this.ws = new WebSocket(WS_URL);

        this.ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'welcome') {
                this.id = msg.payload.id;
                console.log(`[${this.name}] Connected, ID: ${this.id}`);
            }
            this.messages.push(msg);
            // specific check for gameEnd
            if (msg.type === 'gameEnd') {
                console.log(`[${this.name}] ⚠️ RECEIVED gameEnd for Room: ${msg.payload.roomId}`);
            }
        });

        this.ws.on('open', () => {
            console.log(`[${this.name}] WS Open`);
            this.send({ type: "login", payload: { name: this.name } });
        });

        this.ws.on('error', (e) => console.error(`[${this.name}] Error:`, e));
        this.ws.on('close', () => console.log(`[${this.name}] Closed`));
    }

    send(msg) {
        if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(msg));
        } else {
            console.warn(`[${this.name}] Cannot send, state: ${this.ws.readyState}`);
        }
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

    // Now B leaves room1
    console.log("B is leaving Room1 (Returning to Lobby)...");
    clientB.send({ type: "leaveRoom" });

    await sleep(500);

    // Verify B is back in lobby (should receive 'lobby' message)
    const lobbyMsg = clientB.messages.find(m => m.type === 'lobby');
    // Note: connecting gives verify_broadcast.js also 'lobby', need to check latest one?
    // Just check if last message is lobby
    const lastMsg = clientB.messages[clientB.messages.length - 1];
    if (lastMsg && lastMsg.type === 'lobby') {
        console.log("✅ B received lobby message (Left room successfully)");
    } else {
        console.warn("⚠️ B last message is not lobby, but might have received it.");
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
        process.exit(1);
    } else {
        console.log("✅ SUCCESS: Client B did NOT receive gameEnd message.");
    }

    // Cleanup
    clientA.close();
    clientB.close();
    process.exit(0);
}

runTest().catch(console.error);
