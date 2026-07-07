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
const BLOCK = 1;
const PLACED_RED = 2;
const PLACED_BLUE = 3;

const BRIDGE_ROW = 10;
const BRIDGE_START = 1;
const BRIDGE_END = 26;

const GOAL_HEIGHT_TILES = 2;
const BLUE_GOAL = { col: BRIDGE_START, row: BRIDGE_ROW - GOAL_HEIGHT_TILES };
const RED_GOAL = { col: BRIDGE_END, row: BRIDGE_ROW - GOAL_HEIGHT_TILES };

const BLUE_SPAWN = { x: (BLUE_GOAL.col + 3) * TILE, y: (BRIDGE_ROW - 2) * TILE };
const RED_SPAWN = { x: (RED_GOAL.col - 3) * TILE - 28, y: (BRIDGE_ROW - 2) * TILE };

const MAX_BLOCKS = 32;
const MAX_ARROWS = 6;
const WIN_SCORE = 5;
const MAX_HP = 4;

const SWING_DURATION = 200; // 0.2s visual arc
const SWING_COOLDOWN = 380;
const SWING_RADIUS = 3 * TILE; // 3-block radius arc
const KNOCKBACK_VX = 10;
const KNOCKBACK_POP_VY = -7; // mandatory lift so victim doesn't stick on floor

const GRAVITY = 0.5;
const JUMP_HEIGHT_TILES = 1.8;
// Kinematic jump velocity: v0 = sqrt(2 * g * h)  (h in pixels)
const JUMP_V = Math.sqrt(2 * GRAVITY * (JUMP_HEIGHT_TILES * TILE));
const MOVE_SPEED = 3.2;

const FALL_TERMINAL = 18;
const FALL_TERMINAL_FLOATY = FALL_TERMINAL * 0.8; // 20% slower once past the peak

const AIM_PERIOD_MS = 2000;
const ARROW_SPEED = 11;
const ARROW_GRAVITY = 0.35;

const MOUSE_BUILD_RANGE = 5; // tiles (chebyshev)

