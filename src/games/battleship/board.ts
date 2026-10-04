/**
 * Static fleet definition and grid geometry for Battleship.
 *
 * The board is a plain 10x10 addressed by a single cell index, `row * GRID +
 * col`, with row 0 at the top. Columns read A-J and rows 1-10, so cell 0 is
 * "A1" and cell 99 is "J10".
 *
 * Everything here is pure geometry — no game state, no React — so the host's
 * rules engine and the placement UI can share one definition of what fits
 * where.
 */

export const GRID = 10;
export const CELLS = GRID * GRID;

/** One cell as a percentage of the board's width, for the absolute overlays. */
export const CELL_PCT = 100 / GRID;

export type Orientation = 'h' | 'v';

export type ShipId = 'carrier' | 'battleship' | 'cruiser' | 'submarine' | 'destroyer';

export interface ShipDef {
  id: ShipId;
  name: string;
  length: number;
}

/** The classic fleet: five hulls, seventeen cells of steel. */
export const FLEET: ShipDef[] = [
  { id: 'carrier', name: 'Carrier', length: 5 },
  { id: 'battleship', name: 'Battleship', length: 4 },
  { id: 'cruiser', name: 'Cruiser', length: 3 },
  { id: 'submarine', name: 'Submarine', length: 3 },
  { id: 'destroyer', name: 'Destroyer', length: 2 },
];

export const SHIP_BY_ID: Record<ShipId, ShipDef> = Object.fromEntries(
  FLEET.map((ship) => [ship.id, ship])
) as Record<ShipId, ShipDef>;

export const TOTAL_SHIP_CELLS = FLEET.reduce((sum, ship) => sum + ship.length, 0);

/** A deployed hull: which ship, the cell its bow sits on, and which way it runs. */
export interface Placement {
  ship: ShipId;
  /** Bow cell — leftmost when horizontal, topmost when vertical. */
  cell: number;
  orientation: Orientation;
}

// ─── Coordinates ─────────────────────────────────────────────────────────────

export const rowOf = (cell: number) => Math.floor(cell / GRID);
export const colOf = (cell: number) => cell % GRID;
export const cellAt = (row: number, col: number) => row * GRID + col;

export const COLUMN_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

/** Human-readable coordinate, e.g. 23 -> "D3". */
export const cellName = (cell: number) => `${COLUMN_LABELS[colOf(cell)]}${rowOf(cell) + 1}`;

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

// ─── Hull geometry ───────────────────────────────────────────────────────────

/**
 * Every cell a placement covers, bow first. Returns an empty array when the
 * hull would run off the grid, which makes "does it fit" a length check
 * everywhere else.
 */
export function shipCells(placement: Placement): number[] {
  const def = SHIP_BY_ID[placement.ship];
  if (!def) return [];

  const row = rowOf(placement.cell);
  const col = colOf(placement.cell);
  if (placement.cell < 0 || placement.cell >= CELLS) return [];

  const overhangs =
    placement.orientation === 'h' ? col + def.length > GRID : row + def.length > GRID;
  if (overhangs) return [];

  return Array.from({ length: def.length }, (_, i) =>
    placement.orientation === 'h' ? cellAt(row, col + i) : cellAt(row + i, col)
  );
}

/** The bow cell furthest along the axis that still keeps the whole hull on-grid. */
export function maxBow(ship: ShipId, orientation: Orientation) {
  const length = SHIP_BY_ID[ship]?.length ?? 1;
  return {
    row: orientation === 'v' ? GRID - length : GRID - 1,
    col: orientation === 'h' ? GRID - length : GRID - 1,
  };
}

/** True when `placement` sits fully on the grid and clears every hull in `others`. */
export function canPlace(placement: Placement, others: Placement[]): boolean {
  const cells = shipCells(placement);
  if (cells.length === 0) return false;
  const taken = new Set(others.flatMap(shipCells));
  return cells.every((cell) => !taken.has(cell));
}

