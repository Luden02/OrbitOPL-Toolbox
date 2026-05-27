export type GameFormat = 'ISO' | 'ZSO' | 'VCD' | 'UL' | 'POPS' | 'APP';

export type Game = {
  filename: string;
  size?: string;
  gameId: string;
  region?: 'NTSC-U' | 'PAL' | 'NTSC-J' | 'UNKNOWN';
  cdType: string;
  title?: string;
  path: string;
  extension: string;
  parentPath: string;
  format?: GameFormat;
  system?: 'PS1' | 'PS2' | 'APPS';
  art?: gameArt[];
  /** APPS only: the subfolder name under APPS/ (used for deletion). */
  appFolder?: string;
};

export type RawGameFile = {
  extension: string;
  name: string;
  parentPath: string;
  path: string;
  stats?: {
    dev: number;
    mode: number;
    nlink: number;
    uid: number;
    gid: number;
    rdev: number;
    blksize: number;
    ino: number;
    size: number;
    blocks: number;
    atimeMs: number;
    mtimeMs: number;
    ctimeMs: number;
    birthtimeMs: number;
    atime: string;
    mtime: string;
    ctime: string;
    birthtime: string;
  };
};

export type gameArt = {
  extension: string;
  gameId: string;
  name: string;
  path: string;
  type: string;
  base64: string;
};
