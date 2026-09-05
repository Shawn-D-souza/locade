export type GameStatus = 'playing' | 'win';

export interface PlayerInfo {
  id: string;
  name: string;
}

/**
 * The animation phase of the current turn. This lives inside the synced
 * snapshot so every client steps through the roll -> hop -> slide sequence in
 * lockstep instead of each one guessing at timings locally.
 */
export type Phase =
  // Waiting for `currentTurnId` to tap the die.
  | { kind: 'idle' }
  // Die is tumbling. `lastRoll` is already decided but not yet revealed.
  | { kind: 'rolling' }
  // Pawn is walking toward `to`, one square per tick.
  | { kind: 'hopping'; to: number }
  // Pawn has landed on a snake/ladder, anticipating the move
  | { kind: 'anticipating'; via: 'snake' | 'ladder'; to: number }
  // Pawn has already been moved to the snake tail / ladder top and is gliding there.
  | { kind: 'transition'; via: 'snake' | 'ladder' }
  // A beat before the turn hands over. `blocked` means the roll overshot 100.
  | { kind: 'settling'; blocked?: boolean };

export interface SnakesLaddersState {
  /** Authoritative seat order. Published so guests never have to derive it. */
  players: PlayerInfo[];
  /** userId -> square. 0 means still in the off-board staging pen. */
  positions: Record<string, number>;
  /** Players who left mid-game. Kept out of the rotation but still seated. */
  droppedIds: string[];
  turnIndex: number;
  currentTurnId: string;
  lastRoll: number | null;
  phase: Phase;
  /**
   * Monotonic counter bumped on every commit. The host's animation timer keys
   * off this rather than off `phase`, so a hopping -> hopping step always
   * re-fires the effect even though the phase looks unchanged.
   */
  step: number;
  status: GameStatus;
  winnerId: string | null;
}

/**
 * Host-authoritative wire format. The host owns the state and broadcasts the
 * whole snapshot as 'SYNC'; everyone else only ever asks to roll.
 */
export type SnakesLaddersData =
  | ({ type: 'SYNC' } & SnakesLaddersState)
  | { type: 'ROLL'; userId: string };
