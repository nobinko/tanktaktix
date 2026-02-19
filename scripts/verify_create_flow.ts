
import { WebSocket } from 'ws';

type ServerMsg = { type: string; payload?: any };

const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;

async function runTest() {
    console.log("Starting Room Creation Flow Verification...");
    const ws = new WebSocket(WS_URL);

    let state = "CONNECTING";
    let roomId = "";

    ws.on('open', () => {
        console.log("Connected.");
        ws.send(JSON.stringify({ type: "login", payload: { name: "FlowTester" } }));
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as ServerMsg;
        console.log(`[RCV] ${msg.type}`);

        if (msg.type === "welcome") {
            // Expected
        } else if (msg.type === "lobby") {
            if (state === "CONNECTING") {
                state = "LOBBY_INIT";
                // Create Room
                console.log("Creating Room...");
                ws.send(JSON.stringify({ type: "createRoom", payload: { roomId: "flow_test", name: "Flow Test" } }));
                state = "CREATING";
            } else if (state === "CREATING") {
                console.log("Received 'lobby' update after creation request.");
            } else if (state === "IN_ROOM") {
                console.log("Received 'lobby' update while in room. (This is normal, but client must ignore)");
            }
        } else if (msg.type === "room") {
            if (state === "CREATING" || state === "LOBBY_INIT") {
                console.log("✅ Received 'room' message. Joining success.");
                state = "IN_ROOM";
                roomId = msg.payload.roomId;
            } else {
                console.log(`Received 'room' message in state ${state}`);
            }
        }
    });

    // Wait 2 seconds then close
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log("Test Finished.");
    ws.close();
}

runTest();
