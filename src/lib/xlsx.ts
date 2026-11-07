import JSZip from 'jszip';
import { fromTable } from './parseCopy';
import type { ParsedCopy } from '../types';

function parseXml(xml: string): Document {
  return new DOMParser().parseFromString(xml.replace(/xmlns(:\w+)?="[^"]*"/g, ''), 'application/xml');
}

function colIndex(ref: string): number {
  const match = ref.match(/^([A-Z]+)/i);
  if (!match) return 0;
  let n = 0;
  for (const ch of match[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function parseXlsx(buf: ArrayBuffer): Promise<ParsedCopy> {
  const zip = await JSZip.loadAsync(buf);
  const shared: string[] = [];
  const sharedFile = zip.file('xl/sharedStrings.xml');
  if (sharedFile) {
    const doc = parseXml(await sharedFile.async('string'));
    for (const item of [...doc.getElementsByTagName('si')]) {
      shared.push([...item.getElementsByTagName('t')].map((node) => node.textContent || '').join(''));
    }
  }
  const sheets = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort();
  const rows: string[][] = [];
  for (const name of sheets) {
    const file = zip.file(name);
    if (!file) continue;
    const doc = parseXml(await file.async('string'));
    for (const rowEl of [...doc.getElementsByTagName('row')]) {
      const row: string[] = [];
      for (const cell of [...rowEl.getElementsByTagName('c')]) {
        const col = colIndex(cell.getAttribute('r') || '');
        while (row.length < col) row.push('');
        const kind = cell.getAttribute('t') || '';
        let value = '';
        if (kind === 's') {
          const index = Number(cell.getElementsByTagName('v')[0]?.textContent || '0');
          value = shared[index] || '';
        } else if (kind === 'inlineStr') {
          value = [...cell.getElementsByTagName('t')].map((node) => node.textContent || '').join('');
        } else value = cell.getElementsByTagName('v')[0]?.textContent || '';
        row[col] = value;
      }
      if (row.some((cell) => cell.trim())) rows.push(row);
    }
  }
  return fromTable(rows);
}
