import { WebSocket } from 'ws';

const URL = 'ws://localhost:3000/ws';
// 毎回ユニークなルームIDを使用
const ROOM_ID = 'reconn-test-' + Math.random().toString(36).slice(2, 7);

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function testReconnect() {
    console.log("Starting Reconnection Verification...");

    // 1. First connection
    const ws1 = new WebSocket(URL);
    let id = "";
    let initialState: any = null;

    ws1.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'welcome') id = msg.payload.id;
        if (msg.type === 'room') initialState = msg.payload;
    });

    await sleep(500);
    ws1.send(JSON.stringify({ type: 'login', payload: { name: 'Reconn_Tester' } }));
    await sleep(200);
    ws1.send(JSON.stringify({ type: 'createRoom', payload: { roomId: ROOM_ID, mapId: 'alpha' } }));
    await sleep(200);
    ws1.send(JSON.stringify({ type: 'joinRoom', payload: { roomId: ROOM_ID } }));
    await sleep(500);

    if (!initialState) {
        console.error("❌ FAILURE: Failed to enter room.");
        process.exit(1);
    }
    const myHp = initialState.players.find((p: any) => p.id === id)?.hp;
    console.log(`Joined room ${ROOM_ID}. Initial HP: ${myHp}`);

    // 2. Disconnect
    console.log("Disconnecting Client 1...");
    ws1.close();
    await sleep(1000);

    // 3. Reconnect with same ID
    console.log(`Reconnecting with ID: ${id}...`);
    const ws2 = new WebSocket(URL);
    let reWelcomeId = "";
    let reRoomState: any = null;

    ws2.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'welcome') reWelcomeId = msg.payload.id;
        if (msg.type === 'room') reRoomState = msg.payload;
    });

    await sleep(500);
    // Send the saved ID in login payload
    ws2.send(JSON.stringify({ type: 'login', payload: { name: 'Reconn_Tester', id: id } }));

    // Wait for room state broadcast
    for (let i = 0; i < 15; i++) {
        await sleep(200);
        if (reRoomState) break;
    }

    if (reWelcomeId === id && reRoomState) {
        console.log("✅ SUCCESS: Reclaimed session and returned to room!");
        const me = reRoomState.players.find((p: any) => p.id === id);
        if (me) {
            console.log(`Verified HP in reconnected state: ${me.hp}`);
            if (me.hp === myHp) console.log("✅ SUCCESS: HP (state) is consistent!");
        } else {
            console.error("❌ FAILURE: Reconnected but my player not found in room state.");
        }
    } else {
        console.error(`❌ FAILURE: Could not reclaim session. reWelcomeId=${reWelcomeId}, roomState=${reRoomState ? 'OK' : 'MISSING'}`);
        process.exit(1);
    }

    ws2.close();
    console.log("Reconnection test finished.");
}

testReconnect().catch(console.error);
