
import { WebSocket } from 'ws';

type ServerMsg = { type: string; payload?: any };

const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runTest() {
    console.log("Starting Lobby Full Verification...");

    // Client A (Creator)
    const wsA = new WebSocket(WS_URL);
    let idA = "";
    const msgsA: ServerMsg[] = [];

    // Client B (Joiner)
    const wsB = new WebSocket(WS_URL);
    let idB = "";
    const msgsB: ServerMsg[] = [];

    // Setup A
    wsA.on('open', () => {
        wsA.send(JSON.stringify({ type: "login", payload: { name: "Creator" } }));
    });
    wsA.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as ServerMsg;
        msgsA.push(msg);
        if (msg.type === "welcome") idA = msg.payload.id;
    });

    // Setup B
    wsB.on('open', () => {
        wsB.send(JSON.stringify({ type: "login", payload: { name: "Joiner" } }));
    });
    wsB.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as ServerMsg;
        msgsB.push(msg);
        if (msg.type === "welcome") idB = msg.payload.id;
    });

    console.log("Waiting for connections...");
    await sleep(1000);

    // 1. A Creates Room
    const roomId = `room_${Date.now()}`;
    console.log(`Creator creating room: ${roomId}`);
    wsA.send(JSON.stringify({
        type: "createRoom",
        payload: { roomId, name: "Test Room", maxPlayers: 4, timeLimitSec: 240 }
    }));

    await sleep(500);

    // 2. B Checks Lobby for Room
    const lobbyMsgB = msgsB.filter(m => m.type === "lobby").pop();
    if (!lobbyMsgB) {
        console.error("❌ Joiner did not receive lobby update.");
    } else {
        const rooms = lobbyMsgB.payload.rooms as any[];
        const found = rooms.find(r => r.id === roomId);
        if (found) console.log("✅ Joiner sees the created room.");
        else console.error("❌ Joiner does NOT see the created room.", rooms.map(r => r.id));
    }

    // 3. B Joins Room
    console.log(`Joiner joining room: ${roomId}`);
    wsB.send(JSON.stringify({ type: "joinRoom", payload: { roomId } }));

    await sleep(500);

    // 4. Verify B received 'room' state (Successful Join)
    const roomMsgB = msgsB.find(m => m.type === "room" && m.payload.roomId === roomId);
    if (roomMsgB) {
        console.log("✅ Joiner received room state. Join Successful.");
        // Client-side logic would switch screen here.
    } else {
        console.error("❌ Joiner did NOT receive room state.");
    }

    wsA.close();
    wsB.close();
}

runTest();
