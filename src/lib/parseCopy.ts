import { baseName } from './classify';
import { emptyCopy, type ImageHint, type ParsedCopy, type Role } from '../types';

const HEADER_RE =
  /^(商品标题|宝贝标题|商品卖点|导购标题|详情文案|详情描述|商品描述|副标题|卖点|标题|详情|描述|文案)(?:\s*[:：]\s*(.*)|\s*)$/;
const EN_HEADER_RE = /^(title|selling points?|subtitle|description|detail)\s*[:：]\s*(.*)$/i;

export function splitPoints(value: string): string[] {
  const cleaned = value.trim();
  if (!cleaned) return [];
  let parts = cleaned
    .split(/\r?\n|\||｜|;|；/)
    .map(normalizePoint)
    .filter(Boolean);
  if (parts.length === 1 && parts[0].includes('、')) {
    const sub = parts[0].split('、').map(normalizePoint).filter(Boolean);
    if (sub.length >= 2 && sub.length <= 8 && sub.every((part) => part.length <= 18)) parts = sub;
  }
  return parts.slice(0, 12);
}

function normalizePoint(value: string): string {
  return value.replace(/^[\s\-*•·\d.）、]+/, '').trim();
}

function sectionOf(label: string): 'title' | 'points' | 'detail' | null {
  if (/卖点|副标题|导购|selling|subtitle/i.test(label)) return 'points';
  if (/详情|描述|文案|description|detail/i.test(label)) return 'detail';
  if (/标题|title/i.test(label)) return 'title';
  return null;
}

export function parseLabeled(text: string): ParsedCopy | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let current: 'title' | 'points' | 'detail' | null = null;
  const acc = { title: [] as string[], points: [] as string[], detail: [] as string[] };
  let saw = false;
  for (const raw of lines) {
    const line = raw.trim();
    const zh = line.match(HEADER_RE);
    const en = zh ? null : line.match(EN_HEADER_RE);
    const matched = zh || en;
    if (matched) {
      const sec = sectionOf(matched[1]);
      if (sec) {
        saw = true;
        current = sec;
        const content = (matched[2] || '').trim();
        if (content) acc[sec].push(content);
        continue;
      }
    }
    if (!line) {
      if (current === 'detail') acc.detail.push('');
      continue;
    }
    if (current) acc[current].push(line);
  }
  if (!saw) return null;
  return {
    ...emptyCopy(),
    title: acc.title.join(' ').replace(/\s+/g, ' ').trim(),
    points: splitPoints(acc.points.join('\n')),
    detail: acc.detail.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  };
}

export function parseLooseText(text: string): ParsedCopy {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return emptyCopy();
  if (lines[0].length <= 40 && lines.length > 1) {
    return { ...emptyCopy(), title: lines[0], detail: lines.slice(1).join('\n') };
  }
  if (lines.length === 1 && lines[0].length <= 60) return { ...emptyCopy(), title: lines[0] };
  return { ...emptyCopy(), detail: lines.join('\n') };
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((item) => item.trim()));
}

export function fromTable(rows: string[][]): ParsedCopy {
  if (!rows.length) return emptyCopy();
  const header = rows[0].map((cell) => cell.trim());
  const titleCol = header.findIndex((cell) => /标题|宝贝名|商品名/.test(cell) && !/店铺|类目/.test(cell));
  const pointCol = header.findIndex((cell) => /卖点|副标题/.test(cell));
  const detailCol = header.findIndex((cell) => /详情|描述|文案/.test(cell));
  if (titleCol >= 0 || pointCol >= 0 || detailCol >= 0) {
    const dataRows = rows.slice(1).filter((cells) => cells.some((cell) => cell.trim()));
    const first = dataRows[0] || [];
    const parsed: ParsedCopy = {
      ...emptyCopy(),
      title: titleCol >= 0 ? (first[titleCol] || '').trim() : '',
      points: pointCol >= 0 ? splitPoints(first[pointCol] || '') : [],
      detail: detailCol >= 0 ? (first[detailCol] || '').trim() : '',
    };
    if (dataRows.length > 1) parsed.warnings.push('表格里有多行商品，只取了第一行。');
    return parsed;
  }
  const parsed = emptyCopy();
  for (const cells of rows) {
    const label = (cells[0] || '').trim();
    const value = cells
      .slice(1)
      .map((cell) => cell.trim())
      .filter(Boolean)
      .join(' ');
    if (!label || !value) continue;
    if (/卖点|副标题/.test(label)) parsed.points.push(...splitPoints(value));
    else if (/详情|描述|文案/.test(label)) parsed.detail = parsed.detail ? `${parsed.detail}\n${value}` : value;
    else if (/标题|宝贝名|商品名/.test(label) && !/店铺|类目/.test(label)) parsed.title = value;
  }
  if (!parsed.title && !parsed.points.length && !parsed.detail) {
    parsed.warnings.push('表格里没有找到「标题 / 卖点 / 详情」列，文字没有自动填入。');
  }
  return parsed;
}

