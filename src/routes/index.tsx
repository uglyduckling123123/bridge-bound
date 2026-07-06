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
const PLACED_RED = 2;
const PLACED_BLUE = 3;

const BRIDGE_ROW = 10;
const BRIDGE_START = 1;
const BRIDGE_END = 26; // inclusive

// Goals are 2 tiles tall so players can't easily jump over them.
const GOAL_HEIGHT_TILES = 2;
const BLUE_GOAL = { col: BRIDGE_START, row: BRIDGE_ROW - GOAL_HEIGHT_TILES };
const RED_GOAL = { col: BRIDGE_END, row: BRIDGE_ROW - GOAL_HEIGHT_TILES };

// Spawns exactly 3 tiles away from own goal, symmetric.
const BLUE_SPAWN = { x: (BLUE_GOAL.col + 3) * TILE, y: (BRIDGE_ROW - 2) * TILE };
const RED_SPAWN = { x: (RED_GOAL.col - 3) * TILE - 28, y: (BRIDGE_ROW - 2) * TILE };

const MAX_BLOCKS = 32;
const WIN_SCORE = 5;
const MAX_HP = 4;

const SWING_DURATION = 180; // ms
const SWING_COOLDOWN = 380; // ms
const SWING_REACH = 44; // extended
const KNOCKBACK_VX = 10;
const KNOCKBACK_VY = -6;

// Physics: 1.2 tile max jump height => h = v^2/(2g). With g=0.5, v=sqrt(2*0.5*38.4)=~6.2
const GRAVITY = 0.5;
const JUMP_V = 6.2; // gives ~38.4px = 1.2 tiles
const MOVE_SPEED = 3.2;

// Bow aim: 180-degree arc, 1 second peak-to-base (so 2s full cycle)
const AIM_PERIOD_MS = 2000;
const ARROW_SPEED = 11;
const ARROW_GRAVITY = 0.35;

type PlayerId = 0 | 1;

type Controls = {
  left: string;
  right: string;
  jump: string;
  attack: string[];
  place: string;
  breakBlock: string;
  bow: string[];
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
  hp: number;
  swingUntil: number;
  swingReadyAt: number;
  spawn: { x: number; y: number };
  controls: Controls;
  aiming: boolean;
  aimStart: number;
  placedTile: number;
};

