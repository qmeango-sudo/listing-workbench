import type { Adjust, AdjustScope, Role } from '../types';

export type Palette = {
  id: string;
  name: string;
  mode: 'none' | 'map' | 'mono';
  stops: string[];
  hues: number[];
  sats: number[];
};

function hexToHsl(hex: string): [number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  const [h, s] = rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
  return [h, s];
}

function makePalette(id: string, name: string, mode: Palette['mode'], stops: string[]): Palette {
  const hues: number[] = [];
  const sats: number[] = [];
  for (const stop of stops) {
    const [h, s] = hexToHsl(stop);
    hues.push(h);
    sats.push(s);
  }
  return { id, name, mode, stops, hues, sats };
}

export const PALETTES: Palette[] = [
  makePalette('none', '原色', 'none', []),
  makePalette('warm', '暖杏', 'map', ['#E8A15A', '#C4622D', '#F4E2CF', '#8A4B32']),
  makePalette('clay', '赤陶', 'map', ['#B55233', '#E39B78', '#F6E4D8', '#6E2E24']),
  makePalette('pine', '松绿', 'map', ['#1E4A3A', '#6E8F78', '#D5C7A1', '#F3EEE4']),
  makePalette('ink', '黛蓝', 'map', ['#243656', '#5E7C99', '#C9BBA2', '#F4F0E8']),
  makePalette('blush', '胭脂', 'map', ['#8E3A4A', '#D98998', '#F3D5D8', '#F8F3EE']),
  makePalette('mono', '去色', 'mono', ['#8E8880']),
];

const byId = new Map(PALETTES.map((palette) => [palette.id, palette]));

export function paletteById(id: string): Palette {
  return byId.get(id) ?? PALETTES[0];
}

export function isIdentity(adjust: Adjust): boolean {
  return (
    adjust.hue === 0 &&
    adjust.brightness === 0 &&
    adjust.contrast === 0 &&
    (adjust.paletteId === 'none' || adjust.strength === 0)
  );
}

export function shouldAdjust(role: Role, scope: AdjustScope): boolean {
  if (role === 'hold') return false;
  if (scope === 'all') return true;
  return role === scope;
}

export function quickRecolor(): Adjust {
  return { hue: 18, brightness: 6, contrast: 8, paletteId: 'warm', strength: 42 };
}

function clampByte(n: number): number {
  if (n < 0) return 0;
  if (n > 255) return 255;
  return n;
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function lerpHue(a: number, b: number, t: number): number {
  let d = b - a;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return (a + d * t + 360) % 360;
}

export function applyAdjust(data: Uint8ClampedArray, adjust: Adjust): void {
  const palette = paletteById(adjust.paletteId);
  const strength = Math.max(0, Math.min(100, adjust.strength)) / 100;
  const needHsl = adjust.hue !== 0 || (palette.mode !== 'none' && strength > 0);
  const add = adjust.brightness * 2.55;
  const contrast = (100 + adjust.contrast) / 100;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    if (alpha < 1) {
      r = r * alpha + 255 * (1 - alpha);
      g = g * alpha + 255 * (1 - alpha);
      b = b * alpha + 255 * (1 - alpha);
      data[i + 3] = 255;
    }
    if (adjust.brightness !== 0) {
      r += add;
      g += add;
      b += add;
    }
    if (adjust.contrast !== 0) {
      r = (r - 128) * contrast + 128;
      g = (g - 128) * contrast + 128;
      b = (b - 128) * contrast + 128;
    }
    if (needHsl) {
      let [h, s, l] = rgbToHsl(clampByte(r), clampByte(g), clampByte(b));
      h = (h + adjust.hue + 360) % 360;
      if (palette.mode === 'mono') {
        s *= 1 - strength;
      } else if (palette.mode === 'map' && strength > 0 && s > 0.08 && palette.hues.length) {
        let best = palette.hues[0];
        let bestS = palette.sats[0];
        let bestD = 999;
        for (let p = 0; p < palette.hues.length; p += 1) {
          let d = Math.abs(h - palette.hues[p]);
          if (d > 180) d = 360 - d;
          if (d < bestD) {
            bestD = d;
            best = palette.hues[p];
            bestS = palette.sats[p];
          }
        }
        h = lerpHue(h, best, strength);
        s += (bestS - s) * strength * 0.35;
      }
      const rgb = hslToRgb(h, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l)));
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
    } else {
      data[i] = clampByte(r);
      data[i + 1] = clampByte(g);
      data[i + 2] = clampByte(b);
    }
  }
}
