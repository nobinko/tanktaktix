export const WS_PROTOCOL_VERSION = 1;

export type Vector2 = {
  x: number;
  y: number;
};

export type PlayerSummary = {
  id: string;
  name: string;
  roomId: string | null;
  position?: Vector2;
  x?: number;
  y?: number;
  target?: Vector2 | null;
  hp: number;
  ammo: number;
  score: number;
  kills: number;
  deaths: number;
  nextActionAt?: number;
  respawnAt: number | null;
};

export type LeaderboardEntry = {
  id: string;
  name: string;
  score: number;
  kills: number;
  deaths: number;
};

export type RoomSummary = {
  id: string;
  name: string;
  roomName?: string;
  mapId: string;
  maxPlayers: number;
  timeLimitSec: number;
  passwordProtected: boolean;
  createdAt: number;
  endsAt: number;
  ended?: boolean;
  players: string[];
  playerCount?: number;
};

export type LobbyState = {
  rooms: RoomSummary[];
};

export type BulletSummary = {
  id: string;
  shooterId: string;
  position?: Vector2;
  x?: number;
  y?: number;
  radius: number;
};

export type RoomState = {
  roomId: string;
  roomName?: string;
  mapId?: string;
  timeLeftSec: number;
  timeLeft?: number;
  room?: RoomSummary | null;
  players: PlayerSummary[];
  bullets?: BulletSummary[];
  projectiles?: BulletSummary[];
};

export type ChatMessage = {
  from: string;
  message: string;
  timestamp: number;
};

export type ClientToServerMessage =
  | {
      v: 1;
      type: "login";
      payload: { name: string };
    }
  | {
      v: 1;
      type: "requestLobby";
    }
  | {
      v: 1;
      type: "createRoom";
      payload: {
        roomId?: string;
        name?: string;
        mapId?: string;
        maxPlayers?: number;
        timeLimitSec?: number;
        password?: string;
      };
    }
  | {
      v: 1;
      type: "joinRoom";
      payload: { roomId: string; password?: string };
    }
  | {
      v: 1;
      type: "leaveRoom";
    }
  | {
      v: 1;
      type: "leave";
    }
  | {
      v: 1;
      type: "stopMove";
    }
  | {
      v: 1;
      type: "aim";
      payload: { dir: Vector2 } | { direction: Vector2 } | Vector2;
    }
  | {
      v: 1;
      type: "chat";
      payload: { message: string };
    }
  | {
      v: 1;
      type: "move";
      payload: { target: Vector2 } | { dir: Vector2 } | { direction: Vector2 } | { x: number; y: number };
    }
  | {
      v: 1;
      type: "shoot";
      payload:
        | { direction: Vector2 }
        | { dir: Vector2 }
        | { target: Vector2 }
        | { angle: number }
        | Vector2;
    };

export type ServerToClientMessage =
  | {
      v: 1;
      type: "welcome";
      payload: { id: string };
    }
  | {
      v: 1;
      type: "lobby";
      payload: LobbyState;
    }
  | {
      v: 1;
      type: "room";
      payload: RoomState;
    }
  | {
      v: 1;
      type: "chat";
      payload: ChatMessage;
    }
  | {
      v: 1;
      type: "leaderboard";
      payload: { players: LeaderboardEntry[] };
    }
  | {
      v: 1;
      type: "error";
      payload: { message: string };
    };

type UnknownRecord = Record<string, any>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isString = (value: unknown): value is string => typeof value === "string";

const isVector2 = (value: unknown): value is Vector2 =>
  isRecord(value) && isNumber(value.x) && isNumber(value.y);

export const getProtocolVersion = (value: unknown): number | null => {
  if (!isRecord(value)) return null;
  if (value.v === undefined) return WS_PROTOCOL_VERSION;
  if (isNumber(value.v)) return value.v;
  return null;
};

const isOptionalString = (value: unknown): boolean =>
  value === undefined || value === null || isString(value);

const isOptionalNumber = (value: unknown): boolean =>
  value === undefined || value === null || isNumber(value);

const isOptionalVector2 = (value: unknown): boolean =>
  value === undefined || value === null || isVector2(value);

const isRoomSummary = (value: unknown): value is RoomSummary => {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.name) &&
    isString(value.mapId) &&
    isNumber(value.maxPlayers) &&
    isNumber(value.timeLimitSec) &&
    typeof value.passwordProtected === "boolean" &&
    isNumber(value.createdAt) &&
    isNumber(value.endsAt) &&
    Array.isArray(value.players)
  );
};

