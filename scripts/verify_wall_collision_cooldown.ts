import { WebSocket } from 'ws';

type ServerMsg = { type: string; payload?: any };

const PORT = process.env.PORT || 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runTest() {
    console.log("Starting Wall Collision Cooldown Verification...");

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
                    myCooldownUntil = p.nextActionAt || 0;
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
        ws.send(JSON.stringify({ type: "login", payload: { name: "WallCDTest" } }));
    });
    await loginPromise;

    // 2. Create Room (alpha map)
    const roomPromise = new Promise<void>(resolve => {
        const handler = (data: any) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === "room") {
                ws.removeListener('message', handler);
                resolve();
            }
        };
        ws.on('message', handler);
        ws.send(JSON.stringify({ type: "createRoom", payload: { roomId: "wall_cd_test", mapId: "alpha" } }));
        setTimeout(() => {
            ws.send(JSON.stringify({ type: "joinRoom", payload: { roomId: "wall_cd_test" } }));
        }, 200);
    });
    await roomPromise;

    await sleep(2000); // initial wait

    console.log(`Initial Pos: (${myPos.x}, ${myPos.y})`);

    // alpha map target
    // wall is at x=600, w=60, y=200, h=440
    // so x=600 ~ 660, y=200 ~ 640 is a wall.
    // If we start at (120, 520), moving to (700, 520) should hit the wall.
    const targetPos = { x: 700, y: myPos.y };
    console.log(`\nMoving into wall at Target: (${targetPos.x}, ${targetPos.y})`);

    ws.send(JSON.stringify({ type: "move", payload: { target: targetPos } }));

    // Wait and check cooldown
    let hitWall = false;
    let lastX = myPos.x;
    for (let i = 0; i < 40; i++) {
        await sleep(100);
        if (myPos.x > 300 && myPos.x === lastX) {
            // Stopped moving and not at target
            console.log(`Stopped at (${myPos.x}, ${myPos.y}) - Hit wall?`);
            hitWall = true;
            break;
        }
        lastX = myPos.x;
    }

    await sleep(200); // Allow server state to settle

    const now = Date.now();
    const cd = myCooldownUntil - now;
    console.log(`Wall Collision Cooldown Remaining: ${cd}ms`);

    if (cd <= 400) {
        console.warn(`⚠️ Cooldown is too short! Got ${cd}ms. Expected normal penalty (1500+).`);
    } else {
        console.log(`✅ Cooldown is reasonable. Got ${cd}ms.`);
    }

    ws.close();
    process.exit(0);
}

runTest().catch(console.error);
