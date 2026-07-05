import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

export const Route = createFileRoute("/")({
  component: Index,
});

type Player = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  color: string;
  onGround: boolean;
  controls: { left: string; right: string; jump: string };
};

// Tile constants — the whole world is data-driven from here.
const TILE = 32;
const COLS = 30; // 30 * 32 = 960
const ROWS = 17; // 17 * 32 = 544 (canvas 540 rounded up; last row hidden in void)

// Tile types
const AIR = 0;
const BLOCK = 1;

function buildInitialGrid(): number[][] {
  const grid: number[][] = [];
  for (let r = 0; r < ROWS; r++) {
    grid.push(new Array(COLS).fill(AIR));
  }
  // Bridge: a single row of blocks perfectly aligned to the grid.
  // Row 10 (y = 320). Starts at col 1, ends at col 26 — 26 whole blocks.
  const bridgeRow = 10;
  const bridgeStartCol = 1;
  const bridgeEndCol = 26; // inclusive
  for (let c = bridgeStartCol; c <= bridgeEndCol; c++) {
    grid[bridgeRow][c] = BLOCK;
  }
  return grid;
}

function Index() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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
      return grid[row][col] === BLOCK;
    };

    // Spawn players standing on the bridge row (y = 10*32 = 320).
    const bridgeTopY = 10 * TILE;
    const players: Player[] = [
      {
        x: 3 * TILE,
        y: bridgeTopY - 40,
        vx: 0,
        vy: 0,
        w: 28,
        h: 40,
        color: "#ef4444",
        onGround: false,
        controls: { left: "a", right: "d", jump: "w" },
      },
      {
        x: 24 * TILE,
        y: bridgeTopY - 40,
        vx: 0,
        vy: 0,
        w: 28,
        h: 40,
        color: "#3b82f6",
        onGround: false,
        controls: { left: "arrowleft", right: "arrowright", jump: "arrowup" },
      },
    ];

    const keys = new Set<string>();
    const onDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keys.add(k);
      if (k.startsWith("arrow") || k === " ") e.preventDefault();
      for (const p of players) {
        if (k === p.controls.jump && p.onGround) {
          p.vy = -JUMP_V;
          p.onGround = false;
        }
      }
    };
    const onUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);

    // Axis-separated tile collision: move X, resolve; move Y, resolve.
    const moveAxis = (p: Player, dx: number, dy: number) => {
      // X
      p.x += dx;
      if (dx !== 0) {
        const rowTop = Math.floor(p.y / TILE);
        const rowBot = Math.floor((p.y + p.h - 1) / TILE);
        if (dx > 0) {
          const col = Math.floor((p.x + p.w - 1) / TILE);
          for (let r = rowTop; r <= rowBot; r++) {
            if (isSolid(col, r)) {
              p.x = col * TILE - p.w;
              break;
            }
          }
        } else {
          const col = Math.floor(p.x / TILE);
          for (let r = rowTop; r <= rowBot; r++) {
            if (isSolid(col, r)) {
              p.x = (col + 1) * TILE;
              break;
            }
          }
        }
      }
      // Y
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
      // Update
      for (const p of players) {
        p.vx = 0;
        if (keys.has(p.controls.left)) p.vx = -MOVE_SPEED;
        if (keys.has(p.controls.right)) p.vx = MOVE_SPEED;
        p.vy += GRAVITY;
        if (p.vy > 20) p.vy = 20;

        moveAxis(p, p.vx, 0);
        moveAxis(p, 0, p.vy);

        // Respawn if fallen into the void
        if (p.y > H + 200) {
          p.x = (COLS / 2) * TILE;
          p.y = bridgeTopY - 120;
          p.vx = 0;
          p.vy = 0;
        }
      }

      // Draw — background unchanged
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#0f172a");
      grad.addColorStop(1, "#1e293b");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);

      // Distant stars
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      for (let i = 0; i < 40; i++) {
        const sx = (i * 97) % W;
        const sy = (i * 53) % (H / 2);
        ctx.fillRect(sx, sy, 2, 2);
      }

      // Void band below the bridge row
      ctx.fillStyle = "#000";
      ctx.fillRect(0, (10 + 1) * TILE + 8, W, H);

      // Tiles
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          if (grid[r][c] !== BLOCK) continue;
          const x = c * TILE;
          const y = r * TILE;
          ctx.fillStyle = "#78716c";
          ctx.fillRect(x, y, TILE, TILE);
          // Top highlight
          ctx.fillStyle = "#a8a29e";
          ctx.fillRect(x, y, TILE, 3);
          // Bottom shadow
          ctx.fillStyle = "#57534e";
          ctx.fillRect(x, y + TILE - 4, TILE, 4);
          // Seam
          ctx.strokeStyle = "#44403c";
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        }
      }

      // Players
      for (const p of players) {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = "#fff";
        ctx.fillRect(p.x + 6, p.y + 10, 5, 5);
        ctx.fillRect(p.x + 17, p.y + 10, 5, 5);
        ctx.fillStyle = "#000";
        ctx.fillRect(p.x + 8, p.y + 12, 2, 2);
        ctx.fillRect(p.x + 19, p.y + 12, 2, 2);
      }

      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-950 p-6">
      <h1 className="text-3xl font-bold text-white">Bridge Duel</h1>
      <canvas
        ref={canvasRef}
        className="rounded-lg border border-slate-700 shadow-2xl"
        style={{ maxWidth: "100%", height: "auto" }}
      />
      <div className="flex gap-8 text-sm text-slate-300">
        <div>
          <span className="mr-2 inline-block h-3 w-3 rounded-sm bg-red-500" />
          Player 1: WASD (W to jump)
        </div>
        <div>
          <span className="mr-2 inline-block h-3 w-3 rounded-sm bg-blue-500" />
          Player 2: Arrow Keys (↑ to jump)
        </div>
      </div>
    </div>
  );
}
