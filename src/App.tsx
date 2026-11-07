import { useEffect, useMemo, useRef, useState } from 'react';
import { buildListingZip } from './lib/exportPack';
import { isIdentity, shouldAdjust } from './lib/adjust';
import { buildCopyText, listingZipName, saveBlob } from './lib/copyText';
import { importPack } from './lib/importPack';
import { moveImage } from './lib/order';
import { renderDetailPages, type DetailRequest } from './lib/renderDetail';
import { renderMainJpeg, renderPreviewJpeg } from './lib/renderImage';
import { makeSample } from './lib/sample';
import { CopyPane, DetailPane, HoldPane, ImportPane, MainPane } from './ui';
import {
  defaultAdjust,
  type Adjust,
  type AdjustScope,
  type ImgItem,
  type Incoming,
  type LayoutMode,
  type Pack,
  type Role,
} from './types';

type Tab = 'copy' | 'main' | 'detail' | 'hold';
type Shot = { url: string; width: number; height: number };

function fileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}

async function walkEntry(entry: FileSystemEntry, prefix: string): Promise<Incoming[]> {
  if (!entry.name || entry.name.startsWith('.')) return [];
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    return [{ file, path }];
  }
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    children.push(...batch);
  }
  const out: Incoming[] = [];
  for (const child of children) out.push(...(await walkEntry(child, path)));
  return out;
}

async function fromTransfer(data: DataTransfer): Promise<Incoming[]> {
  const entries = [...data.items]
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (entries.some((entry) => entry.isDirectory)) {
    const incoming: Incoming[] = [];
    for (const entry of entries) incoming.push(...(await walkEntry(entry, '')));
    return incoming;
  }
  return [...data.files].map((file) => ({ file, path: file.webkitRelativePath || file.name }));
}

