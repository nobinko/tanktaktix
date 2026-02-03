export type Vector2 = {
  x: number;
  y: number;
};

export type PlayerSummary = {
  id: string;
  name: string;
  roomId: string | null;
  position: Vector2;
  target: Vector2 | null;
  hp: number;
  ammo: number;
  score: number;
  deaths: number;
  nextActionAt: number;
  respawnAt: number | null;
};

export type RoomSummary = {
  id: string;
  mapId: string;
  maxPlayers: number;
  timeLimitSec: number;
  passwordProtected: boolean;
  createdAt: number;
  endsAt: number;
  players: string[];
};

export type LobbyState = {
  rooms: RoomSummary[];
};

export type RoomState = {
  roomId: string;
  players: PlayerSummary[];
  timeLeftSec: number;
};

export type ChatMessage = {
  from: string;
  message: string;
  timestamp: number;
};

export type ClientToServerMessage =
  | {
      type: "login";
      payload: { name: string };
    }
  | {
      type: "requestLobby";
    }
  | {
      type: "createRoom";
      payload: {
        roomId: string;
        mapId: string;
        maxPlayers: number;
        timeLimitSec: number;
        password?: string;
      };
    }
  | {
      type: "joinRoom";
      payload: { roomId: string; password?: string };
    }
  | {
      type: "leaveRoom";
    }
  | {
      type: "chat";
      payload: { message: string };
    }
  | {
      type: "move";
      payload: { target: Vector2 };
    }
  | {
      type: "shoot";
      payload: { direction: Vector2 };
    };

export type ServerToClientMessage =
  | {
      type: "welcome";
      payload: { id: string };
    }
  | {
      type: "lobby";
      payload: LobbyState;
    }
  | {
      type: "room";
      payload: RoomState;
    }
  | {
      type: "chat";
      payload: ChatMessage;
    }
  | {
      type: "leaderboard";
      payload: { players: PlayerSummary[] };
    }
  | {
      type: "error";
      payload: { message: string };
    };
