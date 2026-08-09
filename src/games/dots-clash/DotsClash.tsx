import { useState, useEffect, useRef } from 'react';
import type { GameProps } from '../GameProps';
import type { DotsClashData, CellState, GameStatus } from './types';
import { useNetworkStore } from '../../platform/store/useNetworkStore';
import { useUser } from '../../platform/store/useUserStore';
import { ExitButton } from '../components/ExitButton';

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
    isResolving: boolean;
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
        winnerId: null,
        isResolving: false
      };

      setGameState(initialSync as any);
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
      winnerId: null,
      isResolving: false
    };

    setGameState(newSync as any);
    sendDataToPeers(newSync);
  };

  const processMove = (row: number, col: number, moveUserId: string) => {
    setGameState(currentState => {
      if (!currentState || currentState.status !== 'playing' || currentState.currentTurnId !== moveUserId || currentState.isResolving) {
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

      const nextState = {
        ...currentState,
        board: newBoard,
        spawns: nextSpawns,
        isResolving: true // Trigger animation chain
      };

      sendDataToPeers({
        type: 'SYNC',
        ...nextState
      });

      return nextState;
    });
  };

  // Chain Reaction Animation Effect
  useEffect(() => {
    if (!isHost || !gameState || gameState.status !== 'playing' || !gameState.isResolving) return;

    const timer = setTimeout(() => {
      setGameState(currentState => {
        if (!currentState || currentState.status !== 'playing') return currentState;

        const newBoard = currentState.board.map(r => r.map(c => ({ ...c })));
        const rows = newBoard.length;
        const cols = newBoard[0].length;

        const explodingCells: { r: number, c: number, ownerId: string }[] = [];

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (newBoard[r][c].dots >= 4) {
              explodingCells.push({ r, c, ownerId: newBoard[r][c].ownerId! });
            }
          }
        }

        if (explodingCells.length > 0) {
          for (const { r, c, ownerId } of explodingCells) {
            newBoard[r][c].dots -= 4;
            if (newBoard[r][c].dots === 0) {
              newBoard[r][c].ownerId = null;
            }

            const neighbors = [
              [(r - 1 + rows) % rows, c], // Up
              [(r + 1) % rows, c],        // Down
              [r, (c - 1 + cols) % cols], // Left
              [r, (c + 1) % cols]         // Right
            ];

            for (const [nr, nc] of neighbors) {
              newBoard[nr][nc].dots += 1;
              newBoard[nr][nc].ownerId = ownerId;
            }
          }
        }

        const hasMoreExplosions = newBoard.some(r => r.some(c => c.dots >= 4));

        let status: GameStatus = currentState.status;
        let winnerId = currentState.winnerId;
        let nextTurnIndex = currentState.turnIndex;
        let nextTurnCount = currentState.turnCount;
        let isResolving = true;

        // Check for win condition even during explosions to prevent infinite loops
        const playerDots: Record<string, number> = {};
        currentState.players.forEach(p => { playerDots[p.id] = 0; });

        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (newBoard[r][c].ownerId) {
              playerDots[newBoard[r][c].ownerId!] += 1;
            }
          }
        }

        const effectiveTurnCount = currentState.turnCount + 1;
        const activePlayers = currentState.players.filter(p => {
          if (effectiveTurnCount < currentState.players.length) return true;
          return playerDots[p.id] > 0;
        });

        const isGameOver = effectiveTurnCount >= currentState.players.length && activePlayers.length <= 1;

        if (isGameOver) {
          status = 'win';
          winnerId = activePlayers.length === 1 ? activePlayers[0].id : null;
          isResolving = false; // Stop explosions immediately
          nextTurnCount = effectiveTurnCount;
        } else if (!hasMoreExplosions) {
          isResolving = false;
          nextTurnCount = effectiveTurnCount;

          nextTurnIndex = (currentState.turnIndex + 1) % currentState.players.length;
          if (status === 'playing') {
            while (!activePlayers.find(p => p.id === currentState.players[nextTurnIndex].id)) {
              nextTurnIndex = (nextTurnIndex + 1) % currentState.players.length;
            }
          }
        }

        const nextState = {
          ...currentState,
          board: newBoard,
          turnIndex: nextTurnIndex,
          turnCount: nextTurnCount,
          currentTurnId: currentState.players[nextTurnIndex].id,
          status,
          winnerId,
          isResolving
        };

        sendDataToPeers({
          type: 'SYNC',
          ...nextState
        });

        return nextState;
      });
    }, 350); // Delay between explosion steps

    return () => clearTimeout(timer);
  }, [gameState?.isResolving, gameState?.board, isHost, sendDataToPeers]);

  useEffect(() => {
    if (incomingData?.type === 'SYNC') {
      const { type, ...state } = incomingData;
      setGameState(state as any);
    } else if (incomingData?.type === 'MOVE' && isHost) {
      processMove(incomingData.row, incomingData.col, incomingData.userId);
    }
  }, [incomingData, isHost]);

  const handleClick = (row: number, col: number) => {
    if (!gameState || gameState.status !== 'playing' || gameState.isResolving) return;
    const amITurn = gameState.currentTurnId === userId;
    if (!amITurn) return;

    if (isHost) {
      processMove(row, col, userId);
    } else {
      sendDataToPeers({ type: 'MOVE', row, col, userId });
    }
  };

  const getPlayerTheme = (id: string | null) => {
    if (!id || !gameState) return {
      bg: 'bg-slate-50',
      dot: 'bg-slate-400',
      text: 'text-slate-600',
      pillBg: 'bg-slate-400',
      cellRing: 'ring-slate-200',
      indicatorLight: 'bg-slate-200 border-slate-300',
      textLight: 'text-slate-700',
      indicatorDark: 'bg-slate-500 border-slate-700'
    };
    const idx = gameState.players.findIndex(p => p.id === id);
    const themes = [
      { bg: 'bg-indigo-100', dot: 'bg-indigo-500', text: 'text-indigo-600', pillBg: 'bg-indigo-600', cellRing: 'ring-indigo-200', indicatorLight: 'bg-indigo-200 border-indigo-300', textLight: 'text-indigo-700', indicatorDark: 'bg-indigo-500 border-indigo-700' },
      { bg: 'bg-rose-100', dot: 'bg-rose-500', text: 'text-rose-600', pillBg: 'bg-rose-600', cellRing: 'ring-rose-200', indicatorLight: 'bg-rose-200 border-rose-300', textLight: 'text-rose-700', indicatorDark: 'bg-rose-500 border-rose-700' },
      { bg: 'bg-emerald-100', dot: 'bg-emerald-500', text: 'text-emerald-600', pillBg: 'bg-emerald-600', cellRing: 'ring-emerald-200', indicatorLight: 'bg-emerald-200 border-emerald-300', textLight: 'text-emerald-700', indicatorDark: 'bg-emerald-500 border-emerald-700' },
      { bg: 'bg-amber-100', dot: 'bg-amber-500', text: 'text-amber-600', pillBg: 'bg-amber-600', cellRing: 'ring-amber-200', indicatorLight: 'bg-amber-200 border-amber-300', textLight: 'text-amber-700', indicatorDark: 'bg-amber-500 border-amber-700' },
    ];
    return themes[idx % themes.length];
  };

  if (!gameState) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center w-full h-full min-h-[var(--app-height,100dvh)] bg-slate-50">
        <div className="animate-pulse text-2xl font-black uppercase text-indigo-900 tracking-widest">Initializing Game...</div>
      </div>
    );
  }

  // --- Win/Loss Screen ---
  if (gameState.status === 'win') {
    const isWinner = gameState.winnerId === userId;
    const winnerTheme = getPlayerTheme(gameState.winnerId);

    return (
      <div className={`flex flex-1 flex-col items-center justify-center w-full h-full min-h-[var(--app-height,100dvh)] animate-in fade-in zoom-in duration-300 transition-colors duration-500 ${winnerTheme.bg} font-sans p-4`}>
        <div className="text-center mb-10 bg-white shadow-2xl rounded-3xl p-8 sm:p-10 w-full max-w-[400px]">
          <h1 className={`text-5xl sm:text-6xl font-black uppercase tracking-tight ${isWinner ? winnerTheme.text : 'text-slate-500'}`}>
            {isWinner ? 'Victory!' : 'Defeat'}
          </h1>
          <p className="text-slate-600 font-bold mt-4 text-lg uppercase tracking-wider">
            {isWinner ? 'You conquered the board!' : 'You have been eliminated.'}
          </p>
        </div>

        {isHost ? (
          <div className="flex flex-col sm:flex-row gap-4 w-full max-w-[400px]">
            <button
              onClick={onGameEnd}
              className="flex-1 bg-white text-slate-800 rounded-2xl p-4 font-black text-xl uppercase cursor-pointer shadow hover:shadow-md hover:bg-slate-50 active:scale-95 transition-all"
            >
              Quit
            </button>
            <button
              onClick={handleRestart}
              className={`flex-1 ${winnerTheme.pillBg} text-white rounded-2xl p-4 font-black text-xl uppercase cursor-pointer shadow-md hover:shadow-lg active:scale-95 transition-all`}
            >
              Play Again
            </button>
          </div>
        ) : (
          <div className="text-slate-500 font-black text-xl uppercase animate-pulse mt-4 tracking-widest text-center">
            Waiting for Host...
          </div>
        )}
      </div>
    );
  }

  // --- Game Board Screen ---
  const amITurn = gameState.currentTurnId === userId;
  const mySpawns = gameState.spawns[userId] || 0;
  const currentTurnTheme = getPlayerTheme(gameState.currentTurnId);

  return (
    <div className={`flex flex-col w-full h-full min-h-[var(--app-height,100dvh)] transition-colors duration-500 font-sans ${currentTurnTheme.bg} relative overflow-hidden`}>
      {isHost && <ExitButton onExit={onGameEnd} />}

      {/* Unified Morphing Turn Indicator (Absolute positioned so it doesn't affect document flow) */}
      <div className="absolute top-0 left-0 w-full flex justify-center z-10 pointer-events-none">
        <div
          className={`
            transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)] 
            flex flex-col items-center justify-end
            ${amITurn
              ? `w-[280px] h-[90px] sm:w-[340px] sm:h-[100px] rounded-b-[100%] shadow-[0_15px_30px_rgba(0,0,0,0.3)] border-b-8 border-x-8 ${currentTurnTheme.indicatorDark} pb-3 sm:pb-4`
              : `w-[220px] h-[60px] sm:w-[260px] sm:h-[70px] rounded-b-[100%] shadow-md border-b-4 border-x-4 ${currentTurnTheme.indicatorLight} pb-2 opacity-80 -translate-y-2`
            }
          `}
        >
          <span
            className={`
              transition-all duration-700 uppercase font-black tracking-widest
              ${amITurn
                ? 'text-white text-2xl sm:text-3xl drop-shadow-md'
                : `${currentTurnTheme.textLight} text-base sm:text-lg`
              }
            `}
          >
            {amITurn ? "Your Turn" : "Opponent"}
          </span>

          {/* Spawns container that smoothly collapses when not user's turn */}
          <div className={`transition-all duration-700 overflow-hidden ${amITurn ? 'max-h-12 opacity-100 mt-1' : 'max-h-0 opacity-0 mt-0'}`}>
            {mySpawns > 0 ? (
              <span className="text-white/90 font-bold text-sm sm:text-base drop-shadow-md animate-pulse">
                (Spawns: {mySpawns})
              </span>
            ) : (
              <span className="text-white/80 font-bold text-sm sm:text-base drop-shadow-md">
                (No Spawns)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Board Container (responsive, single screen fit, perfect squares) */}
      <div className="flex-1 w-full mx-auto flex flex-col items-center justify-center p-2 sm:p-4 mt-[90px] sm:mt-[100px] mb-2 sm:mb-4 min-h-0">
        <div
          className="grid w-full h-full max-w-[700px] gap-1.5 sm:gap-2 md:gap-3"
          style={{
            gridTemplateColumns: `repeat(${gameState.board[0].length}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${gameState.board.length}, minmax(0, 1fr))`,
            aspectRatio: `${gameState.board[0].length} / ${gameState.board.length}`,
            maxHeight: 'calc(100dvh - 140px)',
            maxWidth: `calc((100dvh - 140px) * ${gameState.board[0].length / gameState.board.length})`
          }}
        >
          {gameState.board.flatMap((row, rIndex) =>
            row.map((cell, cIndex) => {
              const cellTheme = getPlayerTheme(cell.ownerId);
              const isMyCell = cell.ownerId === userId;
              const isEmpty = cell.dots === 0;
              const canSpawn = isEmpty && mySpawns > 0;
              const canMove = amITurn && (isMyCell || canSpawn);

              // Pure clean modern button style
              const isInteractive = canMove;
              const interactiveClasses = isInteractive
                ? `bg-white hover:bg-slate-50 active:scale-95 cursor-pointer shadow-sm hover:shadow-md ring-2 ${cellTheme.cellRing} z-10`
                : `bg-white/80 cursor-default ring-1 ring-slate-200/80`;

              return (
                <button
                  key={`${rIndex}-${cIndex}`}
                  onClick={() => handleClick(rIndex, cIndex)}
                  disabled={!canMove}
                  className={`w-full h-full rounded-lg sm:rounded-xl md:rounded-2xl flex items-center justify-center transition-all duration-300 ${interactiveClasses} relative overflow-hidden group`}
                >
                  {cell.dots > 0 && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="flex flex-wrap items-center justify-center content-center gap-[10%] w-[62%] h-[62%]">
                        {Array.from({ length: cell.dots }).map((_, i) => (
                          <div
                            key={i}
                            className={`w-[38%] h-[38%] rounded-full ${cellTheme.dot} shadow-sm transform transition-all animate-in zoom-in duration-300`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