export function App() {
  const [title, setTitle] = useState('');
  const [points, setPoints] = useState<string[]>(['']);
  const [detailText, setDetailText] = useState('');
  const [images, setImages] = useState<ImgItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('copy');
  const [adjust, setAdjust] = useState<Adjust>(defaultAdjust);
  const [scope, setScope] = useState<AdjustScope>('all');
  const [squareMain, setSquareMain] = useState(true);
  const [paper, setPaper] = useState('#ffffff');
  const [mode, setMode] = useState<LayoutMode>('stack');
  const [gaps, setGaps] = useState({ stack: 0, columns: 14, spaced: 36 });
  const [banner, setBanner] = useState(true);
  const [maxSlice, setMaxSlice] = useState(1400);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState('');
  const [dragHot, setDragHot] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [previewBusy, setPreviewBusy] = useState(false);
  const [detailShots, setDetailShots] = useState<Shot[]>([]);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [zoom, setZoom] = useState<{ url: string; caption: string } | null>(null);

  const imagesRef = useRef(images);
  const previewRef = useRef(previews);
  const shotRef = useRef(detailShots);
  const dirtyRef = useRef(false);
  const loadRef = useRef<(incoming: Incoming[]) => void>(() => undefined);
  const previewGen = useRef(0);
  const detailGen = useRef(0);
  const detailCache = useRef<{ sig: string; blobs: Blob[] } | null>(null);
  imagesRef.current = images;
  previewRef.current = previews;
  shotRef.current = detailShots;
  dirtyRef.current = images.length > 0 || title.trim() !== '' || detailText.trim() !== '' || points.some((point) => point.trim());

  const mains = images.filter((img) => img.role === 'main');
  const details = images.filter((img) => img.role === 'detail');
  const holds = images.filter((img) => img.role === 'hold');
  const empty = !dirtyRef.current;

  const previewKey = useMemo(() => {
    const items = images
      .map((img) => `${img.id}:${img.role}:${img.blob.size}:${img.width}x${img.height}`)
      .sort();
    return JSON.stringify({ adjust, scope, squareMain, paper, items });
  }, [adjust, images, paper, scope, squareMain]);

  const detailJob = useMemo(() => {
    const detailImages = images.filter((img) => img.role === 'detail');
    const useAdjust = shouldAdjust('detail', scope) ? adjust : defaultAdjust();
    if (!detailImages.length && !detailText.trim()) return null;
    const req: DetailRequest = {
      images: detailImages.map((img) => img.blob),
      title,
      points,
      detailText,
      mode,
      gap: gaps[mode],
      paper,
      banner,
      maxSlice,
      adjust: useAdjust,
    };
    const sig = JSON.stringify({
      ids: detailImages.map((img) => `${img.id}:${img.blob.size}:${img.width}x${img.height}`),
      title,
      points,
      detailText,
      mode,
      gap: gaps[mode],
      paper,
      banner,
      maxSlice,
      adjust: useAdjust,
    });
    return { sig, req };
  }, [adjust, banner, detailText, gaps, images, maxSlice, mode, paper, points, scope, title]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? '' : current)), 4200);
  }

  function releaseGenerated() {
    Object.values(previewRef.current).forEach((url) => URL.revokeObjectURL(url));
    shotRef.current.forEach((shot) => URL.revokeObjectURL(shot.url));
    detailCache.current = null;
  }

  function applyPack(pack: Pack) {
    imagesRef.current.forEach((img) => URL.revokeObjectURL(img.url));
    releaseGenerated();
    setPreviews({});
    setDetailShots([]);
    setTitle(pack.title);
    setPoints(pack.points.length ? pack.points : ['']);
    setDetailText(pack.detail);
    setImages(pack.images);
    setWarnings(pack.warnings);
    setShowOriginal(false);
    setTab(pack.title || pack.detail || pack.points.length ? 'copy' : 'main');
  }

  async function loadIncoming(incoming: Incoming[]) {
    if (!incoming.length) {
      notify('没有读到文件');
      return;
    }
    if (dirtyRef.current && !window.confirm('用新素材替换当前标题、文案和图片？')) return;
    setBusy('正在读取素材…');
    try {
      applyPack(await importPack(incoming));
    } catch (error) {
      setWarnings([error instanceof Error ? error.message : '读取失败']);
    } finally {
      setBusy('');
    }
  }
  loadRef.current = (incoming) => void loadIncoming(incoming);

  useEffect(() => {
    const over = (event: DragEvent) => {
      if (!fileDrag(event)) return;
      event.preventDefault();
      setDragHot(true);
    };
    const leave = (event: DragEvent) => {
      if (event.relatedTarget) return;
      setDragHot(false);
    };
    const drop = (event: DragEvent) => {
      if (!fileDrag(event) || !event.dataTransfer) return;
      event.preventDefault();
      setDragHot(false);
      void fromTransfer(event.dataTransfer).then((incoming) => loadRef.current(incoming));
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  useEffect(() => {
    if (selectedId && images.some((img) => img.id === selectedId)) return;
    setSelectedId(images.find((img) => img.role === 'main')?.id ?? images[0]?.id ?? null);
  }, [images, selectedId]);

  useEffect(() => {
    if (tab === 'hold' && holds.length === 0) setTab('main');
  }, [holds.length, tab]);

  useEffect(() => {
    const gen = ++previewGen.current;
    const targets = images.filter((img) => {
      if (img.role === 'main' && (squareMain || (shouldAdjust(img.role, scope) && !isIdentity(adjust)))) return true;
      return img.role === 'detail' && shouldAdjust(img.role, scope) && !isIdentity(adjust);
    });
    if (!targets.length) {
      setPreviewBusy(false);
      setPreviews((prev) => {
        Object.values(prev).forEach((url) => URL.revokeObjectURL(url));
        return {};
      });
      return;
    }
    setPreviewBusy(true);
    void (async () => {
      const next: Record<string, string> = {};
      try {
        for (const img of targets) {
          const use = shouldAdjust(img.role, scope) ? adjust : defaultAdjust();
          const blob =
            img.role === 'main'
              ? await renderMainJpeg(img.blob, use, { square: squareMain, size: 800, mat: paper })
              : await renderPreviewJpeg(img.blob, use, 540);
          if (previewGen.current !== gen) return;
          next[img.id] = URL.createObjectURL(blob);
        }
        if (previewGen.current !== gen) return;
        setPreviews((prev) => {
          Object.values(prev).forEach((url) => URL.revokeObjectURL(url));
          return next;
        });
      } finally {
        if (previewGen.current !== gen) Object.values(next).forEach((url) => URL.revokeObjectURL(url));
        else setPreviewBusy(false);
      }
    })();
  }, [adjust, images, paper, previewKey, scope, squareMain]);

  useEffect(() => {
    if (tab !== 'detail') return;
    if (!detailJob) {
      setDetailBusy(false);
      setDetailError('');
      setDetailShots((prev) => {
        prev.forEach((shot) => URL.revokeObjectURL(shot.url));
        return [];
      });
      return;
    }
    const gen = ++detailGen.current;
    const job = detailJob;
    setDetailBusy(true);
    setDetailError('');
    void renderDetailPages(job.req)
      .then((pages) => {
        if (detailGen.current !== gen) return;
        detailCache.current = { sig: job.sig, blobs: pages.map((page) => page.blob) };
        setDetailShots((prev) => {
          prev.forEach((shot) => URL.revokeObjectURL(shot.url));
          return pages.map((page) => ({ url: URL.createObjectURL(page.blob), width: page.width, height: page.height }));
        });
      })
      .catch((error: unknown) => {
        if (detailGen.current !== gen) return;
        setDetailError(error instanceof Error ? error.message : '详情图生成失败');
      })
      .finally(() => {
        if (detailGen.current === gen) setDetailBusy(false);
      });
  }, [detailJob, tab]);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setZoom(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom]);

  function onShift(id: string, dir: -1 | 1) {
    setImages((prev) => {
      const item = prev.find((img) => img.id === id);
      if (!item) return prev;
      const group = prev.filter((img) => img.role === item.role);
      const index = group.findIndex((img) => img.id === id);
      const target = index + dir;
      if (target < 0 || target >= group.length) return prev;
      return moveImage(prev, id, item.role, target);
    });
  }

  function onDropOn(sourceId: string, role: Role, toIndex: number) {
    setImages((prev) => {
      const item = prev.find((img) => img.id === sourceId);
      if (!item) return prev;
      if (item.role !== role) return moveImage(prev, sourceId, role, toIndex);
      const group = prev.filter((img) => img.role === role);
      const from = group.findIndex((img) => img.id === sourceId);
      if (from < 0) return prev;
      const insert = from < toIndex ? toIndex - 1 : toIndex;
      if (insert === from) return prev;
      return moveImage(prev, sourceId, role, insert);
    });
  }

  async function onExport() {
    if (busy) return;
    const hasCopy = Boolean(title.trim() || detailText.trim() || points.some((point) => point.trim()));
    if (!mains.length && !details.length && !hasCopy) {
      notify('还没有可以导出的内容');
      return;
    }
    setBusy('正在导出…');
    try {
      const mainBlobs: Blob[] = [];
      for (const img of mains) {
        const use = shouldAdjust('main', scope) ? adjust : defaultAdjust();
        mainBlobs.push(await renderMainJpeg(img.blob, use, { square: squareMain, size: 800, mat: paper }));
      }
      let detailBlobs: Blob[] = [];
      if (detailJob) {
        if (detailCache.current?.sig === detailJob.sig) detailBlobs = detailCache.current.blobs;
        else {
          setBusy('正在排详情…');
          const pages = await renderDetailPages(detailJob.req);
          detailBlobs = pages.map((page) => page.blob);
          detailCache.current = { sig: detailJob.sig, blobs: detailBlobs };
        }
      }
      setBusy('正在打包…');
      const zip = await buildListingZip({ title, points, detail: detailText, mains: mainBlobs, details: detailBlobs });
      saveBlob(zip, listingZipName(title));
      notify(`已导出：主图 ${mainBlobs.length} 张，详情 ${detailBlobs.length} 张`);
    } catch (error) {
      notify(error instanceof Error ? error.message : '导出失败');
    } finally {
      setBusy('');
    }
  }

  async function onCopy() {
    const text = buildCopyText(title, points, detailText);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    notify('文案已复制');
  }

  const notes = [
    !title.trim() && images.length ? '标题还空着' : '',
    !mains.length && (details.length || holds.length) ? '还没有主图' : '',
  ].filter(Boolean);

  return (
    <>
      <header className="app-header">
        <div className="seal">本地</div>
        <div>
          <h1>上架工作台</h1>
          <p>改色、重排、导出。不登录，不上传。</p>
        </div>
        <div className="spacer" />
        <div className="header-counts">
          主图 {mains.length} · 详情 {details.length}
        </div>
        <div className="export-box">
          <button type="button" className="primary" disabled={Boolean(busy)} onClick={() => void onExport()}>
            {busy || '导出上架包'}
          </button>
          <p className={notes.length ? 'export-note warn' : 'export-note'}>
            {notes.join(' · ') || '主图/01.jpg · 详情/01.jpg · 上架文案.txt'}
          </p>
        </div>
      </header>
      <div className="workspace">
        <ImportPane
          busy={busy}
          warnings={warnings}
          counts={{ main: mains.length, detail: details.length, hold: holds.length }}
          onFiles={(files) => loadRef.current([...files].map((file) => ({ file, path: file.webkitRelativePath || file.name })))}
          onSample={() => {
            if (dirtyRef.current && !window.confirm('用示例替换当前内容？')) return;
            setBusy('正在生成示例…');
            void makeSample()
              .then(applyPack)
              .catch((error: unknown) => notify(error instanceof Error ? error.message : '示例生成失败'))
              .finally(() => setBusy(''));
          }}
          onClear={() => {
            if (!dirtyRef.current) return;
            if (!window.confirm('清空当前内容？')) return;
            applyPack({ title: '', points: [], detail: '', images: [], warnings: [] });
          }}
        />
        <main className="sheet stage">
          <div className="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'copy'} onClick={() => setTab('copy')}>
              文案
            </button>
            <button type="button" role="tab" aria-selected={tab === 'main'} onClick={() => setTab('main')}>
              主图 {mains.length}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'detail'} onClick={() => setTab('detail')}>
              详情 {details.length}
            </button>
            {holds.length ? (
              <button type="button" role="tab" aria-selected={tab === 'hold'} onClick={() => setTab('hold')}>
                不导出 {holds.length}
              </button>
            ) : null}
          </div>
          {tab === 'copy' ? (
            <CopyPane
              title={title}
              points={points}
              detail={detailText}
              empty={empty}
              onTitle={setTitle}
              onPoint={(index, value) => setPoints((prev) => prev.map((point, i) => (i === index ? value : point)))}
              onAddPoint={() => setPoints((prev) => (prev.length >= 8 ? prev : [...prev, '']))}
              onRemovePoint={(index) => setPoints((prev) => (prev.length === 1 ? [''] : prev.filter((_, i) => i !== index)))}
              onDetail={setDetailText}
              onCopy={() => void onCopy()}
            />
          ) : null}
          {tab === 'main' ? (
            <MainPane
              items={mains}
              previews={previews}
              selectedId={selectedId}
              showOriginal={showOriginal}
              squareMain={squareMain}
              paper={paper}
              adjust={adjust}
              scope={scope}
              previewBusy={previewBusy}
              onSelect={setSelectedId}
              onToggleOriginal={() => setShowOriginal((value) => !value)}
              onSquare={setSquareMain}
              onPaper={setPaper}
              onAdjust={setAdjust}
              onScope={setScope}
              onShift={onShift}
              onRole={(id, role) => setImages((prev) => moveImage(prev, id, role, 9999))}
              onDelete={(id) => {
                setImages((prev) => {
                  const found = prev.find((img) => img.id === id);
                  if (found) URL.revokeObjectURL(found.url);
                  return prev.filter((img) => img.id !== id);
                });
              }}
              onDropOn={onDropOn}
            />
          ) : null}
          {tab === 'detail' ? (
            <DetailPane
              items={details}
              previews={previews}
              mode={mode}
              gap={gaps[mode]}
              paper={paper}
              banner={banner}
              maxSlice={maxSlice}
              busy={detailBusy}
              error={detailError}
              shots={detailShots}
              onMode={setMode}
              onGap={(value) => setGaps((prev) => ({ ...prev, [mode]: value }))}
              onPaper={setPaper}
              onBanner={setBanner}
              onMaxSlice={setMaxSlice}
              onShift={onShift}
              onRole={(id, role) => setImages((prev) => moveImage(prev, id, role, 9999))}
              onDelete={(id) => {
                setImages((prev) => {
                  const found = prev.find((img) => img.id === id);
                  if (found) URL.revokeObjectURL(found.url);
                  return prev.filter((img) => img.id !== id);
                });
              }}
              onDropOn={onDropOn}
              onZoom={(url, caption) => setZoom({ url, caption })}
            />
          ) : null}
          {tab === 'hold' ? (
            <HoldPane
              items={holds}
              onShift={onShift}
              onRole={(id, role) => setImages((prev) => moveImage(prev, id, role, 9999))}
              onDelete={(id) => {
                setImages((prev) => {
                  const found = prev.find((img) => img.id === id);
                  if (found) URL.revokeObjectURL(found.url);
                  return prev.filter((img) => img.id !== id);
                });
              }}
              onDropOn={onDropOn}
            />
          ) : null}
        </main>
      </div>
      {toast ? <div className="toast" role="status">{toast}</div> : null}
      {zoom ? (
        <div className="lightbox" onClick={() => setZoom(null)}>
          <span>{zoom.caption} · 点击关闭</span>
          <img src={zoom.url} alt={zoom.caption} />
        </div>
      ) : null}
      {dragHot ? <div className="overlay">松开即可导入。会替换当前内容。</div> : null}
    </>
  );
}