function cleanTitle(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s*[-_|｜]\s*(淘宝网|天猫|淘宝|Taobao|Tmall).*$/i, '')
    .trim();
}

export function stripTags(value: string): string {
  if (!/<[a-z][\s\S]*>/i.test(value)) return value.trim();
  const doc = new DOMParser().parseFromString(value, 'text/html');
  doc.querySelectorAll('script,style').forEach((node) => node.remove());
  return (doc.body.textContent || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function isImageRef(value: string): boolean {
  if (value.length > 500) return false;
  return /\.(jpe?g|png|webp|gif|bmp|avif)(\?.*)?$/i.test(value) || /^https?:\/\//i.test(value) || value.startsWith('//');
}

function titleScore(key: string, depth: number): number {
  const k = key.toLowerCase();
  if (!k || /shop|store|店铺|店名|category|类目|brand|品牌|url|link|href/.test(k)) return 0;
  if (/^(商品标题|宝贝标题|itemtitle|goodsname|productname)$/i.test(k)) return 100;
  if ((k === 'title' || k === '标题') && depth <= 3) return 80;
  if (k === 'name' && depth <= 2) return 60;
  if (/标题/.test(k) && !/副|卖点|导购/.test(k) && depth <= 3) return 70;
  return 0;
}

function pointScore(key: string): number {
  const k = key.toLowerCase();
  if (/^(卖点|商品卖点|sellingpoints|sellpoint|subtitle|副标题|导购标题)$/i.test(k)) return 80;
  if (/卖点|副标题/.test(k)) return 70;
  return 0;
}

function detailScore(key: string, depth: number): number {
  const k = key.toLowerCase();
  if (!k || /url|img|image|图|src|href|video|sku/.test(k)) return 0;
  if (/^(详情文案|详情描述|detaildesc|description|pcdesc|wirelessdesc|desc)$/i.test(k)) return 80;
  if ((k === 'detail' || k === 'content' || k === '详情' || k === '描述' || k === '文案') && depth <= 4) return 75;
  if (/详情|描述|文案/.test(k) && depth <= 4) return 60;
  return 0;
}

function roleFromKey(key: string): Role | null {
  const k = key.toLowerCase();
  if (!k) return null;
  if (/评论|买家秀|reviews?|comments?/.test(k)) return 'hold';
  if (/sku|规格|颜色/.test(k)) return 'hold';
  if (/detail|desc|详情|xiangqing|描述图/.test(k)) return 'detail';
  if (/main|zhutu|主图|cover|轮播|gallery/.test(k)) return 'main';
  return null;
}

function holdTagFromKey(key: string): string {
  return /评论|买家秀|review|comment/.test(key.toLowerCase()) ? '评论' : '规格';
}

function considerString(acc: ParsedCopy & { titleScore: number; detailScore: number }, key: string, value: string, depth: number) {
  const trimmed = value.trim();
  if (!trimmed) return;
  const role = roleFromKey(key);
  if (isImageRef(trimmed)) {
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('//')) {
      if (role) acc.remote += 1;
      return;
    }
    if (role) {
      const base = baseName(trimmed);
      if (base) acc.hints.push({ base, role, holdTag: role === 'hold' ? holdTagFromKey(key) : '' });
    }
    return;
  }
  const ts = titleScore(key, depth);
  if (ts > acc.titleScore && trimmed.length <= 120) {
    acc.titleScore = ts;
    acc.title = cleanTitle(stripTags(trimmed));
    return;
  }
  const ps = pointScore(key);
  if (ps > 0 && ps >= (acc.points.length ? 70 : 0) && !acc.points.length) {
    acc.points = splitPoints(stripTags(trimmed));
    return;
  }
  const ds = detailScore(key, depth);
  if (ds > acc.detailScore) {
    acc.detailScore = ds;
    acc.detail = stripTags(trimmed);
  }
}

function harvestImages(acc: ParsedCopy, value: unknown, role: Role, holdTag: string) {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value) || value.startsWith('//')) {
      if (isImageRef(value)) acc.remote += 1;
      return;
    }
    const base = baseName(value);
    if (base && isImageRef(value)) acc.hints.push({ base, role, holdTag });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => harvestImages(acc, item, role, holdTag));
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((item) => harvestImages(acc, item, role, holdTag));
  }
}

