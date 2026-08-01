import { useState, useEffect, useRef } from 'react';
import type { GameProps } from '../GameProps';
import type { TicTacToeData, PlayerMark, GameStatus } from './types';
import { useNetworkStore } from '../../platform/store/useNetworkStore';
import { useUser } from '../../platform/store/useUserStore';
import { ExitButton } from '../components/ExitButton';

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

  // Handle guest dropping
  useEffect(() => {
    if (isHost && initialized.current) {
      // Safely determine if the opponent is still connected
      const otherPeers = peers.filter(p => p.id !== userId);
      
      // If total peers drop below 2 (or the specific guest drops), end the game
      if (peers.length < 2 || otherPeers.length === 0) {
        onGameEnd();
      }
    }
  }, [peers, isHost, userId, onGameEnd]);

  // Helper to determine player color (Host = Red, Guest = Blue)
  const getPlayerColor = (id: string | null) => {
    if (!id) return 'gray';
    if (id === userId) return isHost ? 'red' : 'blue';
    const peer = peers.find(p => p.id === id);
    if (peer) return peer.isHost ? 'red' : 'blue';
    return 'gray';
  };

  if (!gameState) {
    return (
      <div className="flex flex-1 items-center justify-center w-full h-full min-h-[var(--app-height,100dvh)] bg-slate-50">
        <div className="animate-pulse text-2xl font-black uppercase text-indigo-900 tracking-widest">Initializing Game...</div>
      </div>
    );
  }

  // --- Win/Loss Screen ---
  if (gameState.status === 'win') {
    const isWinner = gameState.winnerId === userId;
    const winnerColor = getPlayerColor(gameState.winnerId);
    const bgClass = winnerColor === 'red' ? 'bg-red-100' : 'bg-indigo-100';
    
    return (
      <div className={`flex flex-1 flex-col items-center justify-center w-full h-full min-h-[var(--app-height,100dvh)] animate-in fade-in zoom-in duration-300 transition-colors duration-500 ${bgClass} font-mono p-4`}>
        <div className="text-center mb-10 bg-white shadow-2xl rounded-3xl p-8 sm:p-10 w-full max-w-[400px]">
          <h1 className={`text-6xl sm:text-7xl font-black uppercase tracking-tight ${isWinner ? 'text-emerald-500' : 'text-red-500'}`}>
            {isWinner ? 'Victory!' : 'Defeat'}
          </h1>
        </div>
        
        {isHost ? (
          <div className="flex flex-col sm:flex-row gap-4 w-full max-w-[400px]">
            <button 
              onClick={onGameEnd}
              className="flex-1 bg-slate-100 text-indigo-900 rounded-2xl p-4 font-black text-xl uppercase cursor-pointer shadow-md hover:shadow-lg hover:bg-slate-200 active:scale-95 transition-all"
            >
              Quit
            </button>
            <button 
              onClick={handleRestart}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl p-4 font-black text-xl uppercase cursor-pointer shadow-md hover:shadow-lg active:scale-95 transition-all"
            >
              Play Again
            </button>
          </div>
        ) : (
          <div className="text-indigo-900/60 font-black text-xl uppercase animate-pulse mt-4 tracking-widest text-center">
            Waiting for Host...
          </div>
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
  const currentTurnColor = getPlayerColor(gameState.currentTurnId);

  let statusText = '';
  if (gameState.status === 'draw') {
    statusText = 'Draw!';
  } else {
    statusText = amITurn ? 'Your turn' : "Opponent's turn";
  }

  const handleClick = (index: number) => {
    if (!gameState || gameState.board[index] || gameState.status !== 'playing' || !amITurn) return;

    if (isHost) {
      processMove(index, userId);
    } else {
      sendDataToPeers({ type: 'MOVE', index, userId });
    }
  };

  const bgClass = currentTurnColor === 'red' ? 'bg-red-100' : 'bg-indigo-100';

  return (
    <div className={`flex flex-1 flex-col items-center justify-center w-full h-full min-h-[var(--app-height,100dvh)] transition-colors duration-500 font-mono ${bgClass} p-4 relative`}>
      {isHost && <ExitButton onExit={onGameEnd} />}
      {/* Header section */}
      <div className="mb-10 flex flex-col items-center justify-center space-y-2">
        <div className={`px-8 py-4 rounded-2xl font-black text-xl uppercase transition-colors duration-300 shadow-lg
          ${currentTurnColor === 'red' 
            ? 'bg-red-400 text-white' 
            : 'bg-indigo-600 text-white'
          }
          ${!amITurn ? 'opacity-80 scale-95 shadow-md' : ''}
        `}>
          {statusText} {amITurn && <span className="ml-2 opacity-90">({myMark})</span>}
        </div>
      </div>
      
      {/* Board */}
      <div className="bg-white/60 backdrop-blur-md shadow-2xl p-4 sm:p-6 rounded-[2.5rem]">
        <div className="grid grid-cols-3 gap-3 sm:gap-4 w-max">
          {gameState.board.map((cellUserId, index) => {
            const mark = getDisplayMark(cellUserId);
            const markColor = getPlayerColor(cellUserId);
            const textClass = markColor === 'red' ? 'text-red-500' : 'text-indigo-600';
            
            // Generate interactive classes for empty buttons when it's our turn
            const isInteractive = !mark && amITurn && gameState.status === 'playing';
            const interactiveClasses = isInteractive 
              ? 'bg-slate-50 hover:bg-red-50 active:translate-y-[6px] shadow-[0_6px_0_theme(colors.indigo.900)] active:shadow-[0_0px_0_theme(colors.indigo.900)] cursor-pointer' 
              : 'bg-slate-50/50 cursor-default shadow-[0_6px_0_theme(colors.indigo.900)]';
              
            // Pressed state for filled marks
            const filledClasses = mark 
              ? 'bg-white translate-y-[6px] shadow-[0_0px_0_theme(colors.indigo.900)] cursor-default' 
              : '';
            
            return (
              <button
                key={index}
                onClick={() => handleClick(index)}
                className={`w-24 h-24 sm:w-32 sm:h-32 rounded-3xl flex items-center justify-center text-7xl font-black uppercase transition-all duration-150 border-[3px] border-indigo-900
                  ${mark ? filledClasses : interactiveClasses}
                `}
                disabled={!!cellUserId || gameState.status !== 'playing' || !amITurn}
              >
                {mark && (
                  <span className={`transform transition-all duration-300 animate-in zoom-in spin-in-12 ${textClass} drop-shadow-md`}>
                    {mark}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
