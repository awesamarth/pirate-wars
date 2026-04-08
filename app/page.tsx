"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Screen = "main" | "practice";
type PracticeMode = "1v1" | "1v1v1" | null;
type Difficulty = "easy" | "medium" | "hard" | null;

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [screen, setScreen] = useState<Screen>("main");
  const [practiceMode, setPracticeMode] = useState<PracticeMode>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>(null);
  const router = useRouter();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles: { x: number; y: number; r: number; speed: number; opacity: number; drift: number }[] = [];
    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.5 + 0.3,
        speed: Math.random() * 0.3 + 0.05,
        opacity: Math.random() * 0.5 + 0.1,
        drift: (Math.random() - 0.5) * 0.2,
      });
    }

    let frame: number;
    function draw() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(180, 220, 255, ${p.opacity})`;
        ctx.fill();
        p.y -= p.speed;
        p.x += p.drift;
        if (p.y < -5) { p.y = canvas.height + 5; p.x = Math.random() * canvas.width; }
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
      }
      frame = requestAnimationFrame(draw);
    }
    draw();

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", resize); };
  }, []);

  function goBack() {
    setScreen("main");
    setPracticeMode(null);
    setDifficulty(null);
  }

  const canStart = practiceMode !== null && difficulty !== null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cinzel+Decorative:wght@700;900&family=Cinzel:wght@400;600&display=swap');

        .menu-btn {
          position: relative;
          font-family: 'Cinzel', serif;
          font-weight: 600;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: #f5e6c8;
          background: linear-gradient(180deg, #5c3a1e 0%, #3b2010 40%, #2a1508 100%);
          border: none;
          padding: 0;
          cursor: pointer;
          clip-path: polygon(8px 0%, calc(100% - 8px) 0%, 100% 50%, calc(100% - 8px) 100%, 8px 100%, 0% 50%);
          transition: transform 0.15s ease, filter 0.15s ease;
          text-shadow: 0 1px 3px rgba(0,0,0,0.8);
          box-shadow: 0 4px 20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,220,150,0.15);
        }
        .menu-btn::before {
          content: '';
          position: absolute;
          inset: 0;
          clip-path: polygon(8px 0%, calc(100% - 8px) 0%, 100% 50%, calc(100% - 8px) 100%, 8px 100%, 0% 50%);
          background: linear-gradient(180deg, rgba(255,200,100,0.25) 0%, transparent 50%);
          pointer-events: none;
        }
        .menu-btn::after {
          content: '';
          position: absolute;
          inset: 2px;
          clip-path: polygon(8px 0%, calc(100% - 8px) 0%, 100% 50%, calc(100% - 8px) 100%, 8px 100%, 0% 50%);
          border: 1px solid rgba(200,150,60,0.3);
          pointer-events: none;
        }
        .menu-btn:hover {
          transform: scale(1.04);
          filter: brightness(1.3) drop-shadow(0 0 12px rgba(255,180,60,0.4));
        }
        .menu-btn:active { transform: scale(0.97); }
        .menu-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
          transform: none;
          filter: none;
        }

        .option-btn {
          font-family: 'Cinzel', serif;
          font-weight: 600;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          border: 1px solid rgba(200,150,60,0.25);
          background: rgba(255,255,255,0.03);
          color: rgba(200,160,80,0.6);
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
        }
        .option-btn:hover {
          border-color: rgba(200,150,60,0.5);
          color: rgba(240,190,80,0.9);
          background: rgba(255,180,60,0.06);
        }
        .option-btn.selected {
          background: linear-gradient(135deg, rgba(180,110,20,0.35) 0%, rgba(120,70,10,0.25) 100%);
          border-color: rgba(220,160,60,0.7);
          color: #f5d080;
          box-shadow: 0 0 16px rgba(200,140,30,0.2), inset 0 1px 0 rgba(255,210,100,0.1);
        }

        .back-btn {
          font-family: 'Cinzel', serif;
          font-size: 0.7rem;
          letter-spacing: 0.2em;
          color: rgba(180,140,60,0.4);
          text-transform: uppercase;
          background: none;
          border: none;
          cursor: pointer;
          transition: color 0.2s;
          padding: 0;
        }
        .back-btn:hover { color: rgba(220,170,80,0.8); }

        .section-label {
          font-family: 'Cinzel', serif;
          font-size: 0.65rem;
          letter-spacing: 0.3em;
          text-transform: uppercase;
          color: rgba(180,140,60,0.5);
        }

        .divider {
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(200,150,60,0.2), transparent);
          width: 100%;
        }

        .wave {
          animation: waveBob 4s ease-in-out infinite;
        }
        @keyframes waveBob {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
        }

        .btn-appear {
          opacity: 0;
          transform: translateY(20px);
          animation: btnReveal 0.5s ease forwards;
        }
        @keyframes btnReveal {
          to { opacity: 1; transform: translateY(0); }
        }

        .skull-divider {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .skull-divider::before,
        .skull-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(200,150,60,0.4), transparent);
        }
      `}</style>

      <div
        className="relative min-h-screen overflow-hidden flex flex-col items-center justify-center"
        style={{ background: "linear-gradient(180deg, #0a0e1a 0%, #0d1829 30%, #0e2236 60%, #091520 100%)" }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" style={{ opacity: 0.7 }} />
        <div className="absolute bottom-0 left-0 right-0 h-48 pointer-events-none"
          style={{ background: "linear-gradient(0deg, rgba(10,40,80,0.8) 0%, rgba(15,50,100,0.3) 60%, transparent 100%)" }} />
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 80% 50% at 50% 100%, rgba(20,60,120,0.25) 0%, transparent 70%)" }} />

        <div className="relative z-10 flex flex-col items-center gap-8">

          {/* Title */}
          <div className="wave flex flex-col items-center gap-1">
            <div style={{
              fontFamily: "'Cinzel Decorative', serif",
              fontWeight: 900,
              fontSize: "clamp(3.5rem, 10vw, 6rem)",
              background: "linear-gradient(180deg, #ffe8a0 0%, #f0b830 45%, #c07820 80%, #8b4e10 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              letterSpacing: "0.08em",
              filter: "drop-shadow(0 0 30px rgba(255,150,30,0.5)) drop-shadow(0 0 60px rgba(255,80,10,0.25))",
            }}>PIRATE</div>
            <div style={{
              fontFamily: "'Cinzel Decorative', serif",
              fontWeight: 900,
              fontSize: "clamp(3rem, 8vw, 5.5rem)",
              background: "linear-gradient(180deg, #ffe8a0 0%, #f0b830 45%, #c07820 80%, #8b4e10 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              letterSpacing: "0.25em",
              filter: "drop-shadow(0 0 30px rgba(255,150,30,0.5)) drop-shadow(0 0 60px rgba(255,80,10,0.25))",
            }}>WARS</div>
          </div>

          <div className="skull-divider w-64 text-lg" style={{ color: "rgba(200,150,60,0.6)" }}>☠</div>

          {/* Main menu */}
          {screen === "main" && (
            <div className="flex flex-col items-center gap-4 mt-2">
              {[
                { label: "Play", delay: "0.1s", onClick: () => router.push("/play") },
                { label: "Practice", delay: "0.2s", onClick: () => setScreen("practice") },
                { label: "Watch", delay: "0.3s", onClick: () => router.push("/watch") },
                { label: "First Mate", delay: "0.4s", onClick: () => router.push("/first-mate") },
              ].map(({ label, delay, onClick }) => (
                <button
                  key={label}
                  className="menu-btn btn-appear w-64 py-4 text-lg"
                  style={{ animationDelay: delay }}
                  onClick={onClick}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Practice sub-menu */}
          {screen === "practice" && (
            <div className="flex flex-col items-center gap-5 mt-2 w-72">

              <div className="divider" />

              <div className="flex flex-col items-center gap-3 w-full">
                <p className="section-label">battle mode</p>
                <div className="flex gap-3 w-full">
                  {(["1v1", "1v1v1"] as PracticeMode[]).map((m) => (
                    <button
                      key={m}
                      className={`option-btn flex-1 py-3 rounded text-sm ${practiceMode === m ? "selected" : ""}`}
                      onClick={() => setPracticeMode(m)}
                    >
                      {m === "1v1" ? "⚔ 1v1" : "⚓ 1v1v1"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col items-center gap-3 w-full">
                <p className="section-label">difficulty</p>
                <div className="flex gap-3 w-full">
                  {(["easy", "medium", "hard"] as Difficulty[]).map((d) => (
                    <button
                      key={d}
                      className={`option-btn flex-1 py-3 rounded text-xs ${difficulty === d ? "selected" : ""}`}
                      onClick={() => setDifficulty(d)}
                    >
                      {d === "easy" ? "🟢" : d === "medium" ? "🟡" : "🔴"} {d!.charAt(0).toUpperCase() + d!.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="divider" />

              <button
                className="menu-btn w-56 py-4 text-base"
                disabled={!canStart}
                onClick={() => { window.location.href = `/practice/game/${practiceMode === "1v1" ? "duel" : "three-player"}/${difficulty}`; }}
              >
                Set Sail
              </button>

              <button className="back-btn" onClick={goBack}>← Back</button>
            </div>
          )}

          <p style={{
            fontFamily: "'Cinzel', serif",
            fontSize: "0.65rem",
            letterSpacing: "0.2em",
            color: "rgba(180,140,80,0.35)",
            marginTop: "0.5rem",
          }}>
            BUILT ON SOLANA · DEVNET
          </p>
        </div>
      </div>
    </>
  );
}
