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

    // Bridge dimensions
    const bridge = {
      x: 80,
      y: H / 2 + 40,
      w: W - 160,
      h: 20,
    };

    const players: Player[] = [
      {
        x: bridge.x + 60,
        y: bridge.y - 40,
        vx: 0,
        vy: 0,
        w: 28,
        h: 40,
        color: "#ef4444",
        onGround: false,
        controls: { left: "a", right: "d", jump: "w" },
      },
      {
        x: bridge.x + bridge.w - 90,
        y: bridge.y - 40,
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
      // Prevent page scroll on arrows/space
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

    let raf = 0;
    const loop = () => {
      // Update
      for (const p of players) {
        p.vx = 0;
        if (keys.has(p.controls.left)) p.vx = -MOVE_SPEED;
        if (keys.has(p.controls.right)) p.vx = MOVE_SPEED;

        p.vy += GRAVITY;
        p.x += p.vx;
        p.y += p.vy;

        // Bridge collision (land on top only when falling)
        const onBridgeX = p.x + p.w > bridge.x && p.x < bridge.x + bridge.w;
        const feet = p.y + p.h;
        if (
          onBridgeX &&
          p.vy >= 0 &&
          feet >= bridge.y &&
          feet - p.vy <= bridge.y + 1
        ) {
          p.y = bridge.y - p.h;
          p.vy = 0;
          p.onGround = true;
        } else {
          p.onGround = false;
        }

        // Respawn if fallen into the void
        if (p.y > H + 200) {
          p.x = bridge.x + bridge.w / 2;
          p.y = bridge.y - 100;
          p.vx = 0;
          p.vy = 0;
        }
      }

      // Draw
      // Sky gradient
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

      // Void
      ctx.fillStyle = "#000";
      ctx.fillRect(0, bridge.y + bridge.h + 40, W, H);

      // Bridge
      ctx.fillStyle = "#78716c";
      ctx.fillRect(bridge.x, bridge.y, bridge.w, bridge.h);
      ctx.fillStyle = "#57534e";
      ctx.fillRect(bridge.x, bridge.y + bridge.h - 4, bridge.w, 4);

      // Bridge planks
      ctx.strokeStyle = "#44403c";
      ctx.lineWidth = 1;
      for (let i = 0; i < bridge.w; i += 24) {
        ctx.beginPath();
        ctx.moveTo(bridge.x + i, bridge.y);
        ctx.lineTo(bridge.x + i, bridge.y + bridge.h);
        ctx.stroke();
      }

      // Players
      for (const p of players) {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        // Eyes
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
