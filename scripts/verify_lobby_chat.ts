
import { WebSocket } from 'ws';

type ServerMsg = { type: string; payload?: any };

const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runTest() {
    console.log("Starting Lobby Chat Verification...");

    // Client A
    const wsA = new WebSocket(WS_URL);
    let idA = "";
    const msgsA: ServerMsg[] = [];

    // Client B
    const wsB = new WebSocket(WS_URL);
    let idB = "";
    const msgsB: ServerMsg[] = [];

    // Setup A
    wsA.on('open', () => {
        wsA.send(JSON.stringify({ type: "login", payload: { name: "Alice" } }));
    });
    wsA.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as ServerMsg;
        msgsA.push(msg);
        if (msg.type === "welcome") idA = msg.payload.id;
        if (msg.type === "lobby") {
            // console.log("A received lobby update", msg.payload.onlinePlayers);
        }
    });

    // Setup B
    wsB.on('open', () => {
        wsB.send(JSON.stringify({ type: "login", payload: { name: "Bob" } }));
    });
    wsB.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as ServerMsg;
        msgsB.push(msg);
        if (msg.type === "welcome") idB = msg.payload.id;
    });

    console.log("Waiting for connections...");
    await sleep(1000);

    // Verify Lobby List (Alice should see Bob, Bob should see Alice)
    // Trigger a lobby update by requesting it or waiting for broadcast (login triggers broadcast?)
    // Actually login triggers 'joinLobby' which triggers 'broadcastLobby'.

    // Check Alice's last lobby message
    const lastLobbyA = msgsA.filter(m => m.type === "lobby").pop();
    if (!lastLobbyA || !lastLobbyA.payload.onlinePlayers) {
        console.error("❌ Alice did not receive lobby update with onlinePlayers");
    } else {
        const players = lastLobbyA.payload.onlinePlayers as { id: string, name: string }[];
        const bobFound = players.find(p => p.name === "Bob");
        if (bobFound) console.log("✅ Alice sees Bob in lobby.");
        else console.error("❌ Alice DOES NOT see Bob in lobby.", players);
    }

    // Verify Chat (Alice sends to Lobby)
    console.log("Alice sending lobby chat...");
    wsA.send(JSON.stringify({ type: "chat", payload: { message: "Hello Lobby!" } }));

    await sleep(500);

    // Check if Bob received it
    const chatB = msgsB.find(m => m.type === "chat" && m.payload.message === "Hello Lobby!");
    if (chatB) {
        console.log("✅ Bob received lobby chat from Alice.");
    } else {
        console.error("❌ Bob did NOT receive lobby chat.");
    }

    wsA.close();
    wsB.close();
}

runTest();
