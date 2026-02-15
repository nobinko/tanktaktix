export type Vector2 = {
  x: number;
  y: number;
};

export type Team = "red" | "blue" | null;

export type Wall = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MapData = {
  id: string;
  width: number;
  height: number;
  walls: Wall[];
  spawnPoints: { team: Team; x: number; y: number }[];
};

export type PlayerSummary = {
  id: string;
  name: string;
  team: Team;
  roomId: string | null;
  position: Vector2;
  target: Vector2 | null;
  moveQueue: Vector2[];
  hp: number;
  ammo: number;
  score: number;
  deaths: number;
  nextActionAt: number;
  respawnAt: number | null;
};

export type RoomSummary = {
  id: string;
  name: string;
  mapId: string;
  mapData?: MapData; // simple way to sync map for now
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

export type Explosion = {
  id: string;
  x: number;
  y: number;
  radius: number;
  at: number;
};

export type RoomState = {
  roomId: string;
  players: PlayerSummary[];
  bullets: any[]; // keeping as any for now or define Bullet
  explosions: Explosion[];
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
      name: string;
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
  }
  | {
    type: "moveCancelOne";
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
    type: "explosion"; // Immediate event
    payload: Explosion;
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
