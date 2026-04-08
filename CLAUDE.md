@AGENTS.md

# Pirate Wars — Project Handover

## What this is
Turn-based multiplayer pirate ship battle game on Solana. Built for a hackathon (deadline ~May 11).

## Tech Stack
- **Frontend**: Next.js 16 (app router), Tailwind, Socket.io client, Bun runtime
- **Backend**: Node.js + Socket.io in `/backend/`, run with `bun run backend/server.ts`
- **Onchain**: Solana + Anchor (not built yet, devnet)
- **Run**: `bun dev` starts everything (no hot reload — restart manually on backend changes)

## File Structure
```
backend/
  server.ts       — main Socket.io game server
  types.ts        — all shared types (keep in sync with frontend)
  bot/bot.ts      — bot AI logic for practice mode
app/
  page.tsx        — main menu (has inline Practice sub-menu screen)
  practice/game/duel/[difficulty]/page.tsx         — 1v1 practice game UI
  practice/game/three-player/[difficulty]/page.tsx — 1v1v1 practice game UI
```

## Game Modes

### 3-Player / 1v1v1 (simultaneous turns)
- 3 players, 4 hitboxes each, 2 HP per hitbox
- All submit moves simultaneously, resolve at once
- Max 2 powerups per player per game
- Powerups: `double_damage` (2 damage to same hitbox), `shield` (protects own hitbox), `gun_jam` (67% jams target same turn, 33% backfires on attacker)
- Last ship standing wins
- Simultaneous elimination = draw

### Duel / 1v1 (simultaneous turns)
- 2 players, 5 hitboxes each, 2 HP per hitbox
- **Shield is a move (not a powerup)** — choose to shield a hitbox instead of attacking. Does NOT cost a powerup.
- Powerups: `double_damage`, `gun_jam`, `double_turn`
- `double_turn` has two sub-modes: attack x2 (hit 2 enemy hitboxes) OR attack + shield (hit 1 enemy hitbox + shield 1 own hitbox)
- Max 2 powerups per player per game
- **Poseidon's Wrath**: both players shield for 3 consecutive turns → lightning strike hits random hitbox of random player. Fires again at turn 5, then every turn from 6+. Counter resets if either player attacks.
- Simultaneous elimination = draw

