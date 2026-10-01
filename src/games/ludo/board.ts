/**
 * Static board geometry for Ludo.
 *
 * The board is a 15x15 grid. Four 6x6 yards sit in the corners, a cross-shaped
 * track runs between them, and the middle 3x3 is the shared home.
 *
 *      col 0 ....... 6 7 8 ....... 14
 *  row  0  ┌──────┬───────┬──────┐
 *          │ yard │  arm  │ yard │
 *      5   ├──────┼───────┼──────┤
 *      6   │ arm  │ home  │ arm  │
 *      8   ├──────┼───────┼──────┤
 *      9   │ yard │  arm  │ yard │
 *     14   └──────┴───────┴──────┘
 *
 * Each arm contributes 13 cells to the 52-cell shared ring (six on each outer
 * line plus the tip) and hides one player's five private home-column cells down
 * its middle. Everything here is derived by rotating a single arm four times, so
 * the four quadrants are exactly symmetric by construction.
 */

export const GRID = 15;
export const TOKENS_PER_PLAYER = 4;

/** Side of one cell as a percentage of the board, for absolute positioning. */
export const CELL_PCT = 100 / GRID;

/** Centre of the board in cell units — also the centre of the home. */
export const BOARD_CENTER = GRID / 2;

/** Top-left cell of the middle 3x3 block the four home wedges occupy. */
export const HOME_ORIGIN = (GRID - 3) / 2;

// ─── Token progress scale ────────────────────────────────────────────────────
// A token's whole journey is a single number so movement is plain arithmetic:
//
//   -1          still parked in the yard
//   0           the owner's start cell
//   0 .. 50     the 51 shared ring cells walked on the way round
//   51 .. 55    the five private home-column cells
//   56          home
//
// Reaching home needs an exact roll; 50 + 6 would overshoot and is not allowed.

export const IN_YARD = -1;
export const RING_LENGTH = 52;
/** Highest progress value that still sits on the shared ring. */
export const LAP_END = 50;
export const HOME_COLUMN_LENGTH = 5;
export const HOME_PROGRESS = LAP_END + HOME_COLUMN_LENGTH + 1;

/** A grid cell, or — where noted — a fractional position in cell units. */
export interface Coord {
  row: number;
  col: number;
}

/**
 * Quarter turn about the board centre. Applied to the first arm it yields the
 * next arm in travel order, which is what makes the whole board derivable.
 */
const rotate = ({ row, col }: Coord): Coord => ({ row: GRID - 1 - col, col: row });

/**
 * The 13 ring cells of the first arm, in travel order: down the departure line,
 * outward along the next arm's far line, then around its tip.
 */
const FIRST_ARM: Coord[] = [
  { row: 0, col: 6 },
  { row: 1, col: 6 },
  { row: 2, col: 6 },
  { row: 3, col: 6 },
  { row: 4, col: 6 },
  { row: 5, col: 6 },
  { row: 6, col: 5 },
  { row: 6, col: 4 },
  { row: 6, col: 3 },
  { row: 6, col: 2 },
  { row: 6, col: 1 },
  { row: 6, col: 0 },
  { row: 7, col: 0 },
];

/** The shared ring, in travel order. Index 0 is the top arm's outermost cell. */
export const RING: Coord[] = (() => {
  const out: Coord[] = [];
  let arm = FIRST_ARM;
  for (let i = 0; i < 4; i++) {
    out.push(...arm);
    arm = arm.map(rotate);
  }
  return out;
})();

export interface Quadrant {
  /** Ring index of this quadrant's start cell, i.e. of progress 0. */
  startIndex: number;
  /** Top-left cell of the 6x6 yard. */
  yard: Coord;
  /** The five private cells between the ring and the home, outermost first. */
  homeColumn: Coord[];
  /** Unit step along the home column, pointing at the home. */
  inward: Coord;
  /** Which edge of the yard the name plate sits on. */
  labelEdge: 'top' | 'bottom';
  /** Direction of travel out of the start cell, as a glyph. */
  startArrow: string;
}

const ARROWS: Record<string, string> = { '1,0': '⬇\uFE0E', '-1,0': '⬆\uFE0E', '0,1': '➡\uFE0E', '0,-1': '⬅\uFE0E' };

/**
 * The four quadrants in travel order: top-left, bottom-left, bottom-right,
 * top-right. A player seated in a quadrant leaves their yard onto the adjacent
 * arm, walks the full ring, and turns into that same arm's middle to come home.
 */
export const QUADRANTS: Quadrant[] = (() => {
  const out: Quadrant[] = [];
  let startIndex = 1;
  let homeColumn: Coord[] = [1, 2, 3, 4, 5].map((row) => ({ row, col: 7 }));
  // The yard's outermost cell; rotating it walks the corners round the board.
  let corner: Coord = { row: 0, col: 0 };

  for (let i = 0; i < 4; i++) {
    const next = RING[(startIndex + 1) % RING_LENGTH];
    const from = RING[startIndex];
    const yard: Coord = {
      row: corner.row === 0 ? 0 : GRID - 6,
      col: corner.col === 0 ? 0 : GRID - 6,
    };

    out.push({
      startIndex,
      yard,
      homeColumn,
      inward: {
        row: homeColumn[1].row - homeColumn[0].row,
        col: homeColumn[1].col - homeColumn[0].col,
      },
      labelEdge: yard.row === 0 ? 'top' : 'bottom',
      startArrow: ARROWS[`${next.row - from.row},${next.col - from.col}`],
    });

    startIndex += RING_LENGTH / 4;
    homeColumn = homeColumn.map(rotate);
    corner = rotate(corner);
  }
  return out;
})();

