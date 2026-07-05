import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/")({
  component: Index,
});

// ---------- Tile world ----------
const TILE = 32;
const COLS = 30;
const ROWS = 17;

const AIR = 0;
const BLOCK = 1; // bridge / world (indestructible)
const PLACED = 2; // player-placed (destructible, cleared on reset)

const BRIDGE_ROW = 10;
const BRIDGE_START = 1;
const BRIDGE_END = 26; // inclusive

const BLUE_GOAL = { col: BRIDGE_START, row: BRIDGE_ROW - 1 };
const RED_GOAL = { col: BRIDGE_END, row: BRIDGE_ROW - 1 };

const RED_SPAWN = { x: (BRIDGE_END - 2) * TILE, y: (BRIDGE_ROW - 2) * TILE };
const BLUE_SPAWN = { x: (BRIDGE_START + 1) * TILE, y: (BRIDGE_ROW - 2) * TILE };

const MAX_BLOCKS = 5;
const WIN_SCORE = 5;
const SWING_DURATION = 180; // ms
const SWING_COOLDOWN = 380; // ms
const KNOCKBACK_VX = 11;
const KNOCKBACK_VY = -6;

type PlayerId = 0 | 1;

type Controls = {
  left: string;
  right: string;
  jump: string;
  attack: string[];
  place: string;
  breakBlock: string;
};

type Player = {
  id: PlayerId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  color: string;
  name: "Red" | "Blue";
  facing: 1 | -1;
  onGround: boolean;
  blocksLeft: number;
  swingUntil: number;
  swingReadyAt: number;
  spawn: { x: number; y: number };
  controls: Controls;
};

function buildInitialGrid(): number[][] {
  const grid: number[][] = [];
  for (let r = 0; r < ROWS; r++) grid.push(new Array(COLS).fill(AIR));
  for (let c = BRIDGE_START; c <= BRIDGE_END; c++) grid[BRIDGE_ROW][c] = BLOCK;
  return grid;
}

function clearPlacedBlocks(grid: number[][]) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] === PLACED) grid[r][c] = AIR;
    }
  }
}