type PlayerId = 0 | 1;
type Mode = "menu" | "1v1" | "bot";

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
  arrows: number;
  hp: number;
  swingUntil: number;
  swingReadyAt: number;
  spawn: { x: number; y: number };
  controls: Controls;
  aiming: boolean;
  aimStart: number;
  aimAngleFixed: number; // for bot
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
  const [mode, setMode] = useState<Mode>("menu");
  const [scores, setScores] = useState({ red: 0, blue: 0 });
  const [hpUi, setHpUi] = useState({ red: MAX_HP, blue: MAX_HP });
  const [blocksUi, setBlocksUi] = useState({ red: MAX_BLOCKS, blue: MAX_BLOCKS });
  const [arrowsUi, setArrowsUi] = useState({ red: MAX_ARROWS, blue: MAX_ARROWS });
  const [winner, setWinner] = useState<"Red" | "Blue" | null>(null);
  const [restartToken, setRestartToken] = useState(0);

  const handleRestart = useCallback(() => {
    setScores({ red: 0, blue: 0 });
    setHpUi({ red: MAX_HP, blue: MAX_HP });
    setBlocksUi({ red: MAX_BLOCKS, blue: MAX_BLOCKS });
    setArrowsUi({ red: MAX_ARROWS, blue: MAX_ARROWS });
    setWinner(null);
    setMode("menu");
    setRestartToken((n) => n + 1);
  }, []);

  useEffect(() => {
    if (mode === "menu") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = 960;
    const H = 540;
    canvas.width = W;
    canvas.height = H;

    const grid = buildInitialGrid();
    const botMode = mode === "bot";

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
      id, x: spawn.x, y: spawn.y, vx: 0, vy: 0, w: 28, h: 40,
      color, name, facing, onGround: false,
      blocksLeft: MAX_BLOCKS, arrows: MAX_ARROWS, hp: MAX_HP,
      swingUntil: 0, swingReadyAt: 0, spawn, controls,
      aiming: false, aimStart: 0, aimAngleFixed: Math.PI / 4,
      placedTile: name === "Red" ? PLACED_RED : PLACED_BLUE,
    });

    const players: Player[] = [
      makePlayer(0, "Red", "#ef4444", -1, RED_SPAWN, {
        left: "a", right: "d", jump: "w",
        attack: [" "], place: "g", breakBlock: "h", bow: ["f"],
      }),
      makePlayer(1, "Blue", "#3b82f6", 1, BLUE_SPAWN, {
        left: "arrowleft", right: "arrowright", jump: "arrowup",
        attack: ["enter"], place: "k", breakBlock: "l", bow: ["i", "shift"],
      }),
    ];

    const arrows: Arrow[] = [];

    const syncUi = () => {
      setHpUi({ red: players[0].hp, blue: players[1].hp });
      setBlocksUi({ red: players[0].blocksLeft, blue: players[1].blocksLeft });
      setArrowsUi({ red: players[0].arrows, blue: players[1].arrows });
    };

    const respawnPlayer = (p: Player) => {
      p.x = p.spawn.x; p.y = p.spawn.y; p.vx = 0; p.vy = 0;
      p.hp = MAX_HP; p.blocksLeft = MAX_BLOCKS; p.arrows = MAX_ARROWS;
      p.swingUntil = 0; p.aiming = false;
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
      const red = players[0]; const blue = players[1];
      const bgH = GOAL_HEIGHT_TILES * TILE;
      const bg = { x: BLUE_GOAL.col * TILE, y: BLUE_GOAL.row * TILE, w: TILE, h: bgH };
      const rg = { x: RED_GOAL.col * TILE, y: RED_GOAL.row * TILE, w: TILE, h: bgH };
      let scored = false;
      if (rectsOverlap(red.x, red.y, red.w, red.h, bg.x, bg.y, bg.w, bg.h)) {
        localScores.red += 1; scored = true;
      } else if (rectsOverlap(blue.x, blue.y, blue.w, blue.h, rg.x, rg.y, rg.w, rg.h)) {
        localScores.blue += 1; scored = true;
      }
      if (scored) {
        setScores({ red: localScores.red, blue: localScores.blue });
        if (localScores.red >= WIN_SCORE) { gameOver = true; setWinner("Red"); }
        else if (localScores.blue >= WIN_SCORE) { gameOver = true; setWinner("Blue"); }
        respawnAll();
      }
    };

    // Vector knockback with mandatory vertical "pop" so the victim launches
    // in a clean backward arc without sticking on floor tiles.
    const damageVector = (target: Player, dirX: number, dirY: number) => {
      // Normalize the horizontal component; force a lift regardless of dirY.
      const mag = Math.hypot(dirX, dirY) || 1;
      const nx = dirX / mag;
      target.vx = KNOCKBACK_VX * (nx === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(nx));
      // Blend a bit of the incoming vertical direction with the mandatory pop.
      const ny = dirY / mag;
      target.vy = KNOCKBACK_POP_VY + Math.min(0, ny * 2);
      // Nudge off the ground so the collider doesn't immediately re-seat us.
      target.y -= 1;
      target.onGround = false;
      target.hp -= 1;
      if (target.hp <= 0) respawnPlayer(target);
      syncUi();
    };

    const frontTile = (p: Player, dist = 1) => {
      const cx = p.x + p.w / 2;
      const cy = p.y + p.h / 2;
      const col = Math.floor(cx / TILE) + p.facing * dist;
      const row = Math.floor(cy / TILE);
      return { col, row };
    };

    const canPlaceAt = (col: number, row: number) => {
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
      if (grid[row][col] !== AIR) return false;
      const bx = col * TILE, by = row * TILE;
      for (const other of players) {
        if (rectsOverlap(other.x, other.y, other.w, other.h, bx, by, TILE, TILE)) return false;
      }
      return true;
    };

    const placeAt = (p: Player, col: number, row: number) => {
      if (p.blocksLeft <= 0) return false;
      if (!canPlaceAt(col, row)) return false;
      grid[row][col] = p.placedTile;
      p.blocksLeft -= 1;
      syncUi();
      return true;
    };

    // Every tile — including the initial bridge — is stored in the unified
    // grid and can be removed by index assignment (splice-equivalent for a 2D array).
    const breakAt = (p: Player, col: number, row: number) => {
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
      const t = grid[row][col];
      if (t === AIR) return false;
      grid[row][col] = AIR;
      if (t === p.placedTile) p.blocksLeft = Math.min(MAX_BLOCKS, p.blocksLeft + 1);
      syncUi();
      return true;
    };

    const placeFront = (p: Player) => {
      const f1 = frontTile(p, 1);
      if (placeAt(p, f1.col, f1.row)) return;
      const f2 = frontTile(p, 2);
      placeAt(p, f2.col, f2.row);
    };

    const breakFront = (p: Player) => {
      const f1 = frontTile(p, 1);
      if (breakAt(p, f1.col, f1.row)) return;
      const f2 = frontTile(p, 2);
      breakAt(p, f2.col, f2.row);
    };

    // Instant, vector-based hit detection — runs the frame the key is pressed.
    // The visual arc (drawn separately) takes 0.2s but mechanics resolve NOW.
    const attack = (p: Player) => {
      const now = performance.now();
      if (now < p.swingReadyAt) return;
      p.swingUntil = now + SWING_DURATION;
      p.swingReadyAt = now + SWING_COOLDOWN;
      const acx = p.x + p.w / 2;
      const acy = p.y + p.h / 2;
      for (const other of players) {
        if (other.id === p.id) continue;
        const ocx = other.x + other.w / 2;
        const ocy = other.y + other.h / 2;
        const dx = ocx - acx;
        const dy = ocy - acy;
        // 3-block radius arc — semicircle sweeps behind → over head → in front,
        // which in practice covers the full circle around the attacker.
        if (dx * dx + dy * dy <= SWING_RADIUS * SWING_RADIUS) {
          damageVector(other, dx, dy);
        }
      }
    };

    const aimAngle = (p: Player, now: number) => {
      const t = ((now - p.aimStart) % AIM_PERIOD_MS) / AIM_PERIOD_MS;
      const tri = t < 0.5 ? t * 2 : (1 - t) * 2;
      return tri * Math.PI;
    };

    const fireArrow = (p: Player, angle: number) => {
      if (p.arrows <= 0) return;
      const dx = Math.cos(angle) * p.facing;
      const dy = -Math.sin(angle);
      const ox = p.x + p.w / 2 + dx * 18;
      const oy = p.y + p.h / 2 + dy * 18;
      arrows.push({ x: ox, y: oy, vx: dx * ARROW_SPEED, vy: dy * ARROW_SPEED, owner: p.id, alive: true });
      p.arrows -= 1;
      syncUi();
    };

    // ---------- Mouse (Red) ----------
    const mouse = { x: 0, y: 0, over: false };
    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * W;
      mouse.y = ((e.clientY - rect.top) / rect.height) * H;
      mouse.over = true;
    };
    const onLeave = () => { mouse.over = false; };
    const mouseTile = () => ({ col: Math.floor(mouse.x / TILE), row: Math.floor(mouse.y / TILE) });
    const inRedRange = (col: number, row: number) => {
      const p = players[0];
      const pc = Math.floor((p.x + p.w / 2) / TILE);
      const pr = Math.floor((p.y + p.h / 2) / TILE);
      return Math.max(Math.abs(col - pc), Math.abs(row - pr)) <= MOUSE_BUILD_RANGE;
    };
    const onMouseDown = (e: MouseEvent) => {
      if (gameOver) return;
      e.preventDefault();
      const { col, row } = mouseTile();
      if (!inRedRange(col, row)) return;
      const red = players[0];
      if (e.button === 0) placeAt(red, col, row);
      else if (e.button === 2) breakAt(red, col, row);
    };
    const onCtx = (e: MouseEvent) => e.preventDefault();
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("contextmenu", onCtx);

    // ---------- Keyboard: zero-latency direct boolean flags ----------
    // `keysPressed` is the authoritative held-key dictionary.
    // `justPressed` is populated on the leading edge of a keydown and drained
    // by the frame loop, so edge-triggered actions (attack, place, break, bow
    // start) can never be dropped or duplicated by async event scheduling.
    const keysPressed: Record<string, boolean> = {};
    const justPressed = new Set<string>();
    const justReleased = new Set<string>();

    const onDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k.startsWith("arrow") || k === " ") e.preventDefault();
      if (gameOver) return;
      if (!keysPressed[k]) justPressed.add(k);
      keysPressed[k] = true;
    };
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (keysPressed[k]) justReleased.add(k);
      keysPressed[k] = false;
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);

    // Alias `keys` for existing helpers (mouse indicator, bot hold checks).
    const keys = {
      has: (k: string) => !!keysPressed[k],
    };
    void keys;


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

    // ---------- Bot AI: perception buffer + state machine ----------
    type Snapshot = {
      redX: number;
      redY: number;
      grid: number[][];
      timestamp: number;
    };
    const gameStateHistory: Snapshot[] = [];
    const HISTORY_MAX_AGE = 1500; // prune > 1.5s
    const PERCEPTION_DELAY = 500; // 500ms reaction lag

    const pushHistory = (nowMs: number) => {
      // Deep-copy the grid so mutations don't leak backwards through history.
      const snap: Snapshot = {
        redX: players[0].x,
        redY: players[0].y,
        grid: grid.map((row) => row.slice()),
        timestamp: nowMs,
      };
      gameStateHistory.push(snap);
      const cutoff = nowMs - HISTORY_MAX_AGE;
      while (gameStateHistory.length > 0 && gameStateHistory[0].timestamp < cutoff) {
        gameStateHistory.shift();
      }
    };

    const getDelayedPerception = (nowMs: number) => {
      const targetTs = nowMs - PERCEPTION_DELAY;
      // Newest snapshot with timestamp <= targetTs
      let chosen: Snapshot | null = null;
      for (let i = gameStateHistory.length - 1; i >= 0; i--) {
        if (gameStateHistory[i].timestamp <= targetTs) {
          chosen = gameStateHistory[i];
          break;
        }
      }
      // Null-safety: fall back to Red's live coordinates + live grid.
      if (!chosen) {
        return { delayedRedX: players[0].x, delayedRedY: players[0].y, delayedGrid: grid };
      }
      return { delayedRedX: chosen.redX, delayedRedY: chosen.redY, delayedGrid: chosen.grid };
    };

    enum BotState {
      RACE = "RACE",
      INTERCEPT = "INTERCEPT",
      DEFENSE = "DEFENSE",
      SABOTAGE = "SABOTAGE",
      PILLAR = "PILLAR",
      VOID_RECOVERY = "VOID_RECOVERY",
    }

    const bot = {
      currentState: BotState.INTERCEPT,
      nextEvalAt: 0,
      nextActionAt: 0,
      nextShotAt: 0,
      prevVy: 0,
      pillarJumpArmed: false,
      // Delayed perception exposed to executors:
      delayedRedX: 0,
      delayedRedY: 0,
      delayedGrid: grid,
    };

    const EVAL_INTERVAL = 500; // 0.5s decision cadence

    const BRIDGE_Y = BRIDGE_ROW * TILE;
    const RED_GOAL_X = RED_GOAL.col * TILE;
    const BLUE_GOAL_X = BLUE_GOAL.col * TILE;

    const isBotSolid = (g: number[][], col: number, row: number) => {
      if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return false;
      const t = g[row][col];
      return t === BLOCK || t === PLACED_RED || t === PLACED_BLUE;
    };
    const isEnemyBlock = (t: number) => t === PLACED_RED;
    const isPlacedTile = (t: number) => t === PLACED_RED || t === PLACED_BLUE;

    const pathBlockedByEnemy = (fromX: number, toX: number, y: number, g: number[][]) => {
      const r = Math.floor((y + players[1].h / 2) / TILE);
      const c1 = Math.floor(Math.min(fromX, toX) / TILE);
      const c2 = Math.floor(Math.max(fromX, toX) / TILE);
      for (let c = c1; c <= c2; c++) {
        if (isEnemyBlock(g[r]?.[c] ?? AIR)) return true;
      }
      return false;
    };

    const redSupportedByPlacedOverVoid = (rx: number, ry: number, g: number[][]) => {
      const col = Math.floor((rx + players[0].w / 2) / TILE);
      const feetRow = Math.floor((ry + players[0].h) / TILE);
      const under = g[feetRow]?.[col] ?? AIR;
      if (!isPlacedTile(under)) return false;
      // Is there void beneath the placed block(s)? Scan a few rows down.
      for (let r = feetRow + 1; r < ROWS; r++) {
        if (g[r][col] === BLOCK) return false; // real bridge under → not floating
        if (g[r][col] === AIR) return true;
      }
      return true;
    };

    const evaluateState = (nowMs: number): BotState => {
      const me = players[1];
      const { delayedRedX, delayedRedY, delayedGrid } = bot;

      // STATE A is evaluated every frame separately — skipped here.

      // STATE B: pillaring / elevation matching
      const heightDiff = me.y - delayedRedY; // positive means red is higher
      const horizProxToRed = Math.abs(delayedRedX - me.x);
      if (heightDiff > TILE * 1.2 && horizProxToRed < TILE * 3) {
        return BotState.PILLAR;
      }

      const botDistToTarget = Math.abs(me.x - RED_GOAL_X);
      const redDistToTarget = Math.abs(delayedRedX - BLUE_GOAL_X);

      // STATE C: defense — red is closer to scoring than we are to ours
      if (redDistToTarget < botDistToTarget - 8) {
        return BotState.DEFENSE;
      }

      // STATE D: path sabotage
      const redAtBridgeLevel = Math.abs(delayedRedY - (BRIDGE_ROW - 2) * TILE) < TILE * 1.5;
      if (redAtBridgeLevel && redSupportedByPlacedOverVoid(delayedRedX, delayedRedY, delayedGrid)) {
        return BotState.SABOTAGE;
      }

      // STATE E: racing — we're closer and path is clear of enemy blocks
      if (
        botDistToTarget < redDistToTarget &&
        !pathBlockedByEnemy(me.x, RED_GOAL_X, me.y, delayedGrid)
      ) {
        return BotState.RACE;
      }

      // STATE F: fallback intercept & combat
      return BotState.INTERCEPT;
      void nowMs;
    };

    // ---- executors: run every frame for fluid movement ----
    const moveTowards = (targetX: number) => {
      const me = players[1];
      const dx = targetX - (me.x + me.w / 2);
      if (Math.abs(dx) < 4) { me.vx = 0; return; }
      if (dx > 0) { me.vx = MOVE_SPEED; me.facing = 1; }
      else { me.vx = -MOVE_SPEED; me.facing = -1; }
    };

    const jumpIfGrounded = () => {
      const me = players[1];
      if (me.onGround) { me.vy = -JUMP_V; me.onGround = false; }
    };

    const clearForwardObstacles = (nowMs: number) => {
      const me = players[1];
      const dir = me.facing;
      const cx = Math.floor((me.x + me.w / 2) / TILE);
      const feetRow = Math.floor((me.y + me.h - 1) / TILE);
      const headRow = Math.floor(me.y / TILE);
      const aheadCol = cx + dir;
      if (aheadCol < 0 || aheadCol >= COLS) return;
      const groundAhead = isSolid(aheadCol, feetRow + 1);
      const headBlocked = isSolid(aheadCol, headRow);
      const bodyBlocked = isSolid(aheadCol, feetRow);

      if ((headBlocked || bodyBlocked) && nowMs >= bot.nextActionAt) {
        const oldFacing = me.facing;
        me.facing = dir as 1 | -1;
        breakFront(me);
        me.facing = oldFacing;
        bot.nextActionAt = nowMs + 220;
        return;
      }
      // Smart bridging: void ahead → briefly halt and place under the gap
      if (!groundAhead && me.onGround && me.blocksLeft > 0 && nowMs >= bot.nextActionAt) {
        me.vx = 0;
        placeAt(me, aheadCol, feetRow + 1);
        bot.nextActionAt = nowMs + 180;
      }
    };

    // STATE A executor — checked every frame for clutch saves
    const tryVoidRecovery = (nowMs: number): boolean => {
      const me = players[1];
      const belowBridge = me.y > BRIDGE_Y + TILE * 0.5;
      const falling = me.vy > 0;
      if (!(belowBridge && falling)) return false;
      // Snap horizontal momentum toward nearest solid structure horizontally.
      // Pick left/right based on which side has a nearer solid column at bridge row.
      let nearestDx = 0;
      for (let d = 1; d < COLS; d++) {
        const cL = Math.floor((me.x + me.w / 2) / TILE) - d;
        const cR = Math.floor((me.x + me.w / 2) / TILE) + d;
        if (cL >= 0 && isSolid(cL, BRIDGE_ROW)) { nearestDx = -1; break; }
        if (cR < COLS && isSolid(cR, BRIDGE_ROW)) { nearestDx = 1; break; }
      }
      if (nearestDx !== 0) {
        me.vx = MOVE_SPEED * nearestDx;
        me.facing = nearestDx as 1 | -1;
      }
      // Place a platform directly beneath our feet to arrest the fall.
      if (me.blocksLeft > 0 && nowMs >= bot.nextActionAt) {
        const col = Math.floor((me.x + me.w / 2) / TILE);
        const row = Math.floor((me.y + me.h) / TILE);
        if (placeAt(me, col, row)) {
          bot.nextActionAt = nowMs + 150;
        }
      }
      return true;
    };

    const executePillar = (nowMs: number) => {
      const me = players[1];
      moveTowards(me.x + me.w / 2); // stay in place horizontally
      me.vx = 0;
      if (me.onGround) {
        jumpIfGrounded();
        bot.pillarJumpArmed = true;
      }
      // Detect the peak: vy transitions from negative toward >= 0.
      const atPeak = bot.pillarJumpArmed && bot.prevVy < 0 && me.vy >= -0.2;
      if (atPeak && me.blocksLeft > 0 && nowMs >= bot.nextActionAt) {
        const col = Math.floor((me.x + me.w / 2) / TILE);
        const row = Math.floor((me.y + me.h) / TILE) + 1;
        if (placeAt(me, col, row)) bot.nextActionAt = nowMs + 200;
        bot.pillarJumpArmed = false;
      }
    };

    const executeDefense = (nowMs: number) => {
      const me = players[1];
      moveTowards(BLUE_GOAL_X);
      clearForwardObstacles(nowMs);
      // Blockade: if we're ahead of red (between red and blue goal), wall up.
      const meAhead = Math.abs(me.x - BLUE_GOAL_X) < Math.abs(bot.delayedRedX - BLUE_GOAL_X) - TILE;
      if (meAhead && me.onGround && me.blocksLeft >= 2 && nowMs >= bot.nextActionAt) {
        // Face the incoming red
        me.facing = bot.delayedRedX > me.x ? 1 : -1;
        const cx = Math.floor((me.x + me.w / 2) / TILE);
        const feetRow = Math.floor((me.y + me.h - 1) / TILE);
        const col = cx + me.facing;
        const okLow = placeAt(me, col, feetRow);
        const okHigh = placeAt(me, col, feetRow - 1);
        if (okLow || okHigh) bot.nextActionAt = nowMs + 260;
        // Then smoothly hop over our own wall
        jumpIfGrounded();
      }
    };

    const executeSabotage = (nowMs: number) => {
      const me = players[1];
      // Move under the block supporting the delayed red position.
      const targetCol = Math.floor((bot.delayedRedX + players[0].w / 2) / TILE);
      const targetX = targetCol * TILE + TILE / 2;
      moveTowards(targetX);
      clearForwardObstacles(nowMs);
      // Break the specific block directly beneath the delayed opponent.
      const feetRow = Math.floor((bot.delayedRedY + players[0].h) / TILE);
      if (nowMs >= bot.nextActionAt && isPlacedTile(grid[feetRow]?.[targetCol] ?? AIR)) {
        breakAt(me, targetCol, feetRow);
        bot.nextActionAt = nowMs + 180;
      }
    };

    const executeRace = (nowMs: number) => {
      moveTowards(RED_GOAL_X);
      clearForwardObstacles(nowMs);
    };

    const executeIntercept = (nowMs: number) => {
      const me = players[1];
      const foe = players[0];
      const horizDelayed = bot.delayedRedX - me.x;
      me.facing = horizDelayed >= 0 ? 1 : -1;

      // Melee (uses live foe for real hit resolution; facing was set from delayed x)
      const meleeDist = TILE * 1.2;
      if (Math.abs(foe.x - me.x) < meleeDist && Math.abs(foe.y - me.y) < TILE * 1.4) {
        attack(me);
      }

      // Ranged
      const yAligned = Math.abs(bot.delayedRedY - me.y) < TILE * 1.5;
      const longRange = Math.abs(horizDelayed) > TILE * 4;
      if (yAligned && longRange && me.arrows > 0 && nowMs >= bot.nextShotAt) {
        // Upward angle compensation for gravity drop.
        const dist = Math.abs(horizDelayed);
        const comp = Math.min(0.5, 0.05 + dist / (TILE * 40));
        fireArrow(me, comp);
        bot.nextShotAt = nowMs + 850;
      }

      // Approach target while clearing obstacles.
      moveTowards(bot.delayedRedX);
      clearForwardObstacles(nowMs);
    };

    const updateBot = (nowMs: number) => {
      const me = players[1];

      // Refresh delayed perception once per tick.
      const { delayedRedX, delayedRedY, delayedGrid } = getDelayedPerception(nowMs);
      bot.delayedRedX = delayedRedX;
      bot.delayedRedY = delayedRedY;
      bot.delayedGrid = delayedGrid;

      // STATE A always evaluated first, every frame — clutch save bypass.
      if (tryVoidRecovery(nowMs)) {
        bot.currentState = BotState.VOID_RECOVERY;
        bot.prevVy = me.vy;
        return;
      }

      // Evaluate remaining states on a 0.5s cadence to avoid jitter.
      if (nowMs >= bot.nextEvalAt) {
        bot.currentState = evaluateState(nowMs);
        bot.nextEvalAt = nowMs + EVAL_INTERVAL;
      }

      // Execute the chosen state every frame for fluid behavior.
      switch (bot.currentState) {
        case BotState.PILLAR:    executePillar(nowMs); break;
        case BotState.DEFENSE:   executeDefense(nowMs); break;
        case BotState.SABOTAGE:  executeSabotage(nowMs); break;
        case BotState.RACE:      executeRace(nowMs); break;
        case BotState.INTERCEPT:
        default:                 executeIntercept(nowMs); break;
      }

      bot.prevVy = me.vy;
    };


    let raf = 0;
    const loop = () => {
      const now = performance.now();

      if (!gameOver) {
        // -------- Frame-loop input: evaluate direct flags FIRST --------
        // Doing this at the top of the tick guarantees no dropped or delayed
        // inputs — every held key is checked exactly once per frame.
        for (const p of players) {
          if (botMode && p.id === 1) continue;
          // Jump: held-flag check, self-gated by onGround (no repeat mid-air).
          if (keysPressed[p.controls.jump] && p.onGround) {
            p.vy = -JUMP_V;
            p.onGround = false;
          }
          // Edge-triggered actions from justPressed.
          for (const ak of p.controls.attack) {
            if (justPressed.has(ak)) { attack(p); break; }
          }
          if (p.id === 1) {
            if (justPressed.has(p.controls.place)) placeFront(p);
            if (justPressed.has(p.controls.breakBlock)) breakFront(p);
          }
          for (const bk of p.controls.bow) {
            if (justPressed.has(bk) && !p.aiming && p.arrows > 0) {
              p.aiming = true; p.aimStart = now;
              break;
            }
          }
          // Bow release: fire when no bow key is still held.
          if (p.aiming) {
            const stillHeld = p.controls.bow.some((bk) => keysPressed[bk]);
            const released = p.controls.bow.some((bk) => justReleased.has(bk));
            if (released && !stillHeld) {
              fireArrow(p, aimAngle(p, now));
              p.aiming = false;
            }
          }
        }

        for (const p of players) {
          if (botMode && p.id === 1) {
            updateBot(now);
          } else {
            const left = keysPressed[p.controls.left];
            const right = keysPressed[p.controls.right];
            if (left && !right) { p.vx = -MOVE_SPEED; p.facing = -1; }
            else if (right && !left) { p.vx = MOVE_SPEED; p.facing = 1; }
            else { if (Math.abs(p.vx) > 0.4) p.vx *= 0.8; else p.vx = 0; }
          }
          p.vy += GRAVITY;
          // Floatier fall arc: once past the jump peak (vy > 0), cap the
          // terminal fall speed 20% lower for a distinct, softer descent.
          const cap = p.vy > 0 ? FALL_TERMINAL_FLOATY : FALL_TERMINAL;
          if (p.vy > cap) p.vy = cap;

          moveAxis(p, p.vx, 0);
          moveAxis(p, 0, p.vy);

          if (p.y > H + 200) { respawnPlayer(p); syncUi(); }
        }

        for (const a of arrows) {
          if (!a.alive) continue;
          a.vy += ARROW_GRAVITY;
          a.x += a.vx; a.y += a.vy;
          if (a.x < 0 || a.x > W || a.y > H + 200) { a.alive = false; continue; }
          const col = Math.floor(a.x / TILE);
          const row = Math.floor(a.y / TILE);
          if (isSolid(col, row)) { a.alive = false; continue; }
          for (const p of players) {
            if (p.id === a.owner) continue;
            if (a.x >= p.x && a.x <= p.x + p.w && a.y >= p.y && a.y <= p.y + p.h) {
              damageVector(p, a.vx, a.vy);
              a.alive = false;
              break;
            }
          }
        }
        for (let i = arrows.length - 1; i >= 0; i--) if (!arrows[i].alive) arrows.splice(i, 1);

        tryScore();
      }

      // Drain per-frame edge sets after all input-consumers have run.
      justPressed.clear();
      justReleased.clear();

      // ---------- Draw ----------
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "#0f172a"); grad.addColorStop(1, "#1e293b");
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);

      ctx.fillStyle = "rgba(255,255,255,0.4)";
      for (let i = 0; i < 40; i++) {
        const sx = (i * 97) % W; const sy = (i * 53) % (H / 2);
        ctx.fillRect(sx, sy, 2, 2);
      }

      ctx.fillStyle = "#000";
      ctx.fillRect(0, (BRIDGE_ROW + 1) * TILE + 8, W, H);

      const drawGoal = (col: number, row: number, color: string, glow: string) => {
        const x = col * TILE; const y = row * TILE;
        const hpx = GOAL_HEIGHT_TILES * TILE;
        const g = ctx.createRadialGradient(x + TILE / 2, y + hpx / 2, 4, x + TILE / 2, y + hpx / 2, hpx);
        g.addColorStop(0, glow); g.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = g; ctx.fillRect(x - TILE, y - TILE / 2, TILE * 3, hpx + TILE);
        ctx.fillStyle = color; ctx.fillRect(x + 4, y + 4, TILE - 8, hpx - 8);
        ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1;
        ctx.strokeRect(x + 4.5, y + 4.5, TILE - 9, hpx - 9);
      };
      const pulse = 0.55 + 0.25 * Math.sin(now / 250);
      drawGoal(BLUE_GOAL.col, BLUE_GOAL.row, "#3b82f6", `rgba(59,130,246,${pulse})`);
      drawGoal(RED_GOAL.col, RED_GOAL.row, "#ef4444", `rgba(239,68,68,${pulse})`);

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const t = grid[r][c];
          if (t === AIR) continue;
          const x = c * TILE; const y = r * TILE;
          if (t === BLOCK) {
            ctx.fillStyle = "#78716c"; ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = "#a8a29e"; ctx.fillRect(x, y, TILE, 3);
            ctx.fillStyle = "#57534e"; ctx.fillRect(x, y + TILE - 4, TILE, 4);
            ctx.strokeStyle = "#44403c";
          } else if (t === PLACED_RED) {
            ctx.fillStyle = "#b91c1c"; ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = "#ef4444"; ctx.fillRect(x, y, TILE, 3);
            ctx.fillStyle = "#7f1d1d"; ctx.fillRect(x, y + TILE - 4, TILE, 4);
            ctx.strokeStyle = "#450a0a";
          } else {
            ctx.fillStyle = "#1d4ed8"; ctx.fillRect(x, y, TILE, TILE);
            ctx.fillStyle = "#3b82f6"; ctx.fillRect(x, y, TILE, 3);
            ctx.fillStyle = "#1e3a8a"; ctx.fillRect(x, y + TILE - 4, TILE, 4);
            ctx.strokeStyle = "#0c1e5c";
          }
          ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
        }
      }

      // Mouse build indicator (Red)
      if (mouse.over && !gameOver) {
        const { col, row } = mouseTile();
        if (col >= 0 && col < COLS && row >= 0 && row < ROWS) {
          const inRange = inRedRange(col, row);
          ctx.lineWidth = 2;
          ctx.strokeStyle = inRange ? "rgba(239,68,68,0.9)" : "rgba(120,120,120,0.7)";
          ctx.fillStyle = inRange ? "rgba(239,68,68,0.18)" : "rgba(180,180,180,0.1)";
          if (!inRange) ctx.strokeStyle = "rgba(200,60,60,0.5)";
          ctx.fillRect(col * TILE, row * TILE, TILE, TILE);
          ctx.strokeRect(col * TILE + 1, row * TILE + 1, TILE - 2, TILE - 2);
        }
      }

      // Sword swing visual arc: sweeps from 180° behind the player,
      // over the head, to 180° in front — radius 3*TILE, duration 0.2s.
      for (const p of players) {
        if (now < p.swingUntil) {
          const elapsed = SWING_DURATION - (p.swingUntil - now);
          const progress = Math.max(0, Math.min(1, elapsed / SWING_DURATION));
          const cx = p.x + p.w / 2;
          const cy = p.y + p.h / 2;
          // Base sweep (facing right): from angle π (behind, left) over top
          // through 3π/2 to 2π (=0, front). Flip via scale for facing left.
          const startA = Math.PI;
          const endA = Math.PI + Math.PI * progress; // 0..1 of the half-circle
          ctx.save();
          ctx.translate(cx, cy);
          if (p.facing === -1) ctx.scale(-1, 1);
          // Trailing fan
          ctx.fillStyle = "rgba(255,255,255,0.18)";
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, SWING_RADIUS, startA, endA, false);
          ctx.closePath();
          ctx.fill();
          // Leading blade edge
          ctx.strokeStyle = "rgba(255,255,255,0.95)";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(0, 0, SWING_RADIUS - 2, endA - 0.18, endA, false);
          ctx.stroke();
          // Blade tip highlight
          const tipX = Math.cos(endA) * SWING_RADIUS;
          const tipY = Math.sin(endA) * SWING_RADIUS;
          ctx.fillStyle = "rgba(255,255,255,1)";
          ctx.beginPath();
          ctx.arc(tipX, tipY, 3, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      for (const a of arrows) {
        const ang = Math.atan2(a.vy, a.vx);
        ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(ang);
        ctx.fillStyle = "#fde68a"; ctx.fillRect(-8, -1, 14, 2);
        ctx.fillStyle = "#f59e0b";
        ctx.beginPath(); ctx.moveTo(6, -3); ctx.lineTo(10, 0); ctx.lineTo(6, 3); ctx.closePath(); ctx.fill();
        ctx.restore();
      }

      for (const p of players) {
        if (p.aiming) {
          const a = aimAngle(p, now);
          const cx = p.x + p.w / 2; const cy = p.y + p.h / 2;
          const len = 60;
          const ex = cx + Math.cos(a) * p.facing * len;
          const ey = cy - Math.sin(a) * len;
          ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ex, ey); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = p.color;
          ctx.beginPath(); ctx.arc(ex, ey, 3, 0, Math.PI * 2); ctx.fill();
        }

        ctx.fillStyle = p.color; ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.fillStyle = "#fff";
        ctx.fillRect(p.x + 6, p.y + 10, 5, 5);
        ctx.fillRect(p.x + 17, p.y + 10, 5, 5);
        ctx.fillStyle = "#000";
        const pupilOffset = p.facing === 1 ? 2 : 0;
        ctx.fillRect(p.x + 6 + pupilOffset, p.y + 12, 2, 2);
        ctx.fillRect(p.x + 17 + pupilOffset, p.y + 12, 2, 2);

        const barW = 32, barH = 5;
        const bx = p.x + p.w / 2 - barW / 2; const by = p.y - 12;
        ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(bx - 1, by - 1, barW + 2, barH + 2);
        ctx.fillStyle = "#374151"; ctx.fillRect(bx, by, barW, barH);
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
      canvas.removeEventListener("mousemove", onMove);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("contextmenu", onCtx);
    };
  }, [restartToken, mode]);

  const ArrowIcon = () => (
    <svg width="12" height="12" viewBox="0 0 12 12" className="inline-block">
      <path d="M1 6 L9 6 M6 3 L9 6 L6 9" stroke="#fde68a" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

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
          const ammo = arrowsUi[team];
          const label = team === "red" ? "Red" : (mode === "bot" ? "Blue (Bot)" : "Blue");
          const color = team === "red" ? "#ef4444" : "#3b82f6";
          return (
            <div key={team} className="rounded border p-2" style={{ borderColor: `${color}55`, background: `${color}0d` }}>
              <div className="mb-1 flex items-center justify-between text-xs font-semibold" style={{ color }}>
                <span>{label}</span>
                <span className="flex items-center gap-2">
                  <span>HP {hp}/{MAX_HP}</span>
                  <span>· Blocks {blocks}/{MAX_BLOCKS}</span>
                  <span className="flex items-center gap-1"><ArrowIcon />{ammo}/{MAX_ARROWS}</span>
                </span>
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
          width={960}
          height={540}
          className="rounded-lg border border-slate-700 shadow-2xl"
          style={{ maxWidth: "100%", height: "auto", cursor: mode !== "menu" ? "crosshair" : "default" }}
        />
        {mode === "menu" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-black/80 backdrop-blur-sm"
               style={{ width: 960, height: 540, maxWidth: "100%" }}>
            <div className="text-4xl font-black tracking-widest text-white">BRIDGE DUEL</div>
            <div className="mt-2 text-sm text-slate-400">Choose a game mode</div>
            <div className="mt-8 flex flex-col gap-3">
              <button
                onClick={() => setMode("1v1")}
                className="rounded-md bg-white px-8 py-3 text-sm font-semibold text-slate-900 transition hover:bg-slate-200"
              >
                Local 1v1 (2 Players)
              </button>
              <button
                onClick={() => setMode("bot")}
                className="rounded-md border border-blue-500 bg-blue-500/20 px-8 py-3 text-sm font-semibold text-blue-200 transition hover:bg-blue-500/30"
              >
                vs. Bot (1 Player)
              </button>
            </div>
          </div>
        )}
        {winner && (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-black/75 backdrop-blur-sm">
            <div className="text-5xl font-black tracking-widest text-white">GAME OVER</div>
            <div className="mt-3 text-2xl font-bold" style={{ color: winner === "Red" ? "#ef4444" : "#3b82f6" }}>
              {winner} wins!
            </div>
            <button onClick={handleRestart} className="mt-6 rounded-md bg-white px-6 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-200">
              Main Menu
            </button>
          </div>
        )}
      </div>
      <div className="grid max-w-3xl grid-cols-1 gap-2 text-xs text-slate-300 md:grid-cols-2">
        <div className="rounded border border-red-500/30 bg-red-500/5 p-3">
          <div className="mb-1 font-semibold text-red-400">Red — WASD + Mouse</div>
          Move: A / D · Jump: W · Sword: Space · Bow (hold): F · Left-click: Place · Right-click: Break (5-tile range)
        </div>
        <div className="rounded border border-blue-500/30 bg-blue-500/5 p-3">
          <div className="mb-1 font-semibold text-blue-400">
            {mode === "bot" ? "Blue — Bot" : "Blue — Arrows"}
          </div>
          {mode === "bot"
            ? "Controlled by AI. Choose 1v1 in the menu to play as Blue."
            : "Move: ← → · Jump: ↑ · Sword: Enter · Bow (hold): I or RShift · Place: K · Break: L"}
        </div>
      </div>
    </div>
  );
}
