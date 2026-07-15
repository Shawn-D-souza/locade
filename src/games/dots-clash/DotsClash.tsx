import { useState, useEffect, useRef } from 'react';
import type { GameProps } from '../GameProps';
import type { DotsClashData, CellState, GameStatus } from './types';
import { useNetworkStore } from '../../platform/store/useNetworkStore';
import { useUser } from '../../platform/store/useUserStore';

export default function DotsClash({ sendDataToPeers, incomingData, onGameEnd }: GameProps<DotsClashData>) {
  const { isHost, peers } = useNetworkStore();
  const { userId } = useUser();

  const [gameState, setGameState] = useState<{
    board: CellState[][];
    players: { id: string }[];
    spawns: Record<string, number>;
    turnIndex: number;
    turnCount: number;
    currentTurnId: string;
    status: GameStatus;
    winnerId: string | null;
  } | null>(null);

  const initialized = useRef(false);

  // Initialize Game (Host only)
  useEffect(() => {
    if (isHost && peers.length > 0 && !initialized.current) {
      const otherPeers = peers.filter(p => p.id !== userId);
      if (otherPeers.length === 0) return; // Wait for guests

      initialized.current = true;
      const allPlayers = [userId, ...otherPeers.map(p => p.id)].map(id => ({ id }));
      
      const numPlayers = allPlayers.length;
      const cols = 6;
      const rows = numPlayers > 2 ? 8 : 6;

      const board: CellState[][] = Array(rows).fill(null).map(() => 
        Array(cols).fill(null).map(() => ({ dots: 0, ownerId: null }))
      );

      const spawns: Record<string, number> = {};
      allPlayers.forEach(p => { spawns[p.id] = 3; });

      const initialSync: DotsClashData = {
        type: 'SYNC',
        board,
        players: allPlayers,
        spawns,
        turnIndex: 0,
        turnCount: 0,
        currentTurnId: allPlayers[0].id,
        status: 'playing',
        winnerId: null
      };

      setGameState(initialSync);
      sendDataToPeers(initialSync);
    }
  }, [isHost, peers, userId, sendDataToPeers]);

  const handleRestart = () => {
    if (!isHost) return;
    const otherPeers = peers.filter(p => p.id !== userId);
    if (otherPeers.length === 0) return;

    const allPlayers = [userId, ...otherPeers.map(p => p.id)].map(id => ({ id }));
    const numPlayers = allPlayers.length;
    const cols = 6;
    const rows = numPlayers > 2 ? 8 : 6;
    const board = Array(rows).fill(null).map(() => 
      Array(cols).fill(null).map(() => ({ dots: 0, ownerId: null }))
    );
    const spawns: Record<string, number> = {};
    allPlayers.forEach(p => { spawns[p.id] = 3; });

    const newSync: DotsClashData = {
      type: 'SYNC',
      board,
      players: allPlayers,
      spawns,
      turnIndex: 0,
      turnCount: 0,
      currentTurnId: allPlayers[0].id,
      status: 'playing',
      winnerId: null
    };

    setGameState(newSync);
    sendDataToPeers(newSync);
  };

  const processMove = (row: number, col: number, moveUserId: string) => {
    setGameState(currentState => {
      if (!currentState || currentState.status !== 'playing' || currentState.currentTurnId !== moveUserId) {
        return currentState;
      }

      const cell = currentState.board[row][col];
      const playerSpawns = currentState.spawns[moveUserId];
      
      let isValidMove = false;
      const nextSpawns = { ...currentState.spawns };

      if (cell.ownerId === null || cell.dots === 0) {
        // Place on empty cell (costs 1 spawn)
        if (playerSpawns > 0) {
          isValidMove = true;
          nextSpawns[moveUserId] = playerSpawns - 1;
        }
      } else if (cell.ownerId === moveUserId) {
        // Place on own cell (does not cost spawn)
        isValidMove = true;
      }

      if (!isValidMove) return currentState;

      const newBoard = currentState.board.map(r => r.map(c => ({ ...c })));
      
      newBoard[row][col].dots += 1;
      newBoard[row][col].ownerId = moveUserId;

      const rows = newBoard.length;
      const cols = newBoard[0].length;
      
      let exploded = true;
      let iterations = 0;
      const maxIterations = 1000; // safety net for infinite loops
      
      while (exploded && iterations < maxIterations) {
        exploded = false;
        iterations++;
        
        const explodingCells: {r: number, c: number, ownerId: string}[] = [];
        
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (newBoard[r][c].dots >= 4) {
              explodingCells.push({ r, c, ownerId: newBoard[r][c].ownerId! });
            }
          }
        }
        
        if (explodingCells.length > 0) {
          exploded = true;
          for (const { r, c, ownerId } of explodingCells) {
            // Reset the exploding cell
            newBoard[r][c].dots -= 4;
            if (newBoard[r][c].dots === 0) {
              newBoard[r][c].ownerId = null;
            }
            
            // Distribute to neighbors with grid wrapping
            const neighbors = [
              [(r - 1 + rows) % rows, c], // Up
              [(r + 1) % rows, c],        // Down
              [r, (c - 1 + cols) % cols], // Left
              [r, (c + 1) % cols]         // Right
            ];
            
            for (const [nr, nc] of neighbors) {
              newBoard[nr][nc].dots += 1;
              newBoard[nr][nc].ownerId = ownerId; // Takes ownership instantly
            }
          }
        }
      }

      const nextTurnCount = currentState.turnCount + 1;

      // Check elimination and winning conditions
      const playerDots: Record<string, number> = {};
      currentState.players.forEach(p => { playerDots[p.id] = 0; });
      
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (newBoard[r][c].ownerId) {
            playerDots[newBoard[r][c].ownerId!] += 1;
          }
        }
      }

      const activePlayers = currentState.players.filter(p => {
        // If everyone hasn't taken at least one turn, no one is eliminated
        if (nextTurnCount < currentState.players.length) return true;
        // Eliminated if 0 dots left on the board
        return playerDots[p.id] > 0;
      });

      let status: GameStatus = currentState.status;
      let winnerId = currentState.winnerId;

      if (nextTurnCount >= currentState.players.length && activePlayers.length <= 1) {
        status = 'win';
        winnerId = activePlayers.length === 1 ? activePlayers[0].id : null;
      }

      let nextTurnIndex = (currentState.turnIndex + 1) % currentState.players.length;
      
      // Skip eliminated players
      if (status === 'playing') {
        while (!activePlayers.find(p => p.id === currentState.players[nextTurnIndex].id)) {
          nextTurnIndex = (nextTurnIndex + 1) % currentState.players.length;
        }
      }
      
      const nextState = {
        ...currentState,
        board: newBoard,
        spawns: nextSpawns,
        turnIndex: nextTurnIndex,
        turnCount: nextTurnCount,
        currentTurnId: currentState.players[nextTurnIndex].id,
        status,
        winnerId
      };

      sendDataToPeers({
        type: 'SYNC',
        ...nextState
      });

      return nextState;
    });
  };

  useEffect(() => {
    if (incomingData?.type === 'SYNC') {
      const { type, ...state } = incomingData;
      setGameState(state);
    } else if (incomingData?.type === 'MOVE' && isHost) {
      processMove(incomingData.row, incomingData.col, incomingData.userId);
    }
  }, [incomingData, isHost]);

  const handleClick = (row: number, col: number) => {
    if (!gameState || gameState.status !== 'playing') return;
    const amITurn = gameState.currentTurnId === userId;
    if (!amITurn) return;

    if (isHost) {
      processMove(row, col, userId);
    } else {
      sendDataToPeers({ type: 'MOVE', row, col, userId });
    }
  };

  const getPlayerColor = (id: string | null) => {
    if (!id || !gameState) return 'transparent';
    const idx = gameState.players.findIndex(p => p.id === id);
    const colors = ['bg-indigo-500', 'bg-rose-500', 'bg-emerald-500', 'bg-amber-500'];
    return colors[idx % colors.length] || 'bg-slate-500';
  };

  if (!gameState) {
    return (
      <div className="flex flex-1 items-center justify-center w-full h-full min-h-[100dvh] bg-slate-50">
        <div className="animate-pulse text-xl font-bold text-slate-500">Initializing Game...</div>
      </div>
    );
  }

  // --- Win Screen ---
  if (gameState.status === 'win') {
    const isWinner = gameState.winnerId === userId;
    
    return (
      <div className={`flex flex-1 flex-col items-center justify-center w-full h-full min-h-[100dvh] bg-slate-50 p-4 font-sans select-none touch-none animate-in fade-in zoom-in duration-500`}>
        <div className="bg-white p-8 sm:p-12 rounded-[2.5rem] shadow-2xl text-center max-w-md w-full border border-slate-200">
          <h1 className={`text-5xl sm:text-6xl font-black mb-4 tracking-tight ${isWinner ? 'text-emerald-500' : 'text-rose-500'}`}>
            {isWinner ? 'VICTORY!' : 'DEFEAT'}
          </h1>
          <p className="text-slate-600 font-bold mb-10 text-lg">
            {isWinner ? 'You conquered the board!' : 'You have been eliminated.'}
          </p>
          {isHost ? (
            <div className="flex flex-col sm:flex-row gap-4">
              <button 
                onClick={onGameEnd}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-2xl p-4 font-black text-xl transition-all shadow-sm hover:shadow-md active:scale-95"
              >
                Quit
              </button>
              <button 
                onClick={handleRestart}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl p-4 font-black text-xl transition-all shadow-md hover:shadow-lg active:scale-95"
              >
                Play Again
              </button>
            </div>
          ) : (
            <div className="text-slate-400 font-black text-xl animate-pulse mt-4">
              Waiting for Host...
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- Playing Screen ---
  const amITurn = gameState.currentTurnId === userId;
  const mySpawns = gameState.spawns[userId] || 0;

  return (
    <div className="flex flex-1 flex-col items-center justify-center w-full h-full min-h-[100dvh] bg-slate-50 p-4 font-sans select-none touch-none">
      <div className="mb-6 flex flex-col items-center gap-2">
        <h1 className="text-3xl font-black text-slate-800 tracking-tight">Dots Clash</h1>
        <div className={`px-6 py-2 rounded-full font-bold text-white shadow-md transition-colors duration-300
          ${amITurn ? 'bg-indigo-600 ring-4 ring-indigo-200' : 'bg-slate-400'}`}>
          {amITurn ? 'Your Turn' : "Waiting for Opponent..."}
        </div>
        <div className="text-sm font-bold text-slate-600 bg-white px-4 py-1 rounded-full shadow-sm border border-slate-200 mt-2">
          Spawns Remaining: <span className="text-indigo-600 text-base">{mySpawns}</span>
        </div>
      </div>
      
      <div className="bg-white/80 backdrop-blur-sm p-4 sm:p-6 rounded-3xl shadow-xl border border-slate-200">
        <div className="flex flex-col gap-2">
          {gameState.board.map((row, rIndex) => (
            <div key={rIndex} className="flex gap-2">
              {row.map((cell, cIndex) => {
                const dotColor = getPlayerColor(cell.ownerId);
                const isMyCell = cell.ownerId === userId;
                const canSpawn = cell.dots === 0 && mySpawns > 0;
                const canMove = amITurn && (isMyCell || canSpawn);
                
                return (
                  <button 
                    key={cIndex}
                    onClick={() => handleClick(rIndex, cIndex)}
                    disabled={!canMove}
                    className={`w-12 h-12 sm:w-16 sm:h-16 rounded-xl flex items-center justify-center relative transition-all duration-200
                      ${cell.dots === 0 ? 'bg-slate-50 hover:bg-slate-100 border-2 border-slate-200' : 'bg-slate-100/50 border-2 border-slate-300 shadow-inner'}
                      ${canMove && amITurn ? 'cursor-pointer hover:border-indigo-400 hover:scale-105 active:scale-95' : 'cursor-default opacity-80'}
                    `}
                  >
                    {cell.dots > 0 && (
                      <div className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full ${dotColor} flex items-center justify-center text-white font-black shadow-md transform transition-all animate-in zoom-in spin-in-12`}>
                        {cell.dots}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
