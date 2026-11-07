import type { ImgItem, Role } from '../types';

export function moveImage(images: ImgItem[], id: string, role: Role, index: number): ImgItem[] {
  const item = images.find((img) => img.id === id);
  if (!item) return images;
  const groups: Record<Role, ImgItem[]> = { main: [], detail: [], hold: [] };
  for (const img of images) {
    if (img.id !== id) groups[img.role].push(img);
  }
  const next: ImgItem = {
    ...item,
    role,
    holdTag: role === 'hold' ? item.holdTag || '手动' : '',
  };
  const dest = groups[role];
  dest.splice(Math.max(0, Math.min(index, dest.length)), 0, next);
  return [...groups.main, ...groups.detail, ...groups.hold];
}
