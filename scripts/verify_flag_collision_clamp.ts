
import { WebSocket } from 'ws';

const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;
const ROOM_ID = "test_flag_" + Math.random().toString(36).substring(7);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runTest() {
    console.log("Starting Flag Collision Verification...");
    const ws = new WebSocket(WS_URL);

    let state: any = null;
    let selfId: string = "";

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.type === "welcome") {
                selfId = msg.payload.id;
            }
            if (msg.type === "room") {
                state = msg.payload;
            }
        } catch (e) { }
    });

    await new Promise<void>(r => ws.on('open', r));
    ws.send(JSON.stringify({ type: "login", payload: { name: "FlagTester" } }));

    // Wait for selfId
    while (!selfId) await sleep(100);

    console.log("Creating CTF Room...");
    ws.send(JSON.stringify({
        type: "createRoom",
        payload: { roomId: ROOM_ID, name: "Flag Test Room", timeLimitSec: 60, mapId: "test-s", gameMode: "ctf" }
    }));
    await sleep(500);

    console.log("Joining Room...");
    ws.send(JSON.stringify({ type: "joinRoom", payload: { roomId: ROOM_ID } }));

    while (!state || !state.players.find((p: any) => p.id === selfId)) await sleep(100);

    const self = state.players.find((p: any) => p.id === selfId);
    console.log(`Team: ${self.team}`);

    const enemyFlag = state.flags.find((f: any) => f.team !== self.team);
    console.log(`Enemy flag at (${enemyFlag.x}, ${enemyFlag.y})`);

    // Move to flag
    console.log("Moving to flag...");
    ws.send(JSON.stringify({
        type: "move",
        payload: { target: { x: enemyFlag.x, y: enemyFlag.y } }
    }));

    let clamped = false;
    let pickedUp = false;
    let lastPos = { x: self.x, y: self.y };

    for (let i = 0; i < 200; i++) {
        await sleep(50);
        const currentSelf = state.players.find((p: any) => p.id === selfId);
        if (!currentSelf) continue;

        const distToFlag = Math.hypot(currentSelf.x - enemyFlag.x, currentSelf.y - enemyFlag.y);

        // Check if carrying
        const flag = state.flags.find((f: any) => f.team !== currentSelf.team);
        if (flag.carrierId === selfId) {
            if (!pickedUp) {
                console.log(`✅ Flag picked up! Dist: ${distToFlag.toFixed(1)}`);
                pickedUp = true;
            }
        }

        const isStandingStill = currentSelf.x === lastPos.x && currentSelf.y === lastPos.y;
        if (isStandingStill && distToFlag < 50) {
            if (currentSelf.nextActionAt > Date.now()) {
                if (!clamped) {
                    console.log(`✅ Movement clamped at flag! Dist: ${distToFlag.toFixed(1)}`);
                    clamped = true;
                }
            }
        }

        lastPos = { x: currentSelf.x, y: currentSelf.y };
        if (clamped && pickedUp) break;
    }

    if (clamped && pickedUp) {
        console.log("🎉 SUCCESS: Flag Clamp and Pickup verified!");
    } else {
        console.error("❌ Test failed:");
        console.log(`- Clamped: ${clamped}`);
        console.log(`- Picked Up: ${pickedUp}`);
    }

    ws.close();
}

runTest();
