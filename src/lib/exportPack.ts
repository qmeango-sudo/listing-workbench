import JSZip from 'jszip';
import { buildCopyText } from './copyText';

function pad(index: number): string {
  return String(index).padStart(2, '0');
}

export async function buildListingZip(input: {
  title: string;
  points: string[];
  detail: string;
  mains: Blob[];
  details: Blob[];
}): Promise<Blob> {
  const zip = new JSZip();
  zip.file('上架文案.txt', buildCopyText(input.title, input.points, input.detail));
  if (input.mains.length) {
    const folder = zip.folder('主图');
    input.mains.forEach((blob, index) => folder?.file(`${pad(index + 1)}.jpg`, blob));
  }
  if (input.details.length) {
    const folder = zip.folder('详情');
    input.details.forEach((blob, index) => folder?.file(`${pad(index + 1)}.jpg`, blob));
  }
  return zip.generateAsync({ type: 'blob' });
}
