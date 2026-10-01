import { useState, useEffect, useRef, useMemo } from 'react';
import type { GameProps } from '../GameProps';
import type { LudoData, LudoState, Phase, PlayerInfo } from './types';
import {
  CELL_PCT,
  GRID,
  HOME_ORIGIN,
  HOME_PROGRESS,
  HOME_WEDGES,
  IN_YARD,
  QUADRANTS,
  SAFE_RING_INDICES,
  TOKENS_PER_PLAYER,
  TRACK_CELLS,
  ringIndexAt,
  tokenCenter,
  yardSlot,
} from './board';
import type { Coord, Quadrant } from './board';
import { useNetworkStore } from '../../platform/store/useNetworkStore';
import { useUser } from '../../platform/store/useUserStore';
import { playerColor } from '../../platform/theme/playerColors';
import { ExitButton } from '../components/ExitButton';
import { feedback } from '../../platform/feedback/feedbackManager';

// ─── Animation timings ───────────────────────────────────────────────────────
// The host drives every phase change on a timer and broadcasts it, so these
// double as the CSS transition durations on all clients.
const ROLL_MS = 700;     // die tumble before the value is revealed
const LAUNCH_MS = 420;   // yard -> start cell
const STEP_MS = 230;     // per cell walked
const CAPTURE_MS = 700;  // victims gliding back to their yards
const HOME_MS = 700;     // token settling into the home wedge
const SETTLE_MS = 420;   // beat before the turn hands over

/** Phases the host clock drives. `idle` and `choosing` wait on the player. */
const PHASE_DELAYS: Partial<Record<Phase['kind'], number>> = {
  rolling: ROLL_MS,
  launching: LAUNCH_MS,
  stepping: STEP_MS,
  capturing: CAPTURE_MS,
  homing: HOME_MS,
  settling: SETTLE_MS,
};

/** Rolling this many sixes in a row forfeits the turn, third move included. */
const MAX_SIXES_IN_ROW = 3;

const seatOfToken = (token: number) => Math.floor(token / TOKENS_PER_PLAYER);
const slotOfToken = (token: number) => token % TOKENS_PER_PLAYER;
const quadrantOf = (s: LudoState, seat: number) => QUADRANTS[s.quadrants[seat]];

/** The token the current phase is animating, if any. */
const animatingToken = (phase: Phase): number | null =>
  phase.kind === 'launching' ||
    phase.kind === 'stepping' ||
    phase.kind === 'capturing' ||
    phase.kind === 'homing'
    ? phase.token
    : null;

// ─── Pure state machine ──────────────────────────────────────────────────────

/**
 * Tokens the seated player may legally move on this roll. Yard tokens are
 * interchangeable, so at most one of them is ever offered.
 */
function legalMoves(s: LudoState, seat: number, roll: number): number[] {
  const out: number[] = [];
  let yardOffered = false;

  for (let slot = 0; slot < TOKENS_PER_PLAYER; slot++) {
    const token = seat * TOKENS_PER_PLAYER + slot;
    const progress = s.tokens[token];

    if (progress === HOME_PROGRESS) continue;
    if (progress === IN_YARD) {
      // Only a six opens the gate.
      if (roll === 6 && !yardOffered) {
        out.push(token);
        yardOffered = true;
      }
      continue;
    }
    // You must land exactly on the home, so an overshoot forfeits the move.
    if (progress + roll <= HOME_PROGRESS) out.push(token);
  }
  return out;
}

/** Opponent tokens sharing the unsafe ring cell `token` just landed on. */
function captureVictims(s: LudoState, token: number): number[] {
  const seat = seatOfToken(token);
  const landed = ringIndexAt(quadrantOf(s, seat), s.tokens[token]);
  if (landed === null || SAFE_RING_INDICES.has(landed)) return [];

  const victims: number[] = [];
  s.tokens.forEach((progress, other) => {
    const otherSeat = seatOfToken(other);
    if (otherSeat === seat) return;
    if (ringIndexAt(quadrantOf(s, otherSeat), progress) === landed) victims.push(other);
  });
  return victims;
}

function rotateTurn(s: LudoState): LudoState {
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
    sixesInRow: 0,
    phase: { kind: 'idle' },
  };
}