## Gun Jam Logic (important — was buggy, now fixed)
- When YOU use gun_jam: 67% → your attack lands + target's gun is jammed (fires same turn), 33% → your attack doesn't land + you take damage on a random alive hitbox (backfire)
- When YOUR gun is jammed (from opponent's successful gun_jam last turn... wait — gun jam takes effect same turn): 67% → your shot just fails, 33% → you take self-damage
- Gun jam state is cleared after the turn it takes effect — it does NOT carry over to next turn

## Move Notation
- 3-player: `p1p2h3` (p1 attacks p2 hitbox 3), `p1p2h3_dd`, `p1p2h3_sh1`, `p1p2h3_gjp2`
- Duel: `p1h3`, `p1h3_dd`, `p1h3_gj`, `p1s3` (shield), `p1h1_dth3` (double turn attack x2), `p1h1_dts3` (double turn attack h1 + shield h3), `pw_h4p1` (Poseidon)
- Backfire/jam: `p1_jammed`, `p1_backfire_h2`
- Draw: `game_ended` emits `winner: "draw"`

## Socket Events (client → server)
- `join_practice` `{ userId, username, gameMode, difficulty }` — start a practice game instantly
- `three_player_move` `{ roomId, userId, targetPlayerNum, targetHitbox, powerUp?, difficulty }`
- `duel_move` `{ roomId, userId, move, difficulty }`
- `resign` `{ roomId, userId }`
- `get_game_state` `{ roomId }` — for spectators/agents

## Socket Events (server → client)
- `match_found` — game created, full game state
- `move_submitted` — your move was received (no status text update in practice — bots resolve instantly)
- `turn_resolved` `{ notations, gameState }` — all moves resolved
- `player_eliminated` `{ userId }`
- `game_ended` `{ winner, history }` — winner is userId, "draw", or null

## Bot Difficulty Logic
**Duel:**
- easy: always shield
- medium: 2/3 shield, 1/3 attack
- hard: always attack (will likely result in draws often)

**1v1v1:**
- easy: bots attack each other, only target player when 1v1 remains
- medium: 50% chance target player
- hard: 80% chance target player

## Currency: Dabloons
- Offchain ticket abstraction backed by SOL (no real SPL token yet)
- 100 free on signup, buy more via SOL payment
- Balance will be stored onchain in a PDA (not built yet)
- API key system for agents (no onchain delegation needed)

## What's Working
- [x] Main menu with Practice sub-menu (mode + difficulty selection)
- [x] Practice mode 1v1 and 1v1v1 with bots (all difficulties)
- [x] Full game logic: hitboxes, powerups, gun jam, double damage, double turn, Poseidon's Wrath
- [x] Simultaneous resolution — all moves from turn-start state, order doesn't matter
- [x] Draw detection (simultaneous mutual elimination)
- [x] Human eliminated mid-1v1v1 (bots still fighting) → shows Defeated immediately
- [x] Game over state correctly updates hitbox visuals before showing result screen
- [x] Separate duel and three-player practice pages with mode-appropriate UIs
- [x] Shield as move (not powerup) in duel UI — separate from powerup bar
- [x] Double turn with attack x2 OR attack+shield sub-modes
- [x] Both hitboxes highlight simultaneously when selecting double_turn attack x2

## What's NOT Built Yet (next steps in priority order)
1. **Turn timeout enforcement** — 15s timer auto-submits a random move if player doesn't submit (server-side `setTimeout`)
2. **Play mode** — real multiplayer matchmaking (human vs human), needs wallet connect (Privy or Dynamic)
3. **Watch mode** — spectator UI, uses `get_game_state` socket event
4. **Solana program** — escrow + match result recording + Dabloon purchase instruction
5. **Prediction market** — spectator bets, onchain payouts
6. **First Mate** — configurable AI agent with API key auth
7. **Duel mode improvements** — rating system, tiers, matchmaking by tier
8. **Polish** — animations, music/SFX, proper ship sprites (concept.png in /public)

## Important Notes
- **ALWAYS use `window.location.href` for navigation, never `router.push` or `<Link>`** — Next.js RSC/turbopack causes chunk rebuild mid-navigation in dev which breaks socket timing and causes double-click issues
- `pendingMoves` is a Map and must be stripped before emitting over socket — use `serializeGame()` helper
- Bot moves are injected server-side via `injectBotMovesIfNeeded()` after each human move — bots have empty socketIds
- USER_ID in frontend is generated with `useRef` to stay stable across re-renders
- Simultaneous resolution: use `aliveAtTurnStart` Set to determine who can act/be targeted — mid-turn eliminations don't affect same-turn moves
- `endGame()` emits `turn_resolved` (with final state) THEN `game_ended` — frontend must NOT set winner state in `turn_resolved` when `gs.gameStatus === "ended"`, let `game_ended` handle it
- Practice mode routes: `/practice/game/duel/[difficulty]` and `/practice/game/three-player/[difficulty]`
- Main menu navigates to these via `window.location.href` with mode mapped: `1v1 → duel`, `1v1v1 → three-player`
- Gun jam clears after the turn it fires — `p1.isGunJammed = false; p2.isGunJammed = false` at end of `resolveDuelTurn`
- **`useCallback` deps must include ALL state used inside** — missing deps cause stale closures where the function reads old state values. Every state variable used in `submitMove` must be in its dependency array.
- Double damage hits the SAME hitbox twice (not two different hitboxes)
- Shield in 3-player is a powerup that records in notation but the attack still goes through (shield is cosmetic/notation only in 3p)
