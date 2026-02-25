import { WebSocket } from 'ws';

const PORT = process.env.PORT || 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runTest() {
    console.log("Starting New Obstacles Verification (epsilon)...");

    const ws = new WebSocket(WS_URL);
    let myId = "";
    let myPos = { x: 0, y: 0 };
    let myCooldownUntil = 0;
    let myMoveQueueLen = 0;
    let bullets: any[] = [];
    let explosions: any[] = [];

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.type === "room") {
                const p = msg.payload.players?.find((x: any) => x.id === myId);
                if (p) {
                    myPos = { x: p.x, y: p.y };
                    myCooldownUntil = p.nextActionAt || 0;
                    myMoveQueueLen = p.moveQueue?.length || 0;
                }
                bullets = msg.payload.bullets || [];
                if (msg.payload.explosions) {
                    explosions.push(...msg.payload.explosions);
                }
            } else if (msg.type === "explosion") {
                explosions.push(msg.payload);
            }
        } catch (e) { }
    });

    await new Promise<void>(resolve => ws.on('open', resolve));

    // 1. Login
    ws.send(JSON.stringify({ type: "login", payload: { name: "TestBot" } }));
    await new Promise<void>(resolve => {
        const h = (d: any) => { if (JSON.parse(d).type === "welcome") { myId = JSON.parse(d).payload.id; ws.off('message', h); resolve(); } };
        ws.on('message', h);
    });

    // 2. Create and Join Room (epsilon map)
    const testRoomId = `epsilon_test_${Date.now()}`;
    ws.send(JSON.stringify({ type: "createRoom", payload: { roomId: testRoomId, mapId: "epsilon" } }));
    await sleep(200);
    ws.send(JSON.stringify({ type: "joinRoom", payload: { roomId: testRoomId } }));

    await sleep(3500); // 3 seconds invincibility/cooldown wait

    async function moveTo(tx: number, ty: number, timeoutSecs: number = 8) {
        let loops = timeoutSecs * 10;
        ws.send(JSON.stringify({ type: "move", payload: { target: { x: tx, y: ty } } }));
        for (let i = 0; i < loops; i++) {
            await sleep(100);
            const dist = Math.hypot(myPos.x - tx, myPos.y - ty);
            if (dist < 10) return;
            if (i % 15 === 0) ws.send(JSON.stringify({ type: "move", payload: { target: { x: tx, y: ty } } }));
        }
    }

    async function waitCooldown() {
        // First wait for tank to completely stop
        while (myMoveQueueLen > 0) {
            await sleep(100);
        }
        await sleep(500); // Wait for the final tick to clear p.isMoving and set cooldown

        while (Date.now() < myCooldownUntil) {
            await sleep(100);
        }
        await sleep(200); // extra safety
    }

    // Test 1: Hit House
    console.log("\nTest 1: Move to House and shoot");
    await moveTo(150, 400); // Route around
    await moveTo(270, 380); // Rest a bit below house
    console.log(`Pos: ${myPos.x}, ${myPos.y}. Waiting for cooldown...`);
    await waitCooldown();

    explosions = [];
    ws.send(JSON.stringify({ type: "shoot", payload: { direction: { x: 0, y: -1 } } }));
    await sleep(800);

    // It should hit the house near y=340
    let hitHouse = explosions.some(e => e.y >= 310 && e.y <= 360 && e.x >= 200 && e.x <= 340);
    if (hitHouse) console.log("✅ House blocked the bullet.");
    else {
        console.warn("❌ House failed to block the bullet.");
        console.log("Explosions: ", explosions);
    }

    // Test 2: Oneway Wall (up)
    console.log("\nTest 2: Oneway Wall (up) from bottom");
    await moveTo(150, 850); // Navigate around the oneway wall's side
    await moveTo(250, 860); // Get underneath the UP-oneway
    console.log(`Pos: ${myPos.x}, ${myPos.y}. Waiting for cooldown...`);
    await waitCooldown();

    explosions = [];
    ws.send(JSON.stringify({ type: "shoot", payload: { direction: { x: 0, y: -1 } } }));
    await sleep(800);

    // Bullet should go UP and NOT explode at 800-820.
    let hitOneway1 = explosions.some(e => e.y >= 790 && e.y <= 830 && e.x >= 200 && e.x <= 300);
    if (!hitOneway1) console.log("✅ Bullet passed through Oneway moving matching direction.");
    else {
        console.warn("❌ Bullet erroneously blocked by Oneway!");
        console.log("Explosions: ", explosions);
    }

    // Test 3: Oneway Wall (blocked direction)
    console.log("\nTest 3: Oneway Wall (up) from top");
    await moveTo(150, 860); // Go left to clear the wall first
    await moveTo(150, 750); // Navigate around the oneway wall's side
    await moveTo(250, 750); // Get above the UP-oneway
    console.log(`Pos: ${myPos.x}, ${myPos.y}. Waiting for cooldown...`);
    await waitCooldown();

    explosions = [];
    ws.send(JSON.stringify({ type: "shoot", payload: { direction: { x: 0, y: 1 } } }));
    await sleep(800);

    // Bullet should shoot DOWN and hit the UP-oneway at y=800
    let hitOneway2 = explosions.some(e => e.y >= 790 && e.y <= 810 && e.x >= 200 && e.x <= 300);
    if (hitOneway2) console.log("✅ Oneway blocked the bullet from wrong direction.");
    else {
        console.warn("❌ Oneway failed to block the bullet from wrong direction.");
        console.log("Explosions: ", explosions);
    }

    console.log("\nVerification Complete.");
    process.exit(0);
}

runTest().catch(console.error);
