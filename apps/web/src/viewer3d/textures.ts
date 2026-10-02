import * as THREE from "three";
import type { Material } from "@planner/shared";

const cache = new Map<string, THREE.Texture>();

/** Procedural textures drawn on a canvas; 1 texture tile = `tileCm` centimetres. */
export function materialTexture(m: Material): { texture: THREE.Texture; tileCm: number } {
  const tileCm = m.pattern === "herringbone" ? (m.scale ?? 40) * 2 : m.pattern === "planks" ? (m.scale ?? 120) : m.pattern === "tiles" ? (m.scale ?? 30) * 2 : m.pattern === "hex" ? (m.scale ?? 15) * 3.5 : 100;
  const cached = cache.get(m.id);
  if (cached) return { texture: cached, tileCm };
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const accent = m.accent ?? shade(m.color, -18);
  ctx.fillStyle = m.color;
  ctx.fillRect(0, 0, size, size);
  const px = size / tileCm; // pixels per cm

  const grain = (x: number, y: number, w: number, h: number, base: string) => {
    ctx.fillStyle = shade(base, Math.round((Math.random() - 0.5) * 14));
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  };

  switch (m.pattern) {
    case "herringbone": {
      const L = (m.scale ?? 40) * px; // plank length
      const W = L / 4;
      ctx.save();
      // draw a 45° herringbone by rotating the canvas
      ctx.translate(size / 2, size / 2);
      ctx.rotate(Math.PI / 4);
      const span = size * 1.5;
      for (let row = -span; row < span; row += W) {
        for (let col = -span; col < span; col += 2 * L) {
          grain(col, row, L, W, m.color);
          ctx.save();
          ctx.translate(col + L, row);
          ctx.rotate(Math.PI / 2);
          grain(0, -W, L, W, m.color);
          ctx.restore();
        }
      }
      ctx.restore();
      break;
    }
    case "planks": {
      const L = (m.scale ?? 120) * px;
      const W = Math.max(8, (m.scale ?? 120) / 6) * px;
      for (let y = 0, i = 0; y < size; y += W, i++) {
        const offset = (i % 2) * (L / 2);
        for (let x = -L; x < size + L; x += L) grain(x + offset, y, L, W, m.color);
      }
      break;
    }
    case "tiles": {
      const T = (m.scale ?? 30) * px;
      for (let y = 0, j = 0; y < size; y += T, j++) {
        for (let x = 0, i = 0; x < size; x += T, i++) {
          ctx.fillStyle = m.id === "tile_black_white" ? ((i + j) % 2 ? accent : m.color) : shade(m.color, Math.round((Math.random() - 0.5) * 8));
          ctx.fillRect(x, y, T, T);
          ctx.strokeStyle = m.id === "tile_black_white" ? "rgba(0,0,0,0.1)" : accent;
          ctx.lineWidth = Math.max(1, px * 0.4);
          ctx.strokeRect(x, y, T, T);
        }
      }
      break;
    }
    case "hex": {
      const r = (m.scale ?? 15) * px;
      const h = Math.sqrt(3) * r;
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(1, px * 0.3);
      for (let y = -h; y < size + h; y += h) {
        for (let x = -r * 3, i = 0; x < size + r * 3; x += r * 3, i++) {
          for (const [ox, oy] of [
            [0, 0],
            [r * 1.5, h / 2],
          ]) {
            ctx.beginPath();
            for (let k = 0; k < 6; k++) {
              const a = (Math.PI / 3) * k;
              ctx.lineTo(x + ox + r * Math.cos(a), y + oy + r * Math.sin(a));
            }
            ctx.closePath();
            ctx.fillStyle = shade(m.color, Math.round((Math.random() - 0.5) * 10));
            ctx.fill();
            ctx.stroke();
          }
        }
      }
      break;
    }
    case "concrete":
    case "carpet": {
      const img = ctx.getImageData(0, 0, size, size);
      for (let i = 0; i < img.data.length; i += 4) {
        const n = (Math.random() - 0.5) * (m.pattern === "carpet" ? 22 : 12);
        img.data[i] = clamp(img.data[i]! + n);
        img.data[i + 1] = clamp(img.data[i + 1]! + n);
        img.data[i + 2] = clamp(img.data[i + 2]! + n);
      }
      ctx.putImageData(img, 0, 0);
      break;
    }
    default:
      break;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  cache.set(m.id, texture);
  return { texture, tileCm };
}

const clamp = (v: number) => Math.max(0, Math.min(255, v));

export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n)) return hex;
  const r = clamp((n >> 16) + amount);
  const g = clamp(((n >> 8) & 0xff) + amount);
  const b = clamp((n & 0xff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
