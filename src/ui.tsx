import { useEffect, useRef } from 'react';

function draggingFiles(data: DataTransfer): boolean {
  return Array.from(data.types).includes('Files');
}
import { PALETTES, quickRecolor, type Palette } from './lib/adjust';
import { defaultAdjust, type Adjust, type AdjustScope, type ImgItem, type LayoutMode, type Role } from './types';

const LAYOUTS: { id: LayoutMode; name: string; text: string }[] = [
  { id: 'stack', name: '纵向堆叠', text: '按顺序接起来，超高就切开。' },
  { id: 'columns', name: '双列', text: '并排两张，版心和原来不一样。' },
  { id: 'spaced', name: '分段留白', text: '每张图一节，空行段落跟在图下。' },
];

export function ImportPane(props: {
  busy: string;
  warnings: string[];
  counts: { main: number; detail: number; hold: number };
  onFiles: (files: FileList) => void;
  onSample: () => void;
  onClear: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const dirRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    dirRef.current?.setAttribute('webkitdirectory', '');
    dirRef.current?.setAttribute('directory', '');
  }, []);
  return (
    <aside className="sheet import-pane">
      <h2>素材</h2>
      <p className="lead">把插件保存的图片、txt / html 或 zip 放进来。再次导入会替换当前内容。</p>
      <div className="actions">
        <button type="button" onClick={() => fileRef.current?.click()}>
          选择文件
        </button>
        <button type="button" onClick={() => dirRef.current?.click()}>
          选择文件夹
        </button>
        <button type="button" onClick={props.onSample}>
          载入示例
        </button>
      </div>
      <input
        ref={fileRef}
        className="sr"
        type="file"
        multiple
        accept="image/*,.txt,.md,.html,.htm,.json,.csv,.zip,.xlsx"
        onChange={(event) => {
          if (event.target.files?.length) props.onFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <input
        ref={dirRef}
        className="sr"
        type="file"
        multiple
        onChange={(event) => {
          if (event.target.files?.length) props.onFiles(event.target.files);
          event.target.value = '';
        }}
      />
      <p className="counts-inline">
        主图 {props.counts.main} · 详情 {props.counts.detail}
        {props.counts.hold ? ` · 不导出 ${props.counts.hold}` : ''}
      </p>
      {props.busy ? <p className="status">{props.busy}</p> : null}
      {props.warnings.length ? (
        <ul className="warnings">
          {props.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <details className="help">
        <summary>能认什么，不会做什么</summary>
        <p>文件夹或文件名里有「主图」「详情」「规格 / SKU」「评论」就会分开。文案读 txt、html、json、csv，以及 xlsx 里带标题、卖点、详情的表。zip 文件名支持 UTF-8 和 GBK。</p>
        <p>规格图和评论图默认不进压缩包。只有网址、没有图像文件时不会去下载。加密包、视频、PSD、HEIC 打不开。不登录淘宝，也不上传。</p>
      </details>
      <button type="button" className="texty" onClick={props.onClear} disabled={!props.counts.main && !props.counts.detail && !props.counts.hold}>
        清空
      </button>
    </aside>
  );
}

export function CopyPane(props: {
  title: string;
  points: string[];
  detail: string;
  empty: boolean;
  onTitle: (value: string) => void;
  onPoint: (index: number, value: string) => void;
  onAddPoint: () => void;
  onRemovePoint: (index: number) => void;
  onDetail: (value: string) => void;
  onCopy: () => void;
}) {
  return (
    <div className="copy-form">
      {props.empty ? (
        <ol className="steps">
          <li>
            <b>文案</b>
            <span>改标题、卖点和详情文字。</span>
          </li>
          <li>
            <b>主图</b>
            <span>改色、调亮暗，并按上传顺序排好。</span>
          </li>
          <li>
            <b>详情</b>
            <span>堆叠、双列或分段留白，画成新的详情图。</span>
          </li>
        </ol>
      ) : null}
      <label className="field">
        <span className="label-row">
          标题
          <em className={props.title.trim().length > 60 ? 'over' : ''}>{props.title.trim().length}/60</em>
        </span>
        <input
          value={props.title}
          placeholder="商品标题"
          onChange={(event) => props.onTitle(event.target.value.replace(/[\r\n]+/g, ' '))}
        />
      </label>
      <div className="field">
        <span className="label-row">卖点</span>
        {props.points.map((point, index) => (
          <div className="point-row" key={index}>
            <input
              value={point}
              placeholder={index === 0 ? '例如：内里加绒' : '再写一条'}
              onChange={(event) => props.onPoint(index, event.target.value)}
            />
            <button type="button" onClick={() => props.onRemovePoint(index)} aria-label="删除这条卖点">
              删除
            </button>
          </div>
        ))}
        <button type="button" onClick={props.onAddPoint} disabled={props.points.length >= 8}>
          加一条卖点
        </button>
      </div>
      <label className="field">
        <span className="label-row">详情文案</span>
        <textarea
          value={props.detail}
          placeholder={'写详情。分段留白时，用空行隔开，段落会跟在对应的详情图下面。'}
          onChange={(event) => props.onDetail(event.target.value)}
        />
      </label>
      <button type="button" onClick={props.onCopy}>
        复制文案
      </button>
      <p className="hint">导出的「上架文案.txt」就是这里的标题、卖点和详情，UTF-8。</p>
    </div>
  );
}

export function AdjustControls(props: { adjust: Adjust; scope: AdjustScope; onAdjust: (value: Adjust) => void; onScope: (value: AdjustScope) => void; busy: boolean }) {
  const { adjust } = props;
  return (
    <div className="adjust">
      <div className="label-row">
        <b>调色</b>
        {props.busy ? <em>正在改色…</em> : null}
      </div>
      <div className="quick">
        <button type="button" onClick={() => props.onAdjust(quickRecolor())}>
          一键改色
        </button>
        <button type="button" onClick={() => props.onAdjust(defaultAdjust())}>
          还原
        </button>
      </div>
      <label className="field">
        <span className="label-row">
          色相 <em>{adjust.hue > 0 ? `+${adjust.hue}` : adjust.hue}</em>
        </span>
        <input
          className="hue"
          type="range"
          min={-180}
          max={180}
          value={adjust.hue}
          onChange={(event) => props.onAdjust({ ...adjust, hue: Number(event.target.value) })}
        />
      </label>
      <div className="swatches" role="listbox" aria-label="色板">
        {PALETTES.map((palette) => (
          <button
            key={palette.id}
            type="button"
            className={palette.id === adjust.paletteId ? 'swatch on' : 'swatch'}
            onClick={() =>
              props.onAdjust(
                palette.id === 'none'
                  ? { ...adjust, paletteId: 'none', strength: 0 }
                  : { ...adjust, paletteId: palette.id, strength: adjust.strength || 65 },
              )
            }
          >
            <SwatchDots palette={palette} />
            <span>{palette.name}</span>
          </button>
        ))}
      </div>
      <label className="field">
        <span className="label-row">
          套色强度 <em>{adjust.paletteId === 'none' ? 0 : adjust.strength}</em>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={adjust.paletteId === 'none' ? 0 : adjust.strength}
          disabled={adjust.paletteId === 'none'}
          onChange={(event) => props.onAdjust({ ...adjust, strength: Number(event.target.value) })}
        />
      </label>
      <label className="field">
        <span className="label-row">
          亮度 <em>{adjust.brightness}</em>
        </span>
        <input
          type="range"
          min={-50}
          max={50}
          value={adjust.brightness}
          onChange={(event) => props.onAdjust({ ...adjust, brightness: Number(event.target.value) })}
        />
      </label>
      <label className="field">
        <span className="label-row">
          对比度 <em>{adjust.contrast}</em>
        </span>
        <input
          type="range"
          min={-50}
          max={50}
          value={adjust.contrast}
          onChange={(event) => props.onAdjust({ ...adjust, contrast: Number(event.target.value) })}
        />
      </label>
      <label className="field">
        <span>用于</span>
        <select value={props.scope} onChange={(event) => props.onScope(event.target.value as AdjustScope)}>
          <option value="all">主图和详情</option>
          <option value="main">只调主图</option>
          <option value="detail">只调详情</option>
        </select>
      </label>
      <p className="hint">接近灰、白的地方会留着，主要改有颜色的部分。导出时写进 JPG。</p>
    </div>
  );
}

function SwatchDots({ palette }: { palette: Palette }) {
  if (palette.mode === 'none') return <i className="dots none" />;
  if (palette.mode === 'mono') return <i className="dots"><b style={{ background: '#8e8880' }} /></i>;
  return (
    <i className="dots">
      {palette.stops.map((stop) => (
        <b key={stop} style={{ background: stop }} />
      ))}
    </i>
  );
}

export function MainPane(props: {
  items: ImgItem[];
  previews: Record<string, string>;
  selectedId: string | null;
  showOriginal: boolean;
  squareMain: boolean;
  paper: string;
  adjust: Adjust;
  scope: AdjustScope;
  previewBusy: boolean;
  onSelect: (id: string) => void;
  onToggleOriginal: () => void;
  onSquare: (value: boolean) => void;
  onPaper: (value: string) => void;
  onAdjust: (value: Adjust) => void;
  onScope: (value: AdjustScope) => void;
  onShift: (id: string, dir: -1 | 1) => void;
  onRole: (id: string, role: Role) => void;
  onDelete: (id: string) => void;
  onDropOn: (sourceId: string, role: Role, index: number) => void;
}) {
  const selected = props.items.find((item) => item.id === props.selectedId) ?? props.items[0];
  const src = selected ? (props.showOriginal ? selected.url : props.previews[selected.id] || selected.url) : '';
  return (
    <div className="main-grid">
      <div>
        {selected ? (
          <figure className="preview">
            <img src={src} alt={selected.name} />
            <figcaption>
              <span>
                {selected.name} · 原图 {selected.width}×{selected.height}
                {props.squareMain ? ' · 导出 800×800' : ''}
              </span>
              <button type="button" onClick={props.onToggleOriginal}>
                {props.showOriginal ? '看调整后' : '看原图'}
              </button>
            </figcaption>
          </figure>
        ) : (
          <p className="empty">还没有主图。导入素材，或把其他图改成主图。</p>
        )}
        <ThumbGrid
          items={props.items}
          previews={props.previews}
          selectedId={selected?.id ?? null}
          role="main"
          original={props.showOriginal}
          onSelect={props.onSelect}
          onShift={props.onShift}
          onRole={props.onRole}
          onDelete={props.onDelete}
          onDropOn={props.onDropOn}
        />
        <label className="check">
          <input type="checkbox" checked={props.squareMain} onChange={(event) => props.onSquare(event.target.checked)} />
          主图导出为 800×800，不够的地方用底色补齐
        </label>
        <label className="field inline-color">
          <span>补边底色</span>
          <input type="color" value={props.paper} onChange={(event) => props.onPaper(event.target.value)} />
        </label>
      </div>
      <AdjustControls adjust={props.adjust} scope={props.scope} busy={props.previewBusy} onAdjust={props.onAdjust} onScope={props.onScope} />
    </div>
  );
}

export function DetailPane(props: {
  items: ImgItem[];
  previews: Record<string, string>;
  mode: LayoutMode;
  gap: number;
  paper: string;
  banner: boolean;
  maxSlice: number;
  busy: boolean;
  error: string;
  shots: { url: string; width: number; height: number }[];
  onMode: (mode: LayoutMode) => void;
  onGap: (value: number) => void;
  onPaper: (value: string) => void;
  onBanner: (value: boolean) => void;
  onMaxSlice: (value: number) => void;
  onShift: (id: string, dir: -1 | 1) => void;
  onRole: (id: string, role: Role) => void;
  onDelete: (id: string) => void;
  onDropOn: (sourceId: string, role: Role, index: number) => void;
  onZoom: (url: string, caption: string) => void;
}) {
  return (
    <div className="detail-layout">
      <div className="modes">
        {LAYOUTS.map((layout) => (
          <button key={layout.id} type="button" className={props.mode === layout.id ? 'mode on' : 'mode'} onClick={() => props.onMode(layout.id)}>
            <b>{layout.name}</b>
            <span>{layout.text}</span>
          </button>
        ))}
      </div>
      <div className="detail-controls">
        <label className="field">
          <span className="label-row">
            间距 <em>{props.gap}</em>
          </span>
          <input type="range" min={0} max={80} value={props.gap} onChange={(event) => props.onGap(Number(event.target.value))} />
        </label>
        <label className="field">
          <span className="label-row">
            单张高度 <em>{props.maxSlice}</em>
          </span>
          <input type="range" min={800} max={2000} step={50} value={props.maxSlice} onChange={(event) => props.onMaxSlice(Number(event.target.value))} />
        </label>
        <label className="field inline-color">
          <span>底色</span>
          <input type="color" value={props.paper} onChange={(event) => props.onPaper(event.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={props.banner} onChange={(event) => props.onBanner(event.target.checked)} />
          页首加上标题和卖点
        </label>
      </div>
      <p className="hint">详情图宽 750。太高会按「单张高度」切开，方便上传插件接收。</p>
      {!props.items.length ? <p className="empty">没有详情图时，如果写了详情文案，会把文案排成图片。</p> : null}
      <ThumbGrid
        items={props.items}
        previews={props.previews}
        selectedId={null}
        role="detail"
        original={false}
        onSelect={() => undefined}
        onShift={props.onShift}
        onRole={props.onRole}
        onDelete={props.onDelete}
        onDropOn={props.onDropOn}
      />
      {props.busy ? <p className="status">正在画详情图…</p> : null}
      {props.error ? <p className="status bad">{props.error}</p> : null}
      {props.shots.length ? (
        <>
          <p className="hint">将导出 {props.shots.length} 张详情图。点开可以看大图。</p>
          <div className="film">
            {props.shots.map((shot, index) => (
              <button key={shot.url} type="button" onClick={() => props.onZoom(shot.url, `详情 ${String(index + 1).padStart(2, '0')}`)}>
                <img src={shot.url} alt={`详情第 ${index + 1} 张`} />
                <span>
                  {String(index + 1).padStart(2, '0')} · {shot.width}×{shot.height}
                </span>
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function HoldPane(props: {
  items: ImgItem[];
  onShift: (id: string, dir: -1 | 1) => void;
  onRole: (id: string, role: Role) => void;
  onDelete: (id: string) => void;
  onDropOn: (sourceId: string, role: Role, index: number) => void;
}) {
  return (
    <div>
      <p className="hint">规格图和评论图留在这里，不会写进压缩包。要带上的话，把分组改成主图或详情。</p>
      <ThumbGrid
        items={props.items}
        previews={{}}
        selectedId={null}
        role="hold"
        original
        onSelect={() => undefined}
        onShift={props.onShift}
        onRole={props.onRole}
        onDelete={props.onDelete}
        onDropOn={props.onDropOn}
      />
    </div>
  );
}

function ThumbGrid(props: {
  items: ImgItem[];
  previews: Record<string, string>;
  selectedId: string | null;
  role: Role;
  original: boolean;
  onSelect: (id: string) => void;
  onShift: (id: string, dir: -1 | 1) => void;
  onRole: (id: string, role: Role) => void;
  onDelete: (id: string) => void;
  onDropOn: (sourceId: string, role: Role, index: number) => void;
}) {
  if (!props.items.length) return null;
  return (
    <div className="thumbs">
      {props.items.map((item, index) => {
        const src = props.original ? item.url : props.previews[item.id] || item.url;
        return (
          <article
            key={item.id}
            className={item.id === props.selectedId ? 'thumb on' : 'thumb'}
            onDragOver={(event) => {
              if (draggingFiles(event.dataTransfer)) return;
              event.preventDefault();
            }}
            onDrop={(event) => {
              if (draggingFiles(event.dataTransfer)) return;
              event.preventDefault();
              const sourceId = event.dataTransfer.getData('text/plain');
              if (sourceId) props.onDropOn(sourceId, props.role, index);
            }}
          >
            <header>
              <span className="idx">{String(index + 1).padStart(2, '0')}</span>
              {item.holdTag ? <em className="tag">{item.holdTag}</em> : null}
              <span
                className="grip"
                draggable
                title="拖动排序"
                onDragStart={(event) => {
                  event.dataTransfer.setData('text/plain', item.id);
                  event.dataTransfer.effectAllowed = 'move';
                }}
              >
                拖
              </span>
              <button type="button" aria-label="删除" onClick={() => props.onDelete(item.id)}>
                ×
              </button>
            </header>
            <button type="button" className="pic" onClick={() => props.onSelect(item.id)}>
              <img src={src} alt={item.name} />
            </button>
            <p className="name" title={item.path}>
              {item.name}
            </p>
            <div className="row">
              <button type="button" onClick={() => props.onShift(item.id, -1)} disabled={index === 0} aria-label="上移">
                ↑
              </button>
              <button type="button" onClick={() => props.onShift(item.id, 1)} disabled={index === props.items.length - 1} aria-label="下移">
                ↓
              </button>
              <select aria-label="分组" value={item.role} onChange={(event) => props.onRole(item.id, event.target.value as Role)}>
                <option value="main">主图</option>
                <option value="detail">详情</option>
                <option value="hold">不导出</option>
              </select>
            </div>
          </article>
        );
      })}
      <div
        className="drop-end"
        onDragOver={(event) => {
          if (!draggingFiles(event.dataTransfer)) event.preventDefault();
        }}
        onDrop={(event) => {
          if (draggingFiles(event.dataTransfer)) return;
          event.preventDefault();
          const sourceId = event.dataTransfer.getData('text/plain');
          if (sourceId) props.onDropOn(sourceId, props.role, props.items.length);
        }}
      >
        放到本组最后
      </div>
    </div>
  );
}
