export function buildCopyText(title: string, points: string[], detail: string): string {
  const usable = points.map((point) => point.trim()).filter(Boolean);
  const pointBlock = usable.length ? usable.map((point, index) => `${index + 1}. ${point}`).join('\n') : '（空）';
  return `标题：\n${title.trim() || '（空）'}\n\n卖点：\n${pointBlock}\n\n详情文案：\n${detail.trim() || '（空）'}\n`;
}

export function listingZipName(title: string): string {
  const clean = title
    .trim()
    .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  return `${clean || '未命名'}-上架包.zip`;
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
}