const isPlayerSummary = (value: unknown): value is PlayerSummary => {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.name) &&
    (value.roomId === null || isString(value.roomId)) &&
    isOptionalVector2(value.position) &&
    isOptionalVector2(value.target) &&
    (value.x === undefined || isNumber(value.x)) &&
    (value.y === undefined || isNumber(value.y)) &&
    isNumber(value.hp) &&
    isNumber(value.ammo) &&
    isNumber(value.score) &&
    isNumber(value.kills) &&
    isNumber(value.deaths) &&
    isOptionalNumber(value.nextActionAt) &&
    (value.respawnAt === null || isNumber(value.respawnAt))
  );
};

const isLeaderboardEntry = (value: unknown): value is LeaderboardEntry => {
  if (!isRecord(value)) return false;
  return (
    isString(value.id) &&
    isString(value.name) &&
    isNumber(value.score) &&
    isNumber(value.kills) &&
    isNumber(value.deaths)
  );
};

const isChatMessage = (value: unknown): value is ChatMessage => {
  if (!isRecord(value)) return false;
  return isString(value.from) && isString(value.message) && isNumber(value.timestamp);
};

const isRoomState = (value: unknown): value is RoomState => {
  if (!isRecord(value)) return false;
  if (!isString(value.roomId)) return false;
  if (!isNumber(value.timeLeftSec)) return false;
  if (!Array.isArray(value.players) || !value.players.every(isPlayerSummary)) return false;
  if (value.room !== undefined && value.room !== null && !isRoomSummary(value.room)) return false;
  return true;
};

export const isClientMessage = (value: unknown): value is ClientToServerMessage => {
  if (!isRecord(value)) return false;
  const version = getProtocolVersion(value);
  if (version !== WS_PROTOCOL_VERSION) return false;
  if (!isString(value.type)) return false;

  switch (value.type) {
    case "login":
      return isRecord(value.payload) && isString(value.payload.name);
    case "requestLobby":
      return value.payload === undefined || value.payload === null;
    case "createRoom":
      return (
        isRecord(value.payload) &&
        isOptionalString(value.payload.roomId) &&
        isOptionalString(value.payload.name) &&
        isOptionalString(value.payload.mapId) &&
        isOptionalNumber(value.payload.maxPlayers) &&
        isOptionalNumber(value.payload.timeLimitSec) &&
        isOptionalString(value.payload.password)
      );
    case "joinRoom":
      return isRecord(value.payload) && isString(value.payload.roomId) && isOptionalString(value.payload.password);
    case "leaveRoom":
    case "leave":
    case "stopMove":
      return value.payload === undefined || value.payload === null;
    case "aim": {
      const payload = value.payload;
      if (isVector2(payload)) return true;
      if (!isRecord(payload)) return false;
      if (payload.dir && isVector2(payload.dir)) return true;
      if (payload.direction && isVector2(payload.direction)) return true;
      return false;
    }
    case "chat":
      return isRecord(value.payload) && isString(value.payload.message);
    case "move": {
      const payload = value.payload;
      if (payload === undefined || payload === null) return true;
      if (!isRecord(payload)) return false;
      if (payload.target && isVector2(payload.target)) return true;
      if (payload.dir && isVector2(payload.dir)) return true;
      if (payload.direction && isVector2(payload.direction)) return true;
      if (isNumber(payload.x) && isNumber(payload.y)) return true;
      return false;
    }
    case "shoot": {
      const payload = value.payload;
      if (payload === undefined || payload === null) return true;
      if (isVector2(payload)) return true;
      if (!isRecord(payload)) return false;
      if (payload.direction && isVector2(payload.direction)) return true;
      if (payload.dir && isVector2(payload.dir)) return true;
      if (payload.target && isVector2(payload.target)) return true;
      if (isNumber(payload.angle)) return true;
      return false;
    }
    default:
      return false;
  }
};

export const isServerMessage = (value: unknown): value is ServerToClientMessage => {
  if (!isRecord(value)) return false;
  const version = getProtocolVersion(value);
  if (version !== WS_PROTOCOL_VERSION) return false;
  if (!isString(value.type)) return false;

  switch (value.type) {
    case "welcome":
      return isRecord(value.payload) && isString(value.payload.id);
    case "lobby":
      return (
        isRecord(value.payload) &&
        Array.isArray(value.payload.rooms) &&
        value.payload.rooms.every(isRoomSummary)
      );
    case "room":
      return isRoomState(value.payload);
    case "chat":
      return isChatMessage(value.payload);
    case "leaderboard":
      return (
        isRecord(value.payload) &&
        Array.isArray(value.payload.players) &&
        value.payload.players.every(isLeaderboardEntry)
      );
    case "error":
      return isRecord(value.payload) && isString(value.payload.message);
    default:
      return false;
  }
};
