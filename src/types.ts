export type Role = 'main' | 'detail' | 'hold';

export type RoleSource = 'path' | 'hint' | 'aspect' | 'sample';

export type AdjustScope = 'all' | 'main' | 'detail';

export type LayoutMode = 'stack' | 'columns' | 'spaced';

export type Incoming = {
  file: File;
  path: string;
};

export type ImgItem = {
  id: string;
  name: string;
  path: string;
  role: Role;
  holdTag: string;
  roleSource: RoleSource;
  blob: Blob;
  width: number;
  height: number;
  url: string;
};

export type Adjust = {
  hue: number;
  brightness: number;
  contrast: number;
  paletteId: string;
  strength: number;
};

export type ImageHint = {
  base: string;
  role: Role;
  holdTag: string;
};

export type ParsedCopy = {
  title: string;
  points: string[];
  detail: string;
  hints: ImageHint[];
  remote: number;
  dataImages: { name: string; blob: Blob }[];
  warnings: string[];
};

export type Pack = {
  title: string;
  points: string[];
  detail: string;
  images: ImgItem[];
  warnings: string[];
};

export const defaultAdjust = (): Adjust => ({
  hue: 0,
  brightness: 0,
  contrast: 0,
  paletteId: 'none',
  strength: 0,
});

export function emptyCopy(): ParsedCopy {
  return {
    title: '',
    points: [],
    detail: '',
    hints: [],
    remote: 0,
    dataImages: [],
    warnings: [],
  };
}
