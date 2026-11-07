import type { Role } from '../types';

export type PathRole = { role: Role; holdTag: string };

function matchRole(source: string): PathRole | null {
  if (!source) return null;
  const text = source.toLowerCase();
  if (/评论|买家秀|问大家|晒图|(^|[^a-z])(reviews?|comments?)([^a-z]|$)/i.test(text)) {
    return { role: 'hold', holdTag: '评论' };
  }
  if (/sku|规格图|颜色图|款式图|色卡|(^|[^a-z])sku([^a-z]|$)/i.test(text)) {
    return { role: 'hold', holdTag: '规格' };
  }
  if (/详情|描述|长图|手机图|xiangqing|(^|[^a-z])(detail|desc|description)([^a-z]|$)/i.test(text)) {
    return { role: 'detail', holdTag: '' };
  }
  if (/主图|主图片|轮播|封面|首图|zhutu|(^|[^a-z])(main|cover)([^a-z]|$)/i.test(text)) {
    return { role: 'main', holdTag: '' };
  }
  return null;
}

export function roleFromPath(path: string): PathRole | null {
  const parts = path.split(/[/\\]/).filter(Boolean);
  const dirs = parts.slice(0, -1).join('/');
  const file = parts[parts.length - 1] || '';
  return matchRole(dirs) || matchRole(file);
}

export function isLikelyMain(width: number, height: number): boolean {
  if (width < 1 || height < 1) return false;
  const ratio = width / height;
  const side = Math.max(width, height);
  return ratio > 0.85 && ratio < 1.18 && side >= 320 && side <= 2200;
}

export function isThumbName(path: string): boolean {
  return /thumb|thumbnail|缩略|小图|_small|(^|[^a-z])icon([^a-z]|$)/i.test(path);
}

export function baseName(path: string): string {
  const clean = path.split('?')[0].split('#')[0];
  const parts = clean.split(/[/\\]/);
  const last = parts[parts.length - 1] || '';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}
