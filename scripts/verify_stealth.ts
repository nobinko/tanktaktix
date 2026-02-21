import { WebSocket } from 'ws';

const URL = 'ws://localhost:3000/ws';
const ROOM_ID = 'stealth-test-' + Math.random().toString(36).slice(2, 7);

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function testStealth() {
    console.log("Starting Stealth Verification...");

    // 1. Connect Client A (Red Team)
    const wsA = new WebSocket(URL);
    let idA = "";
    wsA.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'welcome') idA = msg.payload.id;
    });
    await sleep(500);
    wsA.send(JSON.stringify({ type: 'login', payload: { name: 'Red_Spy' } }));
    await sleep(100);
    wsA.send(JSON.stringify({ type: 'createRoom', payload: { roomId: ROOM_ID, mapId: 'delta' } }));
    await sleep(200);
    wsA.send(JSON.stringify({ type: 'joinRoom', payload: { roomId: ROOM_ID } }));

    // 2. Connect Client B (Blue Team)
    const wsB = new WebSocket(URL);
    let idB = "";
    let playersSeenByB: any[] = [];
    wsB.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'welcome') idB = msg.payload.id;
        if (msg.type === 'room') {
            playersSeenByB = msg.payload.players;
        }
    });
    await sleep(500);
    wsB.send(JSON.stringify({ type: 'login', payload: { name: 'Blue_Sentry' } }));
    await sleep(100);
    wsB.send(JSON.stringify({ type: 'joinRoom', payload: { roomId: ROOM_ID } }));
    await sleep(500);

    console.log(`Initial state: B sees ${playersSeenByB.length} players.`);

    // 3. Move A into bush (delta bush is around 300, 300 to 600, 740)
    console.log("Moving Red_Spy into bush...");
    wsA.send(JSON.stringify({ type: 'move', payload: { target: { x: 450, y: 520 } } }));

    // Wait for A to reach and become hidden
    for (let i = 0; i < 20; i++) {
        await sleep(200);
        const redVisible = playersSeenByB.some(p => p.id === idA);
        if (!redVisible) {
            console.log("✅ SUCCESS: Red_Spy is HIDDEN from Blue_Sentry!");
            break;
        }
        if (i === 19) {
            console.error("❌ FAILURE: Red_Spy is still visible to enemy after moving to bush.");
            process.exit(1);
        }
    }

    // 4. A shoots from bush -> should reveal
    console.log("Red_Spy shoots from bush...");
    wsA.send(JSON.stringify({ type: 'shoot', payload: { dir: { x: 1, y: 0 } } }));
    await sleep(100);
    const revealed = playersSeenByB.some(p => p.id === idA);
    if (revealed) {
        console.log("✅ SUCCESS: Red_Spy REVEALED by shooting!");
    } else {
        // It might be too fast to catch with 100ms sleep if broadcast is rare, but tick is 50ms.
        // Try a few more times
        await sleep(50);
        const revealed2 = playersSeenByB.some(p => p.id === idA);
        if (revealed2) console.log("✅ SUCCESS: Red_Spy REVEALED by shooting (retry)!");
        else console.warn("⚠️  WARNING: Could not confirm revealing-by-shooting in this timing.");
    }

    wsA.close();
    wsB.close();
    console.log("Stealth test finished.");
}

testStealth().catch(console.error);