/**
 * Put `token` in motion. Tokens in the yard are moved onto their start cell
 * right away, at the *start* of the launching phase, so the longer pop duration
 * is the one in effect when left/top change.
 */
function beginMove(s: LudoState, token: number): LudoState {
  if (s.tokens[token] === IN_YARD) {
    const tokens = [...s.tokens];
    tokens[token] = 0;
    return { ...s, tokens, phase: { kind: 'launching', token } };
  }
  return { ...s, phase: { kind: 'stepping', token, remaining: s.lastRoll ?? 0 } };
}

/** Work out what the cell a token has just arrived on does to it. */
function resolveLanding(s: LudoState, token: number): LudoState {
  if (s.tokens[token] === HOME_PROGRESS) {
    return { ...s, phase: { kind: 'homing', token } };
  }

  const victims = captureVictims(s, token);
  if (victims.length > 0) {
    const tokens = [...s.tokens];
    victims.forEach((victim) => {
      tokens[victim] = IN_YARD;
    });
    return { ...s, tokens, phase: { kind: 'capturing', token, victims } };
  }

  return { ...s, phase: { kind: 'settling' } };
}

function endTurn(s: LudoState): LudoState {
  const base = s.turnIndex * TOKENS_PER_PLAYER;
  const allHome = Array.from(
    { length: TOKENS_PER_PLAYER },
    (_, slot) => s.tokens[base + slot]
  ).every((progress) => progress === HOME_PROGRESS);

  if (allHome) {
    return { ...s, status: 'win', winnerId: s.currentTurnId, phase: { kind: 'idle' } };
  }

  const settled = s.phase.kind === 'settling' ? s.phase : null;
  const burned = settled?.note === 'burned';
  // A six earns another roll — even one that could not be used — as does a
  // capture or bringing a token home.
  const earnedAnother = !burned && (settled?.extra === true || s.lastRoll === 6);

  if (earnedAnother && !s.droppedIds.includes(s.currentTurnId)) {
    return { ...s, phase: { kind: 'idle' } };
  }
  return rotateTurn(s);
}

/**
 * Advance the game by exactly one phase. Host-only — it rolls the die, so it is
 * not pure. Every other client just receives the resulting snapshot.
 */
function advance(s: LudoState): LudoState {
  switch (s.phase.kind) {
    case 'idle': {
      const roll = 1 + Math.floor(Math.random() * 6);
      return {
        ...s,
        lastRoll: roll,
        sixesInRow: roll === 6 ? s.sixesInRow + 1 : 0,
        phase: { kind: 'rolling' },
      };
    }

    case 'rolling': {
      if (s.sixesInRow >= MAX_SIXES_IN_ROW) {
        return { ...s, phase: { kind: 'settling', note: 'burned' } };
      }
      const options = legalMoves(s, s.turnIndex, s.lastRoll ?? 0);
      if (options.length === 0) {
        return { ...s, phase: { kind: 'settling', note: 'noMoves' } };
      }
      // Skip the prompt when there is nothing to decide.
      if (options.length === 1) return beginMove(s, options[0]);
      return { ...s, phase: { kind: 'choosing', options } };
    }

    case 'choosing':
      // Waits on the player's pick, which the host applies with beginMove().
      return s;

    case 'launching':
      return resolveLanding(s, s.phase.token);

    case 'stepping': {
      const { token, remaining } = s.phase;
      const tokens = [...s.tokens];
      tokens[token] += 1;
      const walked = { ...s, tokens };
      if (remaining > 1) {
        return { ...walked, phase: { kind: 'stepping', token, remaining: remaining - 1 } };
      }
      return resolveLanding(walked, token);
    }

    case 'capturing':
    case 'homing':
      return { ...s, phase: { kind: 'settling', extra: true } };

    case 'settling':
      return endTurn(s);
  }
}

/** Seat -> quadrant. Two players sit diagonally opposite; more fill in order. */
function assignQuadrants(count: number): number[] {
  if (count === 2) return [0, 2];
  return Array.from({ length: count }, (_, seat) => seat % QUADRANTS.length);
}

