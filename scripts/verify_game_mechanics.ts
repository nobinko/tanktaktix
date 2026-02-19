
import { WebSocket } from 'ws';

type ServerMsg = { type: string; payload?: any };

const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runTest() {
    console.log("Starting Comprehensive Game Mechanics Verification...");

    const ws = new WebSocket(WS_URL);
    let myId = "";
    let myState: any = null;
    let roomState: any = null;

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString()) as ServerMsg;
            if (msg.type === "room") {
                roomState = msg.payload;
                const p = msg.payload.players?.find((x: any) => x.id === myId);
                if (p) {
                    myState = p;
                }
            }
        } catch (e) { }
    });

    const openPromise = new Promise<void>(resolve => ws.on('open', resolve));
    await openPromise;
    console.log("[1/6] Connected to Server.");

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
        ws.send(JSON.stringify({ type: "login", payload: { name: "MechTester" } }));
    });
    await loginPromise;
    console.log(`[2/6] Logged in as ${myId}.`);

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
        ws.send(JSON.stringify({ type: "createRoom", payload: { roomId: "mech_test", name: "Mech Test Room" } }));
    });
    await roomPromise;
    console.log("[3/6] Room Created.");

    await sleep(500);

    // 3. Check Initial Stats
    if (myState && myState.hp === 100 && myState.ammo === 20) {
        console.log("✅ Initial Stats OK (HP:100, Ammo:20).");
    } else {
        console.error("❌ Initial Stats Failed:", myState);
    }

    // Move to open area (Y=450)
    ws.send(JSON.stringify({ type: "move", payload: { target: { x: myState.x, y: 450 } } }));
    await sleep(2000);

    const startPos = { ...myState };
    console.log(`Start Pos for Move Tests: (${startPos.x.toFixed(1)}, ${startPos.y.toFixed(1)})`);

    // 4. Short Move Test (Expect 5 steps)
    console.log("\n[Test: Short Move]");
    ws.send(JSON.stringify({ type: "move", payload: { target: { x: startPos.x + 100, y: startPos.y } } }));
    // Wait for start of cooldown
    await sleep(1000); // arrive (~800ms) + buffer
    if (myState.actionLockStep === 5) {
        console.log("✅ Short Move Step Count: 5 (Correct)");
    } else {
        console.log(`⚠️ Short Move Step Count: ${myState.actionLockStep} (Expected 5)`);
    }
    // Wait for cooldown end (Short move 1.5s + Travel ~1s = 2.5s needed)
    await sleep(4000);

    // 5. Long Move Test (Expect 7 steps)
    console.log("\n[Test: Long Move]");
    const longTarget = { x: myState.x + 250, y: myState.y };
    ws.send(JSON.stringify({ type: "move", payload: { target: longTarget } }));

    // Poll for step count
    let sawSeven = false;
    const checkInterval = setInterval(() => {
        if (myState && myState.actionLockStep === 7) sawSeven = true;
    }, 100);

    // Travel ~2.5s + Cooldown 2.1s = 4.6s needed.
    // Wait 6000ms to be safe and catch the '7'
    await sleep(6000);
    clearInterval(checkInterval);

    if (sawSeven) {
        console.log("✅ Long Move Step Count: Saw 7 (Correct)");
    } else {
        console.log(`⚠️ Long Move Step Count: Never saw 7. Last: ${myState?.actionLockStep}`);
    }
    // Extra buffer for cooldown to fully clear
    await sleep(2000);

    // 6. Shooting Test (Expect 6 steps)
    console.log("\n[Test: Shooting]");
    const beforeAmmo = myState.ammo;
    ws.send(JSON.stringify({ type: "shoot", payload: { target: { x: myState.x + 100, y: myState.y } } }));
    await sleep(200); // Wait for processing

    if (myState.actionLockStep === 6) {
        console.log("✅ Shooting Step Count: 6 (Correct)");
    } else {
        console.log(`⚠️ Shooting Step Count: ${myState.actionLockStep} (Expected 6)`);
    }

    if (myState.ammo === beforeAmmo - 1) {
        console.log("✅ Ammo Decremented (Correct)");
    } else {
        console.error(`❌ Ammo Failed: ${beforeAmmo} -> ${myState.ammo}`);
    }

    // Check for bullet
    if (roomState.bullets && roomState.bullets.some((b: any) => b.shooterId === myId)) {
        console.log("✅ Bullet Created (Correct)");
    } else {
        console.error("❌ No Bullet Found");
    }

    // 7. Wall Collision Test
    console.log("\n[Test: Wall Collision]");
    // Map 'alpha' has a wall at x=300, y=150.
    // Or we can just try to drive out of bounds?
    // Let's drive to X = -100.
    ws.send(JSON.stringify({ type: "move", payload: { target: { x: -100, y: myState.y } } }));
    await sleep(2000);

    if (myState.x >= 0) {
        console.log(`✅ Wall/Bound Collision: Stopped at X=${myState.x.toFixed(1)} (>= 0)`);
    } else {
        console.error(`❌ Wall Collision Failed: Exited map at X=${myState.x}`);
    }

    console.log("\nAll Tests Completed.");
    ws.close();
}

runTest();
