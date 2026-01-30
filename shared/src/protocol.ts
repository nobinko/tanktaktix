export type MessageType =
  | "HELLO"
  | "WELCOME"
  | "LOBBY_STATE"
  | "JOIN"
  | "ROOM_STATE"
  | "ERROR"
  | "PING"
  | "PONG";

export type Envelope<TPayload = unknown> = {
  t: MessageType;
  v: number;
  sid: string;
  seq: number;
  ts: number;
  p: TPayload;
};

export type ErrorPayload = {
  code: string;
  message: string;
};

export type HelloPayload = {
  name: string;
};

export type LobbyStatePayload = {
  online: number;
};

export type RoomStatePayload = {
  roomId: string;
  players: string[];
};
