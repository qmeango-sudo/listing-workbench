import { canvasToJpeg } from './renderImage';
import { CJK_FONT } from './font';
import type { ImgItem, Pack } from '../types';

export async function makeSample(): Promise<Pack> {
  const mains = [
    await paint('主图/01-暖色.jpg', 800, 800, (ctx, w, h) => shirt(ctx, w, h, '#c44724', '#e6b089', '暖杏')),
    await paint('主图/02-松绿.jpg', 800, 800, (ctx, w, h) => shirt(ctx, w, h, '#1e4a3a', '#d5c7a1', '松绿')),
    await paint('主图/03-黛蓝.jpg', 800, 800, (ctx, w, h) => shirt(ctx, w, h, '#243656', '#c9bba2', '黛蓝')),
  ];
  const details = [
    await paint('详情/01-版头.jpg', 750, 460, (ctx, w, h) => panel(ctx, w, h, '#c44724', '加厚连帽', ['肩线落下，袖口收紧。', '风从侧缝过去，也不灌进腰里。'])),
    await paint('详情/02-卖点.jpg', 750, 460, (ctx, w, h) => panel(ctx, w, h, '#1e4a3a', '内里短绒', ['贴身的一面做了磨毛。', '白天单穿，晚上可以罩在衬衫外。'])),
    await paint('详情/03-长图.jpg', 750, 1700, (ctx, w, h) => tall(ctx, w, h)),
    await paint('详情/04-洗涤.jpg', 750, 520, (ctx, w, h) => panel(ctx, w, h, '#8e3a4a', '洗涤', ['反面轻柔，不要长时间浸泡。', '平铺阴干，避免高温熨烫帽绳。'])),
  ];
  const sku = await paint('SKU图/色卡.jpg', 800, 800, (ctx, w, h) => dots(ctx, w, h));
  return {
    title: '加厚连帽卫衣 秋冬男女同款',
    points: ['内里加绒', '落肩宽松', '三色可选'],
    detail: '肩线落下，袖口收紧，风从侧缝过去也不会灌进腰里。\n\n内里是一层短绒，贴身的一面做了磨毛。白天单穿，晚上可以罩在衬衫外面。\n\n洗涤时反面轻柔，不要长时间浸泡。',
    images: [...mains, ...details, sku],
    warnings: ['这是内置示例，用来试改色、排序和导出。正式使用时导入插件保存的文件。'],
  };
}

async function paint(
  path: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): Promise<ImgItem> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('浏览器不能画图');
  draw(ctx, width, height);
  const blob = await canvasToJpeg(canvas, 0.92);
  const name = path.split('/').pop() || path;
  const role = path.startsWith('主图') ? 'main' : path.startsWith('SKU') ? 'hold' : 'detail';
  return {
    id: crypto.randomUUID(),
    name,
    path,
    role,
    holdTag: role === 'hold' ? '规格' : '',
    roleSource: 'sample',
    blob,
    width,
    height,
    url: URL.createObjectURL(blob),
  };
}

function shirt(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, accent: string, label: string) {
  ctx.fillStyle = '#f4f1ea';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color;
  round(ctx, w * 0.22, h * 0.24, w * 0.56, h * 0.5, 28);
  ctx.fill();
  ctx.fillRect(w * 0.1, h * 0.28, w * 0.18, h * 0.16);
  ctx.fillRect(w * 0.72, h * 0.28, w * 0.18, h * 0.16);
  ctx.beginPath();
  ctx.arc(w / 2, h * 0.28, w * 0.13, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(w * 0.4, h * 0.46, w * 0.2, h * 0.18);
  ctx.fillStyle = '#1c1916';
  ctx.font = `700 36px ${CJK_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(label, w / 2, h * 0.84);
  ctx.textAlign = 'left';
}

function panel(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, heading: string, lines: string[]) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, 84);
  ctx.fillStyle = '#fffdf8';
  ctx.font = `700 32px ${CJK_FONT}`;
  ctx.textBaseline = 'top';
  ctx.fillText(heading, 32, 26);
  ctx.fillStyle = '#1c1916';
  ctx.font = `400 22px ${CJK_FONT}`;
  lines.forEach((line, index) => ctx.fillText(line, 32, 120 + index * 40));
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.fillRect(32, h - 150, w - 64, 110);
  ctx.globalAlpha = 1;
}

function tall(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#fffdf8';
  ctx.fillRect(0, 0, w, h);
  const bands = [
    ['#c44724', '版位 1'],
    ['#1e4a3a', '版位 2'],
    ['#243656', '版位 3'],
    ['#8e3a4a', '版位 4'],
  ];
  bands.forEach(([color, label], index) => {
    const y = index * (h / bands.length);
    ctx.fillStyle = color;
    ctx.fillRect(40, y + 36, w - 80, h / bands.length - 72);
    ctx.fillStyle = '#fffdf8';
    ctx.font = `700 36px ${CJK_FONT}`;
    ctx.textBaseline = 'top';
    ctx.fillText(label, 72, y + 70);
  });
}

function dots(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#1c1916';
  ctx.font = `700 28px ${CJK_FONT}`;
  ctx.textBaseline = 'top';
  ctx.fillText('规格色', 48, 48);
  ['#c44724', '#1e4a3a', '#d8b15a'].forEach((color, index) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(w / 2, 220 + index * 180, 62, 0, Math.PI * 2);
    ctx.fill();
  });
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
