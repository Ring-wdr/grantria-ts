// Early-game guide marker (FUN_0001788c / FUN_00017980 / FUN_00017a78, drawn by FUN_000331e8). Until the
// class's landmark map is visited, the first main quest in the active list picks a column of a per-map table
// in .rodata (0xfffec / 0x1002f8 / 0x100578, extracted by tools/build_web_assets.py into tables.json):
// a pulsing t.pxl arrow at (x, y), variant 1 turned 270°.

/** rows: [map, then (x, y, variant) per quest column], from the asset build (tables.json guideMarkers) */
export interface GuideTables { c0: number[][]; c1: number[][]; c2: number[][] }

/** per class: landmark map bit, map range [lo, hi), quest -> column, table */
const CLASS: { visit: number; lo: number; hi: number; cols: number[]; table: keyof GuideTables }[] = [
  { visit: 0x1e, lo: 0, hi: 0x1e, cols: [0, 2, 4, 7], table: 'c0' },
  { visit: 0x3f, lo: 0x2b, hi: 0x3f, cols: [0x13, 0x16, 0x18, 0x1a, 0x1d], table: 'c1' },
  { visit: 0x56, lo: 0x58, hi: 0x70, cols: [0x26, 0x28, 0x2a, 0x2d], table: 'c2' },
];

export interface Guide { x: number; y: number; variant: number }

/**
 * Map load (FUN_0001dd48, mode 0 only) and event end (FUN_0002cdc8). null clears the marker (x = y = -1);
 * 'keep' is the original's "map not in the table" return, which leaves the previous marker.
 */
export function pickGuide(tables: GuideTables | undefined, cls: number, map: number, visited: (m: number) => boolean, active: number[],
  mainQuest: (q: number) => boolean): Guide | null | 'keep' {
  const c = CLASS[cls];
  if (!c || visited(c.visit) || map < c.lo || map >= c.hi) return null;
  const q = active.find((v) => mainQuest(v));
  if (q === undefined) return null;
  const col = c.cols.indexOf(q);
  if (col < 0) return null;
  const row = tables?.[c.table].find((r) => r[0] === map);
  if (!row) return 'keep';
  return { x: row[1 + col * 3], y: row[2 + col * 3], variant: row[3 + col * 3] };
}