function attrLines(value: unknown): string[] {
  if (Array.isArray(value)) {
    const lines: string[] = [];
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const name = rec.name ?? rec.key ?? rec.prop ?? rec.pname ?? rec.属性名;
      const val = rec.value ?? rec.val ?? rec.v ?? rec.pvalue ?? rec.属性值;
      if ((typeof name === 'string' || typeof name === 'number') && (typeof val === 'string' || typeof val === 'number')) {
        lines.push(`${name}：${val}`);
      }
    }
    return lines;
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string | number] => typeof entry[1] === 'string' || typeof entry[1] === 'number')
      .map(([key, val]) => `${key}：${val}`);
  }
  return [];
}

function isAttrKey(key: string): boolean {
  return /^(props|attributes|params|参数|商品参数|属性|specifications?)$/i.test(key);
}

export function fromJson(data: unknown): ParsedCopy {
  const acc = Object.assign(emptyCopy(), { titleScore: 0, detailScore: 0 });
  let node = data;
  if (Array.isArray(node)) {
    if (node.length > 1) acc.warnings.push('JSON 里有多件商品，只取了第一件。');
    node = node[0];
  }
  const attrs: string[] = [];
  const walk = (value: unknown, key: string, depth: number) => {
    if (depth > 8 || value == null) return;
    if (/评论|买家秀|reviews?|comments?|推荐/.test(key) && !/卖点/.test(key)) {
      harvestImages(acc, value, 'hold', '评论');
      return;
    }
    if (typeof value === 'string' || typeof value === 'number') {
      considerString(acc, key, String(value), depth);
      return;
    }
    if (Array.isArray(value)) {
      if (pointScore(key) > 0 && value.every((item) => typeof item === 'string' || typeof item === 'number')) {
        acc.points = splitPoints(value.map(String).join('\n'));
        return;
      }
      if (isAttrKey(key)) {
        attrs.push(...attrLines(value));
        return;
      }
      value.forEach((item) => walk(item, key, depth + 1));
      return;
    }
    if (typeof value === 'object') {
      if (isAttrKey(key)) {
        attrs.push(...attrLines(value));
        return;
      }
      for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
        walk(child, childKey, depth + 1);
      }
    }
  };
  walk(node, '', 0);
  if (attrs.length) {
    const block = attrs.join('\n');
    acc.detail = acc.detail ? `${acc.detail}\n\n${block}` : block;
  }
  return {
    title: acc.title,
    points: acc.points,
    detail: acc.detail,
    hints: acc.hints,
    remote: acc.remote,
    dataImages: acc.dataImages,
    warnings: acc.warnings,
  };
}

function queryDetail(doc: Document): { node: Element; specific: boolean } | null {
  const specific = ['#J_DivItemDesc', '#description', '#J_Detail', '.detail-content', '.desc-root', '.tb-detail', 'article'];
  for (const selector of specific) {
    const node = doc.querySelector(selector);
    if (node) return { node, specific: true };
  }
  for (const selector of ['[class*="detail"]', '[id*="detail"]', 'main']) {
    const node = doc.querySelector(selector);
    if (node && (node.textContent || '').trim().length > 40) return { node, specific: false };
  }
  return null;
}

