/**
 * Bot logic for practice mode.
 *
 * getBotMove() returns a random valid move for the given game state.
 * Future difficulty levels (medium, hard) can be added here with smarter strategies.
 */

import type {
  ThreePlayerMove,
  DuelMove,
  ThreePlayerPlayer,
  DuelPlayer,
  Difficulty,
} from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function aliveHitboxes(player: { hitboxes: number[] }): number[] {
  return player.hitboxes
    .map((hp, i) => (hp > 0 ? i + 1 : -1)) // 1-indexed
    .filter((i) => i !== -1);
}

// ---------------------------------------------------------------------------
// Three-player bot
// ---------------------------------------------------------------------------

export function getBotMoveThreePlayer(
  botUserId: string,
  players: ThreePlayerPlayer[],
  _difficulty: Difficulty
): ThreePlayerMove {
  const botIdx = players.findIndex((p) => p.userId === botUserId);
  const bot = players[botIdx];

  // Pick a random living opponent
  const opponents = players.filter((p) => !p.isEliminated && p.userId !== botUserId);
  const target = opponents[randomInt(0, opponents.length - 1)];
  const targetPlayerNum = players.indexOf(target) + 1; // 1-indexed

  // Pick a random alive hitbox on that opponent
  const targetHitboxes = aliveHitboxes(target);
  const targetHitbox = targetHitboxes[randomInt(0, targetHitboxes.length - 1)];

  // Occasionally use a powerup if still have budget (easy: ~20% chance)
  if (bot.powerUpsUsed < 2 && Math.random() < 0.2) {
    const powerUps = ["double_damage", "shield", "gun_jam"] as const;
    const type = powerUps[randomInt(0, powerUps.length - 1)];

    if (type === "shield") {
      // Shield a random alive hitbox of self
      const selfHitboxes = aliveHitboxes(bot);
      const shieldHitbox = selfHitboxes[randomInt(0, selfHitboxes.length - 1)];
      return { targetPlayerNum, targetHitbox, powerUp: { type, shieldHitbox } };
    }

    if (type === "gun_jam") {
      // Jam a random opponent (not self, not the attack target — variety)
      const jamTarget = players.indexOf(target) + 1;
      return { targetPlayerNum, targetHitbox, powerUp: { type, jamTarget } };
    }

    return { targetPlayerNum, targetHitbox, powerUp: { type } };
  }

  return { targetPlayerNum, targetHitbox };
}

// ---------------------------------------------------------------------------
// Duel bot
// ---------------------------------------------------------------------------

export function getBotMoveDuel(
  botUserId: string,
  players: [DuelPlayer, DuelPlayer],
  _difficulty: Difficulty
): DuelMove {
  const bot = players.find((p) => p.userId === botUserId)!;
  const opponent = players.find((p) => p.userId !== botUserId)!;

  const roll = Math.random();

  // ~15% chance to shield a random alive hitbox
  if (roll < 0.15) {
    const selfHitboxes = aliveHitboxes(bot);
    const hitbox = selfHitboxes[randomInt(0, selfHitboxes.length - 1)];
    return { type: "shield", hitbox };
  }

  // ~15% chance to use a powerup if budget allows
  if (roll < 0.30 && bot.powerUpsUsed < 2) {
    const opponentHitboxes = aliveHitboxes(opponent);
    const targetHitbox = opponentHitboxes[randomInt(0, opponentHitboxes.length - 1)];

    const powerUps = ["double_damage", "gun_jam", "double_turn"] as const;
    const type = powerUps[randomInt(0, powerUps.length - 1)];

    if (type === "double_turn") {
      // Pick 2 distinct alive hitboxes
      if (opponentHitboxes.length >= 2) {
        const shuffled = [...opponentHitboxes].sort(() => Math.random() - 0.5);
        return { type: "double_turn", targetHitbox1: shuffled[0], targetHitbox2: shuffled[1] };
      }
      // Fallback to regular attack if only 1 hitbox left
      return { type: "attack", targetHitbox };
    }

    return { type: "attack", targetHitbox, powerUp: type };
  }

  // Default: plain attack on a random alive hitbox
  const opponentHitboxes = aliveHitboxes(opponent);
  const targetHitbox = opponentHitboxes[randomInt(0, opponentHitboxes.length - 1)];
  return { type: "attack", targetHitbox };
}
