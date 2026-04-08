// ---------------------------------------------------------------------------
// Shared types for server + bot
// ---------------------------------------------------------------------------

export type GameMode = "three_player" | "duel";
export type ParticipantType = "human" | "ai";
export type Difficulty = "easy" | "medium" | "hard";

// --- Three-player ---

export type ThreePlayerPowerUp = "double_damage" | "shield" | "gun_jam";

export type ThreePlayerMove = {
  targetPlayerNum: number; // 1-indexed
  targetHitbox: number;    // 1-indexed
  powerUp?: { type: ThreePlayerPowerUp; shieldHitbox?: number; jamTarget?: number };
};

export interface ThreePlayerPlayer {
  userId: string;
  username: string;
  socketId: string;
  participantType: ParticipantType;
  hitboxes: number[]; // length 4, each starts at 2, 0 = destroyed
  powerUpsUsed: number;
  isEliminated: boolean;
  isGunJammed: boolean;
}

export interface ThreePlayerState {
  mode: "three_player";
  players: ThreePlayerPlayer[];
  pendingMoves: Map<string, ThreePlayerMove>;
}

// --- Duel ---

export type DuelPowerUp = "double_damage" | "gun_jam";

export type DuelMove =
  | { type: "attack"; targetHitbox: number; powerUp?: DuelPowerUp }
  | { type: "shield"; hitbox: number }
  | { type: "double_turn"; targetHitbox1: number; targetHitbox2: number; shieldHitbox?: number };

export interface DuelPlayer {
  userId: string;
  username: string;
  socketId: string;
  participantType: ParticipantType;
  hitboxes: number[]; // length 5, each starts at 2, 0 = destroyed
  powerUpsUsed: number;
  isEliminated: boolean;
  isGunJammed: boolean;
}

export interface DuelState {
  mode: "duel";
  players: [DuelPlayer, DuelPlayer];
  consecutiveFullShieldTurns: number;
  pendingMoves: Map<string, DuelMove>;
}

// --- Shared game state ---

export interface BaseGameState {
  roomId: string;
  turnDeadline: number;
  matchDeadline: number;
  gameStatus: "waiting" | "started" | "ended";
  moveHistory: string[];
  winner: string | null;
}

export type GameState = BaseGameState & (ThreePlayerState | DuelState);

// --- Matchmaking ---

export interface WaitingPlayer {
  userId: string;
  username: string;
  socketId: string;
  participantType: ParticipantType;
}
