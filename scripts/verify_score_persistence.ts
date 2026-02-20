/**
 * verify_score_persistence.ts
 *
 * Verifies that score/kills/deaths persist across respawns and are only reset
 * on initial room join.
 *
 * Tests:
 *   1. Stats start at 0 on initial join
 *   2. Kills/score accumulate for the shooter after each kill
 *   3. Deaths accumulate for the target after each death
 *   4. Stats do NOT reset to 0 after respawn
 *
 * Map "alpha" walls (avoid these for clear line-of-fire):
 *   - x=300-340, y=150-370
 *   - x=560-600, y=150-370
 *   - x=100-200, y=100-140
 *   - x=700-800, y=380-420
 *
 * Strategy: both players positioned at y=440 (below all vertical walls).
 * Shooter at x≈300, Target at x≈700 → clear horizontal line of fire (400px).
 * Target stays EAST of the x=560-600 wall across both kills to avoid the
 * bullet path clipping the wall when Target respawns in the upper-east area.
 */

import { WebSocket } from "ws";
import { ServerToClientMessage, ClientToServerMessage, PlayerSummary } from "@tanktaktix/shared";

const PORT = 3000;
const URL = `ws://127.0.0.1:${PORT}/ws`;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const roomId = `test-score-${Date.now()}`;
let myIdA = "";
let myIdB = "";
let stateA: PlayerSummary | undefined;
let stateB: PlayerSummary | undefined;

function connect(name: string): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL);
    ws.once("open", () => ws.send(JSON.stringify({ type: "login", payload: { name } })));
    ws.once("message", (data) => {
      const msg = JSON.parse(data.toString()) as ServerToClientMessage;
      if (msg.type === "welcome") {
        if (name === "Shooter") myIdA = msg.payload.id;
        if (name === "Target")  myIdB = msg.payload.id;
        resolve(ws);
      }
    });
  });
}

function sendMsg(ws: WebSocket, msg: ClientToServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  console.log(`  ${ok ? "✅" : "❌"} ${label}: ${ok ? actual : `got ${actual}, expected ${expected}`}`);
}

function pos(s: PlayerSummary | undefined) {
  const p = (s as any)?.position;
  return p ? `(${p.x.toFixed(0)},${p.y.toFixed(0)})` : "(?)";
}

/** Move to target, wait for arrival + cooldown */
async function moveTo(ws: WebSocket, x: number, y: number, waitMs = 4000) {
  sendMsg(ws, { type: "move", payload: { target: { x, y } } });
  await sleep(waitMs);
}

/** Shoot at Target's current position. Returns true when Target's deaths reaches expectedDeaths. */
async function killTarget(wsA: WebSocket, expectedDeaths: number): Promise<boolean> {
  for (let attempt = 0; attempt < 15; attempt++) {
    if ((stateB?.deaths ?? 0) >= expectedDeaths) return true;

    const ax = (stateA as any)?.position?.x ?? 0;
    const ay = (stateA as any)?.position?.y ?? 0;
    const bx = (stateB as any)?.position?.x ?? 0;
    const by = (stateB as any)?.position?.y ?? 0;
    const dx = bx - ax;
    const dy = by - ay;
    const dist = Math.hypot(dx, dy);

    const dir = dist > 0 ? { x: dx / dist, y: dy / dist } : { x: 1, y: 0 };
    sendMsg(wsA, { type: "shoot", payload: { direction: dir } });
    console.log(`  [shot ${attempt + 1}] A${pos(stateA)} → B${pos(stateB)} dist=${dist.toFixed(0)}px  B.hp=${stateB?.hp}  B.deaths=${stateB?.deaths}`);
    await sleep(1900); // shoot cooldown 1800ms + buffer
  }
  return (stateB?.deaths ?? 0) >= expectedDeaths;
}

