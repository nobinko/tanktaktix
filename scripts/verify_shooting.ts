
import { WebSocket } from 'ws';

type ServerMsg = { type: string; payload?: any };

const PORT = 3000;
const WS_URL = `ws://localhost:${PORT}/ws`;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runTest() {
    console.log("Starting Shooting Verification (A-5)...");

    const ws = new WebSocket(WS_URL);
    let myId = "";
    let myAmmo = 0;
    let bulletCount = 0;

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data.toString()) as ServerMsg;
            if (msg.type === "room") {
                const p = msg.payload.players?.find((x: any) => x.id === myId);
                if (p) {
                    myAmmo = p.ammo;
                }
                bulletCount = (msg.payload.bullets ?? []).length;
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
        ws.send(JSON.stringify({ type: "login", payload: { name: "Shooter" } }));
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
        ws.send(JSON.stringify({ type: "createRoom", payload: { roomId: "shoot_test", name: "Shoot Test" } }));
    });
    await roomPromise;

    await sleep(500);
    const initialAmmo = myAmmo;
    console.log(`Initial Ammo: ${initialAmmo}, Bullets on map: ${bulletCount}`);

    // 3. Shoot
    console.log("Firing shot (North)...");
    ws.send(JSON.stringify({ type: "shoot", payload: { direction: { x: 0, y: -1 } } }));

    // Wait for update (100ms)
    await sleep(100);

    if (myAmmo === initialAmmo - 1) {
        console.log(`✅ Ammo decreased: ${initialAmmo} -> ${myAmmo}`);
    } else {
        console.error(`❌ Ammo Check Failed: ${initialAmmo} -> ${myAmmo}`);
    }

    if (bulletCount > 0) {
        console.log(`✅ Bullet spawned: count=${bulletCount}`);
    } else {
        console.error(`❌ Bullet Check Failed: count=${bulletCount}`);
    }

    // 4. Wait for bullet to expire or hit wall
    // Speed 220, Range 600 -> Life ~2.7s
    console.log("Waiting for bullet to travel/expire (3s)...");
    await sleep(3000);

    if (bulletCount === 0) {
        console.log(`✅ Bullet removed (expired/hit).`);
    } else {
        console.warn(`⚠️ Bullet still exists? count=${bulletCount}`);
    }

    ws.close();
    process.exit(0);
}

runTest().catch(console.error);
