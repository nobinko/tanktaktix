
import { WebSocket } from 'ws';

type ServerMsg = { type: string; payload?: any };

const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;
const ROOM_ID = "test_game_end";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runTest() {
    console.log("Starting Game End Verification...");

    // Client 1 (Creator)
    const ws1 = new WebSocket(WS_URL);
    await new Promise<void>(r => ws1.on('open', r));
    ws1.send(JSON.stringify({ type: "login", payload: { name: "P1_Creator" } }));
    await new Promise<void>(r => ws1.once('message', r));

    // Create Room with 10s limit
    console.log("[P1] Creating Room with 10s Time Limit...");
    ws1.send(JSON.stringify({
        type: "createRoom",
        payload: {
            roomId: ROOM_ID,
            name: "Game End Test",
            timeLimitSec: 10
        }
    }));
    await new Promise<void>(r => ws1.once('message', r));

    // Client 2 (Joiner)
    const ws2 = new WebSocket(WS_URL);
    await new Promise<void>(r => ws2.on('open', r));
    ws2.send(JSON.stringify({ type: "login", payload: { name: "P2_Joiner" } }));
    await new Promise<void>(r => ws2.once('message', r));
    ws2.send(JSON.stringify({ type: "joinRoom", payload: { roomId: ROOM_ID } }));

    // Monitor for gameEnd
    console.log("Waiting for Game End (approx 10s)...");

    const endGamePromise = new Promise<any>(resolve => {
        const handler = (data: any) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === "gameEnd") {
                resolve(msg.payload);
            }
        };
        ws2.on('message', handler);
    });

    // Wait for it
    const result = await Promise.race([
        endGamePromise,
        sleep(15000).then(() => "TIMEOUT")
    ]);

    if (result === "TIMEOUT") {
        console.error("❌ Game End Verification Timed Out!");
    } else {
        console.log("✅ Game End Received!");
        console.log("Winner:", result.winners);
        console.log("Results count:", result.results.length);
        if (result.winners === "draw") {
            console.log("✅ Correctly identified Draw (0-0).");
        } else {
            console.log(`⚠️ Winner is ${result.winners} (Unexpected for 0-0)`);
        }
    }

    ws1.close();
    ws2.close();
}

runTest();
