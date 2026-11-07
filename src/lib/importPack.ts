import JSZip from 'jszip';
import { baseName, isLikelyMain, isThumbName, roleFromPath } from './classify';
import { parseLabeled, parseTextDocument, textRank, titleFromFilename } from './parseCopy';
import { decodeZipName, readTextSmart } from './readText';
import { parseXlsx } from './xlsx';
import {
  emptyCopy,
  type ImageHint,
  type ImgItem,
  type Incoming,
  type Pack,
  type ParsedCopy,
  type Role,
  type RoleSource,
} from '../types';

type Draft = {
  file: Blob;
  path: string;
  name: string;
  width: number;
  height: number;
  role: Role;
  holdTag: string;
  roleSource: RoleSource;
};

type Ranked = ParsedCopy & { titleRank: number; pointRank: number; detailRank: number };

export async function importPack(incoming: Incoming[]): Promise<Pack> {
  const warnings: string[] = [];
  const zipTitles: string[] = [];
  const flat = await flatten(incoming, warnings, zipTitles, 0);
  const fields = rankedEmpty();
  const hintMap = new Map<string, ImageHint>();
  let remote = 0;
  const dataImages: { name: string; blob: Blob; path: string }[] = [];
  const imageIncomings: Incoming[] = [];
  let sawVideo = false;
  let sawDesign = false;
  let sawHeic = false;
  let sawXls = false;

  for (const item of flat) {
    if (shouldSkip(item.path)) continue;
    const lower = item.path.toLowerCase();
    if (/\.(mp4|mov|webm|avi|mkv)$/i.test(lower) || item.file.type.startsWith('video/')) {
      sawVideo = true;
      continue;
    }
    if (/\.(psd|psb|ai)$/i.test(lower)) {
      sawDesign = true;
      continue;
    }
    if (/\.hei[cf]$/i.test(lower)) {
      sawHeic = true;
      continue;
    }
    if (/\.xls$/i.test(lower) && !/\.xlsx$/i.test(lower)) {
      sawXls = true;
      continue;
    }
    if (/\.xlsx$/i.test(lower)) {
      try {
        const parsed = await parseXlsx(await item.file.arrayBuffer());
        mergeParsed(fields, parsed, textRank(item.path));
        parsed.warnings.forEach((warning) => push(warnings, warning));
      } catch {
        warnings.push(`Excel 没有读成：${baseName(item.path)}`);
      }
      continue;
    }
    if (isTextPath(lower) || item.file.type.startsWith('text/') || item.file.type.includes('json')) {
      try {
        const text = await readTextSmart(item.file);
        const rank = textRank(item.path);
        const parsed = rank <= 10 ? parseLabeled(text) : parseTextDocument(item.path, text);
        if (!parsed) continue;
        mergeParsed(fields, parsed, rank);
        rememberHints(hintMap, parsed.hints);
        remote += parsed.remote;
        parsed.dataImages.forEach((image, index) => {
          dataImages.push({ name: image.name, blob: image.blob, path: `${item.path}#${index + 1}-${image.name}` });
        });
        parsed.warnings.forEach((warning) => push(warnings, warning));
      } catch {
        warnings.push(`文案没有读成：${baseName(item.path)}`);
      }
      continue;
    }
    if (await looksLikeImage(item)) {
      imageIncomings.push(item);
      continue;
    }
  }

  if (sawVideo) push(warnings, '跳过了视频。工作台不处理视频。');
  if (sawDesign) push(warnings, '跳过了 PSD / AI，请先另存成 JPG 或 PNG。');
  if (sawHeic) push(warnings, 'HEIC 打不开，请先转成 JPG。');
  if (sawXls) push(warnings, '旧版 .xls 没有读取，请另存为 xlsx 或 csv。');
  if (remote) push(warnings, `有 ${remote} 处图片只写了网络地址，没有图像文件，已跳过（不会去下载）。`);

  const decoded: Draft[] = [];
  for (const item of imageIncomings) {
    const size = await measure(item.file);
    if (!size) {
      push(warnings, `打不开图片：${item.path}`);
      continue;
    }
    decoded.push(blankDraft(item.file, item.path, size.width, size.height));
  }

  if (imageIncomings.length && dataImages.length) {
    push(warnings, '网页里嵌着图片，同时已有图像文件，没有重复导入内嵌图。');
  } else {
    for (const image of dataImages) {
      const size = await measure(image.blob);
      if (!size) continue;
      decoded.push(blankDraft(image.blob, image.path, size.width, size.height));
    }
  }

  const usable = dropTiny(decoded, warnings);
  classify(usable, hintMap, warnings);
  if (!fields.title) {
    const guessed = zipTitles.map(titleFromFilename).find(Boolean);
    if (guessed) fields.title = guessed;
  }

  const images = usable.map((draft) => {
    const url = URL.createObjectURL(draft.file);
    const item: ImgItem = {
      id: crypto.randomUUID(),
      name: draft.name,
      path: draft.path,
      role: draft.role,
      holdTag: draft.holdTag,
      roleSource: draft.roleSource,
      blob: draft.file,
      width: draft.width,
      height: draft.height,
      url,
    };
    return item;
  });

  if (!images.length && !fields.title && !fields.detail && !fields.points.length) {
    push(warnings, '没有读到图片或文案。');
  }

  return {
    title: fields.title,
    points: fields.points,
    detail: fields.detail,
    images,
    warnings,
  };
}

