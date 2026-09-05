import { useState, useEffect, useRef, useMemo } from 'react';
import type { GameProps } from '../GameProps';
import type { SnakesLaddersData, SnakesLaddersState, PlayerInfo } from './types';
import {
  BOARD_SIZE,
  FINAL_SQUARE,
  START_SQUARE,
  LADDERS,
  SNAKES,
  SQUARES_IN_GRID_ORDER,
  squareToCoords,
  transitionFor,
} from './board';
import { useNetworkStore } from '../../platform/store/useNetworkStore';
import { useUser } from '../../platform/store/useUserStore';
import { playerColor } from '../../platform/theme/playerColors';
import { ExitButton } from '../components/ExitButton';
import { feedback } from '../../platform/feedback/feedbackManager';

// ─── Animation timings ───────────────────────────────────────────────────────
// The host drives every phase change on a timer and broadcasts it, so these
// double as the CSS transition durations on all clients.
const ROLL_MS = 700;        // die tumble before the value is revealed
const HOP_MS = 300;         // per square walked
const ANTICIPATE_MS = 400;  // wait on trigger square before sliding
const TRANSITION_MS = 1000; // snake slide / ladder climb
const SETTLE_MS = 500;      // beat before the turn hands over

const PHASE_DELAYS = {
  rolling: ROLL_MS,
  hopping: HOP_MS,
  anticipating: ANTICIPATE_MS,
  transition: TRANSITION_MS,
  settling: SETTLE_MS,
} as const;

// ─── Stage geometry ──────────────────────────────────────────────────────────
// The stage is exactly BOARD_SIZE wide by BOARD_SIZE tall in cell units.
// Pawns starting at position 0 are placed off-board below the bottom edge.
// Everything inside is positioned in percentages of the stage so a single
// absolutely-positioned pawn layer can glide onto the board.
const STAGE_ROWS = BOARD_SIZE;
const ROW_PCT = 100 / STAGE_ROWS;
const COL_PCT = 100 / BOARD_SIZE;

// ─── Pure state machine ──────────────────────────────────────────────────────

function rotateTurn(s: SnakesLaddersState): SnakesLaddersState {
  const n = s.players.length;
  let idx = s.turnIndex;
  for (let i = 0; i < n; i++) {
    idx = (idx + 1) % n;
    if (!s.droppedIds.includes(s.players[idx].id)) break;
  }
  return {
    ...s,
    turnIndex: idx,
    currentTurnId: s.players[idx].id,
    lastRoll: null,
    phase: { kind: 'idle' },
  };
}

/**
 * Advance the game by exactly one phase. Host-only — it rolls the die, so it is
 * not pure. Every other client just receives the resulting snapshot.
 */
function advance(s: SnakesLaddersState): SnakesLaddersState {
  const cur = s.currentTurnId;
  const pos = s.positions[cur] ?? START_SQUARE;

  switch (s.phase.kind) {
    case 'idle': {
      const roll = 1 + Math.floor(Math.random() * 6);
      return { ...s, lastRoll: roll, phase: { kind: 'rolling' } };
    }

    case 'rolling': {
      const target = pos + (s.lastRoll ?? 0);
      // Classic rule: you must land exactly on 100, so an overshoot forfeits
      // the move entirely.
      if (target > FINAL_SQUARE) {
        return { ...s, phase: { kind: 'settling', blocked: true } };
      }
      return { ...s, phase: { kind: 'hopping', to: target } };
    }

    case 'hopping': {
      const { to } = s.phase;
      const next = pos + 1;
      const positions = { ...s.positions, [cur]: next };
      if (next < to) {
        return { ...s, positions, phase: { kind: 'hopping', to } };
      }
      const link = transitionFor(next);
      if (link) {
        return {
          ...s,
          positions,
          phase: { kind: 'anticipating', via: link.via, to: link.to },
        };
      }
      return { ...s, positions, phase: { kind: 'settling' } };
    }

    case 'anticipating':
      // Move the pawn now, at the *start* of the transition phase, so the
      // longer glide duration is the one in effect when left/top change.
      return {
        ...s,
        positions: { ...s.positions, [cur]: s.phase.to },
        phase: { kind: 'transition', via: s.phase.via },
      };

    case 'transition':
      return { ...s, phase: { kind: 'settling' } };

    case 'settling': {
      // Catches both a direct landing on 100 and the 80 -> 100 ladder.
      if (pos === FINAL_SQUARE) {
        return { ...s, status: 'win', winnerId: cur, phase: { kind: 'idle' } };
      }
      // A six earns another roll — even one that overshot or hit a snake —
      // unless that player has since left the lobby.
      if (s.lastRoll === 6 && !s.droppedIds.includes(cur)) {
        return { ...s, phase: { kind: 'idle' } };
      }
      return rotateTurn(s);
    }
  }
}

