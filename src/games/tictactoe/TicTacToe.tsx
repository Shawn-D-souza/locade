import { useState, useEffect, useRef } from 'react';
import type { GameProps } from '../GameProps';
import type { TicTacToeData, PlayerMark, GameStatus } from './types';
import { useNetworkStore } from '../../platform/store/useNetworkStore';
import { useUser } from '../../platform/store/useUserStore';

// Helper function to check for a winner (now uses player IDs)
function calculateWinner(squares: (string | null)[]): string | null {
  const lines = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // Rows
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // Cols
    [0, 4, 8], [2, 4, 6]             // Diagonals
  ];
  for (let i = 0; i < lines.length; i++) {
    const [a, b, c] = lines[i];
    if (squares[a] && squares[a] === squares[b] && squares[a] === squares[c]) {
      return squares[a];
    }
  }
  return null;
}

export default function TicTacToe({ sendDataToPeers, incomingData, onGameEnd }: GameProps<TicTacToeData>) {
  const { isHost, peers } = useNetworkStore();
  const { userId } = useUser();

  const [gameState, setGameState] = useState<{
    board: (string | null)[];
    currentTurnId: string;
    status: GameStatus;
    winnerId: string | null;
    xPlayerId: string;
    oPlayerId: string;
  } | null>(null);

  const initialized = useRef(false);

  // Host Initialization
  useEffect(() => {
    if (isHost && peers.length > 0 && !initialized.current) {
      // Safely find the guest ID (excluding our own userId if it happens to be in peers)
      const otherPeers = peers.filter(p => p.id !== userId);
      if (otherPeers.length === 0) return; // Wait until a real guest joins

      initialized.current = true;
      const guestId = otherPeers[0].id;
      const allPlayers = [userId, guestId];
      
      // Randomly pick X and O
      const xPlayerId = Math.random() > 0.5 ? allPlayers[0] : allPlayers[1];
      const oPlayerId = xPlayerId === allPlayers[0] ? allPlayers[1] : allPlayers[0];
      
      // Randomly pick first turn
      const currentTurnId = Math.random() > 0.5 ? allPlayers[0] : allPlayers[1];

      const initialSync: TicTacToeData = {
        type: 'SYNC',
        board: Array(9).fill(null),
        currentTurnId,
        status: 'playing',
        winnerId: null,
        xPlayerId,
        oPlayerId
      };
      
      setGameState(initialSync);
      sendDataToPeers(initialSync);
    }
  }, [isHost, peers, userId, sendDataToPeers]);

  const processMove = (index: number, moveUserId: string) => {
    // Use the functional state updater to guarantee we always operate on the most recent state
    setGameState((currentState) => {
      if (!currentState) return currentState;
      
      // Validate move
      if (currentState.board[index] || currentState.status !== 'playing' || currentState.currentTurnId !== moveUserId) {
        return currentState;
      }

      const newBoard = [...currentState.board];
      newBoard[index] = moveUserId;

      const winnerId = calculateWinner(newBoard);
      let status: GameStatus = 'playing';
      if (winnerId) {
        status = 'win';
      } else if (newBoard.every(cell => cell !== null)) {
        status = 'draw';
      }

      const nextTurnId = moveUserId === currentState.xPlayerId ? currentState.oPlayerId : currentState.xPlayerId;

      let nextState = {
        ...currentState,
        board: newBoard,
        currentTurnId: nextTurnId,
        status,
        winnerId
      };

      // Auto-restart on draw
      if (status === 'draw') {
        nextState = {
          ...nextState,
          board: Array(9).fill(null),
          currentTurnId: Math.random() > 0.5 ? currentState.xPlayerId : currentState.oPlayerId,
          status: 'playing',
          winnerId: null,
        };
      }

      // Broadcast the new state to peers
      sendDataToPeers({
        type: 'SYNC',
        ...nextState
      });

      return nextState;
    });
  };

  const handleRestart = () => {
    if (!isHost) return;
    
    const otherPeers = peers.filter(p => p.id !== userId);
    if (otherPeers.length === 0) return;
    
    const guestId = otherPeers[0].id;
    const allPlayers = [userId, guestId];
    
    const xPlayerId = Math.random() > 0.5 ? allPlayers[0] : allPlayers[1];
    const oPlayerId = xPlayerId === allPlayers[0] ? allPlayers[1] : allPlayers[0];
    const currentTurnId = Math.random() > 0.5 ? allPlayers[0] : allPlayers[1];

    const newSync: TicTacToeData = {
      type: 'SYNC',
      board: Array(9).fill(null),
      currentTurnId,
      status: 'playing',
      winnerId: null,
      xPlayerId,
      oPlayerId
    };
    
    setGameState(newSync);
    sendDataToPeers(newSync);
  };

  // Handle incoming network data
  useEffect(() => {
    if (incomingData?.type === 'SYNC') {
      const { type, ...state } = incomingData;
      setGameState(state);
    } else if (incomingData?.type === 'MOVE' && isHost) {
      processMove(incomingData.index, incomingData.userId);
    }
  }, [incomingData, isHost]);

  if (!gameState) {
    return <div>Initializing Game...</div>;
  }

  // --- Win/Loss Screen ---
  if (gameState.status === 'win') {
    const isWinner = gameState.winnerId === userId;
    
    return (
      <div>
        <h1>
          {isWinner ? 'You Won!' : 'You Lost'}
        </h1>
        
        {isHost ? (
          <div>
            <button onClick={onGameEnd}>Quit</button>
            <button onClick={handleRestart}>Restart</button>
          </div>
        ) : (
          <div>Waiting for host to restart...</div>
        )}
      </div>
    );
  }

  // --- Game Board Screen ---
  const getDisplayMark = (cellUserId: string | null): PlayerMark | null => {
    if (cellUserId === gameState.xPlayerId) return 'X';
    if (cellUserId === gameState.oPlayerId) return 'O';
    return null;
  };

  const amITurn = gameState.currentTurnId === userId;
  const myMark = gameState.xPlayerId === userId ? 'X' : 'O';

  let statusText = '';
  if (gameState.status === 'draw') {
    statusText = 'Draw!'; // Technically won't show because auto-restart is instant, but keeping just in case
  } else {
    statusText = amITurn ? `Your turn (${myMark})` : "Opponent's turn...";
  }

  const handleClick = (index: number) => {
    if (!gameState || gameState.board[index] || gameState.status !== 'playing' || !amITurn) return;

    if (isHost) {
      processMove(index, userId);
    } else {
      sendDataToPeers({ type: 'MOVE', index, userId });
    }
  };

  return (
    <div>
      <h1>TicTacToe</h1>
      
      <div>{statusText}</div>
      
      <div className="grid grid-cols-3 gap-1 w-max">
        {gameState.board.map((cellUserId, index) => {
          const mark = getDisplayMark(cellUserId);
          return (
            <button
              key={index}
              onClick={() => handleClick(index)}
              className="w-16 h-16 border border-black"
              disabled={!!cellUserId || gameState.status !== 'playing' || !amITurn}
            >
              {mark}
            </button>
          );
        })}
      </div>
    </div>
  );
}