function buildInitialState(seats: PlayerInfo[], step: number): LudoState {
  const turnIndex = Math.floor(Math.random() * seats.length);
  return {
    players: seats,
    quadrants: assignQuadrants(seats.length),
    tokens: new Array(seats.length * TOKENS_PER_PLAYER).fill(IN_YARD),
    droppedIds: [],
    turnIndex,
    currentTurnId: seats[turnIndex].id,
    lastRoll: null,
    sixesInRow: 0,
    phase: { kind: 'idle' },
    step,
    status: 'playing',
    winnerId: null,
  };
}

// ─── Layout helpers ──────────────────────────────────────────────────────────
// The static board is laid out on a real 15x15 CSS grid, so neighbouring cells
// share exact edges instead of each rounding its own percentage and leaving
// hairline seams. Tokens have to animate between cells, so they stay absolutely
// positioned — but they live inside the same bordered box as the grid, which is
// what keeps the two coordinate systems in step.

/** An absolutely positioned box of `cells` size, centred on a cell-unit point. */
const box = (center: Coord, cells: number) => ({
  left: `${(center.col - cells / 2) * CELL_PCT}%`,
  top: `${(center.row - cells / 2) * CELL_PCT}%`,
  width: `${cells * CELL_PCT}%`,
  height: `${cells * CELL_PCT}%`,
});

/** 1-based grid area covering `cells` square from a 0-based top-left cell. */
const area = (cell: Coord, cells = 1) =>
  `${cell.row + 1} / ${cell.col + 1} / span ${cells} / span ${cells}`;

/** Radius of the card's inner edge: the 1rem outer radius less its 3px frame. */
const INNER_RADIUS = 13;

/**
 * Yards sit flush in the board's corners, so they only carry a frame line on
 * the two edges that meet the track and pick up the card's inner radius on the
 * corner they share with it.
 */
function yardFrame(q: Quadrant): React.CSSProperties {
  const atTop = q.yard.row === 0;
  const atLeft = q.yard.col === 0;
  return {
    gridArea: area(q.yard, 6),
    borderStyle: 'solid',
    borderColor: '#312e81',
    borderTopWidth: atTop ? 0 : 3,
    borderBottomWidth: atTop ? 3 : 0,
    borderLeftWidth: atLeft ? 0 : 3,
    borderRightWidth: atLeft ? 3 : 0,
    ...(atTop
      ? atLeft
        ? { borderTopLeftRadius: INNER_RADIUS }
        : { borderTopRightRadius: INNER_RADIUS }
      : atLeft
        ? { borderBottomLeftRadius: INNER_RADIUS }
        : { borderBottomRightRadius: INNER_RADIUS }),
  };
}

