import { applyAdjust, isIdentity } from './adjust';
import { CJK_FONT } from './font';
import { canvasToJpeg } from './renderImage';
import type { Adjust, LayoutMode } from '../types';

export type DetailRequest = {
  images: Blob[];
  title: string;
  points: string[];
  detailText: string;
  mode: LayoutMode;
  gap: number;
  paper: string;
  banner: boolean;
  maxSlice: number;
  adjust: Adjust;
};

export type PageImage = { blob: Blob; width: number; height: number };

type Prepared = { width: number; height: number; bands: HTMLCanvasElement[] };

type Block =
  | { kind: 'spacer'; h: number }
  | {
      kind: 'slice';
      h: number;
      paint: (ctx: CanvasRenderingContext2D, y: number, srcY: number, srcH: number) => void;
    };

const PAGE_W = 750;
const BAND = 4096;

export async function renderDetailPages(req: DetailRequest): Promise<PageImage[]> {
  const width = PAGE_W;
  const maxSlice = Math.max(400, Math.min(2400, Math.round(req.maxSlice)));
  const gap = Math.max(0, Math.min(120, Math.round(req.gap)));
  const prepared: Prepared[] = [];
  for (const blob of req.images) prepared.push(await prepareImage(blob, width, req.adjust));

  const blocks: Block[] = [];
  const banner = req.banner ? renderBanner(width, req.title, req.points, req.paper) : null;
  if (banner) blocks.push(canvasBlock(banner));
  const content = buildContent(prepared, req, width, gap, maxSlice);
  if (banner && content.length) blocks.push({ kind: 'spacer', h: Math.max(gap, 12) });
  blocks.push(...content);
  while (blocks.length && blocks[blocks.length - 1].kind === 'spacer') blocks.pop();
  if (!blocks.length) return [];
  return paginate(blocks, width, maxSlice, req.paper);
}

function buildContent(prepared: Prepared[], req: DetailRequest, width: number, gap: number, maxSlice: number): Block[] {
  const content: Block[] = [];
  if (!prepared.length) {
    for (const card of renderParagraphCanvases(req.detailText, width, req.paper, maxSlice)) {
      if (content.length) content.push({ kind: 'spacer', h: Math.max(gap, 12) });
      content.push(canvasBlock(card));
    }
    return content;
  }
  if (req.mode === 'columns') return columnBlocks(prepared, width, gap);
  if (req.mode === 'spaced') return spacedBlocks(prepared, req.detailText, width, gap, req.paper, maxSlice);
  prepared.forEach((image, index) => {
    if (index > 0 && gap > 0) content.push({ kind: 'spacer', h: gap });
    content.push(imageBlock(image, width));
  });
  return content;
}

function spacedBlocks(
  prepared: Prepared[],
  detailText: string,
  width: number,
  gap: number,
  paper: string,
  maxSlice: number,
): Block[] {
  const paragraphs = splitParagraphs(detailText);
  const content: Block[] = [];
  prepared.forEach((image, index) => {
    if (content.length && gap > 0) content.push({ kind: 'spacer', h: gap });
    const section = composeSpaced(image, paragraphs[index] || '', width, paper);
    if (section) content.push(canvasBlock(section));
    else {
      content.push(imageBlock(image, width));
      const caption = captionCanvas(paragraphs[index] || '', width, paper);
      if (caption) {
        content.push({ kind: 'spacer', h: 8 });
        content.push(canvasBlock(caption));
      }
    }
  });
  const extra = paragraphs.slice(prepared.length).filter(Boolean);
  if (extra.length) {
    for (const card of renderParagraphCanvases(extra.join('\n\n'), width, paper, maxSlice)) {
      content.push({ kind: 'spacer', h: gap || 12 });
      content.push(canvasBlock(card));
    }
  }
  return content;
}

async function prepareImage(blob: Blob, targetW: number, adjust: Adjust): Promise<Prepared> {
  const bitmap = await createImageBitmap(blob);
  const fullH = Math.max(1, Math.round(bitmap.height * (targetW / bitmap.width)));
  const bands: HTMLCanvasElement[] = [];
  let destY = 0;
  while (destY < fullH) {
    const destH = Math.min(BAND, fullH - destY);
    const sy = Math.min(bitmap.height - 1, Math.round((destY * bitmap.height) / fullH));
    const sy2 = Math.min(bitmap.height, Math.round(((destY + destH) * bitmap.height) / fullH));
    const sh = Math.max(1, sy2 - sy);
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = destH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('浏览器不能画图');
    ctx.drawImage(bitmap, 0, sy, bitmap.width, sh, 0, 0, targetW, destH);
    if (!isIdentity(adjust)) {
      const image = ctx.getImageData(0, 0, targetW, destH);
      applyAdjust(image.data, adjust);
      ctx.putImageData(image, 0, 0);
    }
    bands.push(canvas);
    destY += destH;
  }
  bitmap.close();
  return { width: targetW, height: fullH, bands };
}