type Arrow = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  owner: PlayerId;
  alive: boolean;
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
      const t = grid[r][c];
      if (t === PLACED_RED || t === PLACED_BLUE) grid[r][c] = AIR;
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
  const [hpUi, setHpUi] = useState({ red: MAX_HP, blue: MAX_HP });
  const [blocksUi, setBlocksUi] = useState({ red: MAX_BLOCKS, blue: MAX_BLOCKS });
  const [winner, setWinner] = useState<"Red" | "Blue" | null>(null);
  const [restartToken, setRestartToken] = useState(0);

  const handleRestart = useCallback(() => {
    setScores({ red: 0, blue: 0 });
    setHpUi({ red: MAX_HP, blue: MAX_HP });
    setBlocksUi({ red: MAX_BLOCKS, blue: MAX_BLOCKS });
    setWinner(null);
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

    const grid = buildInitialGrid();

    const isSolid = (col: number, row: number): boolean => {
      if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return false;
      const t = grid[row][col];
      return t === BLOCK || t === PLACED_RED || t === PLACED_BLUE;
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
      hp: MAX_HP,
      swingUntil: 0,
      swingReadyAt: 0,
      spawn,
      controls,
      aiming: false,
      aimStart: 0,
      placedTile: name === "Red" ? PLACED_RED : PLACED_BLUE,
    });

    const players: Player[] = [
      makePlayer(0, "Red", "#ef4444", -1, RED_SPAWN, {
        left: "a",
        right: "d",
        jump: "w",
        attack: [" "],
        place: "g",
        breakBlock: "h",
        bow: ["f"],
      }),
      makePlayer(1, "Blue", "#3b82f6", 1, BLUE_SPAWN, {
        left: "arrowleft",
        right: "arrowright",
        jump: "arrowup",
        attack: ["enter"],
        place: "k",
        breakBlock: "l",
        bow: ["i", "shift"],
      }),
    ];

    const arrows: Arrow[] = [];

    const syncUi = () => {
      setHpUi({ red: players[0].hp, blue: players[1].hp });
      setBlocksUi({ red: players[0].blocksLeft, blue: players[1].blocksLeft });
    };

    const respawnPlayer = (p: Player) => {
      p.x = p.spawn.x;
      p.y = p.spawn.y;
      p.vx = 0;
      p.vy = 0;
      p.hp = MAX_HP;
      p.blocksLeft = MAX_BLOCKS;
      p.swingUntil = 0;
      p.aiming = false;
    };

    const respawnAll = () => {
      clearPlacedBlocks(grid);
      for (const p of players) respawnPlayer(p);
      arrows.length = 0;
      syncUi();
    };

    const localScores = { red: 0, blue: 0 };
    let gameOver = false;

    const tryScore = () => {
      const red = players[0];
      const blue = players[1];
      const bgH = GOAL_HEIGHT_TILES * TILE;
      const bg = { x: BLUE_GOAL.col * TILE, y: BLUE_GOAL.row * TILE, w: TILE, h: bgH };
      const rg = { x: RED_GOAL.col * TILE, y: RED_GOAL.row * TILE, w: TILE, h: bgH };
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
        if (localScores.red >= WIN_SCORE) { gameOver = true; setWinner("Red"); }
        else if (localScores.blue >= WIN_SCORE) { gameOver = true; setWinner("Blue"); }
        respawnAll();
      }
    };

    const damage = (target: Player, dir: 1 | -1) => {
      target.vx = KNOCKBACK_VX * dir;
      target.vy = KNOCKBACK_VY;
      target.hp -= 1;
      if (target.hp <= 0) {
        respawnPlayer(target);
      }
      syncUi();
    };

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
      for (const other of players) {
        if (rectsOverlap(other.x, other.y, other.w, other.h, bx, by, TILE, TILE)) return;
      }
      grid[row][col] = p.placedTile;
      p.blocksLeft -= 1;
      syncUi();
    };

    const breakBlock = (p: Player) => {
      const { col, row } = frontTile(p);
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
      const t = grid[row][col];
      if (t !== PLACED_RED && t !== PLACED_BLUE) return;
      grid[row][col] = AIR;
      if (t === p.placedTile) {
        p.blocksLeft = Math.min(MAX_BLOCKS, p.blocksLeft + 1);
      }
      syncUi();
    };

    const swingHitbox = (p: Player) => {
      const x = p.facing === 1 ? p.x + p.w : p.x - SWING_REACH;
      return { x, y: p.y + 4, w: SWING_REACH, h: p.h - 8 };
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
          damage(other, p.facing);
        }
      }
    };

    // Aim angle: 180-degree arc facing forward. 0 = flat forward, +90 = straight up, back to 0.
    // Full cycle 2s (peak-to-base = 1s). Use triangle wave from 0..PI.
    const aimAngle = (p: Player, now: number) => {
      const t = ((now - p.aimStart) % AIM_PERIOD_MS) / AIM_PERIOD_MS; // 0..1
      const tri = t < 0.5 ? t * 2 : (1 - t) * 2; // 0..1..0
      return tri * Math.PI; // 0..PI
    };

    const fireArrow = (p: Player, now: number) => {
      const a = aimAngle(p, now);
      // Direction: forward horizontal, upward vertical. facing sign flips x.
      const dx = Math.cos(a) * p.facing;
      const dy = -Math.sin(a);
      const ox = p.x + p.w / 2 + dx * 18;
      const oy = p.y + p.h / 2 + dy * 18;
      arrows.push({
        x: ox, y: oy,
        vx: dx * ARROW_SPEED,
        vy: dy * ARROW_SPEED,
        owner: p.id,
        alive: true,
      });
    };

    const keys = new Set<string>();
    const onDown = (e: KeyboardEvent) => {
      if (gameOver) return;
      const k = e.key.toLowerCase();
      if (k.startsWith("arrow") || k === " ") e.preventDefault();
      const wasDown = keys.has(k);
      keys.add(k);
      if (wasDown) return;

      const now = performance.now();
      for (const p of players) {
        if (k === p.controls.jump && p.onGround) {
          p.vy = -JUMP_V;
          p.onGround = false;
        }
        if (p.controls.attack.includes(k)) attack(p);
        if (k === p.controls.place) placeBlock(p);
        if (k === p.controls.breakBlock) breakBlock(p);
        if (p.controls.bow.includes(k) && !p.aiming) {
          p.aiming = true;
          p.aimStart = now;
        }
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      keys.delete(k);
      const now = performance.now();
      for (const p of players) {
        if (p.controls.bow.includes(k) && p.aiming) {
          // Only release if none of the bow keys still held
          const stillHeld = p.controls.bow.some((bk) => keys.has(bk));
          if (!stillHeld) {
            fireArrow(p, now);
            p.aiming = false;
          }
        }
      }
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);

    const moveAxis = (p: Player, dx: number, dy: number) => {
      p.x += dx;
      if (dx !== 0) {
        const rowTop = Math.floor(p.y / TILE);
        const rowBot = Math.floor((p.y + p.h - 1) / TILE);
        if (dx > 0) {
          const col = Math.floor((p.x + p.w - 1) / TILE);
          for (let r = rowTop; r <= rowBot; r++) {
            if (isSolid(col, r)) { p.x = col * TILE - p.w; p.vx = 0; break; }
          }
        } else {
          const col = Math.floor(p.x / TILE);
          for (let r = rowTop; r <= rowBot; r++) {
            if (isSolid(col, r)) { p.x = (col + 1) * TILE; p.vx = 0; break; }
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
            if (isSolid(c, row)) { p.y = row * TILE - p.h; p.vy = 0; p.onGround = true; break; }
          }
        } else {
          const row = Math.floor(p.y / TILE);
          for (let c = colLeft; c <= colRight; c++) {
            if (isSolid(c, row)) { p.y = (row + 1) * TILE; p.vy = 0; break; }
          }
        }
      }
    };

    let raf = 0;
    const loop = () => {
      const now = performance.now();

      if (!gameOver) {
        for (const p of players) {
          const left = keys.has(p.controls.left);
          const right = keys.has(p.controls.right);
          if (left && !right) {
            p.vx = -MOVE_SPEED;
            p.facing = -1;
          } else if (right && !left) {
            p.vx = MOVE_SPEED;
            p.facing = 1;
          } else {
            if (Math.abs(p.vx) > 0.4) p.vx *= 0.8;
            else p.vx = 0;
          }
          p.vy += GRAVITY;
          if (p.vy > 18) p.vy = 18;

          moveAxis(p, p.vx, 0);
          moveAxis(p, 0, p.vy);

          if (p.y > H + 200) {
            respawnPlayer(p);
            syncUi();
          }
        }

        // Update arrows
        for (const a of arrows) {
          if (!a.alive) continue;
          a.vy += ARROW_GRAVITY;
          a.x += a.vx;
          a.y += a.vy;
          if (a.x < 0 || a.x > W || a.y > H + 200) { a.alive = false; continue; }
          // Tile collision
          const col = Math.floor(a.x / TILE);
          const row = Math.floor(a.y / TILE);
          if (isSolid(col, row)) { a.alive = false; continue; }
          // Hit players
          for (const p of players) {
            if (p.id === a.owner) continue;
            if (a.x >= p.x && a.x <= p.x + p.w && a.y >= p.y && a.y <= p.y + p.h) {
              damage(p, a.vx >= 0 ? 1 : -1);
              a.alive = false;
              break;
            }
          }
        }
        for (let i = arrows.length - 1; i >= 0; i--) if (!arrows[i].alive) arrows.splice(i, 1);

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

      // Goals (tall)
      const drawGoal = (col: number, row: number, color: string, glow: string) => {
        const x = col * TILE;
        const y = row * TILE;
        const hpx = GOAL_HEIGHT_TILES * TILE;
        const g = ctx.createRadialGradient(x + TILE / 2, y + hpx / 2, 4, x + TILE / 2, y + hpx / 2, hpx);
        g.addColorStop(0, glow);
        g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g;
        ctx.fillRect(x - TILE, y - TILE / 2, TILE * 3, hpx + TILE);
        ctx.fillStyle = color;
        ctx.fillRect(x + 4, y + 4, TILE - 8, hpx - 8);
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 4.5, y + 4.5, TILE - 9, hpx - 9);
      };
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
          } else if (t === PLACED_RED) {
            ctx.fillStyle = "#b91c1c";
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = "#ef4444";
            ctx.fillRect(x, y, TILE, 3);
            ctx.fillStyle = "#7f1d1d";
            ctx.fillRect(x, y + TILE - 4, TILE, 4);
            ctx.strokeStyle = "#450a0a";
          } else {
            ctx.fillStyle = "#1d4ed8";
            ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = "#3b82f6";
            ctx.fillRect(x, y, TILE, 3);
            ctx.fillStyle = "#1e3a8a";
            ctx.fillRect(x, y + TILE - 4, TILE, 4);
            ctx.strokeStyle = "#0c1e5c";
          }
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        }
      }

      // Sword swings
      for (const p of players) {
        if (now < p.swingUntil) {
          const hb = swingHitbox(p);
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.fillRect(hb.x, hb.y + hb.h / 2 - 3, hb.w, 6);
          ctx.fillStyle = "rgba(226,232,240,0.5)";
          ctx.fillRect(hb.x, hb.y, hb.w, hb.h);
        }
      }

      // Arrows
      for (const a of arrows) {
        const ang = Math.atan2(a.vy, a.vx);
        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.rotate(ang);
        ctx.fillStyle = "#fde68a";
        ctx.fillRect(-8, -1, 14, 2);
        ctx.fillStyle = "#f59e0b";
        ctx.beginPath();
        ctx.moveTo(6, -3);
        ctx.lineTo(10, 0);
        ctx.lineTo(6, 3);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // Players + aim + HP bar + block pips
      for (const p of players) {
        // Aim indicator
        if (p.aiming) {
          const a = aimAngle(p, now);
          const cx = p.x + p.w / 2;
          const cy = p.y + p.h / 2;
          const len = 60;
          const ex = cx + Math.cos(a) * p.facing * len;
          const ey = cy - Math.sin(a) * len;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(ex, ey);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(ex, ey, 3, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = "#fff";
        ctx.fillRect(p.x + 6, p.y + 10, 5, 5);
        ctx.fillRect(p.x + 17, p.y + 10, 5, 5);
        ctx.fillStyle = "#000";
        const pupilOffset = p.facing === 1 ? 2 : 0;
        ctx.fillRect(p.x + 6 + pupilOffset, p.y + 12, 2, 2);
        ctx.fillRect(p.x + 17 + pupilOffset, p.y + 12, 2, 2);

        // HP bar
        const barW = 32;
        const barH = 5;
        const bx = p.x + p.w / 2 - barW / 2;
        const by = p.y - 12;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
        ctx.fillStyle = "#374151";
        ctx.fillRect(bx, by, barW, barH);
        ctx.fillStyle = p.hp > 2 ? "#22c55e" : p.hp > 1 ? "#eab308" : "#ef4444";
        ctx.fillRect(bx, by, (barW * p.hp) / MAX_HP, barH);
      }

      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
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

      <div className="grid w-full max-w-[960px] grid-cols-2 gap-3">
        {(["red", "blue"] as const).map((team) => {
          const hp = hpUi[team];
          const blocks = blocksUi[team];
          const label = team === "red" ? "Red" : "Blue";
          const color = team === "red" ? "#ef4444" : "#3b82f6";
          return (
            <div
              key={team}
              className="rounded border p-2"
              style={{ borderColor: `${color}55`, background: `${color}0d` }}
            >
              <div className="mb-1 flex items-center justify-between text-xs font-semibold" style={{ color }}>
                <span>{label}</span>
                <span>HP {hp}/{MAX_HP} · Blocks {blocks}/{MAX_BLOCKS}</span>
              </div>
              <div className="mb-1 h-2 w-full overflow-hidden rounded bg-slate-800">
                <div className="h-full transition-all" style={{ width: `${(hp / MAX_HP) * 100}%`, background: color }} />
              </div>
              <div className="h-2 w-full overflow-hidden rounded bg-slate-800">
                <div className="h-full transition-all" style={{ width: `${(blocks / MAX_BLOCKS) * 100}%`, background: color, opacity: 0.6 }} />
              </div>
            </div>
          );
        })}
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
          Move: A / D · Jump: W · Sword: Space · Bow (hold): F · Place: G · Break: H
        </div>
        <div className="rounded border border-blue-500/30 bg-blue-500/5 p-3">
          <div className="mb-1 font-semibold text-blue-400">Blue — Arrows</div>
          Move: ← → · Jump: ↑ · Sword: Enter · Bow (hold): I or RShift · Place: K · Break: L
        </div>
      </div>
    </div>
  );
}
