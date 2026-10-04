import type { Placement, ShipId } from './board';

export type GameStatus = 'placing' | 'playing' | 'win';

export interface PlayerInfo {
  id: string;
  name: string;
}

/** What a fired cell turned out to be. `null` in a grid means unexplored water. */
export type ShotResult = 'miss' | 'hit';

/**
 * The animation phase of the current turn. This lives inside the synced
 * snapshot so every client steps through the aim -> shell -> splash sequence in
 * lockstep instead of each one guessing at timings locally.
 */
export type Phase =
  // Waiting on both players to lock in a fleet.
  | { kind: 'deploying' }
  // Waiting for `currentTurnId` to pick a cell on the enemy grid.
  | { kind: 'aiming' }
  // A shell is in the air. The outcome is not decided until it lands.
  | { kind: 'firing'; targetId: string; cell: number }
  // The shell landed; `shots` already records it and the result is on screen.
  | { kind: 'splash'; targetId: string; cell: number; result: ShotResult; sunk: ShipId | null }
  // A beat before the turn hands over. `extra` means the shooter fires again.
  | { kind: 'settling'; extra?: boolean };

export interface BattleshipState {
  /** Authoritative seat order. Published so guests never have to derive it. */
  players: PlayerInfo[];
  /**
   * playerId -> their deployed hulls.
   *
   * Deliberately part of the broadcast snapshot, exactly like every other game
   * on the platform: the host owns the rules, so it needs both fleets, and a
   * reconnecting player gets their own board back for free from the replayed
   * snapshot. The UI never draws an opponent hull until it is sunk, but this is
   * concealment, not secrecy — anyone with devtools can read the wire. That is
   * an accepted trade for a couch/party game; a tamper-proof version would need
   * a commit-reveal scheme or a neutral server.
   */
  fleets: Record<string, Placement[]>;
  /** Players who have locked their fleet in. Both present ends the placing phase. */
  ready: string[];
  /** playerId -> 100 cells of shots fired *at* them. */
  shots: Record<string, (ShotResult | null)[]>;
  /** playerId -> which of their hulls are confirmed sunk, and so public. */
  sunk: Record<string, ShipId[]>;
  /** Players who left mid-game. The battle holds until they return or time out. */
  droppedIds: string[];
  turnIndex: number;
  currentTurnId: string;
  phase: Phase;
  /**
   * Monotonic counter bumped on every commit. The host's animation timer keys
   * off this rather than off `phase`, so two identical-looking phases in a row
   * still re-fire the effect.
   */
  step: number;
  status: GameStatus;
  winnerId: string | null;
}

/**
 * Host-authoritative wire format. The host owns the state and broadcasts the
 * whole snapshot as 'SYNC'; everyone else only ever asks to deploy or to fire.
 */
export type BattleshipData =
  | ({ type: 'SYNC' } & BattleshipState)
  | { type: 'DEPLOY'; userId: string; fleet: Placement[] }
  | { type: 'FIRE'; userId: string; cell: number };