function imageBlock(image: Prepared, destW: number): Block {
  const destH = Math.max(1, Math.round(image.height * (destW / image.width)));
  return {
    kind: 'slice',
    h: destH,
    paint(ctx, y, srcY, srcH) {
      paintPreparedSlice(ctx, image, 0, y, destW, srcY, srcH, destH);
    },
  };
}

function canvasBlock(canvas: HTMLCanvasElement): Block {
  return {
    kind: 'slice',
    h: canvas.height,
    paint(ctx, y, srcY, srcH) {
      ctx.drawImage(canvas, 0, srcY, canvas.width, srcH, 0, y, canvas.width, srcH);
    },
  };
}

function columnBlocks(images: Prepared[], pageW: number, gap: number): Block[] {
  const pad = 16;
  const gutter = Math.max(0, Math.min(80, gap));
  const colW = Math.max(80, Math.floor((pageW - pad * 2 - gutter) / 2));
  const blocks: Block[] = [];
  for (let i = 0; i < images.length; i += 2) {
    const left = images[i];
    const right = images[i + 1];
    if (blocks.length && gutter > 0) blocks.push({ kind: 'spacer', h: gutter });
    if (!right) {
      blocks.push(imageBlock(left, pageW));
      continue;
    }
    const lh = Math.max(1, Math.round(left.height * (colW / left.width)));
    const rh = Math.max(1, Math.round(right.height * (colW / right.width)));
    blocks.push({
      kind: 'slice',
      h: Math.max(lh, rh),
      paint(ctx, y, srcY, srcH) {
        paintPreparedSlice(ctx, left, pad, y, colW, srcY, srcH, lh);
        paintPreparedSlice(ctx, right, pad + colW + gutter, y, colW, srcY, srcH, rh);
      },
    });
  }
  return blocks;
}

function paintPreparedSlice(
  ctx: CanvasRenderingContext2D,
  prepared: Prepared,
  dx: number,
  dy: number,
  destW: number,
  srcY: number,
  srcH: number,
  destH: number,
) {
  if (destH <= 0 || srcY >= destH) return;
  const visible = Math.min(srcH, destH - srcY);
  if (visible <= 0) return;
  const scale = prepared.height / destH;
  let needY = srcY * scale;
  let needH = visible * scale;
  let destCursor = dy;
  let bandTop = 0;
  for (const band of prepared.bands) {
    const bandBottom = bandTop + band.height;
    if (needH <= 0.5) break;
    if (bandBottom <= needY + 0.5) {
      bandTop = bandBottom;
      continue;
    }
    if (bandTop >= needY + needH) break;
    const sy = Math.max(0, needY - bandTop);
    const sh = Math.min(band.height - sy, needY + needH - (bandTop + sy));
    if (sh <= 0) {
      bandTop = bandBottom;
      continue;
    }
    const dh = sh / scale;
    ctx.drawImage(band, 0, sy, band.width, sh, dx, destCursor, destW, dh);
    destCursor += dh;
    needY += sh;
    needH -= sh;
    bandTop = bandBottom;
  }
}

function composeSpaced(image: Prepared, caption: string, pageW: number, paper: string): HTMLCanvasElement | null {
  const padX = 28;
  const padY = 16;
  const innerW = pageW - padX * 2;
  const destH = Math.max(1, Math.round(image.height * (innerW / image.width)));
  const scratch = measure();
  scratch.font = `400 16px ${CJK_FONT}`;
  const lines = caption ? capLines(scratch, caption, innerW, 4) : [];
  const captionH = lines.length ? 14 + lines.length * 26 : 0;
  const height = padY + destH + captionH + padY;
  if (height > 8000) return null;
  const canvas = document.createElement('canvas');
  canvas.width = pageW;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, pageW, height);
  paintPreparedSlice(ctx, image, padX, padY, innerW, 0, destH, destH);
  ctx.fillStyle = '#1c1916';
  ctx.font = `400 16px ${CJK_FONT}`;
  ctx.textBaseline = 'top';
  let y = padY + destH + 12;
  for (const line of lines) {
    ctx.fillText(line, padX, y);
    y += 26;
  }
  ctx.fillStyle = shade(paper, -18);
  ctx.fillRect(padX, height - 1, innerW, 1);
  return canvas;
}

function captionCanvas(text: string, width: number, paper: string): HTMLCanvasElement | null {
  const body = text.trim();
  if (!body) return null;
  const scratch = measure();
  scratch.font = `400 16px ${CJK_FONT}`;
  const lines = capLines(scratch, body, width - 56, 4);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 20 + lines.length * 26;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, canvas.height);
  ctx.fillStyle = '#1c1916';
  ctx.font = `400 16px ${CJK_FONT}`;
  ctx.textBaseline = 'top';
  lines.forEach((line, index) => ctx.fillText(line, 28, 8 + index * 26));
  return canvas;
}