async function runTest() {
  console.log("=== Score Persistence Verification ===\n");

  const wsA = await connect("Shooter");
  const wsB = await connect("Target");
  await sleep(200);

  wsA.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as ServerToClientMessage;
    if (msg.type === "room") stateA = msg.payload.players.find(p => p.id === myIdA);
  });
  wsB.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as ServerToClientMessage;
    if (msg.type === "room") stateB = msg.payload.players.find(p => p.id === myIdB);
  });

  // Create & join room
  sendMsg(wsA, {
    type: "createRoom",
    payload: { roomId, name: "ScoreTest", mapId: "alpha", maxPlayers: 2, timeLimitSec: 300 }
  });
  await sleep(300);
  sendMsg(wsA, { type: "joinRoom", payload: { roomId } });
  sendMsg(wsB, { type: "joinRoom", payload: { roomId } });

  await new Promise<void>((resolve, reject) => {
    let n = 0;
    const iv = setInterval(() => {
      if (stateA && stateB) { clearInterval(iv); resolve(); }
      if (++n > 100) { clearInterval(iv); reject(new Error("Timeout: room sync")); }
    }, 50);
  });

  console.log(`Spawned: Shooter${pos(stateA)} team=${(stateA as any)?.team}  Target${pos(stateB)} team=${(stateB as any)?.team}\n`);

  // ── Test 1: Initial stats are 0 ──────────────────────────────────────────
  console.log("[Test 1] Initial stats on join");
  check("Shooter score",  stateA!.score,  0);
  check("Shooter kills",  stateA!.kills,  0);
  check("Shooter deaths", stateA!.deaths, 0);
  check("Target score",   stateB!.score,  0);
  check("Target deaths",  stateB!.deaths, 0);

  // ── Position both at y=440 (below all walls) ─────────────────────────────
  // Use two moves to bridge the gap from spawn positions
  console.log("\nPositioning to clear-LOS zone (y=440)...");
  await moveTo(wsA, 200, 440, 5000);
  await moveTo(wsB, 700, 440, 5000);
  await moveTo(wsA, 300, 440, 4000);
  // Target stays at (700, 440) — east of the x=560-600 wall
  console.log(`Positioned: Shooter${pos(stateA)}  Target${pos(stateB)}`);

  // ── Test 2: First kill ───────────────────────────────────────────────────
  console.log("\n[Test 2] After 1st kill of Target");
  const killed1 = await killTarget(wsA, 1);
  await sleep(500);
  if (!killed1) console.log("  ⚠️  1st kill not confirmed within shot limit");
  check("Shooter kills after 1st kill",  stateA!.kills,  1);
  check("Shooter score after 1st kill",  stateA!.score,  1);
  check("Target deaths after 1st kill",  stateB!.deaths, 1);
  const killsAfter1  = stateA!.kills;
  const deathsAfter1 = stateB!.deaths;

  // ── Realign after respawn ────────────────────────────────────────────────
  await sleep(2000); // respawn CD (1500ms invincibility + buffer)
  console.log("\nRealigning...");
  await moveTo(wsA, 300, 440, 3000);
  // Move Target back to (700,440) — blue spawns are upper-east, direct path clear
  await moveTo(wsB, 700, 440, 6000);
  console.log(`Realigned: Shooter${pos(stateA)}  Target${pos(stateB)}`);

  // ── Test 3: Second kill — stats must accumulate ──────────────────────────
  console.log("\n[Test 3] After 2nd kill — stats must accumulate, not reset");
  const killed2 = await killTarget(wsA, deathsAfter1 + 1);
  await sleep(500);
  if (!killed2) console.log("  ⚠️  2nd kill not confirmed within shot limit");
  check("Shooter kills after 2nd kill (expected 2)", stateA!.kills,  killsAfter1 + 1);
  check("Shooter score after 2nd kill (expected 2)", stateA!.score,  killsAfter1 + 1);
  check("Target deaths after 2nd kill (expected 2)", stateB!.deaths, deathsAfter1 + 1);

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log("\n=== Final State ===");
  console.log(`  Shooter — kills: ${stateA!.kills}, score: ${stateA!.score}, deaths: ${stateA!.deaths}`);
  console.log(`  Target  — kills: ${stateB!.kills}, score: ${stateB!.score}, deaths: ${stateB!.deaths}`);

  wsA.close();
  wsB.close();
  console.log("\nScore Persistence Verification Complete.");
}

runTest().catch(console.error);
