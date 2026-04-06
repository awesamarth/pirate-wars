import { createServer } from "node:http";
import next from "next";
import { Server } from "socket.io";
import type {
  GameMode,
  GameState,
  BaseGameState,
  ThreePlayerState,
  ThreePlayerPlayer,
  ThreePlayerMove,
  ThreePlayerPowerUp,
  DuelState,
  DuelPlayer,
  DuelMove,
  WaitingPlayer,
  Difficulty,
} from "./types";
import { getBotMoveThreePlayer, getBotMoveDuel } from "./bot/bot";

const port = parseInt(process.env.PORT || "3000", 10);
const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";

const app = next({ dev, hostname, port });
const handler = app.getRequestHandler();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TURN_TIMEOUT_MS = 15_000;
const MATCH_TIMEOUT_MS = 10 * 60 * 1000;

const HITBOXES_THREE_PLAYER = 4;
const HITBOXES_DUEL = 5;
const MAX_POWERUPS_PER_GAME = 2;

// Poseidon's Wrath: fires once at turn 3, once at turn 5, every turn from 6+
const POSEIDON_THRESHOLDS = [3, 5, 6] as const;

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

const games = new Map<string, GameState>();

const waitingQueues: Record<GameMode, WaitingPlayer[]> = {
  three_player: [],
  duel: [],
};

const userIdToSocket = new Map<string, string>(); // userId -> socketId

// ---------------------------------------------------------------------------
// Notation helpers
// ---------------------------------------------------------------------------

// Three-player:
//   p1p2h3        — p1 attacks p2's hitbox 3
//   p1p2h3_dd     — with double damage
//   p1p2h3_sh1    — attack + shield own hitbox 1
//   p1p2h3_gjp2   — attack + gun jam p2

function encodeThreePlayerMove(
  actorNum: number,
  targetPlayerNum: number,
  targetHitbox: number,
  powerUp?: { type: ThreePlayerPowerUp; shieldHitbox?: number; jamTarget?: number }
): string {
  const base = `p${actorNum}p${targetPlayerNum}h${targetHitbox}`;
  if (!powerUp) return base;
  switch (powerUp.type) {
    case "double_damage": return `${base}_dd`;
    case "shield":        return `${base}_sh${powerUp.shieldHitbox}`;
    case "gun_jam":       return `${base}_gjp${powerUp.jamTarget}`;
  }
}

// Duel:
//   p1h3          — attack hitbox 3
//   p1h3_dd       — double damage
//   p1h3_gj       — gun jam
//   p1s3          — shield hitbox 3
//   p1h1_dth3     — double turn: attack h1 and h3
//   pw_h4p1       — Poseidon's Wrath hit p1's hitbox 4 (server-emitted)

function encodeDuelMove(playerNum: number, move: DuelMove): string {
  switch (move.type) {
    case "attack": {
      const base = `p${playerNum}h${move.targetHitbox}`;
      if (move.powerUp === "double_damage") return `${base}_dd`;
      if (move.powerUp === "gun_jam")       return `${base}_gj`;
      return base;
    }
    case "shield":
      return `p${playerNum}s${move.hitbox}`;
    case "double_turn":
      return `p${playerNum}h${move.targetHitbox1}_dth${move.targetHitbox2}`;
  }
}