function renderBanner(width: number, title: string, points: string[], paper: string): HTMLCanvasElement | null {
  const heading = title.trim();
  const pts = points.map((point) => point.trim()).filter(Boolean);
  if (!heading && !pts.length) return null;
  const scratch = measure();
  scratch.font = `700 30px ${CJK_FONT}`;
  const titleLines = heading ? wrapText(scratch, heading, width - 72).slice(0, 2) : [];
  scratch.font = `400 16px ${CJK_FONT}`;
  const pointLines = pts.length ? wrapText(scratch, pts.join('    ·    '), width - 72).slice(0, 3) : [];
  const height = 32 + titleLines.length * 40 + (pointLines.length ? 16 + pointLines.length * 26 : 0) + 20;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#c44724';
  ctx.fillRect(0, 0, 8, height);
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#1c1916';
  ctx.font = `700 30px ${CJK_FONT}`;
  let y = 24;
  for (const line of titleLines) {
    ctx.fillText(line, 32, y);
    y += 40;
  }
  ctx.font = `400 16px ${CJK_FONT}`;
  ctx.fillStyle = '#3f3a34';
  if (pointLines.length) y += 8;
  for (const line of pointLines) {
    ctx.fillText(line, 32, y);
    y += 26;
  }
  return canvas;
}

function renderParagraphCanvases(text: string, width: number, paper: string, maxSlice: number): HTMLCanvasElement[] {
  const body = text.trim();
  if (!body) return [];
  const scratch = measure();
  scratch.font = `400 18px ${CJK_FONT}`;
  const lines = wrapText(scratch, body, width - 72);
  const lineH = 30;
  const maxLines = Math.max(1, Math.floor((maxSlice - 64) / lineH));
  const canvases: HTMLCanvasElement[] = [];
  for (let i = 0; i < lines.length; i += maxLines) {
    const chunk = lines.slice(i, i + maxLines);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = 32 + chunk.length * lineH + 24;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, width, canvas.height);
    ctx.fillStyle = '#1c1916';
    ctx.font = `400 18px ${CJK_FONT}`;
    ctx.textBaseline = 'top';
    chunk.forEach((line, index) => ctx.fillText(line, 36, 28 + index * lineH));
    canvases.push(canvas);
  }
  return canvases;
}

function splitParagraphs(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const byBlank = trimmed
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (byBlank.length > 1) return byBlank;
  const lines = trimmed
    .split(/\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (lines.length >= 2 && lines.every((line) => line.length <= 40)) return lines;
  return [trimmed];
}

function capLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, max: number): string[] {
  const lines = wrapText(ctx, text, maxWidth);
  if (lines.length <= max) return lines;
  const cut = lines.slice(0, max);
  const last = cut[max - 1].replace(/\s+$/, '');
  cut[max - 1] = last.length > 1 ? `${last.slice(0, -1)}…` : '…';
  return cut;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\n/)) {
    if (!para) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const ch of para) {
      const test = line + ch;
      if (line && ctx.measureText(test).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else line = test;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function shade(hex: string, delta: number): string {
  const match = hex.match(/^#([0-9a-f]{6})$/i);
  if (!match) return hex;
  const n = Number.parseInt(match[1], 16);
  const channel = (value: number) => Math.max(0, Math.min(255, value + delta));
  return `rgb(${channel((n >> 16) & 255)},${channel((n >> 8) & 255)},${channel(n & 255)})`;
}

function measure(): CanvasRenderingContext2D {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) throw new Error('浏览器不能画图');
  return ctx;
}

async function paginate(blocks: Block[], width: number, maxSlice: number, paper: string): Promise<PageImage[]> {
  const pages: PageImage[] = [];
  let page = fresh(width, maxSlice, paper);
  let y = 0;

  async function flush() {
    if (y <= 0) return;
    const height = Math.max(1, Math.round(y));
    pages.push({ blob: await cropJpeg(page, height), width, height });
    page = fresh(width, maxSlice, paper);
    y = 0;
  }

  for (const block of blocks) {
    if (block.kind === 'spacer') {
      if (y > 0 && y + block.h <= maxSlice) y += block.h;
      continue;
    }
    let src = 0;
    while (src < block.h) {
      if (y >= maxSlice) await flush();
      const room = maxSlice - y;
      if (room < 8 && y > 0) {
        await flush();
        continue;
      }
      const take = Math.min(maxSlice - y, block.h - src);
      if (take <= 0) break;
      const ctx = page.getContext('2d');
      if (!ctx) throw new Error('浏览器不能画图');
      block.paint(ctx, y, src, take);
      y += take;
      src += take;
    }
  }
  if (y > 0) {
    const height = Math.max(1, Math.round(y));
    pages.push({ blob: await cropJpeg(page, height), width, height });
  }
  return pages;
}

function fresh(width: number, height: number, paper: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不能画图');
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

function cropJpeg(src: HTMLCanvasElement, height: number): Promise<Blob> {
  if (height === src.height) return canvasToJpeg(src, 0.9);
  const canvas = document.createElement('canvas');
  canvas.width = src.width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('浏览器不能画图'));
  ctx.drawImage(src, 0, 0);
  return canvasToJpeg(canvas, 0.9);
}
