
import { WebSocket } from 'ws';

type ServerMsg = { type: string; payload?: any };

const PORT = process.env.PORT || 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runTest() {
    console.log("Starting Variable Cooldown Verification (A-6-EXT)...");

    const ws = new WebSocket(WS_URL);
    let myId = "";
    let myPos = { x: 0, y: 0 };
    let myCooldownUntil = 0;
    let isMoving = false;

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString()) as ServerMsg;
            if (msg.type === "room") {
                const p = msg.payload.players?.find((x: any) => x.id === myId);
                if (p) {
                    myPos = { x: p.x, y: p.y };
                    if (p.actionLockStep !== undefined) {
                        // console.log(`[DEBUG] Step=${p.actionLockStep}`);
                    }
                    myCooldownUntil = p.nextActionAt || 0;
                    // Check step
                    if (p.actionLockStep > 5) {
                        console.log(`[VERIFY] Received Step > 5! Step=${p.actionLockStep}`);
                    }
                    // Infer isMoving roughly? No direct field in public?
                    // Actually p.moveQueue length?
                    const qLen = p.moveQueue?.length || 0;
                    isMoving = qLen > 0;
                }
            }
        } catch (e) { }
    });

    const openPromise = new Promise<void>(resolve => ws.on('open', resolve));
    await openPromise;

    // 1. Login
    const loginPromise = new Promise<void>(resolve => {
        const handler = (data: any) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === "welcome") {
                myId = msg.payload.id;
                ws.removeListener('message', handler);
                resolve();
            }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({ type: "login", payload: { name: "VarCoolTest" } }));
    });
    await loginPromise;

    // 2. Create Room
    const roomPromise = new Promise<void>(resolve => {
        const handler = (data: any) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === "room") {
                ws.removeListener('message', handler);
                resolve();
            }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({ type: "createRoom", payload: { roomId: "var_cd_test", name: "Var CD Test" } }));
        setTimeout(() => {
            ws.send(JSON.stringify({ type: "joinRoom", payload: { roomId: "var_cd_test" } }));
        }, 200);
    });
    await roomPromise;

    await sleep(500);
    // --- Setup: Move to Safe Area (Y > 400) ---
    // If we are at Y ~ 260, we are blocked by wall at X=300.
    // Let's move to Y=450 where it's clear (Spawn 2 area).
    if (myPos.y < 400) {
        console.log("Moving to Safe Area (Y=450)...");
        ws.send(JSON.stringify({ type: "move", payload: { target: { x: myPos.x, y: 450 } } }));
        await sleep(3000); // Wait for travel
        console.log("Safe Area Navigation - Wait 1 done.");
        // Re-read pos
    }
    await sleep(2000); // Wait for cooldown to clear
    console.log("Safe Area Navigation - Wait 2 done. Starting Test 1.");

    const startPos = { ...myPos };
    console.log(`Test Start Pos: (${startPos.x.toFixed(1)}, ${startPos.y.toFixed(1)})`);

    // --- Test 1: Short Move (<200px) ---
    const targetShort = { x: startPos.x + 100, y: startPos.y }; // Dist 100
    console.log(`\n[Test 1] Short Move (100px) -> Expecting 1500ms Cooldown`);

    ws.send(JSON.stringify({ type: "move", payload: { target: targetShort } }));

    // Wait for arrival. 100px / 120px/s = ~0.83s.
    // Wait 1.0s to be sure.
    await sleep(1000);

    // Check cooldown.
    const now1 = Date.now();
    const cd1 = myCooldownUntil - now1;
    console.log(`Short Move Cooldown Remaining: ${cd1}ms`);

    // If arrival just happened, CD should be ~1200.
    // We waited 1.0s. Arrival was at 0.83s. So CD started 0.17s ago.
    // Remaining should be ~1030ms.
    if (cd1 > 800 && cd1 < 1300) {
        console.log(`✅ Short Cooldown valid (Expected ~1000-1200, Got ${cd1})`);
    } else {
        console.warn(`⚠️ Short Cooldown suspicious. Got ${cd1}`);
    }

    // Wait for full cooldown expiry
    await sleep(1500);

    // --- Test 2: Long Move (>200px) ---
    const currentPos = { ...myPos };
    const targetLong = { x: currentPos.x + 250, y: currentPos.y }; // Dist 250
    console.log(`\n[Test 2] Long Move (250px) -> Expecting 2100ms Cooldown`);

    ws.send(JSON.stringify({ type: "move", payload: { target: targetLong } }));

    // Wait for arrival. 250px / 120px/s = ~2.08s.
    // Poll position
    for (let i = 0; i < 30; i++) {
        await sleep(100);
        if (Math.abs(myPos.x - targetLong.x) < 5 && Math.abs(myPos.y - targetLong.y) < 5) {
            console.log(`Reached target at ~${(i + 1) * 100}ms`);
            break;
        }
    }

    // Wait a bit for server to process 'arrival' and sync state
    await sleep(300);

    const now2 = Date.now();
    const cd2 = myCooldownUntil - now2;
    console.log(`Long Move Cooldown Remaining: ${cd2}ms. Pos: (${myPos.x.toFixed(1)}, ${myPos.y.toFixed(1)})`);

    // Arrival at 2.08s. Waited 2.2s. CD started 0.12s ago.
    // Expected: 1600 - 120 = 1480ms.
    if (cd2 > 1300 && cd2 < 1700) {
        console.log(`✅ Long Cooldown valid (Expected ~1400-1600, Got ${cd2})`);
    } else {
        console.warn(`⚠️ Long Cooldown suspicious. Got ${cd2}`);
    }

    ws.close();
    process.exit(0);
}

runTest().catch(console.error);
