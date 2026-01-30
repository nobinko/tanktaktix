export type ClientMessageType =
  | "HELLO"
  | "CREATE_ROOM"
  | "JOIN_ROOM"
  | "LEAVE_ROOM"
  | "SET_TEAM"
  | "SET_READY"
  | "PING";

export type ServerMessageType =
  | "WELCOME"
  | "LOBBY_STATE"
  | "ROOM_STATE"
  | "ERROR"
  | "PONG";

export type MessageType = ClientMessageType | ServerMessageType;

export type Team = "A" | "B" | null;

export interface Envelope<T extends MessageType = MessageType, P = unknown> {
  type: T;
  payload: P;
}

export interface HelloPayload {
  name: string;
}

export interface WelcomePayload {
  sid: string;
  name: string;
}

export interface RoomCounts {
  total: number;
  a: number;
  b: number;
}

export interface RoomSummary {
  roomId: string;
  name: string;
  counts: RoomCounts;
  inProgress: boolean;
}

export interface LobbyStatePayload {
  rooms: RoomSummary[];
}

export interface CreateRoomPayload {
  name: string;
}

export interface JoinRoomPayload {
  roomId: string;
}

export interface LeaveRoomPayload {
  reason?: string;
}

export interface SetTeamPayload {
  team: Team;
}

export interface SetReadyPayload {
  ready: boolean;
}

export interface RoomPlayer {
  sid: string;
  name: string;
  team: Team;
  ready: boolean;
  joinedAt: number;
}

export interface RoomStatePayload {
  roomId: string;
  name: string;
  players: RoomPlayer[];
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface PingPayload {
  ts?: number;
}

export interface PongPayload {
  ts?: number;
}

export type ClientEnvelope =
  | Envelope<"HELLO", HelloPayload>
  | Envelope<"CREATE_ROOM", CreateRoomPayload>
  | Envelope<"JOIN_ROOM", JoinRoomPayload>
  | Envelope<"LEAVE_ROOM", LeaveRoomPayload>
  | Envelope<"SET_TEAM", SetTeamPayload>
  | Envelope<"SET_READY", SetReadyPayload>
  | Envelope<"PING", PingPayload>;

export type ServerEnvelope =
  | Envelope<"WELCOME", WelcomePayload>
  | Envelope<"LOBBY_STATE", LobbyStatePayload>
  | Envelope<"ROOM_STATE", RoomStatePayload>
  | Envelope<"ERROR", ErrorPayload>
  | Envelope<"PONG", PongPayload>;

export function parseEnvelope(payload: string): Envelope | null {
  try {
    const parsed = JSON.parse(payload) as Envelope;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (typeof parsed.type !== "string" || !("payload" in parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function formatEnvelope(message: Envelope): string {
  return JSON.stringify(message);
}
