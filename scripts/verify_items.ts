
import { WebSocket } from 'ws';

type ServerMsg = { type: string; payload?: any };

const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;
const ROOM_ID = "test_items";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runTest() {
    console.log("Starting Item System Verification...");

    // Client 1 (Creator/Tester)
    const ws = new WebSocket(WS_URL);
    await new Promise<void>(r => ws.on('open', r));
    ws.send(JSON.stringify({ type: "login", payload: { name: "ItemTester" } }));

    // Wait for welcome
    await new Promise<void>(r => ws.once('message', data => {
        console.log("Logged in:", JSON.parse(data.toString()).payload.id);
        r();
    }));

    // Create Room with short time limit
    console.log("Creating Room...");
    ws.send(JSON.stringify({
        type: "createRoom",
        payload: {
            roomId: ROOM_ID,
            name: "Item Test Room",
            timeLimitSec: 60
        }
    }));
    await sleep(500);

    // Join Room
    console.log("Joining Room...");
    ws.send(JSON.stringify({ type: "joinRoom", payload: { roomId: ROOM_ID } }));

    // Wait for first room state
    let state: any = null;
    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === "room") {
            state = msg.payload;
        }
    });

    console.log("Waiting for Room state...");
    while (!state) await sleep(100);

    // Force player to have low HP and Ammo for testing
    // Note: We can't force server state directly via WS easily if it's not a debug command,
    // but we can WAIT for an item to spawn, then move to it.

    console.log("Waiting for an item to spawn (interval is 10s)...");
    let itemFound = null;
    let attempts = 0;
    while (!itemFound && attempts < 200) {
        if (state.items && state.items.length > 0) {
            itemFound = state.items[0];
            break;
        }
        await sleep(100);
        attempts++;
    }

    if (!itemFound) {
        console.error("❌ No items spawned after 20s!");
        ws.close();
        return;
    }

    console.log(`✅ Item spawned: ${itemFound.type} at (${itemFound.x.toFixed(1)}, ${itemFound.y.toFixed(1)})`);

    // Move to item
    console.log("Moving to item position...");
    ws.send(JSON.stringify({
        type: "move",
        payload: { target: { x: itemFound.x, y: itemFound.y } }
    }));

    // Wait for pickup (item should disappear from state)
    console.log("Checking if item is picked up...");
    let pickedUp = false;
    let pickupAttempts = 0;
    while (!pickedUp && pickupAttempts < 50) {
        if (state.items && !state.items.find((it: any) => it.id === itemFound.id)) {
            pickedUp = true;
            break;
        }
        await sleep(100);
        pickupAttempts++;
    }

    if (pickedUp) {
        console.log("✅ Item successfully picked up (disappeared from state)!");
        // Check player stats
        const self = state.players.find((p: any) => p.id === state.selfId);
        if (itemFound.type === "medic") {
            console.log(`Player HP: ${self.hp} (Initially 100, might not change if full)`);
        } else {
            console.log(`Player Ammo: ${self.ammo} (Should be > 20 if ammo picked)`);
        }
    } else {
        console.error("❌ Item was not picked up!");
    }

    ws.close();
}

runTest();
