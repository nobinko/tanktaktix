import type {
  BulletPublic,
  ChatMessage,
  Explosion,
  Flag,
  Item,
  MapData,
  PlayerSummary,
  RoomSummary,
  Vector2,
} from "@tanktaktix/shared";

export type Phase = "login" | "lobby" | "room";

export const state = {
  phase: "login" as Phase,
  selfId: "",
  name: "",
  rooms: [] as RoomSummary[],
  roomId: "" as string | "",
  players: [] as PlayerSummary[],
  timeLeftSec: 0,
  chat: [] as ChatMessage[],
  aiming: false,
  aimPoint: null as Vector2 | null,
  bullets: [] as BulletPublic[],
  explosions: [] as (Explosion & { startedAt: number })[],
  mapData: null as MapData | null,
  teamScores: { red: 0, blue: 0 } as { red: number; blue: number },
  camera: { x: 0, y: 0, zoom: 1, rotation: 0 },
  lobbyChat: [] as { from: string; message: string }[],
  onlinePlayers: [] as { id: string; name: string }[],
  items: [] as Item[],
  flags: [] as Flag[],
  isSpectator: false,
  lastHpMap: {} as Record<string, number>,
  hitFlashes: {} as Record<string, number>,
  floatingTexts: [] as { id: string; text: string; color: string; x: number; y: number; startedAt: number }[],
  particles: [] as { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: string }[],
  leavingRoomId: "",
};

export const keysDown = new Set<string>();
export const CAMERA_SPEED = 8;
export const ZOOM_STEP = 0.1;
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 3.0;
export const ROTATION_STEP = Math.PI / 36;

export const mapSize = { width: 1800, height: 1040 };
