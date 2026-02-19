
import { WebSocket } from 'ws';

type ServerMsg = { type: string; payload?: any };

const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runTest() {
    console.log("Starting Manual Join Verification...");
    const ws = new WebSocket(WS_URL);

    ws.on('open', () => {
        console.log("Connected.");
        ws.send(JSON.stringify({ type: "login", payload: { name: "ManualJoiner" } }));
    });

    let receivedRoomMsg = false;
    let createdRoomId = "";

    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as ServerMsg;
        // console.log(`[RCV] ${msg.type}`);

        if (msg.type === "welcome") {
            // Create Room
            console.log("Creating Room 'manual_join_test'...");
            ws.send(JSON.stringify({ type: "createRoom", payload: { roomId: "manual_join_test", name: "Manual Join Test" } }));
        } else if (msg.type === "lobby") {
            // console.log("Received Lobby Update.");
            const room = msg.payload.rooms.find((r: any) => r.id === "manual_join_test");
            if (room) {
                createdRoomId = room.id;
            }
        } else if (msg.type === "room") {
            console.log("⚠️ Received 'room' message!");
            receivedRoomMsg = true;
        }
    });

    // Wait 2 seconds to ensure we do NOT get "room" message automatically
    console.log("Waiting 2s to check for auto-join...");
    await sleep(2000);

    if (receivedRoomMsg) {
        console.error("❌ Failed: Auto-joined room after creation!");
        ws.close();
        process.exit(1);
    } else {
        console.log("✅ Success: Did NOT auto-join room.");
    }

    if (!createdRoomId) {
        console.error("❌ Failed: Room was not found in lobby update!");
    } else {
        console.log("✅ Success: Room appeared in lobby.");

        // NOW Join manually
        console.log("Attempting manual join...");
        ws.send(JSON.stringify({ type: "joinRoom", payload: { roomId: "manual_join_test" } }));

        // Wait for room msg
        await sleep(1000);
        if (receivedRoomMsg) {
            console.log("✅ Success: Joined room manually.");
        } else {
            console.error("❌ Failed: Did not receive room message after manual join.");
        }
    }

    ws.close();
}

runTest();
