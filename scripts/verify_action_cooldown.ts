
import { WebSocket } from 'ws';

type ServerMsg = { type: string; payload?: any };

const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runTest() {
    console.log("Starting Action Cooldown Verification (A-6)...");

    const ws = new WebSocket(WS_URL);
    let myId = "";
    let myAmmo = 0;
    let myPos = { x: 0, y: 0 };
    let myCooldownTarget = 0; // nextActionAt from server

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString()) as ServerMsg;
            if (msg.type === "room") {
                const p = msg.payload.players?.find((x: any) => x.id === myId);
                if (p) {
                    myAmmo = p.ammo;
                    myPos = { x: p.x, y: p.y };
                    myCooldownTarget = p.nextActionAt || 0;
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
        ws.send(JSON.stringify({ type: "login", payload: { name: "CooldownTest" } }));
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
        ws.send(JSON.stringify({ type: "createRoom", payload: { roomId: "cd_test", name: "Cooldown Test" } }));
    });
    await roomPromise;

    await sleep(500);
    const startAmmo = myAmmo;
    console.log(`Initial Ammo: ${startAmmo}`);

    // --- Test 1: Shoot -> Immediate Second Shoot (Should Fail) ---
    console.log("\n[Test 1] Rapid Fire Check");
    ws.send(JSON.stringify({ type: "shoot", payload: { direction: { x: 0, y: -1 } } }));
    await sleep(50); // very short delay
    ws.send(JSON.stringify({ type: "shoot", payload: { direction: { x: 0, y: -1 } } }));

    await sleep(100); // Wait for updates

    // Expecting ammo checks:
    // 1st shot succeeds (-1)
    // 2nd shot fails (queued or ignored? implementation says ignored if cooldown)
    // So ammo should be startAmmo - 1.

    if (myAmmo === startAmmo - 1) {
        console.log(`✅ Rapid Fire blocked correctly. Ammo: ${myAmmo} (Expected: ${startAmmo - 1})`);
    } else {
        console.error(`❌ Rapid Fire Check Failed. Ammo: ${myAmmo} (Expected: ${startAmmo - 1})`);
    }

    // --- Test 2: Shoot -> Immediate Move (Skipped to avoid queue side-effects) ---
    // We want to test pure cooldown expiry here.

    // --- Test 3: Wait -> Shoot (Should Success) ---
    console.log("\n[Test 3] Action after Cooldown expires");
    // We waited ~150ms in Test 1. Cooldown is 1200ms.
    // Need to wait > 1050ms.
    console.log("Waiting for cooldown (1.5s)...");
    await sleep(1500);

    const ammoBefore2 = myAmmo;
    ws.send(JSON.stringify({ type: "shoot", payload: { direction: { x: 0, y: -1 } } }));

    await sleep(200);

    if (myAmmo === ammoBefore2 - 1) {
        console.log(`✅ Action allowed after cooldown. Ammo: ${myAmmo}`);
    } else {
        console.error(`❌ Cooldown Expiry Check Failed. Ammo: ${myAmmo} (Expected: ${ammoBefore2 - 1})`);
    }

    // --- Test 4: Check if 'nextActionAt' is sent correctly ---
    console.log("\n[Test 4] Server sending valid nextActionAt timestamp");
    const now = Date.now();
    // We just shot 200ms ago. nextActionAt should be ~1000ms in future.
    const diff = myCooldownTarget - now;
    if (diff > 500 && diff < 1500) {
        console.log(`✅ nextActionAt seems valid. Time remaining: ${diff}ms`);
    } else {
        console.warn(`⚠️ nextActionAt might be off. Time remaining: ${diff}ms (Expected ~800-1000)`);
    }

    ws.close();
    process.exit(0);
}

runTest().catch(console.error);