function pushHint(hints: ImageHint[], src: string, role: Role, holdTag: string) {
  if (!src || src.startsWith('data:') || /^https?:\/\//i.test(src) || src.startsWith('//')) return;
  const base = baseName(src);
  if (!base) return;
  hints.push({ base, role, holdTag });
}

export function parseHtml(html: string): ParsedCopy {
  const out = emptyCopy();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const h1 = doc.querySelector('h1')?.textContent?.trim() || '';
  const og = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() || '';
  const titleTag = doc.querySelector('title')?.textContent?.trim() || '';
  out.title = cleanTitle(h1 || og || titleTag);
  const pointNode = doc.querySelector('[class*="卖点"], [id*="卖点"], .subtitle, .tb-subtitle');
  if (pointNode) out.points = splitPoints(pointNode.textContent || '');
  doc.querySelectorAll('script,style,noscript,iframe').forEach((node) => node.remove());
  const detail = queryDetail(doc);
  const raw = (detail?.node ?? doc.body)?.textContent || '';
  out.detail = raw.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!detail?.specific && out.detail.length > 5000) {
    out.detail = out.detail.slice(0, 5000).trim();
    out.warnings.push('整页文字很长，详情只取了前一段，请再看一眼。');
  }
  let index = 0;
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (/^https?:\/\//i.test(src) || src.startsWith('//')) out.remote += 1;
    const match = src.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/i);
    if (!match) return;
    index += 1;
    try {
      const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
      const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
      const type = `image/${ext === 'jpg' ? 'jpeg' : ext}`;
      out.dataImages.push({ name: `内嵌-${index}.${ext}`, blob: new Blob([bytes], { type }) });
    } catch {
      out.warnings.push('有一张嵌在网页里的图没有解开。');
    }
  });
  const mainRoot = doc.querySelector('#J_UlThumb, .tb-thumb, [class*="main-image"], [class*="mainImage"]');
  mainRoot?.querySelectorAll('img').forEach((img) => pushHint(out.hints, img.getAttribute('src') || '', 'main', ''));
  detail?.node.querySelectorAll('img').forEach((img) => pushHint(out.hints, img.getAttribute('src') || '', 'detail', ''));
  return out;
}

export function parseTextDocument(path: string, text: string): ParsedCopy {
  const base = (path.split(/[/\\]/).pop() || path).toLowerCase();
  const plain = /\.(txt|md)$/i.test(base);
  if (plain && /卖点/.test(base) && !/标题|详情|描述/.test(base)) {
    const labeled = parseLabeled(text);
    if (labeled && (labeled.points.length || labeled.title || labeled.detail)) return labeled;
    return { ...emptyCopy(), points: splitPoints(text) };
  }
  if (plain && /(标题|商品标题|宝贝标题)/.test(base) && !/卖点|详情|描述|文案/.test(base)) {
    const labeled = parseLabeled(text);
    if (labeled?.title) return labeled;
    const line = text.trim().split(/\n/).map((item) => item.trim()).filter(Boolean)[0] || '';
    return { ...emptyCopy(), title: line.slice(0, 80) };
  }
  if (plain && /(详情|描述|文案|desc)/i.test(base) && !/卖点|标题/.test(base)) {
    const labeled = parseLabeled(text);
    if (labeled && (labeled.detail || labeled.title || labeled.points.length)) return labeled;
    return { ...emptyCopy(), detail: text.trim() };
  }
  if (/\.csv$/i.test(base)) return fromTable(parseCsv(text));
  const trimmed = text.trim();
  if (/\.json$/i.test(base) || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return fromJson(JSON.parse(trimmed));
    } catch {
      if (/\.json$/i.test(base)) return { ...emptyCopy(), warnings: ['有一份 JSON 没能解析。'] };
    }
  }
  if (/<[a-z][\s\S]*>/i.test(trimmed) && /<\/[a-z0-9]+>/i.test(trimmed)) return parseHtml(trimmed);
  return parseLabeled(text) ?? parseLooseText(text);
}

export function textRank(path: string): number {
  const name = path.toLowerCase();
  if (/readme|导入说明|使用说明|说明\.txt|license/.test(name)) return 10;
  if (/卖点/.test(name)) return 90;
  if (/标题/.test(name) && !/说明/.test(name)) return 90;
  if (/详情|描述|文案|(^|[^a-z])desc([^a-z]|$)/.test(name)) return 80;
  if (/\.json$/.test(name)) return 70;
  if (/\.(xlsx|csv)$/.test(name)) return 68;
  if (/\.html?$/.test(name)) return 60;
  return 40;
}

export function titleFromFilename(name: string): string {
  const base = name.replace(/\.(zip|html?|txt|json|xlsx|csv)$/i, '').trim();
  if (!base || base.length > 40 || !/[\u4e00-\u9fff]/.test(base)) return '';
  if (/^(images?|pics?|download|新建|图片|照片|商品|整合包|详情|主图|素材|下载)/i.test(base)) return '';
  return base;
}
