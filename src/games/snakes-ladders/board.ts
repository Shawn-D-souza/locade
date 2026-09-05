/**
 * Static board definition for Snakes & Ladders.
 *
 * The board is a serpentine (boustrophedon) 10x10 grid: square 1 sits at the
 * bottom-left, numbering runs right along the bottom row to 10, then the next
 * row runs right-to-left from 11 to 20, and so on. Square 100 ends up at the
 * top-left corner.
 */

export const BOARD_SIZE = 10;
export const FINAL_SQUARE = 100;

/** Square 0 is the off-board staging pen every pawn starts in. */
export const START_SQUARE = 0;

/** Ladder bottom -> ladder top. */
export const LADDERS: Record<number, number> = {
  1: 38,
  4: 14,
  9: 31,
  21: 42,
  28: 84,
  36: 44,
  51: 67,
  71: 91,
  80: 100,
};

/** Snake head -> snake tail. */
export const SNAKES: Record<number, number> = {
  16: 6,
  47: 26,
  49: 11,
  56: 53,
  62: 19,
  64: 60,
  87: 24,
  93: 73,
  95: 75,
  98: 78,
};

/**
 * This is the classic Milton Bradley layout, which is deliberately
 * non-chaining: no ladder top or snake tail is itself a ladder bottom or snake
 * head. That means resolving a landing is a single lookup rather than a loop.
 * If you edit the maps above, keep that property or the movement code needs to
 * become iterative.
 */

/** Where a snake/ladder starting on `sq` leads, or null if the square is plain. */
export function transitionFor(sq: number): { to: number; via: 'snake' | 'ladder' } | null {
  if (SNAKES[sq] !== undefined) return { to: SNAKES[sq], via: 'snake' };
  if (LADDERS[sq] !== undefined) return { to: LADDERS[sq], via: 'ladder' };
  return null;
}

/**
 * Grid coordinates for a board square (1-100).
 * Row 0 is the top row, matching CSS grid document order.
 */
export function squareToCoords(sq: number): { row: number; col: number } {
  const idx = sq - 1;
  const rowFromBottom = Math.floor(idx / BOARD_SIZE);
  const colInRow = idx % BOARD_SIZE;
  return {
    row: BOARD_SIZE - 1 - rowFromBottom,
    // Odd rows (counting from the bottom) run right-to-left.
    col: rowFromBottom % 2 === 0 ? colInRow : BOARD_SIZE - 1 - colInRow,
  };
}

/** Every square in document order, so the grid can be rendered with a single map. */
export const SQUARES_IN_GRID_ORDER: number[] = (() => {
  const out: number[] = new Array(BOARD_SIZE * BOARD_SIZE);
  for (let sq = 1; sq <= FINAL_SQUARE; sq++) {
    const { row, col } = squareToCoords(sq);
    out[row * BOARD_SIZE + col] = sq;
  }
  return out;
})();
