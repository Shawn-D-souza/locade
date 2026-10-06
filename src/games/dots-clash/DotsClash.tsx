import { useState, useEffect, useRef } from 'react';
import type { GameProps } from '../GameProps';
import type { DotsClashData, DotsClashState, DotsClashSync, CellState, GameStatus } from './types';
import { useNetworkStore } from '../../platform/store/useNetworkStore';
import { useUser } from '../../platform/store/useUserStore';
import { ExitButton } from '../components/ExitButton';
import { feedback } from '../../platform/feedback/feedbackManager';

export default function DotsClash({ sendDataToPeers, incomingData, onGameEnd }: GameProps<DotsClashData>) {
  const { isHost, peers } = useNetworkStore();
  const { userId } = useUser();
  const prevWinStateRef = useRef<boolean>(false);


  const [gameState, setGameState] = useState<DotsClashState | null>(null);

  useEffect(() => {
    if (gameState?.status === 'win' && !prevWinStateRef.current) {
      prevWinStateRef.current = true;
      if (gameState.winnerId === userId) {
        feedback.win();
      } else {
        feedback.lose();
      }
    } else if (gameState?.status !== 'win') {
      prevWinStateRef.current = false;
    }
  }, [gameState?.status, gameState?.winnerId, userId]);

  const prevBoardRef = useRef<CellState[][] | null>(null);
  useEffect(() => {
    if (gameState?.board) {
      if (prevBoardRef.current) {
        let exploded = false;
        const prevBoard = prevBoardRef.current;
        for (let r = 0; r < prevBoard.length; r++) {
          for (let c = 0; c < prevBoard[0].length; c++) {
            if (prevBoard[r][c].dots >= 4 && gameState.board[r][c].dots < 4) {
              exploded = true;
            }
          }
        }
        if (exploded) {
          feedback.boop();
        }
      }
      prevBoardRef.current = gameState.board;
    }
  }, [gameState?.board]);

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

      const initialSync: DotsClashSync = {
        type: 'SYNC',
        board,
        players: allPlayers,
        spawns,
        droppedIds: [],
        turnIndex: 0,
        turnCount: 0,
        currentTurnId: allPlayers[0].id,
        status: 'playing',
        winnerId: null,
        isResolving: false
      };

      setGameState(initialSync);
      sendDataToPeers(initialSync);
    }
  }, [isHost, peers, userId, sendDataToPeers]);

  const handleRestart = () => {
    if (!isHost) return;
    feedback.tap();
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

    const newSync: DotsClashSync = {
      type: 'SYNC',
      board,
      players: allPlayers,
      spawns,
      droppedIds: [],
      turnIndex: 0,
      turnCount: 0,
      currentTurnId: allPlayers[0].id,
      status: 'playing',
      winnerId: null,
      isResolving: false
    };

    setGameState(newSync);
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
        // Who can still win. Deliberately ignores droppedIds: a player who is
        // merely reconnecting must not hand victory to the other side, which
        // would collapse a two-player game on a 2-second WiFi blip.
        const contenders = currentState.players.filter(p => {
          if (effectiveTurnCount < currentState.players.length) return true;
          return playerDots[p.id] > 0;
        });

        const isGameOver = effectiveTurnCount >= currentState.players.length && contenders.length <= 1;

        if (isGameOver) {
          status = 'win';
          winnerId = contenders.length === 1 ? contenders[0].id : null;
          isResolving = false; // Stop explosions immediately
          nextTurnCount = effectiveTurnCount;
        } else if (!hasMoreExplosions) {
          isResolving = false;
          nextTurnCount = effectiveTurnCount;

          // Who can actually take a turn right now. An absent player holds the
          // turn forever otherwise, since nobody can move on their behalf.
          const turnEligible = contenders.filter(p => !currentState.droppedIds.includes(p.id));
          const n = currentState.players.length;
          nextTurnIndex = (currentState.turnIndex + 1) % n;

          if (status === 'playing' && turnEligible.length > 0) {
            // Bounded scan: an unbounded search spins the tab if nobody is eligible.
            for (let i = 0; i < n; i++) {
              if (turnEligible.some(p => p.id === currentState.players[nextTurnIndex].id)) break;
              nextTurnIndex = (nextTurnIndex + 1) % n;
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
    }, 550); // Delay between explosion steps

    return () => clearTimeout(timer);
  }, [gameState?.isResolving, gameState?.board, isHost, sendDataToPeers]);

  useEffect(() => {
    if (incomingData?.type === 'SYNC') {
      const { type, ...state } = incomingData;
      setGameState(state);
    } else if (incomingData?.type === 'MOVE' && isHost) {
      processMove(incomingData.row, incomingData.col, incomingData.userId);
    }
  }, [incomingData, isHost]);

  // ── Players leaving and returning mid-game (host only) ─────────────────────
  useEffect(() => {
    if (!isHost || !initialized.current || !gameState) return;
    if (gameState.status !== 'playing') return;

    // Derived from the roster rather than accumulated, so a player who
    // reconnects is un-benched by the same pass that benched them. A peer with
    // `connected: false` is inside their grace window: skipped by the rotation
    // so the game doesn't stall, but still seated, with their cells untouched.
    const playable = new Set(peers.filter(p => p.connected).map(p => p.id));
    const seated = new Set(peers.map(p => p.id));

    const droppedIds = gameState.players.filter(p => !playable.has(p.id)).map(p => p.id);

    const unchanged =
      droppedIds.length === gameState.droppedIds.length &&
      droppedIds.every(id => gameState.droppedIds.includes(id));
    if (unchanged) return;

    // Only end the game once the host has actually released a seat.
    if (gameState.players.filter(p => seated.has(p.id)).length < 2) {
      onGameEnd();
      return;
    }

    let { turnIndex, currentTurnId } = gameState;
    // Hand the turn on if the player holding it just went away. Mid-explosion
    // drops resolve themselves when the chain finishes and rotates.
    if (droppedIds.includes(currentTurnId) && !gameState.isResolving) {
      const n = gameState.players.length;
      for (let i = 0; i < n; i++) {
        turnIndex = (turnIndex + 1) % n;
        if (!droppedIds.includes(gameState.players[turnIndex].id)) break;
      }
      currentTurnId = gameState.players[turnIndex].id;
    }

    const nextState = { ...gameState, droppedIds, turnIndex, currentTurnId };
    setGameState(nextState);
    sendDataToPeers({ type: 'SYNC', ...nextState });
  }, [peers, isHost, gameState, onGameEnd, sendDataToPeers]);

  const handleClick = (row: number, col: number) => {
    if (!gameState || gameState.status !== 'playing' || gameState.isResolving) return;
    const amITurn = gameState.currentTurnId === userId;
    if (!amITurn) return;

    feedback.pop();

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
              onClick={() => {
                feedback.tap();
                onGameEnd();
              }}
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

  const explosionCSS = `
    @keyframes explode-y {
      0% { transform: translateY(0); }
      27% { transform: translateY(0); animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
      100% { transform: translateY(calc(var(--explode-n) * (424.5% + 8px))); }
    }
    @keyframes explode-x {
      0% { transform: translateX(0); }
      27% { transform: translateX(0); animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
      100% { transform: translateX(calc(var(--explode-n) * (424.5% + 8px))); }
    }
    @keyframes explode-y-ghost {
      0% { transform: translateY(calc(var(--ghost-start) * (424.5% + 8px))); }
      27% { transform: translateY(calc(var(--ghost-start) * (424.5% + 8px))); animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
      100% { transform: translateY(calc(var(--ghost-end) * (424.5% + 8px))); }
    }
    @keyframes explode-x-ghost {
      0% { transform: translateX(calc(var(--ghost-start) * (424.5% + 8px))); }
      27% { transform: translateX(calc(var(--ghost-start) * (424.5% + 8px))); animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1); }
      100% { transform: translateX(calc(var(--ghost-end) * (424.5% + 8px))); }
    }
  `;

  return (
    <div className={`flex flex-col w-full h-full min-h-[var(--app-height,100dvh)] transition-colors duration-500 font-sans ${currentTurnTheme.bg} relative overflow-hidden`}>
      <style>{explosionCSS}</style>
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
          className="grid w-full h-full max-w-[700px] gap-[8px]"
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
              
              let outlineClasses: string;
              if (cell.dots >= 4) {
                outlineClasses = `ring-4 ${cellTheme.cellRing} ring-offset-1 z-20 shadow-lg`;
              } else if (isInteractive) {
                outlineClasses = `ring-2 ${cellTheme.cellRing} z-10`;
              } else {
                outlineClasses = `ring-1 ring-slate-200/80`;
              }

              const interactiveClasses = isInteractive
                ? `bg-white hover:bg-slate-50 active:scale-95 cursor-pointer shadow-sm hover:shadow-md`
                : `bg-white/80 cursor-default`;

              return (
                <button
                  key={`${rIndex}-${cIndex}`}
                  onClick={() => handleClick(rIndex, cIndex)}
                  disabled={!canMove}
                  className={`w-full h-full rounded-lg sm:rounded-xl md:rounded-2xl flex items-center justify-center transition-all duration-300 ${interactiveClasses} ${outlineClasses} relative overflow-visible group`}
                >
                  {cell.dots > 0 && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30">
                      <div className={`relative flex flex-wrap items-center justify-center content-center gap-[10%] w-[62%] h-[62%]`}>
                        {Array.from({ length: cell.dots }).map((_, i) => {
                          if (cell.dots >= 4) {
                            const dir = i % 4;
                            const rows = gameState.board.length;
                            const cols = gameState.board[0].length;
                            
                            let moveN = 0;
                            let isX = false;
                            
                            let isEdge = false;
                            let ghostStart = 0;
                            let ghostEnd = 0;
                            
                            if (dir === 0) { // UP
                              moveN = -1;
                              isX = false;
                              if (rIndex === 0) {
                                isEdge = true;
                                ghostStart = rows;
                                ghostEnd = rows - 1;
                              }
                            } else if (dir === 1) { // RIGHT
                              moveN = 1;
                              isX = true;
                              if (cIndex === cols - 1) {
                                isEdge = true;
                                ghostStart = -cols;
                                ghostEnd = -(cols - 1);
                              }
                            } else if (dir === 2) { // LEFT
                              moveN = -1;
                              isX = true;
                              if (cIndex === 0) {
                                isEdge = true;
                                ghostStart = cols;
                                ghostEnd = cols - 1;
                              }
                            } else if (dir === 3) { // DOWN
                              moveN = 1;
                              isX = false;
                              if (rIndex === rows - 1) {
                                isEdge = true;
                                ghostStart = -rows;
                                ghostEnd = -(rows - 1);
                              }
                            }
                            
                            const animName = isX ? 'explode-x' : 'explode-y';
                                             
                            return (
                              <div key={i} className="relative w-[38%] h-[38%] z-40">
                                <div
                                  className={`absolute inset-0 rounded-full ${cellTheme.dot} shadow-md`}
                                  style={{ 
                                    animation: `${animName} 550ms forwards`,
                                    '--explode-n': moveN 
                                  } as React.CSSProperties}
                                />
                                {isEdge && (
                                  <div
                                    className={`absolute inset-0 rounded-full ${cellTheme.dot} shadow-md`}
                                    style={{ 
                                      animation: `${isX ? 'explode-x-ghost' : 'explode-y-ghost'} 550ms forwards`,
                                      '--ghost-start': ghostStart,
                                      '--ghost-end': ghostEnd
                                    } as React.CSSProperties}
                                  />
                                )}
                              </div>
                            );
                          }
                          
                          return (
                            <div
                              key={i}
                              className={`w-[38%] h-[38%] rounded-full ${cellTheme.dot} shadow-md relative animate-in zoom-in duration-300 ease-out`}
                            />
                          );
                        })}
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
