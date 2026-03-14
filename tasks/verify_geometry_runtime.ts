import { compileMapGeometry, type MapData } from "@tanktaktix/shared";
import { createRoom } from "../server/src/room.ts";
import { rooms } from "../server/src/state.ts";
import { checkWallCollision } from "../server/src/utils/collision.ts";
import { state } from "../client/src/state.ts";
import { drawWorld } from "../client/src/render/world.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

class MockContext {
  public arcCalls = 0;
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;
  font = "";
  textAlign: CanvasTextAlign = "left";
  textBaseline: CanvasTextBaseline = "alphabetic";

  clearRect() {}
  save() {}
  restore() {}
  translate() {}
  rotate() {}
  scale() {}
  fillRect() {}
  strokeRect() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  stroke() {}
  fill() {}
  clip() {}
  closePath() {}
  fillText() {}
  rect() {}
  arc() { this.arcCalls++; }
}

const mapData: MapData = {
  id: "verify-curve",
  width: 800,
  height: 600,
  walls: [],
  spawnPoints: [],
  objects: [
    { type: "river-elbow-mid-s", x: 300, y: 300 },
  ],
};

const geometry = compileMapGeometry(mapData);
const elbow = geometry.renderables.find((shape) => shape.kind === "ringSector");
assert(elbow, "ringSector was not generated for river elbow");
assert(geometry.blocking.some((shape) => shape.kind === "ringSector"), "ringSector was not included in blocking geometry");

assert(checkWallCollision(300, 300, 8, geometry) === true, "server collision did not hit river elbow geometry");
assert(checkWallCollision(300, 120, 8, geometry) === false, "server collision falsely hit outside river elbow geometry");

createRoom({
  roomName: "verify-curve",
  roomId: "verify-curve",
  mapId: "custom",
  customMapData: mapData,
  passwordProtected: false,
  maxPlayers: 2,
  timeLimitSec: 60,
  gameMode: "ctf",
  lobbyId: "default",
  hostId: "host",
});

const room = rooms.get("verify-curve");
assert(room, "room was not created");
assert(room.mapData.objects?.[0]?.type === "river-elbow-mid-s", "room mapData lost prefab object source");
assert(room.mapData.walls.length === 0, "room mapData was unexpectedly expanded into rectangle walls");
assert(room.geometry.renderables.some((shape) => shape.kind === "ringSector"), "room geometry did not retain ringSector");
rooms.delete("verify-curve");

state.mapData = mapData;
state.mapGeometry = geometry;
state.mapSize.width = mapData.width;
state.mapSize.height = mapData.height;
state.camera.x = 0;
state.camera.y = 0;
state.camera.zoom = 1;
state.camera.rotation = 0;

const ctx = new MockContext();
drawWorld(ctx as unknown as CanvasRenderingContext2D, { width: 800, height: 600 } as HTMLCanvasElement);
assert(ctx.arcCalls > 0, "client world renderer did not draw any arcs for ringSector terrain");

console.log("Geometry runtime verification passed");
