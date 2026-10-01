export type GameStatus = 'playing' | 'win';

export interface PlayerInfo {
  id: string;
  name: string;
}

/**
 * The animation phase of the current turn. This lives inside the synced snapshot
 * so every client steps through the roll -> walk -> capture sequence in lockstep
 * instead of each one guessing at timings locally.
 *
 * `token` is an index into `LudoState.tokens`.
 */
export type Phase =
  // Waiting for `currentTurnId` to tap the die.
  | { kind: 'idle' }
  // Die is tumbling. `lastRoll` is already decided but not yet revealed.
  | { kind: 'rolling' }
  // Waiting for `currentTurnId` to pick one of several movable tokens.
  | { kind: 'choosing'; options: number[] }
  // A token is popping out of the yard onto its start cell.
  | { kind: 'launching'; token: number }
  // A token is walking the board, one cell per tick, `remaining` to go.
  | { kind: 'stepping'; token: number; remaining: number }
  // `victims` have just been sent back to their yards and are gliding there.
  | { kind: 'capturing'; token: number; victims: number[] }
  // A token has just reached the home and is settling into its wedge.
  | { kind: 'homing'; token: number }
  // A beat before the turn hands over. `extra` means the player rolls again.
  | { kind: 'settling'; note?: 'noMoves' | 'burned'; extra?: boolean };

export interface LudoState {
  /** Authoritative seat order. Published so guests never have to derive it. */
  players: PlayerInfo[];
  /** seat -> board quadrant. A two-player game seats them diagonally opposite. */
  quadrants: number[];
  /**
   * Progress of every token, flattened as `seat * TOKENS_PER_PLAYER + slot`.
   * See `board.ts` for what the numbers mean.
   */
  tokens: number[];
  /** Players who left mid-game. Kept out of the rotation but still seated. */
  droppedIds: string[];
  turnIndex: number;
  currentTurnId: string;
  lastRoll: number | null;
  /** Consecutive sixes by the current player; the third one burns the turn. */
  sixesInRow: number;
  phase: Phase;
  /**
   * Monotonic counter bumped on every commit. The host's animation timer keys
   * off this rather than off `phase`, so a stepping -> stepping tick always
   * re-fires the effect even though the phase looks unchanged.
   */
  step: number;
  status: GameStatus;
  winnerId: string | null;
}

/**
 * Host-authoritative wire format. The host owns the state and broadcasts the
 * whole snapshot as 'SYNC'; everyone else only ever asks to roll or to pick.
 */
export type LudoData =
  | ({ type: 'SYNC' } & LudoState)
  | { type: 'ROLL'; userId: string }
  | { type: 'PICK'; userId: string; token: number };