/**
 * Flip a hull's orientation, pivoting about the bow. If that overhangs the grid
 * or fouls another hull, the bow is nudged back along the new axis until it
 * fits — so a tap near the edge still rotates instead of silently refusing.
 * Returns null when there is genuinely no room.
 */
export function rotated(placement: Placement, others: Placement[]): Placement | null {
  const length = SHIP_BY_ID[placement.ship]?.length ?? 1;
  const orientation: Orientation = placement.orientation === 'h' ? 'v' : 'h';
  const row = rowOf(placement.cell);
  const col = colOf(placement.cell);

  for (let back = 0; back < length; back++) {
    const origin = orientation === 'h' ? col - back : row - back;
    if (origin < 0) break;

    const candidate: Placement = {
      ship: placement.ship,
      orientation,
      cell: orientation === 'h' ? cellAt(row, origin) : cellAt(origin, col),
    };
    if (canPlace(candidate, others)) return candidate;
  }
  return null;
}

/** The hull covering `cell`, or null for open water. */
export function shipAt(fleet: Placement[], cell: number): Placement | null {
  return fleet.find((placement) => shipCells(placement).includes(cell)) ?? null;
}

/** True once every cell of `placement` appears in `hits`. */
export const isSunk = (placement: Placement, hits: Set<number>) =>
  shipCells(placement).every((cell) => hits.has(cell));

// ─── Validation & generation ─────────────────────────────────────────────────

/**
 * A legal fleet is all five hulls, each on the grid, none overlapping. The host
 * runs this over whatever a guest sends before trusting it.
 */
export function validateFleet(fleet: unknown): fleet is Placement[] {
  if (!Array.isArray(fleet) || fleet.length !== FLEET.length) return false;

  const seen = new Set<ShipId>();
  const taken = new Set<number>();

  for (const placement of fleet) {
    if (typeof placement !== 'object' || placement === null) return false;
    const { ship, cell, orientation } = placement as Placement;

    if (!(ship in SHIP_BY_ID) || seen.has(ship)) return false;
    if (!Number.isInteger(cell)) return false;
    if (orientation !== 'h' && orientation !== 'v') return false;
    seen.add(ship);

    const cells = shipCells({ ship, cell, orientation });
    if (cells.length === 0) return false;
    for (const covered of cells) {
      if (taken.has(covered)) return false;
      taken.add(covered);
    }
  }
  return true;
}

/** Used only if the randomiser somehow never converges — five tidy rows. */
const FALLBACK_FLEET: Placement[] = [
  { ship: 'carrier', cell: cellAt(0, 0), orientation: 'h' },
  { ship: 'battleship', cell: cellAt(2, 0), orientation: 'h' },
  { ship: 'cruiser', cell: cellAt(4, 0), orientation: 'h' },
  { ship: 'submarine', cell: cellAt(6, 0), orientation: 'h' },
  { ship: 'destroyer', cell: cellAt(8, 0), orientation: 'h' },
];

/**
 * A legal random fleet. Hulls go down longest-first so the tight late fits stay
 * easy, and a jammed board is retried from scratch rather than backtracked — on
 * a 10x10 with 17 occupied cells that practically never happens.
 */
export function randomFleet(): Placement[] {
  for (let attempt = 0; attempt < 50; attempt++) {
    const placed: Placement[] = [];

    for (const ship of FLEET) {
      let settled = false;
      for (let tries = 0; tries < 200 && !settled; tries++) {
        const candidate: Placement = {
          ship: ship.id,
          cell: Math.floor(Math.random() * CELLS),
          orientation: Math.random() < 0.5 ? 'h' : 'v',
        };
        if (canPlace(candidate, placed)) {
          placed.push(candidate);
          settled = true;
        }
      }
      if (!settled) break;
    }

    if (placed.length === FLEET.length) return placed;
  }
  return FALLBACK_FLEET.map((placement) => ({ ...placement }));
}
