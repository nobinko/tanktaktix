import { WebSocket } from "ws";
import { ServerToClientMessage, ClientToServerMessage, PlayerSummary } from "@tanktaktix/shared";

const PORT = 3000;
const URL = `ws://127.0.0.1:${PORT}/ws`;

let wsA: WebSocket;
let wsB: WebSocket;

let myIdA: string = "";
let myIdB: string = "";

const roomId = `test-respawn-room-${Date.now()}`;

let resolvePromiseA: () => void;
let resolvePromiseB: () => void;

function connect(name: string): Promise<WebSocket> {
    return new Promise((resolve) => {
        const ws = new WebSocket(URL);
        ws.once("open", () => {
            ws.send(JSON.stringify({ type: "login", payload: { name } }));
        });

        let welcomed = false;
        ws.on("message", (data) => {
            const msg = JSON.parse(data.toString()) as ServerToClientMessage;
            if (msg.type === "welcome" && !welcomed) {
                welcomed = true;
                if (name === "PlayerA_Shooter") myIdA = msg.payload.id;
                if (name === "PlayerB_Target") myIdB = msg.payload.id;
                resolve(ws);
            }
        });
    });
}

function sendMsg(ws: WebSocket, msg: ClientToServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

async function runTest() {
    console.log("Starting Instant Respawn and CD Verification...");

    wsA = await connect("PlayerA_Shooter");
    wsB = await connect("PlayerB_Target");

    await new Promise(r => setTimeout(r, 200));

    let playerA_target: PlayerSummary | undefined;
    let playerB_target: PlayerSummary | undefined;

    let gotRoomA = false;
    let gotRoomB = false;

    wsA.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as ServerToClientMessage;
        console.log(`[wsA] Received: ${msg.type}`);
        if (msg.type === "error") {
            console.error(`[wsA] ERROR:`, msg.payload);
        }
        if (msg.type === "welcome") myIdA = msg.payload.id;
        if (msg.type === "room") {
            console.log(`[wsA] Room players: ${msg.payload.players.map(p => p.id)} vs myIdA=${myIdA}`);
            playerA_target = msg.payload.players.find(p => p.id === myIdA);
            gotRoomA = true;
        }
    });

    wsB.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as ServerToClientMessage;
        if (msg.type === "error") {
            console.error(`[wsB] ERROR:`, msg.payload);
        }
        if (msg.type === "welcome") myIdB = msg.payload.id;
        if (msg.type === "room") {
            console.log(`[wsB] Room players: ${msg.payload.players.map(p => p.id)} vs myIdB=${myIdB}`);
            playerB_target = msg.payload.players.find(p => p.id === myIdB);
            gotRoomB = true;
        }
    });

    await new Promise(r => setTimeout(r, 200));

    // Player A creates the room
    sendMsg(wsA, {
        type: "createRoom",
        payload: { roomId, name: "TestRespawn", mapId: "alpha", maxPlayers: 2, timeLimitSec: 60 }
    });

    await new Promise(r => setTimeout(r, 200));

    sendMsg(wsA, { type: "joinRoom", payload: { roomId } });
    sendMsg(wsB, { type: "joinRoom", payload: { roomId } });

    await new Promise((resolve, reject) => {
        let attempts = 0;
        const check = setInterval(() => {
            attempts++;
            if (gotRoomA && gotRoomB && playerA_target && playerB_target) {
                clearInterval(check);
                resolve(true);
            }
            if (attempts > 100) { // 5 seconds
                clearInterval(check);
                console.error(`[Setup] Timeout waiting for room sync. gotRoomA: ${gotRoomA}, gotRoomB: ${gotRoomB}, playerA: ${!!playerA_target}, playerB: ${!!playerB_target}`);
                reject(new Error("Timeout waiting for room."));
            }
        }, 50);
    });

    console.log(`[Setup] A at (${Math.round(playerA_target!.position.x)}, ${Math.round(playerA_target!.position.y)})`);
    console.log(`[Setup] B at (${Math.round(playerB_target!.position.x)}, ${Math.round(playerB_target!.position.y)})`);

    // Align positions to guarantee hits
    sendMsg(wsA, { type: "move", payload: { target: { x: 400, y: 300 } } });
    sendMsg(wsB, { type: "move", payload: { target: { x: 500, y: 300 } } });

    await new Promise(r => setTimeout(r, 2000)); // wait for move

    console.log(`[Aligned] A: ${Math.round(playerA_target!.position.x)}, HP: ${playerA_target!.hp}`);
    console.log(`[Aligned] B: ${Math.round(playerB_target!.position.x)}, HP: ${playerB_target!.hp}`);

    // 1. A shoots B to death (5 hits required for 100 HP, 20 each)
    console.log(`[Test] A shooting B until death...`);
    let shotCount = 0;
    while (playerB_target!.hp > 0 && shotCount < 15) {
        sendMsg(wsA, { type: "shoot", payload: { direction: { x: 1, y: 0 } } });
        shotCount++;
        // Wait 250ms for bullet flight + cooldown (actually cooldown is 1200ms usually, let's wait 1300ms)
        await new Promise(r => setTimeout(r, 1300));
    }

    await new Promise(r => setTimeout(r, 500));

    // Assert Instant Respawn
    let cdRemaining = (playerB_target!.respawnCooldownUntil ?? 0) - Date.now();
    console.log(`[Check 1] B HP: ${playerB_target!.hp}, CD Remaining: ${cdRemaining}ms`);
    if (playerB_target!.hp === 100 && cdRemaining > 0) {
        console.log("  => SUCCESS: B instantly respawned with HP 100 and has a cooldown.");
    } else {
        console.log("  => FAILED: Instant respawn behavior incorrect.");
    }

    // Record spawn point
    const bSpawnPos = { ...playerB_target!.position };

    // 2. Invincibility Check: A shoots B while B is in CD
    console.log(`[Test] A moves to B's spawn and shoots B during CD...`);
    // Move A to B's spawn point closely
    sendMsg(wsA, { type: "move", payload: { target: { x: bSpawnPos.x - 50, y: bSpawnPos.y } } });
    await new Promise(r => setTimeout(r, 200));

    sendMsg(wsA, { type: "shoot", payload: { direction: { x: 1, y: 0 } } });
    await new Promise(r => setTimeout(r, 500));

    console.log(`[Check 2] B HP after being shot during CD: ${playerB_target!.hp}`);
    if (playerB_target!.hp === 100) {
        console.log("  => SUCCESS: B is invincible during cooldown.");
    } else {
        console.log("  => FAILED: B took damage during cooldown.");
    }

    // 3. Reject Shooting Check: B tries to shoot A during CD
    console.log(`[Test] B attempts to shoot A during CD...`);
    const bAmmoBefore = playerB_target!.ammo;
    sendMsg(wsB, { type: "shoot", payload: { direction: { x: -1, y: 0 } } });
    await new Promise(r => setTimeout(r, 200));

    // Refetch latest B target state (since ammo might decrease locally on server before returning)
    console.log(`[Check 3] B Ammo after attempting to shoot: ${playerB_target!.ammo} (Expected: ${bAmmoBefore})`);
    if (playerB_target!.ammo === bAmmoBefore) {
        console.log("  => SUCCESS: B could not shoot during cooldown.");
    } else {
        console.log("  => FAILED: B shot during cooldown.");
    }

    // 4. Movement Queueing Check: B queues move during CD
    console.log(`[Test] B queues a move during CD...`);
    sendMsg(wsB, { type: "move", payload: { target: { x: bSpawnPos.x + 100, y: bSpawnPos.y } } });
    await new Promise(r => setTimeout(r, 200));

    console.log(`[Check 4a] B move queue length: ${playerB_target!.moveQueue.length}`);
    if (playerB_target!.moveQueue.length > 0) {
        console.log("  => SUCCESS: Movement was queued.");
    } else {
        console.log("  => FAILED: Movement was not queued.");
    }

    const posDuringCd = { ...playerB_target!.position };
    console.log(`[Check 4b] B position during CD: (${Math.round(posDuringCd.x)}, ${Math.round(posDuringCd.y)}) vs Spawn (${Math.round(bSpawnPos.x)}, ${Math.round(bSpawnPos.y)})`);
    if (Math.abs(posDuringCd.x - bSpawnPos.x) < 5 && Math.abs(posDuringCd.y - bSpawnPos.y) < 5) {
        console.log("  => SUCCESS: B did not move during CD.");
    } else {
        console.log("  => FAILED: B moved during CD.");
    }

    // Wait for CD to finish
    console.log(`Waiting for B's CD to finish...`);
    await new Promise(r => setTimeout(r, 1500));

    // Check if B's movement executes after CD
    await new Promise(r => setTimeout(r, 1000)); // wait for movement execution

    console.log(`[Check 4c] B position after CD ends: (${Math.round(playerB_target!.position.x)}, ${Math.round(playerB_target!.position.y)})`);
    if (Math.abs(playerB_target!.position.x - bSpawnPos.x) > 10) {
        console.log("  => SUCCESS: B executed queued movement after CD.");
    } else {
        console.log("  => FAILED: B did not execute queued movement.");
    }

    wsA.close();
    wsB.close();
    console.log("Instant Respawn Verification Complete.");
}

runTest().catch(console.error);
