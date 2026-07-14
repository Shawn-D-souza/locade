export type PlayerMark = 'X' | 'O';

export type GameStatus = 'playing' | 'win' | 'draw';

/**
 * Data payloads for the Tic Tac Toe game.
 * We use a host-authoritative model where the host manages the state and broadcasts it via 'SYNC',
 * and the guest sends 'MOVE' actions.
 */
export type TicTacToeData =
  | {
      // Sent by the host to sync the current game state to the guest.
      // This is used for initialization, after every valid move, and on restarts.
      type: 'SYNC';
      board: (string | null)[]; // Array of 9, containing player IDs or null
      currentTurnId: string;    // The ID of the player whose turn it is
      status: GameStatus;       // Current status of the game
      winnerId: string | null;  // The ID of the winner, if status is 'win'
      xPlayerId: string;        // ID of the player assigned to 'X'
      oPlayerId: string;        // ID of the player assigned to 'O'
    }
  | {
      // Sent by the guest (or host locally) to request a move.
      // Host will validate and apply the move, then broadcast a new 'SYNC'.
      type: 'MOVE';
      index: number;            // 0-8 indicating the cell index
      userId: string;           // The ID of the player making the move
    }
  | {
      // Sent by the host when they click the "Restart" button on the win screen.
      // Alternatively, the host could just send a new 'SYNC' with a reset board.
      // Having an explicit RESTART is sometimes helpful for UI animations.
      type: 'RESTART';
    };
