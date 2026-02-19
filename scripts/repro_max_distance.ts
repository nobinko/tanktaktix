
import { WebSocket } from 'ws';

type ServerMsg = { type: string; payload?: any };

const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runTest() {
    console.log("Starting Max Distance Verification (Wall-Avoidance Mode)...");

    const ws = new WebSocket(WS_URL);
    let myId = "";
    let myPos = { x: 0, y: 0 };
    let isMoving = false;

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString()) as ServerMsg;
            if (msg.type === "room") {
                const p = msg.payload.players?.find((x: any) => x.id === myId);
                if (p) {
                    myPos = { x: p.x, y: p.y };
                    // Determine if server thinks we are moving (useful for wait logic)
                    // But payload might not have isMoving? Let's check proto.
                    // The public payload usually doesn't expose isMoving directly unless added.
                    // We can infer from position changes, but let's just wait.
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
        ws.send(JSON.stringify({ type: "login", payload: { name: "WallDodger" } }));
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
        ws.send(JSON.stringify({ type: "createRoom", payload: { roomId: "dist_safe", name: "Safe Dist Test" } }));
    });
    await roomPromise;

    await sleep(500);

    // 3. Move to safe start position (100, 50) - Y=50 is free of walls
    console.log("Relocating to safe start (100, 50)...");
    ws.send(JSON.stringify({ type: "move", payload: { target: { x: 100, y: 50 } } }));

    // Wait enough time to reach there (max dist ~1000px / 120 = 9s)
    await sleep(8000);
    console.log("Relocated Position:", myPos);

    // 4. Move far away along Y=50
    const startPos = { ...myPos };
    const target = { x: 800, y: 50 }; // Distance ~700 from (100,50)

    console.log(`Commanding LONG move to: (${target.x}, ${target.y})`);
    ws.send(JSON.stringify({ type: "move", payload: { target } }));

    // Wait 6 seconds (should cover ~700px if no limit)
    console.log("Waiting for movement (6s)...");
    await sleep(6000);

    const finalPos = { ...myPos };
    console.log("Final Position:", finalPos);

    const dist = Math.sqrt(Math.pow(finalPos.x - startPos.x, 2) + Math.pow(finalPos.y - startPos.y, 2));
    console.log("Total Distance Moved:", dist);

    // Check
    const MAX_LIMIT = 350;
    if (dist > MAX_LIMIT) {
        console.error(`❌ FAILURE: Moved ${dist.toFixed(1)}px > ${MAX_LIMIT}px. No limit enforced.`);
    } else {
        console.log(`✅ SUCCESS: Moved ${dist.toFixed(1)}px. Limit enforced.`);
    }

    ws.close();
    process.exit(0);
}

runTest().catch(console.error);
