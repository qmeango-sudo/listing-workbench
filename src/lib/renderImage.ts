import { applyAdjust, isIdentity } from './adjust';
import type { Adjust } from '../types';

export function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('导出 JPEG 失败'))), 'image/jpeg', quality);
  });
}

async function editedCanvas(blob: Blob, adjust: Adjust, width: number, height: number): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('浏览器不能画图');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  if (!isIdentity(adjust)) {
    const image = ctx.getImageData(0, 0, width, height);
    applyAdjust(image.data, adjust);
    ctx.putImageData(image, 0, 0);
  }
  return canvas;
}

export async function renderMainJpeg(
  blob: Blob,
  adjust: Adjust,
  opts: { square: boolean; size: number; mat: string },
): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const sourceW = bitmap.width;
  const sourceH = bitmap.height;
  bitmap.close();
  let width = sourceW;
  let height = sourceH;
  if (opts.square) {
    const scale = opts.size / Math.max(sourceW, sourceH);
    width = Math.max(1, Math.round(sourceW * scale));
    height = Math.max(1, Math.round(sourceH * scale));
  } else if (Math.max(width, height) > 1600) {
    const scale = 1600 / Math.max(width, height);
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
  }
  const edited = await editedCanvas(blob, adjust, width, height);
  if (!opts.square || (width === opts.size && height === opts.size)) return canvasToJpeg(edited);
  const out = document.createElement('canvas');
  out.width = opts.size;
  out.height = opts.size;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('浏览器不能画图');
  ctx.fillStyle = opts.mat;
  ctx.fillRect(0, 0, opts.size, opts.size);
  ctx.drawImage(edited, Math.round((opts.size - width) / 2), Math.round((opts.size - height) / 2));
  return canvasToJpeg(out);
}

export async function renderPreviewJpeg(blob: Blob, adjust: Adjust, maxEdge: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  bitmap.close();
  const canvas = await editedCanvas(blob, adjust, width, height);
  return canvasToJpeg(canvas, 0.82);
}
