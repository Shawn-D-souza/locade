export type GameStatus = 'playing' | 'win' | 'draw';

export interface CellState {
  dots: number;
  ownerId: string | null;
}

export interface PlayerInfo {
  id: string;
}

/**
 * The authoritative game state. Named separately from the payload that carries
 * it so the component's local state can reuse the exact same shape.
 */
export interface DotsClashState {
  board: CellState[][];
  players: PlayerInfo[];
  spawns: Record<string, number>;
  /** Players who are away or have left. Skipped by turn rotation, still seated. */
  droppedIds: string[];
  turnIndex: number;
  turnCount: number;
  currentTurnId: string;
  status: GameStatus;
  winnerId: string | null;
  isResolving: boolean;
}

/** Sent by the host to sync the current game state to the guest. */
export type DotsClashSync = { type: 'SYNC' } & DotsClashState;

/**
 * Data payloads for the Dots Clash game.
 * We use a host-authoritative model where the host manages the state and broadcasts it via 'SYNC',
 * and the guest sends 'MOVE' actions.
 */
export type DotsClashData =
  | DotsClashSync
  | {
      // Sent by the guest (or host locally) to request a move.
      type: 'MOVE';
      row: number;
      col: number;
      userId: string;
    }
  | {
      // Sent by the host when restarting the game.
      type: 'RESTART';
    };