function buildInitialState(seats: PlayerInfo[], step: number): SnakesLaddersState {
  const positions: Record<string, number> = {};
  seats.forEach((p) => {
    positions[p.id] = START_SQUARE;
  });
  const turnIndex = Math.floor(Math.random() * seats.length);
  return {
    players: seats,
    positions,
    droppedIds: [],
    turnIndex,
    currentTurnId: seats[turnIndex].id,
    lastRoll: null,
    phase: { kind: 'idle' },
    step,
    status: 'playing',
    winnerId: null,
  };
}

// ─── Static connector artwork ────────────────────────────────────────────────
// Built once at module load in a 0..100 viewBox that maps onto the board region.

const r2 = (n: number) => Math.round(n * 100) / 100;
const center = (sq: number) => {
  const { row, col } = squareToCoords(sq);
  return { x: col * COL_PCT + COL_PCT / 2, y: row * COL_PCT + COL_PCT / 2 };
};

const LADDER_SHAPES = Object.entries(LADDERS).map(([fromStr, to]) => {
  const from = Number(fromStr);
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  // Unit normal, used to push the two rails apart and to draw the rungs.
  const nx = -dy / len;
  const ny = dx / len;
  const halfWidth = 1.7;

  const rail = (offset: number) =>
    `M ${r2(a.x + nx * offset)} ${r2(a.y + ny * offset)} L ${r2(b.x + nx * offset)} ${r2(b.y + ny * offset)}`;

  const rungCount = Math.max(3, Math.round(len / 5));
  const rungs: string[] = [];
  for (let i = 0; i <= rungCount; i++) {
    const t = i / rungCount;
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    rungs.push(
      `M ${r2(px + nx * halfWidth)} ${r2(py + ny * halfWidth)} L ${r2(px - nx * halfWidth)} ${r2(py - ny * halfWidth)}`
    );
  }

  return { from, to, rails: [rail(halfWidth), rail(-halfWidth)], rungs };
});

