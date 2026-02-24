export type Vector2 = {
  x: number;
  y: number;
};

export type Team = "red" | "blue" | null;
export type ItemType = "medic" | "ammo" | "heart" | "bomb" | "rope" | "boots";
export type WallType = "wall" | "bush" | "water";

export type Item = {
  id: string;
  x: number;
  y: number;
  type: ItemType;
  spawnedAt: number;
};

export type Wall = {
  x: number;
  y: number;
  width: number;
  height: number;
  type?: WallType;
};

export type MapData = {
  id: string;
  width: number;
  height: number;
  walls: Wall[];
  spawnPoints: { team: Team; x: number; y: number }[];
  flagPositions?: { team: Team; x: number; y: number }[]; // CTF flag locations (defaults to spawnPoints if omitted)
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
  kills: number;
  hits: number;
  fired: number;
  nextActionAt: number;
  actionLockStep: number; // 5→0 countdown display (0 = ready)
  hullAngle: number;      // hull facing direction (radians)
  turretAngle: number;    // turret facing direction (radians)
  respawnAt: number | null;
  respawnCooldownUntil: number | null; // Indicates until when the player is invincible and cannot act
  isHidden: boolean;      // True if the player is in a bush and not visible to enemies
  // Phase 4: Item state
  hasBomb?: boolean;
  ropeCount?: number;
  bootsCharges?: number;
};

export type RoomSummary = {
  id: string;
  name: string;
  gameMode: "deathmatch" | "ctf";
  mapId: string;
  mapData?: MapData; // simple way to sync map for now
  maxPlayers: number;
  timeLimitSec: number;
  passwordProtected: boolean;
  createdAt: number;
  endsAt: number;
  players: string[];
  spectatorCount?: number; // Number of spectators watching
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

export type BulletPublic = {
  id: string;
  shooterId: string;
  x: number;
  y: number;
  position: Vector2;
  radius: number;
  startX?: number;
  startY?: number;
  isBomb?: boolean;
  isRope?: boolean;
  isAmmoPass?: boolean;
  isHealPass?: boolean;
  isFlagPass?: boolean;
  flagTeam?: Team;
};

export type RoomState = {
  roomId: string;
  players: PlayerSummary[];
  bullets: BulletPublic[];
  explosions: Explosion[];
  timeLeftSec: number;
  gameMode: "deathmatch" | "ctf";
  teamScores: { red: number; blue: number };
  mapData: MapData;
  flags?: Flag[]; // Only for CTF
  items: Item[];
};

export type Flag = {
  team: Team; // "red" or "blue"
  x: number;
  y: number;
  carrierId: string | null; // ID of player holding it
  droppedById?: string; // Phase 4-5: ID of player who dropped it, to prevent immediate re-pickup
};

export type ChatMessage = {
  from: string;
  message: string;
  timestamp: number;
};

export type ClientToServerMessage =
  | {
    type: "login";
    payload: { name: string; id?: string };
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
      gameMode?: "deathmatch" | "ctf";
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
    type: "useItem"; // Phase 4-7: Secondary Aim Action
    payload: { item: string; direction: Vector2 };
  }
  | {
    type: "moveCancelOne";
  }
  | {
    type: "spectateRoom";
    payload: { roomId: string; password?: string };
  }
  | {
    type: "stopMove"; // Cancel all queued moves and stop immediately
  }
  | {
    type: "aim"; // Update turret aim direction (during AIM mode)
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
  }
  | {
    type: "gameEnd";
    payload: {
      winners: Team | "draw";
      results: PlayerSummary[];
    };
  };
