/**
 * Bot logic for practice mode.
 *
 * Difficulty behaviour:
 *
 * DUEL (1v1):
 *   easy   — bot always shields one of its remaining hitboxes
 *   medium — 2/3 chance shield, 1/3 chance attack player's hitbox
 *   hard   — always attacks player's hitbox (no shielding)
 *
 * THREE-PLAYER (1v1v1):
 *   easy   — bots attack each other; once only 1 bot left vs player, it attacks player
 *   medium — 50% chance each bot targets player, 50% chance targets the other bot
 *   hard   — 80% chance each bot targets player, 20% chance targets the other bot
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

/** Returns 1-indexed alive hitbox numbers for a player. */
function aliveHitboxes(player: { hitboxes: number[] }): number[] {
  return player.hitboxes
    .map((hp, i) => (hp > 0 ? i + 1 : -1))
    .filter((i) => i !== -1);
}

function pickRandom<T>(arr: T[]): T {
  return arr[randomInt(0, arr.length - 1)];
}

// ---------------------------------------------------------------------------
// Duel bot
// ---------------------------------------------------------------------------

export function getBotMoveDuel(
  botUserId: string,
  players: [DuelPlayer, DuelPlayer],
  difficulty: Difficulty
): DuelMove {
  const bot = players.find((p) => p.userId === botUserId)!;
  const opponent = players.find((p) => p.userId !== botUserId)!;

  const botAlive = aliveHitboxes(bot);
  const opponentAlive = aliveHitboxes(opponent);

  switch (difficulty) {
    case "easy": {
      // Always shield a random alive hitbox
      return { type: "shield", hitbox: pickRandom(botAlive) };
    }

    case "medium": {
      // 0 or 1 → shield, 2 → attack
      const roll = randomInt(0, 2);
      if (roll <= 1) {
        return { type: "shield", hitbox: pickRandom(botAlive) };
      }
      return { type: "attack", targetHitbox: pickRandom(opponentAlive) };
    }

    case "hard": {
      // Always attack
      return { type: "attack", targetHitbox: pickRandom(opponentAlive) };
    }
  }
}

// ---------------------------------------------------------------------------
// Three-player bot
// ---------------------------------------------------------------------------

export function getBotMoveThreePlayer(
  botUserId: string,
  players: ThreePlayerPlayer[],
  difficulty: Difficulty
): ThreePlayerMove {
  const botIdx = players.findIndex((p) => p.userId === botUserId);
  const bot = players[botIdx];

  const humanPlayer = players.find((p) => p.participantType === "human" && !p.isEliminated);
  const otherBots = players.filter(
    (p) => p.userId !== botUserId && p.participantType === "ai" && !p.isEliminated
  );
  const alivePlayers = players.filter((p) => !p.isEliminated && p.userId !== botUserId);

  // If no human left, bots attack each other (shouldn't really happen in practice mode)
  if (!humanPlayer) {
    const target = pickRandom(alivePlayers);
    const targetPlayerNum = players.indexOf(target) + 1;
    return { targetPlayerNum, targetHitbox: pickRandom(aliveHitboxes(target)) };
  }

  const humanPlayerNum = players.indexOf(humanPlayer) + 1;
  const humanHitboxes = aliveHitboxes(humanPlayer);

  switch (difficulty) {
    case "easy": {
      // Attack other bots if any alive, otherwise attack player
      if (otherBots.length > 0) {
        const target = pickRandom(otherBots);
        const targetPlayerNum = players.indexOf(target) + 1;
        return { targetPlayerNum, targetHitbox: pickRandom(aliveHitboxes(target)) };
      }
      return { targetPlayerNum: humanPlayerNum, targetHitbox: pickRandom(humanHitboxes) };
    }

    case "medium": {
      // 50/50: attack player or attack another bot
      if (otherBots.length > 0 && Math.random() < 0.5) {
        const target = pickRandom(otherBots);
        const targetPlayerNum = players.indexOf(target) + 1;
        return { targetPlayerNum, targetHitbox: pickRandom(aliveHitboxes(target)) };
      }
      return { targetPlayerNum: humanPlayerNum, targetHitbox: pickRandom(humanHitboxes) };
    }

    case "hard": {
      // 80% attack player, 20% attack another bot
      if (otherBots.length > 0 && Math.random() > 0.8) {
        const target = pickRandom(otherBots);
        const targetPlayerNum = players.indexOf(target) + 1;
        return { targetPlayerNum, targetHitbox: pickRandom(aliveHitboxes(target)) };
      }
      return { targetPlayerNum: humanPlayerNum, targetHitbox: pickRandom(humanHitboxes) };
    }
  }
}