/**
 * The classic eight safe squares: every start cell, plus the star eight steps
 * along from it. Nothing can be captured while standing on one.
 */
export const SAFE_RING_INDICES: ReadonlySet<number> = new Set(
  QUADRANTS.flatMap((q) => [q.startIndex, (q.startIndex + 8) % RING_LENGTH])
);

export interface TrackCell {
  row: number;
  col: number;
  kind: 'ring' | 'home-column';
  /** Quadrant whose colour this cell carries, or null for a plain ring cell. */
  owner: number | null;
  safe: boolean;
  start: boolean;
  arrow: string | null;
}

/** Every painted track cell — 52 ring plus 4x5 home column — in one list. */
export const TRACK_CELLS: TrackCell[] = (() => {
  const startOwner = new Map<number, number>();
  QUADRANTS.forEach((q, i) => startOwner.set(q.startIndex, i));

  const ring: TrackCell[] = RING.map((cell, index) => {
    const owner = startOwner.get(index);
    return {
      ...cell,
      kind: 'ring',
      owner: owner ?? null,
      safe: SAFE_RING_INDICES.has(index),
      start: owner !== undefined,
      arrow: owner === undefined ? null : QUADRANTS[owner].startArrow,
    };
  });

  const homeColumns: TrackCell[] = QUADRANTS.flatMap((q, i) =>
    q.homeColumn.map((cell) => ({
      ...cell,
      kind: 'home-column' as const,
      owner: i,
      safe: false,
      start: false,
      arrow: null,
    }))
  );

  return [...ring, ...homeColumns];
})();

/**
 * Each quadrant's wedge of the home, as polygon points in a 0-100 viewBox laid
 * over the centre 3x3. Ordered to match `QUADRANTS`, so the wedge a player
 * arrives in is the one their home column points at.
 */
export const HOME_WEDGES: string[] = [
  '0,0 100,0 50,50', // top
  '0,0 50,50 0,100', // left
  '0,100 50,50 100,100', // bottom
  '100,0 100,100 50,50', // right
];

// ─── Token placement ─────────────────────────────────────────────────────────
// All of these return the *centre* of a token in cell units, measured from the
// board's top-left corner, so the render layer can position everything through
// one helper and let CSS animate the difference between two of them.

/** Half the gap between the four parking spots inside a yard. */
const YARD_SLOT_SPREAD = 1;
/** How far a quadrant's finished tokens sit from the centre of the home. */
const HOME_CLUSTER_INSET = 1;
/** Gap between finished tokens as they line up across their wedge. */
const HOME_SLOT_SPACING = 0.45;

/** The 2x2 parking spots inside a quadrant's yard. */
export function yardSlot(q: Quadrant, slot: number): Coord {
  return {
    row: q.yard.row + 3 + (slot < 2 ? -YARD_SLOT_SPREAD : YARD_SLOT_SPREAD),
    col: q.yard.col + 3 + (slot % 2 === 0 ? -YARD_SLOT_SPREAD : YARD_SLOT_SPREAD),
  };
}

/** Where a finished token rests, lined up across its own wedge of the home. */
export function homeSlot(q: Quadrant, slot: number): Coord {
  // Perpendicular to `inward`, so the line of tokens lies across the wedge.
  const across = { row: q.inward.col, col: -q.inward.row };
  const offset = (slot - (TOKENS_PER_PLAYER - 1) / 2) * HOME_SLOT_SPACING;
  return {
    row: BOARD_CENTER - q.inward.row * HOME_CLUSTER_INSET + across.row * offset,
    col: BOARD_CENTER - q.inward.col * HOME_CLUSTER_INSET + across.col * offset,
  };
}

/** Where the token in `slot` of `q` sits at the given progress. */
export function tokenCenter(q: Quadrant, slot: number, progress: number): Coord {
  if (progress === IN_YARD) return yardSlot(q, slot);
  if (progress >= HOME_PROGRESS) return homeSlot(q, slot);

  const cell =
    progress <= LAP_END
      ? RING[(q.startIndex + progress) % RING_LENGTH]
      : q.homeColumn[progress - LAP_END - 1];

  return { row: cell.row + 0.5, col: cell.col + 0.5 };
}

/**
 * Absolute ring index a token occupies, or null when it is off the shared ring
 * (in the yard, in a home column, or home). Two tokens can only ever collide
 * where this matches.
 */
export function ringIndexAt(q: Quadrant, progress: number): number | null {
  if (progress < 0 || progress > LAP_END) return null;
  return (q.startIndex + progress) % RING_LENGTH;
}

/** Progress a token would reach on this roll. Yard tokens land on their start. */
export function destinationProgress(progress: number, roll: number): number {
  return progress === IN_YARD ? 0 : progress + roll;
}