function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function Index() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scores, setScores] = useState({ red: 0, blue: 0 });
  const [winner, setWinner] = useState<"Red" | "Blue" | null>(null);
  const restartTokenRef = useRef(0);
  const [restartToken, setRestartToken] = useState(0);

  const handleRestart = useCallback(() => {
    setScores({ red: 0, blue: 0 });
    setWinner(null);
    restartTokenRef.current += 1;
    setRestartToken((n) => n + 1);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = 960;
    const H = 540;
    canvas.width = W;
    canvas.height = H;

    const GRAVITY = 0.6;
    const MOVE_SPEED = 4;
    const JUMP_V = 12;

    const grid = buildInitialGrid();

    const isSolid = (col: number, row: number): boolean => {
      if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return false;
      const t = grid[row][col];
      return t === BLOCK || t === PLACED;
    };

    const makePlayer = (
      id: PlayerId,
      name: "Red" | "Blue",
      color: string,
      facing: 1 | -1,
      spawn: { x: number; y: number },
      controls: Controls,
    ): Player => ({
      id,
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      w: 28,
      h: 40,
      color,
      name,
      facing,
      onGround: false,
      blocksLeft: MAX_BLOCKS,
      swingUntil: 0,
      swingReadyAt: 0,
      spawn,
      controls,
    });

    const players: Player[] = [
      makePlayer(0, "Red", "#ef4444", -1, RED_SPAWN, {
        left: "a",
        right: "d",
        jump: "w",
        attack: [" "],
        place: "g",
        breakBlock: "h",
      }),
      makePlayer(1, "Blue", "#3b82f6", 1, BLUE_SPAWN, {
        left: "arrowleft",
        right: "arrowright",
        jump: "arrowup",
        attack: ["enter", "shift"],
        place: "k",
        breakBlock: "l",
      }),
    ];

    const respawnAll = () => {
      clearPlacedBlocks(grid);
      for (const p of players) {
        p.x = p.spawn.x;
        p.y = p.spawn.y;
        p.vx = 0;
        p.vy = 0;
        p.blocksLeft = MAX_BLOCKS;
        p.swingUntil = 0;
      }
    };

    // Local score tracking (mirrored to React state)
    const localScores = { red: 0, blue: 0 };
    let gameOver = false;

    const tryScore = () => {
      // Red enters Blue Goal
      const red = players[0];
      const blue = players[1];
      const bg = { x: BLUE_GOAL.col * TILE, y: BLUE_GOAL.row * TILE, w: TILE, h: TILE };
      const rg = { x: RED_GOAL.col * TILE, y: RED_GOAL.row * TILE, w: TILE, h: TILE };
      let scored = false;
      if (rectsOverlap(red.x, red.y, red.w, red.h, bg.x, bg.y, bg.w, bg.h)) {
        localScores.red += 1;
        scored = true;
      } else if (rectsOverlap(blue.x, blue.y, blue.w, blue.h, rg.x, rg.y, rg.w, rg.h)) {
        localScores.blue += 1;
        scored = true;
      }
      if (scored) {
        setScores({ red: localScores.red, blue: localScores.blue });
        if (localScores.red >= WIN_SCORE) {
          gameOver = true;
          setWinner("Red");
        } else if (localScores.blue >= WIN_SCORE) {
          gameOver = true;
          setWinner("Blue");
        }
        respawnAll();
      }
    };

    // Facing tile in front of player (based on player's vertical center row)
    const frontTile = (p: Player) => {
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      const col = Math.floor(cx / TILE) + p.facing;
      const row = Math.floor(cy / TILE);
      return { col, row };
    };

    const placeBlock = (p: Player) => {
      if (p.blocksLeft <= 0) return;
      const { col, row } = frontTile(p);
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
      if (grid[row][col] !== AIR) return;
      const bx = col * TILE;
      const by = row * TILE;
      // Don't place inside any player
      for (const other of players) {
        if (rectsOverlap(other.x, other.y, other.w, other.h, bx, by, TILE, TILE)) return;
      }
      grid[row][col] = PLACED;
      p.blocksLeft -= 1;
    };

    const breakBlock = (p: Player) => {
      const { col, row } = frontTile(p);
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
      if (grid[row][col] !== PLACED) return; // only player-placed blocks
      grid[row][col] = AIR;
      p.blocksLeft = Math.min(MAX_BLOCKS, p.blocksLeft + 1);
    };

    const swingHitbox = (p: Player) => {
      const reach = 34;
      const x = p.facing === 1 ? p.x + p.w : p.x - reach;
      return { x, y: p.y + 4, w: reach, h: p.h - 8 };
    };

    const attack = (p: Player) => {
      const now = performance.now();
      if (now < p.swingReadyAt) return;
      p.swingUntil = now + SWING_DURATION;
      p.swingReadyAt = now + SWING_COOLDOWN;
      const hb = swingHitbox(p);
      for (const other of players) {
        if (other.id === p.id) continue;
        if (rectsOverlap(hb.x, hb.y, hb.w, hb.h, other.x, other.y, other.w, other.h)) {
          other.vx = KNOCKBACK_VX * p.facing;
          other.vy = KNOCKBACK_VY;
        }
      }
    };

    const keys = new Set<string>();
    const onDown = (e: KeyboardEvent) => {
      if (gameOver) return;
      const k = e.key.toLowerCase();
      if (k.startsWith("arrow") || k === " ") e.preventDefault();
      const wasDown = keys.has(k);
      keys.add(k);
      if (wasDown) return; // edge-triggered actions only fire on initial press

      for (const p of players) {
        if (k === p.controls.jump && p.onGround) {
          p.vy = -JUMP_V;
          p.onGround = false;
        }
        if (p.controls.attack.includes(k)) attack(p);
        if (k === p.controls.place) placeBlock(p);
        if (k === p.controls.breakBlock) breakBlock(p);
      }
    };
    const onUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);

    // Axis-separated tile collision
    const moveAxis = (p: Player, dx: number, dy: number) => {
      p.x += dx;
      if (dx !== 0) {
        const rowTop = Math.floor(p.y / TILE);
        const rowBot = Math.floor((p.y + p.h - 1) / TILE);
        if (dx > 0) {
          const col = Math.floor((p.x + p.w - 1) / TILE);
          for (let r = rowTop; r <= rowBot; r++) {
            if (isSolid(col, r)) {
              p.x = col * TILE - p.w;
              p.vx = 0;
              break;
            }
          }
        } else {
          const col = Math.floor(p.x / TILE);
          for (let r = rowTop; r <= rowBot; r++) {
            if (isSolid(col, r)) {
              p.x = (col + 1) * TILE;
              p.vx = 0;
              break;
            }
          }
        }
      }
      p.y += dy;
      p.onGround = false;
      if (dy !== 0) {
        const colLeft = Math.floor(p.x / TILE);
        const colRight = Math.floor((p.x + p.w - 1) / TILE);
        if (dy > 0) {
          const row = Math.floor((p.y + p.h - 1) / TILE);
          for (let c = colLeft; c <= colRight; c++) {
            if (isSolid(c, row)) {
              p.y = row * TILE - p.h;
              p.vy = 0;
              p.onGround = true;
              break;
            }
          }
        } else {
          const row = Math.floor(p.y / TILE);
          for (let c = colLeft; c <= colRight; c++) {
            if (isSolid(c, row)) {
              p.y = (row + 1) * TILE;
              p.vy = 0;
              break;
            }
          }
        }
      }
    };

    let raf = 0;
    const loop = () => {
      const now = performance.now();

      if (!gameOver) {
        // Input → intent
        for (const p of players) {
          // Horizontal input applies as an impulse toward MOVE_SPEED so knockback persists briefly.
          const left = keys.has(p.controls.left);
          const right = keys.has(p.controls.right);
          if (left && !right) {
            p.vx = -MOVE_SPEED;
            p.facing = -1;
          } else if (right && !left) {
            p.vx = MOVE_SPEED;
            p.facing = 1;
          } else {
            // Friction / decay for knockback
            if (Math.abs(p.vx) > 0.5) p.vx *= 0.82;
            else p.vx = 0;
          }
          p.vy += GRAVITY;
          if (p.vy > 20) p.vy = 20;

          moveAxis(p, p.vx, 0);
          moveAxis(p, 0, p.vy);

          if (p.y > H + 200) {
            p.x = p.spawn.x;
            p.y = p.spawn.y;
            p.vx = 0;
            p.vy = 0;
          }
        }

        tryScore();
      }

      // ---------- Draw ----------
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#0f172a");
      grad.addColorStop(1, "#1e293b");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = "rgba(255,255,255,0.4)";
      for (let i = 0; i < 40; i++) {
        const sx = (i * 97) % W;
        const sy = (i * 53) % (H / 2);
        ctx.fillRect(sx, sy, 2, 2);
      }

      ctx.fillStyle = "#000";
      ctx.fillRect(0, (BRIDGE_ROW + 1) * TILE + 8, W, H);

      // Goals (rendered before tiles so bridge blocks don't get covered)
      const drawGoal = (col: number, row: number, color: string, glow: string) => {
        const x = col * TILE;
        const y = row * TILE;
        // Glow
        const g = ctx.createRadialGradient(x + TILE / 2, y + TILE / 2, 2, x + TILE / 2, y + TILE / 2, TILE);
        g.addColorStop(0, glow);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x - TILE / 2, y - TILE / 2, TILE * 2, TILE * 2);
        // Core
        ctx.fillStyle = color;
        ctx.fillRect(x + 4, y + 4, TILE - 8, TILE - 8);
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 4.5, y + 4.5, TILE - 9, TILE - 9);
      };
      // Pulse
      const pulse = 0.55 + 0.25 * Math.sin(now / 250);
      drawGoal(BLUE_GOAL.col, BLUE_GOAL.row, "#3b82f6", `rgba(59,130,246,${pulse})`);
      drawGoal(RED_GOAL.col, RED_GOAL.row, "#ef4444", `rgba(239,68,68,${pulse})`);

      // Tiles
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const t = grid[r][c];
          if (t === AIR) continue;
          const x = c * TILE;
          const y = r * TILE;
          if (t === BLOCK) {
            ctx.fillStyle = "#78716c";
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = "#a8a29e";
            ctx.fillRect(x, y, TILE, 3);
            ctx.fillStyle = "#57534e";
            ctx.fillRect(x, y + TILE - 4, TILE, 4);
            ctx.strokeStyle = "#44403c";
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
          } else {
            // PLACED — warmer wooden look
            ctx.fillStyle = "#b45309";
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = "#d97706";
            ctx.fillRect(x, y, TILE, 3);
            ctx.fillStyle = "#78350f";
            ctx.fillRect(x, y + TILE - 4, TILE, 4);
            ctx.strokeStyle = "#451a03";
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
          }
        }
      }

      // Sword swings
      for (const p of players) {
        if (now < p.swingUntil) {
          const hb = swingHitbox(p);
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.fillRect(hb.x, hb.y + hb.h / 2 - 3, hb.w, 6);
          ctx.fillStyle = "rgba(226,232,240,0.6)";
          ctx.fillRect(hb.x, hb.y, hb.w, hb.h);
        }
      }

      // Players
      for (const p of players) {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        // Eyes reflect facing
        ctx.fillStyle = "#fff";
        ctx.fillRect(p.x + 6, p.y + 10, 5, 5);
        ctx.fillRect(p.x + 17, p.y + 10, 5, 5);
        ctx.fillStyle = "#000";
        const pupilOffset = p.facing === 1 ? 2 : 0;
        ctx.fillRect(p.x + 6 + pupilOffset, p.y + 12, 2, 2);
        ctx.fillRect(p.x + 17 + pupilOffset, p.y + 12, 2, 2);
        // Block count pips above head
        for (let i = 0; i < p.blocksLeft; i++) {
          ctx.fillStyle = "#fbbf24";
          ctx.fillRect(p.x + i * 6, p.y - 8, 4, 4);
        }
      }

      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
    // Re-init on restart
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restartToken]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 p-6">
      <h1 className="text-3xl font-bold text-white">Bridge Duel</h1>
      <div className="flex items-center gap-4 text-lg font-semibold">
        <span className="text-red-500">Red: {scores.red}</span>
        <span className="text-slate-500">|</span>
        <span className="text-blue-500">Blue: {scores.blue}</span>
      </div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="rounded-lg border border-slate-700 shadow-2xl"
          style={{ maxWidth: "100%", height: "auto" }}
        />
        {winner && (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-black/75 backdrop-blur-sm">
            <div className="text-5xl font-black tracking-widest text-white">GAME OVER</div>
            <div
              className="mt-3 text-2xl font-bold"
              style={{ color: winner === "Red" ? "#ef4444" : "#3b82f6" }}
            >
              {winner} wins!
            </div>
            <button
              onClick={handleRestart}
              className="mt-6 rounded-md bg-white px-6 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-200"
            >
              Restart
            </button>
          </div>
        )}
      </div>
      <div className="grid max-w-3xl grid-cols-1 gap-2 text-xs text-slate-300 md:grid-cols-2">
        <div className="rounded border border-red-500/30 bg-red-500/5 p-3">
          <div className="mb-1 font-semibold text-red-400">Red — WASD</div>
          Move: A / D · Jump: W · Attack: Space · Place: G · Break: H
        </div>
        <div className="rounded border border-blue-500/30 bg-blue-500/5 p-3">
          <div className="mb-1 font-semibold text-blue-400">Blue — Arrows</div>
          Move: ← → · Jump: ↑ · Attack: Enter/Shift · Place: K · Break: L
        </div>
      </div>
    </div>
  );
}
