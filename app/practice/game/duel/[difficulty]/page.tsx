"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { io, Socket } from "socket.io-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Difficulty = "easy" | "medium" | "hard";
type DuelPowerUp = "double_damage" | "gun_jam";

interface BasePlayer {
  userId: string;
  username: string;
  participantType: "human" | "ai";
  hitboxes: number[];
  powerUpsUsed: number;
  isEliminated: boolean;
  isGunJammed: boolean;
}

interface GameState {
  roomId: string;
  mode: "duel";
  players: BasePlayer[];
  gameStatus: "waiting" | "started" | "ended";
  moveHistory: string[];
  winner: string | null;
  turnDeadline: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USERNAME = "Captain";

function hpColor(hp: number): string {
  if (hp >= 2) return "#22c55e";
  if (hp === 1) return "#f59e0b";
  return "#374151";
}

function difficultyLabel(d: string): string {
  return d.charAt(0).toUpperCase() + d.slice(1);
}

// ---------------------------------------------------------------------------
// Ship component
// ---------------------------------------------------------------------------

function ShipCard({
  player,
  isMe,
  isEliminated,
  isSelecting,
  selectedHitbox,
  onHitboxClick,
  showShieldSelect,
  onShieldHitboxClick,
  shieldSelectedHitbox,
  selectedHitboxes,
}: {
  player: BasePlayer;
  isMe: boolean;
  isEliminated: boolean;
  isSelecting: boolean;
  selectedHitbox: number | null;
  selectedHitboxes?: number[];
  onHitboxClick: (hitbox: number) => void;
  showShieldSelect?: boolean;
  onShieldHitboxClick?: (hitbox: number) => void;
  shieldSelectedHitbox?: number | null;
}) {
  return (
    <div style={{
      border: isMe
        ? "2px solid rgba(99,179,237,0.6)"
        : isSelecting
        ? "2px solid rgba(245,158,11,0.8)"
        : "1px solid rgba(200,150,60,0.2)",
      background: isEliminated ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.03)",
      borderRadius: 8,
      padding: "12px 16px",
      opacity: isEliminated ? 0.45 : 1,
      transition: "all 0.15s",
      minWidth: 180,
    }}>
      <div style={{
        fontFamily: "'Cinzel', serif",
        fontSize: "0.75rem",
        letterSpacing: "0.1em",
        color: isMe ? "rgba(99,179,237,0.9)" : "rgba(200,160,80,0.7)",
        marginBottom: 6,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <span>{player.username} {isMe ? "(You)" : player.participantType === "ai" ? "⚙ Bot" : ""}</span>
        {player.isGunJammed && <span style={{ color: "#ef4444", fontSize: "0.6rem" }}>🔒 JAMMED</span>}
        {isEliminated && <span style={{ color: "#6b7280" }}>☠ SUNK</span>}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {player.hitboxes.map((hp, i) => {
          const hitboxNum = i + 1;
          const isSelected = selectedHitboxes ? selectedHitboxes.includes(hitboxNum) : selectedHitbox === hitboxNum;
          const isShieldSelected = shieldSelectedHitbox === hitboxNum;
          const isDestroyed = hp <= 0;
          const clickable = !isDestroyed && (isSelecting || (showShieldSelect && isMe));

          return (
            <button
              key={i}
              disabled={isDestroyed || (!isSelecting && !(showShieldSelect && isMe))}
              onClick={() => {
                if (isSelecting && !isDestroyed) onHitboxClick(hitboxNum);
                if (showShieldSelect && isMe && !isDestroyed && onShieldHitboxClick) onShieldHitboxClick(hitboxNum);
              }}
              style={{
                width: 36, height: 36, borderRadius: 4,
                border: isSelected
                  ? "2px solid #f59e0b"
                  : isShieldSelected
                  ? "2px solid #60a5fa"
                  : "1px solid rgba(255,255,255,0.1)",
                background: isDestroyed
                  ? "#1f2937"
                  : isSelected
                  ? "rgba(245,158,11,0.2)"
                  : isShieldSelected
                  ? "rgba(96,165,250,0.2)"
                  : "rgba(255,255,255,0.05)",
                cursor: clickable ? "pointer" : "default",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
                transition: "all 0.1s",
              }}
              title={`Hitbox ${hitboxNum}: ${hp} HP`}
            >
              <span style={{ fontSize: "0.5rem", color: "rgba(255,255,255,0.4)" }}>H{hitboxNum}</span>
              <div style={{ display: "flex", gap: 2 }}>
                {[0, 1].map((dot) => (
                  <div key={dot} style={{
                    width: 6, height: 6, borderRadius: "50%",
                    background: dot < hp ? hpColor(hp) : "#374151",
                  }} />
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function DuelGameInner({ difficulty }: { difficulty: Difficulty }) {
  const userIdRef = useRef(`user_${Math.random().toString(36).slice(2, 9)}`);
  const USER_ID = userIdRef.current;

  const socketRef = useRef<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [status, setStatus] = useState<string>("Connecting...");
  const [submitted, setSubmitted] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  const [lastNotations, setLastNotations] = useState<string[]>([]);
  const [timeLeft, setTimeLeft] = useState<number>(15);

  // Move selection
  const [selectedHitbox, setSelectedHitbox] = useState<number | null>(null);
  const [moveType, setMoveType] = useState<"attack" | "shield">("attack");
  const [activePowerUp, setActivePowerUp] = useState<string | null>(null); // "double_damage" | "gun_jam" | "double_turn"
  const [shieldHitbox, setShieldHitbox] = useState<number | null>(null);
  const [doubleTurnH2, setDoubleTurnH2] = useState<number | null>(null);
  const [doubleTurnShield, setDoubleTurnShield] = useState<number | null>(null);
  const [doubleTurnMode, setDoubleTurnMode] = useState<"attack" | "shield">("attack"); // sub-mode for double_turn

  const me = gameState?.players.find((p) => p.userId === USER_ID);
  const opponent = gameState?.players.find((p) => p.userId !== USER_ID);

  // Turn timer
  useEffect(() => {
    if (!gameState || gameState.gameStatus !== "started" || submitted || winner) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((gameState.turnDeadline - Date.now()) / 1000));
      setTimeLeft(remaining);
    }, 500);
    return () => clearInterval(interval);
  }, [gameState, submitted, winner]);

  // Socket setup
  useEffect(() => {
    const socket = io();
    socketRef.current = socket;

    socket.on("connect", () => {
      setStatus("Connected — starting practice...");
      socket.emit("join_practice", { userId: USER_ID, username: USERNAME, gameMode: "duel", difficulty });
    });

    socket.on("match_found", (data: GameState) => {
      setGameState(data);
      setStatus("Game started!");
      setSubmitted(false);
    });

    socket.on("move_submitted", () => { setSubmitted(true); });

    socket.on("turn_resolved", ({ notations, gameState: gs }: { notations: string[]; gameState: GameState }) => {
      setGameState(gs);
      setLastNotations(notations);
      setSubmitted(false);
      resetSelection();
      if (gs.gameStatus !== "ended") {
        setStatus("Turn resolved — make your move!");
      }
    });

    socket.on("game_ended", ({ winner: w }: { winner: string | null }) => {
      const result = w === null || w === "draw" ? "draw" : w;
      setWinner(result);
      setStatus(result === USER_ID ? "⚓ Victory! You won!" : result === "draw" ? "⚓ Draw! All ships sunk simultaneously." : "☠ Defeated. Better luck next time.");
      setGameState((prev) => prev ? { ...prev, gameStatus: "ended", winner: w } : prev);
    });

    socket.on("error", ({ message }: { message: string }) => setStatus(`Error: ${message}`));
    socket.on("disconnect", () => setStatus("Disconnected"));

    return () => { socket.disconnect(); };
  }, [difficulty]);

  function resetSelection() {
    setSelectedHitbox(null);
    setMoveType("attack");
    setActivePowerUp(null);
    setShieldHitbox(null);
    setDoubleTurnH2(null);
    setDoubleTurnShield(null);
    setDoubleTurnMode("attack");
  }

  // ---------------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------------

  const submitMove = useCallback(() => {
    if (!socketRef.current || !gameState || submitted || !me || me.isEliminated) return;
    const roomId = gameState.roomId;
    const userId = USER_ID;

    if (moveType === "shield") {
      if (shieldHitbox === null) { setStatus("Pick a hitbox to shield"); return; }
      socketRef.current.emit("duel_move", { roomId, userId, move: { type: "shield", hitbox: shieldHitbox }, difficulty });
      return;
    }
    if (activePowerUp === "double_turn") {
      if (doubleTurnMode === "shield") {
        if (selectedHitbox === null) { setStatus("Pick a hitbox to attack"); return; }
        if (doubleTurnShield === null) { setStatus("Pick a hitbox to shield"); return; }
        socketRef.current.emit("duel_move", { roomId, userId, move: { type: "double_turn", targetHitbox1: selectedHitbox, targetHitbox2: selectedHitbox, shieldHitbox: doubleTurnShield }, difficulty });
      } else {
        if (selectedHitbox === null || doubleTurnH2 === null) { setStatus("Pick 2 hitboxes to attack"); return; }
        socketRef.current.emit("duel_move", { roomId, userId, move: { type: "double_turn", targetHitbox1: selectedHitbox, targetHitbox2: doubleTurnH2 }, difficulty });
      }
      return;
    }
    if (selectedHitbox === null) { setStatus("Pick a hitbox to attack"); return; }
    const powerUp = (activePowerUp === "double_damage" || activePowerUp === "gun_jam") ? activePowerUp as DuelPowerUp : undefined;
    socketRef.current.emit("duel_move", { roomId, userId, move: { type: "attack", targetHitbox: selectedHitbox, powerUp }, difficulty });
  }, [gameState, submitted, me, moveType, activePowerUp, selectedHitbox, shieldHitbox, doubleTurnH2, doubleTurnShield, doubleTurnMode, difficulty]);

  const canSubmit = () => {
    if (!me || me.isEliminated || submitted || winner) return false;
    if (moveType === "shield") return shieldHitbox !== null;
    if (activePowerUp === "double_turn") {
      if (doubleTurnMode === "shield") return selectedHitbox !== null && doubleTurnShield !== null;
      return selectedHitbox !== null && doubleTurnH2 !== null;
    }
    return selectedHitbox !== null;
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!gameState) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #0a0e1a 0%, #0d1829 50%, #091520 100%)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'Cinzel', serif", color: "rgba(200,160,80,0.7)", letterSpacing: "0.2em",
      }}>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&display=swap');`}</style>
        {status}
      </div>
    );
  }

  const isShieldingThisTurn = moveType === "shield";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700&family=Cinzel:wght@400;600&display=swap');

        .pu-btn {
          font-family: 'Cinzel', serif;
          font-size: 0.65rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          border: 1px solid rgba(200,150,60,0.25);
          background: rgba(255,255,255,0.03);
          color: rgba(200,160,80,0.6);
          padding: 6px 10px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .pu-btn:hover:not(:disabled) {
          border-color: rgba(200,150,60,0.5);
          color: rgba(240,190,80,0.9);
          background: rgba(255,180,60,0.06);
        }
        .pu-btn.active {
          background: rgba(180,110,20,0.3);
          border-color: rgba(220,160,60,0.7);
          color: #f5d080;
        }
        .pu-btn.shield-active {
          background: rgba(30,80,180,0.3);
          border-color: rgba(96,165,250,0.7);
          color: #93c5fd;
        }
        .pu-btn:disabled { opacity: 0.3; cursor: not-allowed; }

        .move-btn {
          font-family: 'Cinzel', serif;
          font-size: 0.7rem;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          border: 1px solid rgba(200,150,60,0.3);
          background: rgba(255,255,255,0.03);
          color: rgba(200,160,80,0.7);
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .move-btn:hover:not(:disabled) {
          border-color: rgba(200,150,60,0.6);
          color: rgba(240,190,80,1);
          background: rgba(255,180,60,0.06);
        }
        .move-btn.active {
          background: rgba(180,110,20,0.3);
          border-color: rgba(220,160,60,0.7);
          color: #f5d080;
        }
        .move-btn.shield-mode {
          border-color: rgba(96,165,250,0.4);
          color: rgba(147,197,253,0.7);
        }
        .move-btn.shield-mode:hover:not(:disabled) {
          border-color: rgba(96,165,250,0.7);
          color: #93c5fd;
          background: rgba(96,165,250,0.06);
        }
        .move-btn.shield-mode.active {
          background: rgba(30,80,180,0.3);
          border-color: rgba(96,165,250,0.7);
          color: #93c5fd;
        }
        .move-btn:disabled { opacity: 0.3; cursor: not-allowed; }

        .submit-btn {
          font-family: 'Cinzel', serif;
          font-weight: 600;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          clip-path: polygon(8px 0%, calc(100% - 8px) 0%, 100% 50%, calc(100% - 8px) 100%, 8px 100%, 0% 50%);
          background: linear-gradient(180deg, #5c3a1e 0%, #3b2010 40%, #2a1508 100%);
          color: #f5e6c8;
          border: none;
          padding: 12px 32px;
          cursor: pointer;
          transition: transform 0.15s, filter 0.15s;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
        }
        .submit-btn:hover:not(:disabled) {
          transform: scale(1.04);
          filter: brightness(1.3) drop-shadow(0 0 12px rgba(255,180,60,0.4));
        }
        .submit-btn:disabled { opacity: 0.35; cursor: not-allowed; }
      `}</style>

      <div style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #0a0e1a 0%, #0d1829 40%, #0e2236 70%, #091520 100%)",
        padding: "24px 16px",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 20,
      }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, width: "100%", maxWidth: 720 }}>
          <button
            onClick={() => { window.location.href = "/"; }}
            style={{ fontFamily: "'Cinzel', serif", fontSize: "0.65rem", letterSpacing: "0.15em", color: "rgba(180,140,60,0.5)", background: "none", border: "none", cursor: "pointer" }}
          >
            ← PORT
          </button>
          <div style={{ flex: 1, textAlign: "center" }}>
            <span style={{
              fontFamily: "'Cinzel Decorative', serif", fontSize: "1.1rem",
              background: "linear-gradient(180deg, #ffe8a0, #c07820)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
              filter: "drop-shadow(0 0 10px rgba(255,150,30,0.4))",
            }}>
              Practice — 1V1 · {difficultyLabel(difficulty)}
            </span>
          </div>
          <div style={{
            fontFamily: "'Cinzel', serif", fontSize: "1.2rem", fontWeight: 600,
            color: timeLeft <= 5 ? "#ef4444" : "rgba(200,160,80,0.8)",
            minWidth: 36, textAlign: "right",
            visibility: (!winner && !submitted) ? "visible" : "hidden",
          }}>
            {timeLeft}s
          </div>
        </div>

        {/* Status */}
        <div style={{
          fontFamily: "'Cinzel', serif", fontSize: "0.7rem", letterSpacing: "0.15em",
          color: winner ? (winner === USER_ID ? "#22c55e" : winner === "draw" ? "#60a5fa" : "#ef4444") : "rgba(180,140,60,0.6)",
          textAlign: "center",
        }}>
          {status}
        </div>

        {/* Last turn notations */}
        {lastNotations.length > 0 && (
          <div style={{ fontFamily: "monospace", fontSize: "0.7rem", color: "rgba(150,120,60,0.5)", letterSpacing: "0.05em", textAlign: "center" }}>
            {lastNotations.join("  ·  ")}
          </div>
        )}

        {/* Ships */}
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", justifyContent: "center", width: "100%", maxWidth: 720 }}>
          {opponent && (
            <ShipCard
              player={opponent}
              isMe={false}
              isEliminated={opponent.isEliminated}
              isSelecting={!opponent.isEliminated && !submitted && !winner && moveType === "attack"}
              selectedHitbox={selectedHitbox}
              selectedHitboxes={activePowerUp === "double_turn" && doubleTurnMode === "attack" ? [selectedHitbox, doubleTurnH2].filter((h): h is number => h !== null) : undefined}
              onHitboxClick={(hb) => {
                if (activePowerUp === "double_turn") {
                  if (doubleTurnMode === "shield") {
                    setSelectedHitbox(hb); // only one attack target in shield mode
                  } else {
                    if (selectedHitbox === null) setSelectedHitbox(hb);
                    else setDoubleTurnH2(hb);
                  }
                } else {
                  setSelectedHitbox(hb);
                }
              }}
            />
          )}
          {me && (
            <ShipCard
              player={me}
              isMe={true}
              isEliminated={me.isEliminated}
              isSelecting={false}
              selectedHitbox={null}
              onHitboxClick={() => {}}
              showShieldSelect={isShieldingThisTurn || (activePowerUp === "double_turn" && doubleTurnMode === "shield")}
              shieldSelectedHitbox={activePowerUp === "double_turn" ? doubleTurnShield : shieldHitbox}
              onShieldHitboxClick={(hb) => activePowerUp === "double_turn" ? setDoubleTurnShield(hb) : setShieldHitbox(hb)}
            />
          )}
        </div>

        {/* Controls */}
        {!winner && !submitted && me && !me.isEliminated && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, width: "100%", maxWidth: 520 }}>

            {/* Move type row */}
            <div style={{ borderTop: "1px solid rgba(200,150,60,0.15)", paddingTop: 12, width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
              <span style={{ fontFamily: "'Cinzel', serif", fontSize: "0.6rem", letterSpacing: "0.2em", color: "rgba(180,140,60,0.4)", textAlign: "center" }}>
                CHOOSE YOUR MOVE
              </span>
              <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                {/* Attack (default, no special) */}
                <button
                  className={`move-btn ${moveType === "attack" ? "active" : ""}`}
                  onClick={() => { setMoveType("attack"); setShieldHitbox(null); }}
                >
                  ⚔ Attack
                </button>
                {/* Shield — a move, not a powerup */}
                <button
                  className={`move-btn shield-mode ${moveType === "shield" ? "active" : ""}`}
                  onClick={() => { setMoveType(moveType === "shield" ? "attack" : "shield"); setSelectedHitbox(null); setActivePowerUp(null); setShieldHitbox(null); }}
                >
                  🛡 Shield
                </button>
              </div>
            </div>

            {/* Double turn sub-mode toggle */}
            {activePowerUp === "double_turn" && (
              <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
                <button
                  className={`pu-btn ${doubleTurnMode === "attack" ? "active" : ""}`}
                  onClick={() => { setDoubleTurnMode("attack"); setDoubleTurnShield(null); setDoubleTurnH2(null); setSelectedHitbox(null); }}
                >
                  ⚔⚔ Attack x2
                </button>
                <button
                  className={`pu-btn ${doubleTurnMode === "shield" ? "active" : ""}`}
                  onClick={() => { setDoubleTurnMode("shield"); setDoubleTurnH2(null); setSelectedHitbox(null); }}
                >
                  ⚔🛡 Attack + Shield
                </button>
              </div>
            )}

            {/* Powerups row (only when attacking) */}
            {moveType === "attack" && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                <span style={{ fontFamily: "'Cinzel', serif", fontSize: "0.6rem", letterSpacing: "0.2em", color: "rgba(180,140,60,0.4)", alignSelf: "center" }}>
                  POWERUPS ({2 - (me.powerUpsUsed)} left)
                </span>
                <button
                  className={`pu-btn ${activePowerUp === "double_damage" ? "active" : ""}`}
                  disabled={me.powerUpsUsed >= 2 && activePowerUp !== "double_damage"}
                  onClick={() => setActivePowerUp(activePowerUp === "double_damage" ? null : "double_damage")}
                >
                  💥 Double Dmg
                </button>
                <button
                  className={`pu-btn ${activePowerUp === "gun_jam" ? "active" : ""}`}
                  disabled={me.powerUpsUsed >= 2 && activePowerUp !== "gun_jam"}
                  onClick={() => setActivePowerUp(activePowerUp === "gun_jam" ? null : "gun_jam")}
                >
                  🔒 Gun Jam
                </button>
                <button
                  className={`pu-btn ${activePowerUp === "double_turn" ? "active" : ""}`}
                  disabled={me.powerUpsUsed >= 2 && activePowerUp !== "double_turn"}
                  onClick={() => { setActivePowerUp(activePowerUp === "double_turn" ? null : "double_turn"); setSelectedHitbox(null); setDoubleTurnH2(null); }}
                >
                  ⚡ Double Turn
                </button>
              </div>
            )}

            {/* Hint */}
            <div style={{ fontFamily: "'Cinzel', serif", fontSize: "0.6rem", letterSpacing: "0.1em", color: "rgba(150,120,60,0.5)", textAlign: "center", minHeight: 16 }}>
              {moveType === "shield" && !shieldHitbox && "Click a hitbox on YOUR ship to shield it"}
              {moveType === "shield" && shieldHitbox && `Shielding H${shieldHitbox} — ready to fire`}
              {moveType === "attack" && activePowerUp === "double_turn" && doubleTurnMode === "attack" && !selectedHitbox && "Click 1st hitbox to attack"}
              {moveType === "attack" && activePowerUp === "double_turn" && doubleTurnMode === "attack" && selectedHitbox && !doubleTurnH2 && "Click 2nd hitbox to attack"}
              {moveType === "attack" && activePowerUp === "double_turn" && doubleTurnMode === "shield" && !selectedHitbox && "Click enemy hitbox to attack"}
              {moveType === "attack" && activePowerUp === "double_turn" && doubleTurnMode === "shield" && selectedHitbox && !doubleTurnShield && "Click your hitbox to shield"}
              {moveType === "attack" && activePowerUp !== "double_turn" && !selectedHitbox && "Click a hitbox on the enemy ship to attack"}
            </div>

            <button className="submit-btn" disabled={!canSubmit()} onClick={submitMove}>
              Fire!
            </button>
          </div>
        )}

        {submitted && !winner && (
          <div style={{ fontFamily: "'Cinzel', serif", fontSize: "0.7rem", letterSpacing: "0.2em", color: "rgba(200,160,80,0.5)" }}>
            Waiting for resolution...
          </div>
        )}

        {/* Game over */}
        {winner && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, marginTop: 12 }}>
            <div style={{
              fontFamily: "'Cinzel Decorative', serif", fontSize: "1.5rem",
              background: winner === USER_ID
                ? "linear-gradient(180deg, #ffe8a0, #22c55e)"
                : winner === "draw"
                ? "linear-gradient(180deg, #ffe8a0, #60a5fa)"
                : "linear-gradient(180deg, #fca5a5, #ef4444)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
            }}>
              {winner === USER_ID ? "Victory!" : winner === "draw" ? "Draw!" : "Defeated"}
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                className="submit-btn"
                onClick={() => {
                  setGameState(null); setWinner(null); setLastNotations([]);
                  setStatus("Connecting..."); setSubmitted(false); resetSelection();
                  socketRef.current?.emit("join_practice", { userId: USER_ID, username: USERNAME, gameMode: "duel", difficulty });
                }}
              >
                Play Again
              </button>
              <button className="submit-btn" onClick={() => { window.location.href = "/"; }}>
                Port
              </button>
            </div>
            <div style={{ fontFamily: "monospace", fontSize: "0.65rem", color: "rgba(150,120,60,0.4)", maxWidth: 480, textAlign: "center", lineHeight: 1.8 }}>
              {gameState?.moveHistory.join(" · ")}
            </div>
          </div>
        )}

      </div>
    </>
  );
}

export default function DuelPracticePage() {
  const params = useParams();
  const difficulty = (params.difficulty as Difficulty) ?? "easy";
  return <DuelGameInner difficulty={difficulty} />;
}
