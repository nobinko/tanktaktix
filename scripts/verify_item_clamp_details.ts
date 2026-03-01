
import { WebSocket } from 'ws';

const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;
const ROOM_ID = "test_clamp_" + Math.random().toString(36).substring(7);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runTest() {
    console.log("Starting Robust Item Collision Verification...");
    const ws = new WebSocket(WS_URL);

    let state: any = null;
    let selfId: string = "";
    let welcomeReceived = 0;

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            // console.log("Incoming:", msg.type);
            if (msg.type === "welcome") {
                selfId = msg.payload.id;
                welcomeReceived++;
            }
            if (msg.type === "room") {
                state = msg.payload;
            }
        } catch (e) {
            console.error("Parse error:", e);
        }
    });

    await new Promise<void>(r => ws.on('open', r));
    console.log("Connected. Sending login...");
    ws.send(JSON.stringify({ type: "login", payload: { name: "ClampTester" } }));

    // Wait for selfId
    console.log("Waiting for selfId...");
    while (!selfId) await sleep(100);
    console.log("Self ID:", selfId);

    console.log("Creating Room...");
    ws.send(JSON.stringify({
        type: "createRoom",
        payload: { roomId: ROOM_ID, name: "Clamp Test Room", timeLimitSec: 60, mapId: "test-s", gameMode: "deathmatch" }
    }));
    await sleep(500);

    console.log("Joining Room...");
    ws.send(JSON.stringify({ type: "joinRoom", payload: { roomId: ROOM_ID } }));

    console.log("Waiting for Room state...");
    while (!state || !state.players.find((p: any) => p.id === selfId)) await sleep(100);

    console.log("Waiting for an item to spawn...");
    let itemFound = null;
    let waitAttempts = 0;
    while (!itemFound && waitAttempts < 100) {
        if (state.items && state.items.length > 0) {
            itemFound = state.items[0];
            break;
        }
        await sleep(100);
        waitAttempts++;
    }

    if (!itemFound) {
        console.error("❌ No items found!");
        ws.close();
        return;
    }

    console.log(`✅ Item found: ${itemFound.type} at (${itemFound.x.toFixed(1)}, ${itemFound.y.toFixed(1)})`);

    let self = state.players.find((p: any) => p.id === selfId);
    console.log(`Starting pos: (${self.x.toFixed(1)}, ${self.y.toFixed(1)})`);

    // Move to item
    console.log("Sending move target...");
    ws.send(JSON.stringify({
        type: "move",
        payload: { target: { x: itemFound.x, y: itemFound.y } }
    }));

    let clamped = false;
    let pickedUp = false;
    let itemDisappeared = false;
    let cooldownStarted = false;
    let lastPos = { x: self.x, y: self.y };

    console.log("Monitoring movement...");
    for (let i = 0; i < 200; i++) {
        await sleep(50);
        self = state.players.find((p: any) => p.id === selfId);
        if (!self) continue;

        const distToItem = Math.hypot(self.x - itemFound.x, self.y - itemFound.y);

        if (!itemDisappeared && !state.items.find((it: any) => it.id === itemFound.id)) {
            console.log(`✅ Item ${itemFound.id} disappeared! Dist: ${distToItem.toFixed(1)}`);
            itemDisappeared = true;
            pickedUp = true;
        }

        const isStandingStill = self.x === lastPos.x && self.y === lastPos.y;
        if (isStandingStill && distToItem < 40) {
            // Check if cooldown is active
            if (self.nextActionAt > Date.now()) {
                if (!clamped) {
                    console.log(`✅ Movement clamped! Dist: ${distToItem.toFixed(1)}, Cooldown: ${self.nextActionAt - Date.now()}ms`);
                    clamped = true;
                    cooldownStarted = true;
                }
            }
        }

        lastPos = { x: self.x, y: self.y };
        if (clamped && pickedUp) break;
    }

    if (clamped && pickedUp) {
        console.log("🎉 SUCCESS: Clamp and Pickup verified!");
    } else {
        console.error("❌ Test failed:");
        console.log(`- Clamped: ${clamped}`);
        console.log(`- Picked Up: ${pickedUp}`);
    }

    ws.close();
}

runTest().catch(e => console.error("Test error:", e));