const SNAKE_SHAPES = Object.entries(SNAKES).map(([fromStr, to], i) => {
  const from = Number(fromStr);
  const a = center(from);
  const b = center(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  // Alternate the bow direction so neighbouring snakes don't look cloned.
  const amp = Math.min(6.5, 1.6 + len * 0.18) * (i % 2 === 0 ? 1 : -1);
  const c1 = { x: a.x + dx * 0.3 + nx * amp, y: a.y + dy * 0.3 + ny * amp };
  const c2 = { x: a.x + dx * 0.7 - nx * amp, y: a.y + dy * 0.7 - ny * amp };
  const d = `M ${r2(a.x)} ${r2(a.y)} C ${r2(c1.x)} ${r2(c1.y)}, ${r2(c2.x)} ${r2(c2.y)}, ${r2(b.x)} ${r2(b.y)}`;
  return { from, to, d, head: a };
});

// ─── Die pips (indices into a 3x3 grid) ──────────────────────────────────────
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

const KEYFRAMES = `
  @keyframes sl-die-tumble {
    0%   { 
      transform: translateY(0) rotate(0deg) scale(1); 
      filter: drop-shadow(0px 2px 2px rgba(49, 46, 129, 0.2));
      animation-timing-function: ease-out; 
    }
    50%  { 
      transform: translateY(-24px) rotate(180deg) scale(1.1); 
      filter: drop-shadow(0px 16px 12px rgba(49, 46, 129, 0.3));
      animation-timing-function: ease-in; 
    }
    100% { 
      transform: translateY(0) rotate(360deg) scale(1); 
      filter: drop-shadow(0px 2px 2px rgba(49, 46, 129, 0.2));
    }
  }
  /* Keeps the centering translate the pawn already carries inline, otherwise
     the animation would drop it and the pawn would jump off its square. */
  @keyframes sl-pawn-bob {
    0%, 100% { transform: translate(-50%, -50%) scale(1); }
    50%      { transform: translate(-50%, -62%) scale(1.06); }
  }
  /* Animates outline rather than box-shadow so it can't fight the die's hard
     offset shadow, and outline never affects layout. */
  @keyframes sl-die-ready {
    0%, 100% { outline-color: rgba(49, 46, 129, 0); outline-offset: 2px; }
    50%      { outline-color: rgba(49, 46, 129, 0.3); outline-offset: 6px; }
  }
`;

export default function SnakesLadders({ sendDataToPeers, incomingData, onGameEnd }: GameProps<SnakesLaddersData>) {
  const { isHost, peers } = useNetworkStore();
  const { userId } = useUser();

  const [gameState, setGameState] = useState<SnakesLaddersState | null>(null);

  // Mirror of the latest committed state. The timer effect and the incoming
  // message handler both need to read the newest snapshot synchronously, and
  // reading it here keeps sendDataToPeers out of a setState updater (React 19
  // StrictMode double-invokes updaters, which would double-send).
  const stateRef = useRef<SnakesLaddersState | null>(null);
  const initialized = useRef(false);

  /** Host only: adopt a new snapshot, bump the step counter and broadcast it. */
  const commit = (next: SnakesLaddersState) => {
    const stamped: SnakesLaddersState = { ...next, step: next.step + 1 };
    stateRef.current = stamped;
    setGameState(stamped);
    sendDataToPeers({ type: 'SYNC', ...stamped });
  };

  /** Adopt an incoming snapshot without re-broadcasting it. */
  const applySync = (next: SnakesLaddersState) => {
    stateRef.current = next;
    setGameState(next);
  };

  // ── Host initialization ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isHost || initialized.current) return;
    // `peers` includes the local user, so wait for a real guest.
    if (peers.filter((p) => p.id !== userId).length === 0) return;

    initialized.current = true;
    // Roster order verbatim: this keeps a player's seat index — and therefore
    // their colour — identical to what they saw in the Lobby.
    const seats: PlayerInfo[] = peers.map((p) => ({ id: p.id, name: p.name }));
    commit(buildInitialState(seats, 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost, peers, userId]);

  // ── Host-driven animation clock ────────────────────────────────────────────
  // Keyed on `step` rather than on `phase`, so a hopping -> hopping step always
  // re-fires instead of being swallowed by an unchanged object identity.
  useEffect(() => {
    if (!isHost) return;
    const s = stateRef.current;
    if (!s || s.status !== 'playing') return;
    if (s.phase.kind === 'idle') return; // idle waits on player input

    const timer = setTimeout(() => {
      const latest = stateRef.current;
      if (latest) commit(advance(latest));
    }, PHASE_DELAYS[s.phase.kind]);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.step, isHost]);

  // ── Incoming network data ──────────────────────────────────────────────────
  useEffect(() => {
    if (incomingData?.type === 'SYNC') {
      const { type, ...next } = incomingData;
      applySync(next);
    } else if (incomingData?.type === 'ROLL' && isHost) {
      // The host relays GAME_DATA between guests, so guests see each other's
      // ROLL messages too — the isHost guard is what keeps this authoritative.
      const s = stateRef.current;
      if (
        s &&
        s.status === 'playing' &&
        s.phase.kind === 'idle' &&
        s.currentTurnId === incomingData.userId
      ) {
        commit(advance(s));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingData, isHost]);

  // ── Players leaving mid-game (host only) ───────────────────────────────────
  useEffect(() => {
    if (!isHost || !initialized.current) return;
    const s = stateRef.current;
    if (!s) return;

    const present = new Set(peers.map((p) => p.id));
    const gone = s.players
      .filter((p) => !present.has(p.id) && !s.droppedIds.includes(p.id))
      .map((p) => p.id);
    if (gone.length === 0) return;

    const droppedIds = [...s.droppedIds, ...gone];
    const remaining = s.players.filter((p) => !droppedIds.includes(p.id));
    if (remaining.length < 2) {
      onGameEnd();
      return;
    }

    // Dropped players keep their seat (so nobody's colour shifts) but are
    // skipped by rotateTurn from here on. If one was sitting on an idle turn we
    // have to rotate now, otherwise the game would wait forever; mid-animation
    // drops resolve themselves when the chain reaches `settling`.
    let next: SnakesLaddersState = { ...s, droppedIds };
    if (gone.includes(s.currentTurnId) && s.phase.kind === 'idle') {
      next = rotateTurn(next);
    }
    commit(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peers, isHost, onGameEnd]);

  // ── Sound & haptics, on every client ───────────────────────────────────────
  const prevBeatRef = useRef<{ phaseKind: string; pos: number } | null>(null);
  useEffect(() => {
    const s = gameState;
    if (!s) return;
    const pos = s.positions[s.currentTurnId] ?? START_SQUARE;
    const prev = prevBeatRef.current;
    prevBeatRef.current = { phaseKind: s.phase.kind, pos };
    if (!prev) return;

    if (prev.phaseKind === 'hopping' && pos !== prev.pos) {
      feedback.pop();
    } else if (s.phase.kind === 'transition' && prev.phaseKind !== 'transition') {
      if (s.phase.via === 'snake') feedback.boop();
      else feedback.hit('light');
    } else if (s.phase.kind === 'settling' && s.phase.blocked && prev.phaseKind !== 'settling') {
      feedback.hit('light');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.step]);

  const prevWinStateRef = useRef(false);
  useEffect(() => {
    if (gameState?.status === 'win' && !prevWinStateRef.current) {
      prevWinStateRef.current = true;
      if (gameState.winnerId === userId) feedback.win();
      else feedback.lose();
    } else if (gameState?.status !== 'win') {
      prevWinStateRef.current = false;
    }
  }, [gameState?.status, gameState?.winnerId, userId]);

  // ── Local die tumble (cosmetic, never synced) ──────────────────────────────
  const [tumbleFace, setTumbleFace] = useState(1);
  const isRolling = gameState?.phase.kind === 'rolling';
  useEffect(() => {
    if (!isRolling) return;
    const id = setInterval(() => {
      setTumbleFace((prev) => {
        let next;
        do {
          next = 1 + Math.floor(Math.random() * 6);
        } while (next === prev);
        return next;
      });
    }, 60);
    return () => clearInterval(id);
  }, [isRolling]);

  // ── Input ──────────────────────────────────────────────────────────────────
  const canRoll =
    !!gameState &&
    gameState.status === 'playing' &&
    gameState.phase.kind === 'idle' &&
    gameState.currentTurnId === userId;

  const handleRoll = () => {
    if (!canRoll) return;
    feedback.tap();
    if (isHost) {
      const s = stateRef.current;
      if (s) commit(advance(s));
    } else {
      sendDataToPeers({ type: 'ROLL', userId });
    }
  };

  const handleRestart = () => {
    if (!isHost) return;
    feedback.tap();
    if (peers.filter((p) => p.id !== userId).length === 0) return;
    const seats: PlayerInfo[] = peers.map((p) => ({ id: p.id, name: p.name }));
    commit(buildInitialState(seats, stateRef.current?.step ?? 0));
  };

  // ── Derived render data ────────────────────────────────────────────────────
  const occupants = useMemo(() => {
    const map = new Map<number, number[]>();
    if (!gameState) return map;
    gameState.players.forEach((p, seat) => {
      const sq = gameState.positions[p.id] ?? START_SQUARE;
      if (sq === START_SQUARE) return;
      const list = map.get(sq);
      if (list) list.push(seat);
      else map.set(sq, [seat]);
    });
    return map;
  }, [gameState]);

  if (!gameState) {
    return (
      <div className="flex flex-1 items-center justify-center w-full h-full min-h-[var(--app-height,100dvh)] bg-slate-50">
        <div className="animate-pulse text-2xl font-black uppercase text-indigo-900 tracking-widest">
          Initializing Game...
        </div>
      </div>
    );
  }

  const seatOf = (id: string) => gameState.players.findIndex((p) => p.id === id);
  const nameOf = (id: string) => gameState.players.find((p) => p.id === id)?.name ?? 'Player';
  const turnColor = playerColor(Math.max(0, seatOf(gameState.currentTurnId)));

  // ── Win screen ─────────────────────────────────────────────────────────────
  if (gameState.status === 'win') {
    const isWinner = gameState.winnerId === userId;
    const winColor = playerColor(Math.max(0, seatOf(gameState.winnerId ?? '')));

    return (
      <div
        className="flex flex-1 flex-col items-center justify-center w-full h-full min-h-[var(--app-height,100dvh)] transition-colors duration-500 font-mono p-4"
        style={{ backgroundColor: `${winColor}33` }}
      >
        <div className="text-center mb-8 bg-white border-2 border-indigo-900 shadow-2xl rounded-3xl p-8 sm:p-10 w-full max-w-[400px]">
          <h1
            className={`text-5xl sm:text-6xl font-black uppercase tracking-tight ${isWinner ? 'text-emerald-500' : 'text-red-500'}`}
          >
            {isWinner ? 'Victory!' : 'Defeat'}
          </h1>
          <p className="text-slate-600 font-bold mt-4 text-base uppercase tracking-wider">
            {isWinner ? 'You reached 100 first!' : `${nameOf(gameState.winnerId ?? '')} reached 100.`}
          </p>
        </div>

        {isHost ? (
          <div className="flex flex-col sm:flex-row gap-4 w-full max-w-[400px]">
            <button
              onClick={() => {
                feedback.tap();
                onGameEnd();
              }}
              className="flex-1 bg-white text-indigo-900 border-2 border-indigo-900 rounded-2xl p-4 font-black text-xl uppercase cursor-pointer shadow-[0_4px_0_theme(colors.indigo.900)] active:shadow-none active:translate-y-[4px] transition-all"
            >
              Quit
            </button>
            <button
              onClick={handleRestart}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white border-2 border-indigo-900 rounded-2xl p-4 font-black text-xl uppercase cursor-pointer shadow-[0_4px_0_theme(colors.indigo.900)] active:shadow-none active:translate-y-[4px] transition-all"
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

  // ── Board screen ───────────────────────────────────────────────────────────
  const amITurn = gameState.currentTurnId === userId;
  const { phase, lastRoll } = gameState;

  let subLine = '';
  if (phase.kind === 'rolling') subLine = 'Rolling...';
  else if (phase.kind === 'hopping') subLine = `Rolled ${lastRoll}`;
  else if (phase.kind === 'anticipating') subLine = phase.via === 'snake' ? 'Uh oh...' : 'Here we go!';
  else if (phase.kind === 'transition') subLine = phase.via === 'snake' ? 'Snake!' : 'Ladder!';
  else if (phase.kind === 'settling') subLine = phase.blocked ? `Overshot with ${lastRoll}` : `Rolled ${lastRoll}`;
  else if (lastRoll === 6) subLine = 'Six — roll again!';
  else if (amITurn) subLine = 'Tap the die';

  const dieFace = phase.kind === 'rolling' ? tumbleFace : (lastRoll ?? 1);
  const moveMs = phase.kind === 'transition' ? TRANSITION_MS : HOP_MS;
  const moveEase = phase.kind === 'transition' ? 'cubic-bezier(0.5, 0, 0.5, 1)' : 'ease-in-out';

  return (
    <div
      className="flex flex-col justify-center w-full h-[var(--app-height,100dvh)] font-mono relative overflow-hidden bg-slate-100"
    >
      <style>{KEYFRAMES}</style>
      <div
        className="absolute inset-0 transition-colors duration-500 pointer-events-none"
        style={{ backgroundColor: `${turnColor}2E` }}
      />
      {isHost && <ExitButton onExit={onGameEnd} />}

      {/* Morphing turn indicator (absolute so it never shifts the board) */}
      <div className="absolute top-0 left-0 w-full flex justify-center z-20 pointer-events-none">
        <div
          className={`
            transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)]
            flex flex-col items-center justify-end border-indigo-900
            ${amITurn
              ? 'w-[280px] h-[86px] sm:w-[340px] sm:h-[96px] rounded-b-[100%] shadow-[0_12px_24px_rgba(0,0,0,0.25)] border-b-8 border-x-8 pb-3'
              : 'w-[220px] h-[58px] sm:w-[260px] sm:h-[66px] rounded-b-[100%] shadow-md border-b-4 border-x-4 pb-1.5 opacity-90 -translate-y-1'
            }
          `}
          style={{ backgroundColor: turnColor }}
        >
          <span
            className={`transition-all duration-700 uppercase font-black tracking-widest text-indigo-900 truncate max-w-[88%] ${amITurn ? 'text-2xl sm:text-3xl' : 'text-sm sm:text-base'
              }`}
          >
            {amITurn ? 'Your Turn' : nameOf(gameState.currentTurnId)}
          </span>

          <div
            className={`transition-all duration-700 overflow-hidden ${subLine ? 'max-h-10 opacity-100 mt-0.5' : 'max-h-0 opacity-0 mt-0'
              }`}
          >
            <span className="text-indigo-900/70 font-bold text-xs sm:text-sm">{subLine}</span>
          </div>
        </div>
      </div>

      {/* Stage: 10 board rows + 1 staging-pen row */}
      <div className="shrink-0 w-full flex items-center justify-center px-2 pt-[80px] sm:pt-[94px] pb-6 relative z-10">
        <div
          className="relative w-full"
          style={{
            aspectRatio: `${BOARD_SIZE} / ${STAGE_ROWS}`,
            maxHeight: '100%',
            maxWidth: `min(520px, calc((100dvh - 215px) * ${BOARD_SIZE / STAGE_ROWS}))`,
          }}
        >
          <div className="absolute inset-0 bg-white border-[3px] border-indigo-900 rounded-2xl overflow-hidden">
            {/* Squares */}
            <div
              className="absolute inset-x-0 top-0 grid h-full"
              style={{
                gridTemplateColumns: `repeat(${BOARD_SIZE}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${BOARD_SIZE}, minmax(0, 1fr))`,
              }}
            >
              {SQUARES_IN_GRID_ORDER.map((sq, i) => {
                const row = Math.floor(i / BOARD_SIZE);
                const col = i % BOARD_SIZE;
                const link = transitionFor(sq);
                const shade = (row + col) % 2 === 1;

                let tint = shade ? 'bg-indigo-900/[0.055]' : 'bg-white';
                if (link?.via === 'snake') tint = 'bg-rose-200/60';
                else if (link?.via === 'ladder') tint = 'bg-emerald-200/60';
                else if (sq === FINAL_SQUARE) tint = 'bg-amber-200/70';

                return (
                  <div
                    key={sq}
                    className={`relative border border-indigo-900/10 ${tint} flex items-center justify-center`}
                  >
                    <span className="absolute top-[1px] left-[2px] text-[6px] sm:text-[8px] font-bold leading-none text-indigo-900/40">
                      {sq}
                    </span>
                    {sq === FINAL_SQUARE && (
                      <span className="text-[7px] sm:text-[9px] font-black uppercase leading-none text-amber-700">
                        Win
                      </span>
                    )}
                    {link && (
                      <span
                        className={`absolute bottom-[1px] right-[2px] text-[6px] sm:text-[8px] font-black leading-none ${link.via === 'snake' ? 'text-rose-700' : 'text-emerald-700'
                          }`}
                      >
                        {link.via === 'snake' ? '↓' : '↑'}
                        {link.to}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Snake and ladder artwork, mapped exactly onto the square grid */}
            <svg
              className="absolute inset-x-0 top-0 pointer-events-none h-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {LADDER_SHAPES.map((l) => (
                <g key={`ladder-${l.from}`}>
                  {l.rungs.map((d, i) => (
                    <path key={`ro-${i}`} d={d} fill="none" stroke="#065f46" strokeWidth="1.4" strokeLinecap="round" />
                  ))}
                  {l.rungs.map((d, i) => (
                    <path key={`ri-${i}`} d={d} fill="none" stroke="#6ee7b7" strokeWidth="0.55" strokeLinecap="round" />
                  ))}
                  {l.rails.map((d, i) => (
                    <path key={`ao-${i}`} d={d} fill="none" stroke="#065f46" strokeWidth="1.9" strokeLinecap="round" />
                  ))}
                  {l.rails.map((d, i) => (
                    <path key={`ai-${i}`} d={d} fill="none" stroke="#34d399" strokeWidth="0.8" strokeLinecap="round" />
                  ))}
                </g>
              ))}

              {SNAKE_SHAPES.map((s) => (
                <g key={`snake-${s.from}`}>
                  <path d={s.d} fill="none" stroke="#312e81" strokeWidth="3.4" strokeLinecap="round" />
                  <path d={s.d} fill="none" stroke="#f43f5e" strokeWidth="2.2" strokeLinecap="round" />
                  <path
                    d={s.d}
                    fill="none"
                    stroke="#fecdd3"
                    strokeWidth="0.55"
                    strokeLinecap="round"
                    strokeDasharray="1.3 2.4"
                  />
                  <circle cx={s.head.x} cy={s.head.y} r="2.6" fill="#f43f5e" stroke="#312e81" strokeWidth="0.8" />
                  <circle cx={s.head.x - 0.95} cy={s.head.y - 0.6} r="0.5" fill="#312e81" />
                  <circle cx={s.head.x + 0.95} cy={s.head.y - 0.6} r="0.5" fill="#312e81" />
                </g>
              ))}
            </svg>
          </div>

          {/* Pawns — one absolutely positioned layer so CSS animates the moves */}
          <div className="absolute inset-0 pointer-events-none">
            {gameState.players.map((p, seat) => {
              const sq = gameState.positions[p.id] ?? START_SQUARE;
              const dropped = gameState.droppedIds.includes(p.id);
              const isActive = p.id === gameState.currentTurnId;
              const color = playerColor(seat);

              let leftPct: number;
              let topPct: number;
              let offsetX = 0;
              let offsetY = 0;
              let sizePct: number;

              if (sq === START_SQUARE) {
                // Fixed slot per seat so the pen never re-shuffles as pawns leave.
                const slots = gameState.players.length;
                leftPct = ((seat + 0.5) / slots) * 100 - COL_PCT / 2;
                topPct = BOARD_SIZE * ROW_PCT;
                sizePct = slots > 10 ? Math.max(38, 720 / slots) : 68;
              } else {
                const { row, col } = squareToCoords(sq);
                leftPct = col * COL_PCT;
                topPct = row * ROW_PCT;
                // Fan co-located pawns around the middle of the square.
                const group = occupants.get(sq) ?? [seat];
                const k = Math.max(0, group.indexOf(seat));
                const n = group.length;
                if (n > 1) {
                  const angle = (k / n) * Math.PI * 2 - Math.PI / 2;
                  offsetX = Math.cos(angle) * 24;
                  offsetY = Math.sin(angle) * 24;
                }
                sizePct = n <= 1 ? 70 : n <= 4 ? 54 : 42;
              }

              return (
                <div
                  key={p.id}
                  className="absolute"
                  style={{
                    left: `${leftPct}%`,
                    top: `${topPct}%`,
                    width: `${COL_PCT}%`,
                    height: `${ROW_PCT}%`,
                    zIndex: isActive ? 3 : 2,
                    transitionProperty: 'left, top',
                    transitionDuration: `${moveMs}ms`,
                    transitionTimingFunction: moveEase,
                  }}
                >
                  <div
                    className={`absolute rounded-full border-2 border-indigo-900 flex items-center justify-center transition-all duration-200 ${dropped ? 'opacity-35 grayscale' : ''
                      }`}
                    style={{
                      left: `${50 + offsetX}%`,
                      top: `${50 + offsetY}%`,
                      width: `${sizePct}%`,
                      height: `${sizePct}%`,
                      transform: 'translate(-50%, -50%)',
                      backgroundColor: color,
                      boxShadow: isActive ? '0 0 0 2px rgba(49,46,129,0.35)' : '0 1px 2px rgba(0,0,0,0.3)',
                      animation:
                        isActive && !dropped && (phase.kind === 'idle' || phase.kind === 'rolling')
                          ? 'sl-pawn-bob 600ms ease-in-out infinite'
                          : undefined,
                    }}
                  >
                    <span className="text-[6px] sm:text-[8px] font-black leading-none text-indigo-900">
                      {seat + 1}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Spacer that adds gap if vertical space allows, but shrinks if tight */}
      <div className="shrink min-h-0 w-full h-4 sm:h-8" />

      {/* Roll bar */}
      <div className="shrink-0 w-full flex flex-col items-center gap-1.5 px-3 pb-3 relative z-10">


        {/* Die */}
        <button
          onClick={handleRoll}
          disabled={!canRoll}
          aria-label="Roll the die"
          className={`w-[68px] h-[68px] sm:w-[76px] sm:h-[76px] rounded-2xl border-[3px] border-indigo-900 bg-white p-2 transition-all duration-150 ${canRoll
              ? 'cursor-pointer hover:bg-slate-50 active:bg-slate-100'
              : 'cursor-default opacity-70'
            }`}
          style={
            isRolling
              ? { animation: 'sl-die-tumble 350ms infinite' }
              : canRoll
                ? { outline: '2px solid transparent', animation: 'sl-die-ready 1.6s ease-in-out infinite' }
                : undefined
          }
        >
          <div className="grid grid-cols-3 grid-rows-3 gap-[3px] w-full h-full">
            {Array.from({ length: 9 }).map((_, i) => (
              <span
                key={i}
                className={`rounded-full ${PIPS[dieFace]?.includes(i) ? 'bg-indigo-900' : 'bg-transparent'}`}
              />
            ))}
          </div>
        </button>


      </div>
    </div>
  );
}