function encodePoseidonStrike(targetPlayerNum: number, hitbox: number): string {
  return `pw_h${hitbox}p${targetPlayerNum}`;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeBaseGameState(roomId: string): BaseGameState {
  const now = Date.now();
  return {
    roomId,
    turnDeadline: now + TURN_TIMEOUT_MS,
    matchDeadline: now + MATCH_TIMEOUT_MS,
    gameStatus: "started",
    moveHistory: [],
    winner: null,
  };
}

/** Damages a hitbox (0-indexed) by 1. Returns true if the player was newly eliminated. */
function destroyHitbox(player: { hitboxes: number[]; isEliminated: boolean }, hitbox: number): boolean {
  if (player.hitboxes[hitbox] <= 0) return false;
  player.hitboxes[hitbox]--;
  if (player.hitboxes.every((h) => h <= 0)) {
    player.isEliminated = true;
    return true;
  }
  return false;
}

function aliveHitboxIndices(player: { hitboxes: number[] }): number[] {
  return player.hitboxes.map((hp, i) => (hp > 0 ? i : -1)).filter((i) => i !== -1);
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function checkThreePlayerWin(players: ThreePlayerPlayer[]): string | null {
  const alive = players.filter((p) => !p.isEliminated);
  return alive.length === 1 ? alive[0].userId : null;
}

function checkDuelWin(players: [DuelPlayer, DuelPlayer]): string | null {
  const alive = players.filter((p) => !p.isEliminated);
  return alive.length === 1 ? alive[0].userId : null;
}

function endGame(io: Server, game: GameState, winnerId: string): void {
  game.gameStatus = "ended";
  game.winner = winnerId;
  io.to(game.roomId).emit("game_ended", { winner: winnerId, history: game.moveHistory });
  games.delete(game.roomId);
}

// ---------------------------------------------------------------------------
// Bot injection
// ---------------------------------------------------------------------------

/**
 * After a human submits a move, inject bot moves for any bots in the game
 * that haven't submitted yet. If all moves are now in, resolves the turn.
 */
function injectBotMovesIfNeeded(
  io: Server,
  game: GameState,
  difficulty: Difficulty
): void {
  if (game.mode === "three_player") {
    const g = game as GameState & ThreePlayerState;
    const activePlayers = g.players.filter((p) => !p.isEliminated);
    for (const player of activePlayers) {
      if (player.participantType === "ai" && !g.pendingMoves.has(player.userId)) {
        const move = getBotMoveThreePlayer(player.userId, g.players, difficulty);
        g.pendingMoves.set(player.userId, move);
      }
    }
    if (g.pendingMoves.size >= activePlayers.length) {
      resolveThreePlayerTurn(io, g);
    }
  } else {
    const g = game as GameState & DuelState;
    for (const player of g.players) {
      if (player.participantType === "ai" && !g.pendingMoves.has(player.userId)) {
        const move = getBotMoveDuel(player.userId, g.players, difficulty);
        g.pendingMoves.set(player.userId, move);
      }
    }
    if (g.pendingMoves.size >= 2) {
      resolveDuelTurn(io, g);
    }
  }
}

// ---------------------------------------------------------------------------
// Three-player game logic (simultaneous)
// ---------------------------------------------------------------------------

function handleThreePlayerMove(
  io: Server,
  socket: any,
  game: GameState & ThreePlayerState,
  payload: {
    userId: string;
    targetPlayerNum: number;
    targetHitbox: number;
    powerUp?: { type: ThreePlayerPowerUp; shieldHitbox?: number; jamTarget?: number };
    difficulty?: Difficulty;
  }
): void {
  const { userId, targetPlayerNum, targetHitbox, powerUp, difficulty = "easy" } = payload;

  const actorIdx = game.players.findIndex((p) => p.userId === userId);
  if (actorIdx === -1) return;

  const actor = game.players[actorIdx];
  if (actor.isEliminated) return;

  if (powerUp && actor.powerUpsUsed >= MAX_POWERUPS_PER_GAME) {
    socket.emit("error", { message: "Max powerups reached" });
    return;
  }

  game.pendingMoves.set(userId, { targetPlayerNum, targetHitbox, powerUp });
  socket.emit("move_submitted", { waiting: true });

  injectBotMovesIfNeeded(io, game, difficulty);
}

function resolveThreePlayerTurn(io: Server, game: GameState & ThreePlayerState): void {
  const { roomId, players, pendingMoves } = game;
  const turnNotations: string[] = [];

  // Pass 1: apply gun jams so they take effect on attacks this same turn
  for (const [userId, move] of pendingMoves) {
    if (move.powerUp?.type !== "gun_jam") continue;
    const actorIdx = players.findIndex((p) => p.userId === userId);
    const actor = players[actorIdx];
    if (actor.isEliminated) continue;

    const jamTargetIdx = (move.powerUp.jamTarget ?? 0) - 1;
    if (jamTargetIdx >= 0 && jamTargetIdx < players.length && jamTargetIdx !== actorIdx) {
      players[jamTargetIdx].isGunJammed = true;
    }
    actor.powerUpsUsed++;
  }

  // Pass 2: resolve all attacks
  for (const [userId, move] of pendingMoves) {
    const actorIdx = players.findIndex((p) => p.userId === userId);
    const actor = players[actorIdx];
    if (actor.isEliminated) continue;

    const actorNum = actorIdx + 1;
    const { targetPlayerNum, targetHitbox, powerUp } = move;
    const targetIdx = targetPlayerNum - 1;
    const target = players[targetIdx];

    if (!target || target.isEliminated || targetIdx === actorIdx) continue;

    // Gun jam check (67% fail, 33% backfire)
    if (actor.isGunJammed) {
      actor.isGunJammed = false;
      if (Math.random() < 0.67) {
        turnNotations.push(`p${actorNum}_jammed`);
        continue;
      }
      // Backfire: damage actor
      const alive = aliveHitboxIndices(actor);
      if (alive.length > 0) {
        const h = alive[randomInt(0, alive.length - 1)];
        destroyHitbox(actor, h);
        turnNotations.push(`p${actorNum}_backfire_h${h + 1}`);
      }
      continue;
    }

    if (powerUp && powerUp.type !== "gun_jam") actor.powerUpsUsed++;

    const targetHitboxIdx = targetHitbox - 1;
    if (target.hitboxes[targetHitboxIdx] <= 0) continue;

    if (powerUp?.type === "double_damage") {
      destroyHitbox(target, targetHitboxIdx);
      const others = aliveHitboxIndices(target).filter((i) => i !== targetHitboxIdx);
      if (others.length > 0) destroyHitbox(target, others[randomInt(0, others.length - 1)]);
    } else {
      // shield powerup: attack still goes through, shield is recorded in notation
      destroyHitbox(target, targetHitboxIdx);
    }

    turnNotations.push(encodeThreePlayerMove(actorNum, targetPlayerNum, targetHitbox, powerUp));

    if (target.isEliminated) {
      io.to(roomId).emit("player_eliminated", { userId: target.userId });
    }
  }

  pendingMoves.clear();
  game.moveHistory.push(...turnNotations);
  game.turnDeadline = Date.now() + TURN_TIMEOUT_MS;

  const winner = checkThreePlayerWin(players);
  if (winner) { endGame(io, game, winner); return; }

  io.to(roomId).emit("turn_resolved", { notations: turnNotations, gameState: game });
}

// ---------------------------------------------------------------------------
// Duel game logic (simultaneous)
// ---------------------------------------------------------------------------

function handleDuelMove(
  io: Server,
  socket: any,
  game: GameState & DuelState,
  payload: { userId: string; move: DuelMove; difficulty?: Difficulty }
): void {
  const { userId, move, difficulty = "easy" } = payload;

  const playerIdx = game.players.findIndex((p) => p.userId === userId);
  if (playerIdx === -1) return;

  const player = game.players[playerIdx];
  if (player.isEliminated) return;

  if ((move.type === "attack" && move.powerUp) || move.type === "double_turn") {
    if (player.powerUpsUsed >= MAX_POWERUPS_PER_GAME) {
      socket.emit("error", { message: "Max powerups reached" });
      return;
    }
  }

  game.pendingMoves.set(userId, move);
  socket.emit("move_submitted", { waiting: true });

  injectBotMovesIfNeeded(io, game, difficulty);
}

function resolveDuelTurn(io: Server, game: GameState & DuelState): void {
  const { roomId, players, pendingMoves } = game;
  const [p1, p2] = players;
  const move1 = pendingMoves.get(p1.userId)!;
  const move2 = pendingMoves.get(p2.userId)!;
  pendingMoves.clear();

  const turnNotations: string[] = [];

  // Count powerup usage
  if ((move1.type === "attack" && move1.powerUp) || move1.type === "double_turn") p1.powerUpsUsed++;
  if ((move2.type === "attack" && move2.powerUp) || move2.type === "double_turn") p2.powerUpsUsed++;

  const p1ShieldedHitbox = move1.type === "shield" ? move1.hitbox : null;
  const p2ShieldedHitbox = move2.type === "shield" ? move2.hitbox : null;
  const bothShielded = move1.type === "shield" && move2.type === "shield";

  applyDuelMove(io, game, p1, p2, move1, 1, p2ShieldedHitbox, turnNotations);
  applyDuelMove(io, game, p2, p1, move2, 2, p1ShieldedHitbox, turnNotations);

  // Poseidon's Wrath
  if (bothShielded) {
    game.consecutiveFullShieldTurns++;
    const strikes = countPoseidonStrikes(game.consecutiveFullShieldTurns);
    for (let i = 0; i < strikes; i++) {
      const targetIdx = randomInt(0, 1);
      const target = players[targetIdx];
      const alive = aliveHitboxIndices(target);
      if (alive.length === 0) continue;

      const hitbox = alive[randomInt(0, alive.length - 1)];
      destroyHitbox(target, hitbox);
      turnNotations.push(encodePoseidonStrike(targetIdx + 1, hitbox + 1));

      if (target.isEliminated) {
        io.to(roomId).emit("player_eliminated", { userId: target.userId });
      }
    }
  } else {
    game.consecutiveFullShieldTurns = 0;
  }

  game.moveHistory.push(...turnNotations);

  const winner = checkDuelWin(players);
  if (winner) { endGame(io, game, winner); return; }

  game.turnDeadline = Date.now() + TURN_TIMEOUT_MS;
  io.to(roomId).emit("turn_resolved", { notations: turnNotations, gameState: game });
}

function countPoseidonStrikes(consecutiveTurns: number): number {
  if (consecutiveTurns === POSEIDON_THRESHOLDS[0]) return 1;
  if (consecutiveTurns === POSEIDON_THRESHOLDS[1]) return 1;
  if (consecutiveTurns >= POSEIDON_THRESHOLDS[2]) return 1;
  return 0;
}

function applyDuelMove(
  io: Server,
  game: GameState & DuelState,
  actor: DuelPlayer,
  target: DuelPlayer,
  move: DuelMove,
  actorNum: number,
  targetShieldedHitbox: number | null,
  notations: string[]
): void {
  notations.push(encodeDuelMove(actorNum, move));

  if (move.type === "shield") return;

  // Gun jam check
  if (actor.isGunJammed) {
    actor.isGunJammed = false;
    if (Math.random() < 0.67) {
      notations.push(`p${actorNum}_jammed`);
      return;
    }
    const alive = aliveHitboxIndices(actor);
    if (alive.length > 0) {
      const h = alive[randomInt(0, alive.length - 1)];
      destroyHitbox(actor, h);
      notations.push(`p${actorNum}_backfire_h${h + 1}`);
    }
    return;
  }

  if (move.type === "attack") {
    const hitboxIdx = move.targetHitbox - 1;
    if (targetShieldedHitbox !== null && move.targetHitbox === targetShieldedHitbox) return; // blocked by shield

    if (move.powerUp === "double_damage") {
      destroyHitbox(target, hitboxIdx);
      const others = aliveHitboxIndices(target).filter((i) => i !== hitboxIdx);
      if (others.length > 0) destroyHitbox(target, others[randomInt(0, others.length - 1)]);
    } else if (move.powerUp === "gun_jam") {
      destroyHitbox(target, hitboxIdx);
      target.isGunJammed = true;
    } else {
      destroyHitbox(target, hitboxIdx);
    }
  }

  if (move.type === "double_turn") {
    const h1 = move.targetHitbox1 - 1;
    const h2 = move.targetHitbox2 - 1;
    if (targetShieldedHitbox === null || move.targetHitbox1 !== targetShieldedHitbox) destroyHitbox(target, h1);
    if (targetShieldedHitbox === null || move.targetHitbox2 !== targetShieldedHitbox) destroyHitbox(target, h2);
  }

  if (target.isEliminated) {
    io.to(game.roomId).emit("player_eliminated", { userId: target.userId });
  }
}

// ---------------------------------------------------------------------------
// Resign + disconnect
// ---------------------------------------------------------------------------

function handleResign(io: Server, game: GameState, userId: string): void {
  const { roomId } = game;

  if (game.mode === "three_player") {
    const player = game.players.find((p) => p.userId === userId);
    if (!player) return;
    player.isEliminated = true;
    game.pendingMoves.delete(userId);

    const alive = game.players.filter((p) => !p.isEliminated);
    if (alive.length === 1) {
      endGame(io, game, alive[0].userId);
    } else {
      io.to(roomId).emit("player_eliminated", { userId, reason: "resignation" });
      const active = game.players.filter((p) => !p.isEliminated);
      if (game.pendingMoves.size >= active.length) {
        resolveThreePlayerTurn(io, game as GameState & ThreePlayerState);
      }
    }
  } else {
    const winner = game.players.find((p) => p.userId !== userId);
    if (winner) endGame(io, game, winner.userId);
  }
}

function handleDisconnect(io: Server, userId: string): void {
  removeFromQueue(userId);
  userIdToSocket.delete(userId);

  games.forEach((game, roomId) => {
    if (!game.players.some((p) => p.userId === userId)) return;
    handleResign(io, game, userId);
    io.to(roomId).emit("player_disconnected", { userId });
  });
}

// ---------------------------------------------------------------------------
// Matchmaking
// ---------------------------------------------------------------------------

function removeFromQueue(userId: string): void {
  for (const queue of Object.values(waitingQueues)) {
    const idx = queue.findIndex((p) => p.userId === userId);
    if (idx !== -1) { queue.splice(idx, 1); return; }
  }
}

function tryMatchThreePlayers(io: Server, queue: WaitingPlayer[]): void {
  if (queue.length < 3) return;

  const [p1, p2, p3] = queue.splice(0, 3);
  const roomId = Date.now().toString();

  const makePlayer = (p: WaitingPlayer): ThreePlayerPlayer => ({
    userId: p.userId,
    username: p.username,
    socketId: p.socketId,
    participantType: p.participantType,
    hitboxes: Array(HITBOXES_THREE_PLAYER).fill(2),
    powerUpsUsed: 0,
    isEliminated: false,
    isGunJammed: false,
  });

  const game: GameState = {
    ...makeBaseGameState(roomId),
    mode: "three_player",
    players: [makePlayer(p1), makePlayer(p2), makePlayer(p3)],
    pendingMoves: new Map(),
  };

  games.set(roomId, game);
  for (const p of [p1, p2, p3]) {
    io.sockets.sockets.get(p.socketId)?.join(roomId);
  }
  io.to(roomId).emit("match_found", game);
}

function tryMatchDuel(io: Server, queue: WaitingPlayer[]): void {
  if (queue.length < 2) return;

  const [p1, p2] = queue.splice(0, 2);
  const roomId = Date.now().toString();

  const makePlayer = (p: WaitingPlayer): DuelPlayer => ({
    userId: p.userId,
    username: p.username,
    socketId: p.socketId,
    participantType: p.participantType,
    hitboxes: Array(HITBOXES_DUEL).fill(2),
    powerUpsUsed: 0,
    isEliminated: false,
    isGunJammed: false,
  });

  const game: GameState = {
    ...makeBaseGameState(roomId),
    mode: "duel",
    players: [makePlayer(p1), makePlayer(p2)],
    consecutiveFullShieldTurns: 0,
    pendingMoves: new Map(),
  };

  games.set(roomId, game);
  for (const p of [p1, p2]) {
    io.sockets.sockets.get(p.socketId)?.join(roomId);
  }
  io.to(roomId).emit("match_found", game);
}

/**
 * Creates a practice game immediately with bot opponents, no matchmaking queue.
 * Returns the roomId.
 */
function createPracticeGame(
  io: Server,
  humanPlayer: WaitingPlayer,
  gameMode: GameMode,
  difficulty: Difficulty
): string {
  const roomId = Date.now().toString();

  if (gameMode === "three_player") {
    const makeBotPlayer = (num: number): ThreePlayerPlayer => ({
      userId: `bot_${roomId}_${num}`,
      username: `Bot ${num}`,
      socketId: "",
      participantType: "ai",
      hitboxes: Array(HITBOXES_THREE_PLAYER).fill(2),
      powerUpsUsed: 0,
      isEliminated: false,
      isGunJammed: false,
    });

    const human: ThreePlayerPlayer = {
      userId: humanPlayer.userId,
      username: humanPlayer.username,
      socketId: humanPlayer.socketId,
      participantType: "human",
      hitboxes: Array(HITBOXES_THREE_PLAYER).fill(2),
      powerUpsUsed: 0,
      isEliminated: false,
      isGunJammed: false,
    };

    const game: GameState = {
      ...makeBaseGameState(roomId),
      mode: "three_player",
      players: [human, makeBotPlayer(1), makeBotPlayer(2)],
      pendingMoves: new Map(),
    };

    games.set(roomId, game);
    io.sockets.sockets.get(humanPlayer.socketId)?.join(roomId);
    io.to(roomId).emit("match_found", { ...game, difficulty });
  } else {
    const bot: DuelPlayer = {
      userId: `bot_${roomId}`,
      username: "Bot",
      socketId: "",
      participantType: "ai",
      hitboxes: Array(HITBOXES_DUEL).fill(2),
      powerUpsUsed: 0,
      isEliminated: false,
      isGunJammed: false,
    };

    const human: DuelPlayer = {
      userId: humanPlayer.userId,
      username: humanPlayer.username,
      socketId: humanPlayer.socketId,
      participantType: "human",
      hitboxes: Array(HITBOXES_DUEL).fill(2),
      powerUpsUsed: 0,
      isEliminated: false,
      isGunJammed: false,
    };

    const game: GameState = {
      ...makeBaseGameState(roomId),
      mode: "duel",
      players: [human, bot],
      consecutiveFullShieldTurns: 0,
      pendingMoves: new Map(),
    };

    games.set(roomId, game);
    io.sockets.sockets.get(humanPlayer.socketId)?.join(roomId);
    io.to(roomId).emit("match_found", { ...game, difficulty });
  }

  return roomId;
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

app.prepare().then(() => {
  const httpServer = createServer(handler);
  const io = new Server(httpServer);

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    // -----------------------------------------------------------------------
    // Matchmaking — live play
    // -----------------------------------------------------------------------

    socket.on(
      "join_lobby",
      ({
        userId,
        username,
        gameMode,
        participantType = "human",
      }: {
        userId: string;
        username: string;
        gameMode: GameMode;
        participantType?: "human" | "ai";
      }) => {
        socket.data.userId = userId;
        userIdToSocket.set(userId, socket.id);

        const queue = waitingQueues[gameMode];
        if (!queue.find((p) => p.userId === userId)) {
          queue.push({ userId, username, socketId: socket.id, participantType });
        }

        if (gameMode === "three_player") tryMatchThreePlayers(io, queue);
        else tryMatchDuel(io, queue);

        if (queue.find((p) => p.userId === userId)) {
          socket.emit("in_queue", { position: queue.length });
        }
      }
    );

    socket.on("leave_lobby", ({ userId }: { userId: string }) => {
      removeFromQueue(userId);
    });

    // -----------------------------------------------------------------------
    // Practice mode — instant bot game
    // -----------------------------------------------------------------------

    socket.on(
      "join_practice",
      ({
        userId,
        username,
        gameMode,
        difficulty,
      }: {
        userId: string;
        username: string;
        gameMode: GameMode;
        difficulty: Difficulty;
      }) => {
        socket.data.userId = userId;
        userIdToSocket.set(userId, socket.id);

        const roomId = createPracticeGame(
          io,
          { userId, username, socketId: socket.id, participantType: "human" },
          gameMode,
          difficulty
        );

        socket.data.difficulty = difficulty;
        socket.data.roomId = roomId;
      }
    );

    // -----------------------------------------------------------------------
    // Reconnect to existing game
    // -----------------------------------------------------------------------

    socket.on(
      "get_game_data",
      ({ roomId, userId }: { roomId: string; userId: string }) => {
        const game = games.get(roomId);
        if (!game) { socket.emit("game_data", { error: "Game not found" }); return; }
        socket.data.userId = userId;
        userIdToSocket.set(userId, socket.id);
        socket.join(roomId);
        socket.emit("game_data", game);
      }
    );

    // -----------------------------------------------------------------------
    // Three-player moves
    // -----------------------------------------------------------------------

    socket.on(
      "three_player_move",
      (payload: {
        roomId: string;
        userId: string;
        targetPlayerNum: number;
        targetHitbox: number;
        powerUp?: { type: ThreePlayerPowerUp; shieldHitbox?: number; jamTarget?: number };
        difficulty?: Difficulty;
      }) => {
        const game = games.get(payload.roomId);
        if (!game || game.mode !== "three_player" || game.gameStatus !== "started") return;
        handleThreePlayerMove(io, socket, game as GameState & ThreePlayerState, payload);
      }
    );

    // -----------------------------------------------------------------------
    // Duel moves
    // -----------------------------------------------------------------------

    socket.on(
      "duel_move",
      (payload: { roomId: string; userId: string; move: DuelMove; difficulty?: Difficulty }) => {
        const game = games.get(payload.roomId);
        if (!game || game.mode !== "duel" || game.gameStatus !== "started") return;
        handleDuelMove(io, socket, game as GameState & DuelState, payload);
      }
    );

    // -----------------------------------------------------------------------
    // Get game state (for spectators, agents, prediction market observers)
    // -----------------------------------------------------------------------

    socket.on("get_game_state", ({ roomId }: { roomId: string }) => {
      const game = games.get(roomId);
      if (!game) { socket.emit("game_state", { error: "Game not found" }); return; }
      socket.emit("game_state", game);
    });

    // -----------------------------------------------------------------------
    // Resign
    // -----------------------------------------------------------------------

    socket.on("resign", ({ roomId, userId }: { roomId: string; userId: string }) => {
      const game = games.get(roomId);
      if (!game) return;
      handleResign(io, game, userId);
    });

    // -----------------------------------------------------------------------
    // Disconnect
    // -----------------------------------------------------------------------

    socket.on("disconnect", () => {
      const userId = socket.data.userId;
      if (userId) handleDisconnect(io, userId);
    });
  });

  httpServer.once("error", (err) => {
    console.error(err);
    process.exit(1);
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