const positionKey = (center: Coord) => `${center.row.toFixed(2)}:${center.col.toFixed(2)}`;

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
  @keyframes ludo-die-tumble {
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
  /* Animates outline rather than box-shadow so it can't fight the die's hard
     offset shadow, and outline never affects layout. */
  @keyframes ludo-die-ready {
    0%, 100% { outline-color: rgba(49, 46, 129, 0); outline-offset: 2px; }
    50%      { outline-color: rgba(49, 46, 129, 0.3); outline-offset: 6px; }
  }
  /* Same reasoning for a pickable token, whose transform carries its centring. */
  @keyframes ludo-token-pick {
    0%, 100% { outline-color: rgba(49, 46, 129, 0.15); outline-offset: 1px; }
    50%      { outline-color: rgba(49, 46, 129, 0.75); outline-offset: 5px; }
  }

  @keyframes ludo-burst {
    0%   { opacity: 0.9; transform: scale(0.5); }
    100% { opacity: 0;   transform: scale(2.4); }
  }
`;

export default function Ludo({ sendDataToPeers, incomingData, onGameEnd }: GameProps<LudoData>) {
  const { isHost, peers } = useNetworkStore();
  const { userId } = useUser();

  const [gameState, setGameState] = useState<LudoState | null>(null);

  // Mirror of the latest committed state. The timer effect and the incoming
  // message handler both need to read the newest snapshot synchronously, and
  // reading it here keeps sendDataToPeers out of a setState updater (React 19
  // StrictMode double-invokes updaters, which would double-send).
  const stateRef = useRef<LudoState | null>(null);
  const initialized = useRef(false);

  /** Host only: adopt a new snapshot, bump the step counter and broadcast it. */
  const commit = (next: LudoState) => {
    const stamped: LudoState = { ...next, step: next.step + 1 };
    stateRef.current = stamped;
    setGameState(stamped);
    sendDataToPeers({ type: 'SYNC', ...stamped });
  };

  /** Adopt an incoming snapshot without re-broadcasting it. */
  const applySync = (next: LudoState) => {
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
  // Keyed on `step` rather than on `phase`, so a stepping -> stepping tick
  // always re-fires instead of being swallowed by an unchanged object identity.
  useEffect(() => {
    if (!isHost) return;
    const s = stateRef.current;
    if (!s || s.status !== 'playing') return;

    const delay = PHASE_DELAYS[s.phase.kind];
    if (delay === undefined) return; // idle and choosing wait on player input

    const timer = setTimeout(() => {
      const latest = stateRef.current;
      if (latest) commit(advance(latest));
    }, delay);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.step, isHost]);

  // ── Incoming network data ──────────────────────────────────────────────────
  useEffect(() => {
    if (incomingData?.type === 'SYNC') {
      const { type, ...next } = incomingData;
      applySync(next);
      return;
    }
    if (!isHost || !incomingData) return;

    // The host relays GAME_DATA between guests, so guests see each other's
    // requests too — the isHost guard is what keeps this authoritative.
    const s = stateRef.current;
    if (!s || s.status !== 'playing' || s.currentTurnId !== incomingData.userId) return;

    if (incomingData.type === 'ROLL' && s.phase.kind === 'idle') {
      commit(advance(s));
    } else if (
      incomingData.type === 'PICK' &&
      s.phase.kind === 'choosing' &&
      s.phase.options.includes(incomingData.token)
    ) {
      commit(beginMove(s, incomingData.token));
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

    // Dropped players keep their seat and their tokens (so nobody's colour or
    // quadrant shifts) but are skipped by rotateTurn from here on. If one was
    // sitting on a turn that waits for input we have to rotate now, otherwise
    // the game would wait forever; mid-animation drops resolve themselves when
    // the chain reaches `settling`.
    let next: LudoState = { ...s, droppedIds };
    if (
      gone.includes(s.currentTurnId) &&
      (s.phase.kind === 'idle' || s.phase.kind === 'choosing')
    ) {
      next = rotateTurn(next);
    }
    commit(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peers, isHost, onGameEnd]);

  // ── Sound & haptics, on every client ───────────────────────────────────────
  const prevPhaseRef = useRef<Phase['kind'] | null>(null);
  useEffect(() => {
    if (!gameState) return;
    const phase = gameState.phase;
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = phase.kind;
    if (!prev) return;

    if (phase.kind === 'launching') feedback.hit('light');
    else if (phase.kind === 'capturing') feedback.boop();
    else if (phase.kind === 'homing') feedback.score();
    else if (phase.kind === 'stepping' && prev === 'stepping') feedback.pop();
    else if (phase.kind === 'settling') {
      // Either the last step of a walk just landed, or the roll went nowhere.
      if (prev === 'stepping') feedback.pop();
      else if (phase.note) feedback.hit('light');
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
  const isMyTurn = !!gameState && gameState.currentTurnId === userId;
  const canRoll =
    !!gameState && gameState.status === 'playing' && gameState.phase.kind === 'idle' && isMyTurn;

  const myOptions =
    gameState?.status === 'playing' && gameState.phase.kind === 'choosing' && isMyTurn
      ? gameState.phase.options
      : [];

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

  const handlePick = (token: number) => {
    if (!myOptions.includes(token)) return;
    feedback.tap();
    if (isHost) {
      const s = stateRef.current;
      if (s) commit(beginMove(s, token));
    } else {
      sendDataToPeers({ type: 'PICK', userId, token });
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

  /** quadrant -> seat, for painting yards, home columns and wedges. */
  const seatByQuadrant = useMemo(() => {
    const out: (number | null)[] = QUADRANTS.map(() => null);
    gameState?.quadrants.forEach((quadrant, seat) => {
      out[quadrant] = seat;
    });
    return out;
  }, [gameState?.quadrants]);

  /** Tokens grouped by the exact point they rest on, so stacks can be fanned. */
  const occupants = useMemo(() => {
    const map = new Map<string, number[]>();
    if (!gameState) return map;
    gameState.tokens.forEach((progress, token) => {
      const seat = seatOfToken(token);
      const key = positionKey(
        tokenCenter(quadrantOf(gameState, seat), slotOfToken(token), progress)
      );
      const list = map.get(key);
      if (list) list.push(token);
      else map.set(key, [token]);
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
            {isWinner
              ? 'All four tokens home!'
              : `${nameOf(gameState.winnerId ?? '')} got all four home.`}
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
  const { phase, lastRoll } = gameState;

  let subLine = '';
  if (phase.kind === 'rolling') subLine = 'Rolling...';
  else if (phase.kind === 'choosing')
    subLine = isMyTurn ? `Rolled ${lastRoll} — pick a token` : `Rolled ${lastRoll}`;
  else if (phase.kind === 'launching') subLine = 'Out of the yard!';
  else if (phase.kind === 'stepping') subLine = `Rolled ${lastRoll}`;
  else if (phase.kind === 'capturing') subLine = 'Captured!';
  else if (phase.kind === 'homing') subLine = 'Token home!';
  else if (phase.kind === 'settling')
    subLine =
      phase.note === 'burned'
        ? 'Three sixes — turn lost'
        : phase.note === 'noMoves'
          ? `No move with ${lastRoll}`
          : `Rolled ${lastRoll}`;
  else if (lastRoll === 6) subLine = 'Six — roll again!';
  else if (isMyTurn) subLine = 'Tap the die';

  const dieFace = phase.kind === 'rolling' ? tumbleFace : (lastRoll ?? 1);
  const moving = animatingToken(phase);
  const moveMs =
    phase.kind === 'launching'
      ? LAUNCH_MS
      : phase.kind === 'capturing'
        ? CAPTURE_MS
        : phase.kind === 'homing'
          ? HOME_MS
          : STEP_MS;
  const moveEase = phase.kind === 'stepping' ? 'ease-in-out' : 'cubic-bezier(0.4, 0, 0.3, 1)';

  return (
    <div className="flex flex-col justify-center w-full h-[var(--app-height,100dvh)] font-mono relative overflow-hidden bg-slate-100">
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
            ${isMyTurn
              ? 'w-[280px] h-[86px] sm:w-[340px] sm:h-[96px] rounded-b-[100%] shadow-[0_12px_24px_rgba(0,0,0,0.25)] border-b-8 border-x-8 pb-3'
              : 'w-[220px] h-[58px] sm:w-[260px] sm:h-[66px] rounded-b-[100%] shadow-md border-b-4 border-x-4 pb-1.5 opacity-90 -translate-y-1'
            }
          `}
          style={{ backgroundColor: turnColor }}
        >
          <span
            className={`transition-all duration-700 uppercase font-black tracking-widest text-indigo-900 truncate max-w-[88%] ${isMyTurn ? 'text-2xl sm:text-3xl' : 'text-sm sm:text-base'
              }`}
          >
            {isMyTurn ? 'Your Turn' : nameOf(gameState.currentTurnId)}
          </span>

          <div
            className={`transition-all duration-700 overflow-hidden ${subLine ? 'max-h-10 opacity-100 mt-0.5' : 'max-h-0 opacity-0 mt-0'
              }`}
          >
            <span className="text-indigo-900/70 font-bold text-xs sm:text-sm whitespace-nowrap">
              {subLine}
            </span>
          </div>
        </div>
      </div>

      {/* Stage: the square 15x15 board */}
      <div className="shrink-0 w-full flex items-center justify-center px-2 pt-[80px] sm:pt-[94px] pb-6 relative z-0">
        <div
          className="relative w-full"
          style={{
            aspectRatio: '1 / 1',
            maxWidth: 'min(520px, calc(var(--app-height, 100dvh) - 244px))',
          }}
        >
          {/* Every layer below is measured against this one box — the grid and
              the absolutely positioned tokens share its padding box, so the
              frame's own width can't knock the two out of register. */}
          <div className="absolute inset-0 bg-white border-[3px] border-indigo-900 rounded-2xl overflow-hidden">
            <div
              className="absolute inset-0 grid"
              style={{
                gridTemplateColumns: `repeat(${GRID}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${GRID}, minmax(0, 1fr))`,
              }}
            >
              {/* Yards */}
              {QUADRANTS.map((q, quadrant) => {
                const seat = seatByQuadrant[quadrant];
                const seated = seat !== null;
                const color = seated ? playerColor(seat) : '#cbd5e1';
                const player = seated ? gameState.players[seat] : null;
                const isTurn = !!player && player.id === gameState.currentTurnId;
                const dropped = !!player && gameState.droppedIds.includes(player.id);

                return (
                  <div
                    key={`yard-${quadrant}`}
                    className={`relative transition-all duration-500 ${seated ? '' : 'opacity-40'
                      } ${dropped ? 'grayscale' : ''}`}
                    style={{
                      ...yardFrame(q),
                      backgroundColor: color,
                      // Inset so the board's rounded corners never clip it.
                      boxShadow: isTurn ? 'inset 0 0 0 3px rgba(49,46,129,0.55)' : undefined,
                    }}
                  >
                    <div className="absolute inset-[16.67%] bg-white/85 rounded-xl border-2 border-indigo-900/15" />
                    {player && (
                      <span
                        className="absolute left-0 w-full px-1.5 text-center leading-none font-black uppercase tracking-wider text-indigo-900 truncate text-[8px] sm:text-[10px]"
                        style={q.labelEdge === 'top' ? { top: '4%' } : { bottom: '4%' }}
                      >
                        {player.name}
                      </span>
                    )}
                  </div>
                );
              })}

              {/* Track: the shared ring plus the four home columns */}
              {TRACK_CELLS.map((cell) => {
                const seat = cell.owner === null ? null : seatByQuadrant[cell.owner];
                const owned = cell.owner !== null;
                const tint = seat !== null ? playerColor(seat) : '#e2e8f0';

                return (
                  <div
                    key={`cell-${cell.row}-${cell.col}`}
                    className="relative border border-indigo-900/15"
                    style={{
                      gridArea: area(cell),
                      backgroundColor: owned ? tint : '#ffffff',
                    }}
                  >
                    {cell.start && (
                      <span className="absolute inset-0 flex items-center justify-center font-black text-white/70 text-[20px] sm:text-[26px] leading-none">
                        {cell.arrow}
                      </span>
                    )}
                    {cell.safe && !cell.start && (
                      <span className="absolute inset-0 flex items-center justify-center text-amber-400 text-[24px] sm:text-[30px] leading-none">
                        ★
                      </span>
                    )}
                  </div>
                );
              })}

              {/* The home, one wedge per quadrant */}
              <svg
                className="w-full h-full pointer-events-none"
                style={{ gridArea: area({ row: HOME_ORIGIN, col: HOME_ORIGIN }, 3) }}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {HOME_WEDGES.map((points, quadrant) => {
                  const seat = seatByQuadrant[quadrant];
                  return (
                    <polygon
                      key={`wedge-${quadrant}`}
                      points={points}
                      fill={seat === null ? '#e2e8f0' : playerColor(seat)}
                      stroke="#312e81"
                      strokeWidth="1.2"
                    />
                  );
                })}
              </svg>
            </div>

            {/* Parking spots inside each occupied yard. Absolute rather than
                gridded, so they land exactly where a parked token does. */}
            {QUADRANTS.map((q, quadrant) =>
              seatByQuadrant[quadrant] === null
                ? null
                : Array.from({ length: TOKENS_PER_PLAYER }, (_, slot) => (
                  <div
                    key={`park-${quadrant}-${slot}`}
                    className="absolute rounded-full border-2 border-dashed border-indigo-900/25"
                    style={box(yardSlot(q, slot), 1.1)}
                  />
                ))
            )}



            {/* Capture flash on the cell that did the taking */}
            {phase.kind === 'capturing' && (
              <div
                className="absolute rounded-full border-4 border-rose-500 pointer-events-none z-[7]"
                style={{
                  ...box(
                    tokenCenter(
                      quadrantOf(gameState, seatOfToken(phase.token)),
                      slotOfToken(phase.token),
                      gameState.tokens[phase.token]
                    ),
                    1
                  ),
                  animation: `ludo-burst ${CAPTURE_MS}ms ease-out forwards`,
                }}
              />
            )}

            {/* Tokens — one absolutely positioned layer so CSS animates the moves */}
            <div className="absolute inset-0 pointer-events-none">
              {gameState.tokens.map((progress, token) => {
                const seat = seatOfToken(token);
                const slot = slotOfToken(token);
                const player = gameState.players[seat];
                const q = quadrantOf(gameState, seat);
                const center = tokenCenter(q, slot, progress);
                const dropped = gameState.droppedIds.includes(player.id);
                const selectable = myOptions.includes(token);
                const isMoving = moving === token;

                // Fan co-located tokens around the middle of their cell.
                const group = occupants.get(positionKey(center)) ?? [token];
                const crowd = group.length;
                let offsetX = 0;
                let offsetY = 0;
                if (crowd > 1) {
                  const angle = (group.indexOf(token) / crowd) * Math.PI * 2 - Math.PI / 2;
                  offsetX = Math.cos(angle) * 22;
                  offsetY = Math.sin(angle) * 22;
                }

                let sizePct: number;
                if (progress === IN_YARD) sizePct = 112;
                else if (progress === HOME_PROGRESS) sizePct = 46;
                else sizePct = crowd <= 1 ? 80 : crowd === 2 ? 62 : 48;

                return (
                  <div
                    key={`token-${token}`}
                    className="absolute"
                    style={{
                      ...box(center, 1),
                      zIndex: isMoving ? 6 : selectable ? 5 : 4,
                      transitionProperty: 'left, top',
                      transitionDuration: `${moveMs}ms`,
                      transitionTimingFunction: moveEase,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => handlePick(token)}
                      disabled={!selectable}
                      aria-label={
                        selectable ? `Move token ${slot + 1}` : `${player.name} token ${slot + 1}`
                      }
                      className={`absolute rounded-full border-2 border-indigo-900 transition-all duration-200 flex items-center justify-center overflow-hidden ${selectable ? 'pointer-events-auto cursor-pointer' : 'cursor-default'
                        } ${dropped ? 'opacity-35 grayscale' : ''}`}
                      style={{
                        left: `${50 + offsetX}%`,
                        top: `${50 + offsetY}%`,
                        width: `${sizePct}%`,
                        height: `${sizePct}%`,
                        transform: `translate(-50%, -50%) scale(${isMoving ? 1.14 : 1})`,
                        backgroundColor: playerColor(seat),
                        boxShadow: isMoving
                          ? '0 6px 12px rgba(0,0,0,0.5), inset 0 -4px 6px rgba(0,0,0,0.3)'
                          : '0 2px 4px rgba(0,0,0,0.4), inset 0 -3px 4px rgba(0,0,0,0.2)',
                        outline: selectable ? '2px solid transparent' : undefined,
                        animation: selectable
                          ? 'ludo-token-pick 1.2s ease-in-out infinite'
                          : undefined,
                      }}
                    >
                      {/* Gradient overlay for 3D body effect */}
                      <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.4) 0%, transparent 50%, rgba(0,0,0,0.2) 100%)' }} />
                      {/* Token top */}
                      <div className="relative w-[50%] h-[50%] rounded-full border border-indigo-900/60 pointer-events-none"
                        style={{
                          backgroundColor: playerColor(seat),
                          boxShadow: 'inset 0 2px 3px rgba(255,255,255,0.6), inset 0 -2px 3px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.5)'
                        }}
                      >
                        <span className="absolute left-[15%] top-[15%] w-[35%] h-[35%] rounded-full bg-white/80" />
                      </div>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Spacer that adds gap if vertical space allows, but shrinks if tight */}
      <div className="shrink min-h-0 w-full h-4 sm:h-8" />

      {/* Roll bar */}
      <div className="shrink-0 w-full flex flex-col items-center gap-1.5 px-3 pb-3 relative z-0">
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
              ? { animation: 'ludo-die-tumble 350ms infinite' }
              : canRoll
                ? { outline: '2px solid transparent', animation: 'ludo-die-ready 1.6s ease-in-out infinite' }
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