function blankDraft(file: Blob, path: string, width: number, height: number): Draft {
  return {
    file,
    path,
    name: baseName(path),
    width,
    height,
    role: 'detail',
    holdTag: '',
    roleSource: 'aspect',
  };
}

function classify(drafts: Draft[], hints: Map<string, ImageHint>, warnings: string[]) {
  drafts.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN', { numeric: true, sensitivity: 'base' }));
  for (const draft of drafts) {
    const fromPath = roleFromPath(draft.path);
    if (fromPath) {
      draft.role = fromPath.role;
      draft.holdTag = fromPath.holdTag;
      draft.roleSource = 'path';
      continue;
    }
    const hint = hints.get(draft.name.toLowerCase());
    if (hint) {
      draft.role = hint.role;
      draft.holdTag = hint.holdTag;
      draft.roleSource = 'hint';
      continue;
    }
    draft.role = isLikelyMain(draft.width, draft.height) ? 'main' : 'detail';
    draft.roleSource = 'aspect';
  }
  const aspectMains = drafts.filter((draft) => draft.role === 'main' && draft.roleSource === 'aspect');
  if (aspectMains.length > 5) {
    aspectMains.slice(5).forEach((draft) => {
      draft.role = 'detail';
    });
    push(warnings, '接近正方形的图超过 5 张，多出来的放到了详情。需要的话可以改回主图。');
  }
  const anyAspect = drafts.some((draft) => draft.roleSource === 'aspect');
  const anyNamed = drafts.some((draft) => draft.roleSource === 'path' || draft.roleSource === 'hint');
  if (anyAspect && !anyNamed && drafts.length) {
    push(warnings, '没有主图/详情这样的文件夹名，已按接近正方形放到主图，其余放到详情。');
  } else if (anyAspect && anyNamed) {
    push(warnings, '有一部分图没有文件夹名，是按尺寸归类的。');
  }
  if (drafts.length && !drafts.some((draft) => draft.role === 'main')) {
    push(warnings, '没有分出主图。文件夹里带「主图」时会自动归类，也可以在图上改成主图。');
  }
  const paths = drafts.map((draft) => draft.path);
  if (paths.some((path) => /手机/.test(path)) && paths.some((path) => /详情/.test(path) && !/手机/.test(path))) {
    push(warnings, '包里同时有手机详情和普通详情，都放进了详情，可以删掉不要的那组。');
  }
  const groups: Record<Role, Draft[]> = { main: [], detail: [], hold: [] };
  for (const draft of drafts) groups[draft.role].push(draft);
  drafts.splice(0, drafts.length, ...groups.main, ...groups.detail, ...groups.hold);
}

function dropTiny(drafts: Draft[], warnings: string[]): Draft[] {
  const thumbs = drafts.filter((draft) => isThumbName(draft.path));
  const named = drafts.filter((draft) => !isThumbName(draft.path));
  let pool = drafts;
  if (thumbs.length && named.length) {
    pool = named;
    push(warnings, `跳过了 ${thumbs.length} 张缩略图。`);
  }
  const big = pool.filter((draft) => draft.width >= 120 || draft.height >= 120);
  if (big.length && big.length < pool.length) {
    push(warnings, `跳过了 ${pool.length - big.length} 张很小的图（像图标）。`);
    return big;
  }
  return pool;
}

async function measure(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

async function looksLikeImage(item: Incoming): Promise<boolean> {
  if (/\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(item.path) || item.file.type.startsWith('image/')) return true;
  if (/\.[a-z0-9]+$/i.test(item.path)) return false;
  const bytes = new Uint8Array(await item.file.slice(0, 16).arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return true;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return true;
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return true;
  const head = String.fromCharCode(...bytes.slice(0, 12));
  return head.startsWith('RIFF') && head.includes('WEBP');
}

function isTextPath(path: string): boolean {
  return /\.(txt|md|csv|json|html?)$/i.test(path);
}

function shouldSkip(path: string): boolean {
  return path.split(/[/\\]/).some((part) => !part || part === '__MACOSX' || part.startsWith('.') || part === 'Thumbs.db');
}

async function flatten(incoming: Incoming[], warnings: string[], zipTitles: string[], depth: number): Promise<Incoming[]> {
  const out: Incoming[] = [];
  for (const item of incoming) {
    if (shouldSkip(item.path)) continue;
    if (/\.zip$/i.test(item.path) && depth < 2) {
      const guessed = titleFromFilename(baseName(item.path));
      if (guessed) zipTitles.push(guessed);
      try {
        const expanded = await expandZip(item.file, item.path);
        out.push(...(await flatten(expanded, warnings, zipTitles, depth + 1)));
      } catch {
        push(warnings, `压缩包打不开（可能已加密或已损坏）：${baseName(item.path)}`);
      }
      continue;
    }
    out.push(item);
  }
  return out;
}

async function expandZip(file: Blob, zipPath: string): Promise<Incoming[]> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer(), { decodeFileName: decodeZipName });
  const prefix = baseName(zipPath).replace(/\.zip$/i, '');
  const out: Incoming[] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || shouldSkip(entry.name)) continue;
    const blob = await entry.async('blob');
    const leaf = baseName(entry.name);
    const typed = new File([blob], leaf, { type: mimeFromPath(entry.name) });
    out.push({ file: typed, path: `${prefix}/${entry.name}` });
  }
  return out;
}

function mimeFromPath(path: string): string {
  const ext = (path.toLowerCase().split('.').pop() || '').split('?')[0];
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'bmp') return 'image/bmp';
  if (ext === 'avif') return 'image/avif';
  if (ext === 'txt' || ext === 'md' || ext === 'csv') return 'text/plain';
  if (ext === 'html' || ext === 'htm') return 'text/html';
  if (ext === 'json') return 'application/json';
  if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  return '';
}

function rememberHints(map: Map<string, ImageHint>, hints: ImageHint[]) {
  for (const hint of hints) {
    const key = hint.base.toLowerCase();
    if (key && !map.has(key)) map.set(key, hint);
  }
}

function rankedEmpty(): Ranked {
  return { ...emptyCopy(), titleRank: 0, pointRank: 0, detailRank: 0 };
}

function mergeParsed(base: Ranked, add: ParsedCopy, rank: number) {
  if (add.title && rank >= base.titleRank) {
    base.title = add.title;
    base.titleRank = rank;
  }
  if (add.points.length && rank >= base.pointRank) {
    base.points = add.points;
    base.pointRank = rank;
  }
  if (add.detail && rank >= base.detailRank) {
    base.detail = rank > base.detailRank || !base.detail ? add.detail : `${base.detail}\n\n${add.detail}`.trim();
    base.detailRank = rank;
  }
}

function push(list: string[], message: string) {
  if (message && !list.includes(message)) list.push(message);
}
