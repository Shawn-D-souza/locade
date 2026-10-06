import { useState, useEffect, useRef } from 'react';
import type { GameProps } from '../GameProps';
import type { BattleshipData, BattleshipState, Phase, PlayerInfo, ShotResult } from './types';
import {
  CELLS,
  CELL_PCT,
  FLEET,
  GRID,
  SHIP_BY_ID,
  canPlace,
  cellAt,
  cellName,
  clamp,
  colOf,
  isSunk,
  maxBow,
  randomFleet,
  rotated,
  rowOf,
  shipAt,
  shipCells,
  validateFleet,
} from './board';
import type { Orientation, Placement, ShipId } from './board';
import { useNetworkStore } from '../../platform/store/useNetworkStore';
import { useUser } from '../../platform/store/useUserStore';
import { playerColor } from '../../platform/theme/playerColors';
import { ExitButton } from '../components/ExitButton';
import { feedback } from '../../platform/feedback/feedbackManager';

// ─── Animation timings ───────────────────────────────────────────────────────
// The host drives every phase change on a timer and broadcasts it, so these
// double as the CSS durations on all clients.
const FIRE_MS = 450;        // shell arcing down onto the target cell
const SPLASH_MISS_MS = 440; // a miss has nothing to read, so it barely pauses
const SPLASH_HIT_MS = 760;  // a hit is worth a beat
const SPLASH_SUNK_MS = 950; // and a wreck needs long enough to surface
const SETTLE_MS = 220;      // pause before the turn hands over

// ─── Wreck reveal ────────────────────────────────────────────────────────────
// Purely local CSS, and deliberately short: the scorch marks burn off
// bow-to-stern, then the hull rises out of the water behind them, all well
// inside SPLASH_SUNK_MS so nothing is still moving when the turn hands over.
const SCORCH_OUT_MS = 200; // one scorch mark dissolving
const SCORCH_STEP_MS = 26; // stagger between marks along the hull
const WRECK_DELAY_MS = 90; // beat before the hull starts surfacing
const WRECK_MS = 340;      // hull rising into place
const SPRAY_MS = 520;      // sea whitening around it

/**
 * How long the host holds a phase before advancing it. `deploying` and `aiming`
 * return null because they wait on a player instead of on the clock. The splash
 * is priced by what it has to show, so a miss hands the turn over quickly
 * instead of making both players sit through a hit's worth of animation.
 */
function phaseDelay(phase: Phase): number | null {
  switch (phase.kind) {
    case 'firing':
      return FIRE_MS;
    case 'splash':
      if (phase.sunk) return SPLASH_SUNK_MS;
      return phase.result === 'hit' ? SPLASH_HIT_MS : SPLASH_MISS_MS;
    case 'settling':
      return SETTLE_MS;
    default:
      return null;
  }
}

/** Pointer travel, in px, below which a drag is read as a tap-to-rotate. */
const TAP_SLOP = 8;

// ─── Pure state machine ──────────────────────────────────────────────────────

/** Battleship is strictly two-handed, so "the other seat" is unambiguous. */
const opponentOf = (s: BattleshipState, id: string): string | null =>
  s.players.find((p) => p.id !== id)?.id ?? null;

/** Cells of `ownerId`'s grid that have already been struck. */
function hitsOn(s: BattleshipState, ownerId: string): Set<number> {
  const hits = new Set<number>();
  (s.shots[ownerId] ?? []).forEach((result, cell) => {
    if (result === 'hit') hits.add(cell);
  });
  return hits;
}

/** A legal shot: that player's turn to aim, at water nobody has tried yet. */
function canFireAt(s: BattleshipState, userId: string, cell: number): boolean {
  if (s.status !== 'playing' || s.phase.kind !== 'aiming') return false;
  if (s.currentTurnId !== userId) return false;
  if (s.droppedIds.length > 0) return false;
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS) return false;

  const targetId = opponentOf(s, userId);
  if (targetId === null) return false;
  return (s.shots[targetId]?.[cell] ?? null) === null;
}

/** Put a shell in the air. The caller has already checked the shot is legal. */
function beginFire(s: BattleshipState, cell: number): BattleshipState {
  const targetId = opponentOf(s, s.currentTurnId);
  if (targetId === null) return s;
  return { ...s, phase: { kind: 'firing', targetId, cell } };
}

/**
 * Record one player's fleet. Once both are in, the battle opens on a coin-flip
 * turn. Returns the state unchanged if the fleet is junk or already filed,
 * which is what keeps a guest from redeploying mid-game.
 */
function applyDeploy(s: BattleshipState, userId: string, fleet: Placement[]): BattleshipState {
  if (s.status !== 'placing' || s.ready.includes(userId)) return s;
  if (!s.players.some((p) => p.id === userId)) return s;
  if (!validateFleet(fleet)) return s;

  const next: BattleshipState = {
    ...s,
    fleets: { ...s.fleets, [userId]: fleet },
    ready: [...s.ready, userId],
  };
  if (next.ready.length < next.players.length) return next;

  const turnIndex = Math.floor(Math.random() * next.players.length);
  return {
    ...next,
    status: 'playing',
    turnIndex,
    currentTurnId: next.players[turnIndex].id,
    phase: { kind: 'aiming' },
  };
}

function rotateTurn(s: BattleshipState): BattleshipState {
  const turnIndex = (s.turnIndex + 1) % s.players.length;
  return {
    ...s,
    turnIndex,
    currentTurnId: s.players[turnIndex].id,
    phase: { kind: 'aiming' },
  };
}

function endTurn(s: BattleshipState): BattleshipState {
  const settled = s.phase.kind === 'settling' ? s.phase : null;
  // A hit earns another shot — as long as the shooter is still at the table.
  if (settled?.extra && !s.droppedIds.includes(s.currentTurnId)) {
    return { ...s, phase: { kind: 'aiming' } };
  }
  return rotateTurn(s);
}

/**
 * Advance the game by exactly one phase. Host-only, and the only place a shot
 * is ever resolved. Every other client just receives the resulting snapshot.
 */
function advance(s: BattleshipState): BattleshipState {
  switch (s.phase.kind) {
    case 'deploying':
    case 'aiming':
      // Waits on a player; the host applies their request directly.
      return s;

    case 'firing': {
      const { targetId, cell } = s.phase;
      const struck = shipAt(s.fleets[targetId] ?? [], cell);
      const result: ShotResult = struck ? 'hit' : 'miss';

      const grid = [...(s.shots[targetId] ?? new Array(CELLS).fill(null))];
      grid[cell] = result;
      const shots = { ...s.shots, [targetId]: grid };

      // A hull goes down the moment its last cell is struck, which is the only
      // thing that ever makes an enemy ship public.
      const landed = { ...s, shots };
      const downed = struck && isSunk(struck, hitsOn(landed, targetId)) ? struck.ship : null;
      const sunk = downed
        ? { ...s.sunk, [targetId]: [...(s.sunk[targetId] ?? []), downed] }
        : s.sunk;

      return { ...landed, sunk, phase: { kind: 'splash', targetId, cell, result, sunk: downed } };
    }

    case 'splash': {
      const { targetId, result } = s.phase;
      if ((s.sunk[targetId]?.length ?? 0) === FLEET.length) {
        return { ...s, status: 'win', winnerId: s.currentTurnId, phase: { kind: 'settling' } };
      }
      return { ...s, phase: { kind: 'settling', extra: result === 'hit' } };
    }

    case 'settling':
      return endTurn(s);
  }
}

function buildInitialState(seats: PlayerInfo[], step: number): BattleshipState {
  const blankGrids = Object.fromEntries(
    seats.map((p) => [p.id, new Array<ShotResult | null>(CELLS).fill(null)])
  );
  return {
    players: seats,
    fleets: {},
    ready: [],
    shots: blankGrids,
    sunk: Object.fromEntries(seats.map((p) => [p.id, [] as ShipId[]])),
    droppedIds: [],
    // Placeholder until both fleets are in; applyDeploy picks the real opener.
    turnIndex: 0,
    currentTurnId: seats[0].id,
    phase: { kind: 'deploying' },
    step,
    status: 'placing',
    winnerId: null,
  };
}

// ─── Layout helpers ──────────────────────────────────────────────────────────
// Water cells live on a real 10x10 CSS grid so neighbours share exact edges.
// Hulls and markers have to animate between cells, so they sit on absolutely
// positioned layers inside the same box — which is what keeps the two
// coordinate systems in register.

const cellBox = (cell: number) => ({
  left: `${colOf(cell) * CELL_PCT}%`,
  top: `${rowOf(cell) * CELL_PCT}%`,
  width: `${CELL_PCT}%`,
  height: `${CELL_PCT}%`,
});

const shipBox = (placement: Placement) => {
  const length = SHIP_BY_ID[placement.ship]?.length ?? 1;
  return {
    left: `${colOf(placement.cell) * CELL_PCT}%`,
    top: `${rowOf(placement.cell) * CELL_PCT}%`,
    width: `${(placement.orientation === 'h' ? length : 1) * CELL_PCT}%`,
    height: `${(placement.orientation === 'v' ? length : 1) * CELL_PCT}%`,
  };
};

/**
 * Keyframes plus the two-board stage. The stage is plain CSS rather than
 * Tailwind classes because both boards are squares sharing one height budget,
 * and that budget changes when they go side by side on a wide screen — which
 * needs a media query that inline styles can't express.
 */
const GAME_CSS = `
  @keyframes bs-shell {
    0%   { transform: translate(-50%, -420%) scale(2.1); opacity: 0; }
    25%  { opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(0.7); opacity: 1; }
  }
  @keyframes bs-ripple {
    0%   { opacity: 0.9; transform: scale(0.3); }
    100% { opacity: 0;   transform: scale(2.8); }
  }
  @keyframes bs-blast {
    0%   { opacity: 1;   transform: scale(0.2); }
    55%  { opacity: 0.9; transform: scale(1.7); }
    100% { opacity: 0;   transform: scale(2.6); }
  }
  /* Animates outline rather than box-shadow so it can't fight a hull's own
     offset shadow, and outline never affects layout. */
  @keyframes bs-ready {
    0%, 100% { outline-color: rgba(49, 46, 129, 0); outline-offset: 2px; }
    50%      { outline-color: rgba(49, 46, 129, 0.35); outline-offset: 6px; }
  }
  @keyframes bs-mark {
    0%   { opacity: 0; transform: scale(1.6); }
    100% { opacity: 1; transform: scale(1); }
  }
  @keyframes bs-smoke {
    0%   { opacity: 0;   transform: scale(0.2) translate(0, 10%); }
    30%  { opacity: 0.4; transform: scale(1) translate(5%, -10%); }
    100% { opacity: 0;   transform: scale(1.5) translate(-10%, -30%); }
  }
  /* A sunk hull's scorch marks burn off so the hull itself can be read. */
  @keyframes bs-scorch-out {
    0%   { opacity: 1; transform: scale(1); }
    100% { opacity: 0; transform: scale(0.35) translateY(-12%); }
  }
  /* The wreck surfaces: opacity and transform only, so it runs on the
     compositor instead of repainting the hull every frame. */
  @keyframes bs-surface {
    0%   { opacity: 0; transform: translateY(5%) scale(1.12); }
    100% { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes bs-spray {
    0%   { opacity: 0;    transform: scale(0.6); }
    22%  { opacity: 0.85; }
    100% { opacity: 0;    transform: scale(1.45); }
  }
  @keyframes bs-reticle-in {
    0%   { opacity: 0; transform: scale(1.45); }
    100% { opacity: 1; transform: scale(1); }
  }
  @keyframes bs-aim-pulse {
    0%, 100% { opacity: 0.8; transform: translate(-50%, -50%) scale(0.8); }
    50%      { opacity: 1;   transform: translate(-50%, -50%) scale(1.15); }
  }

  /* ─── Tiles ───────────────────────────────────────────────────────────────
     Every unexplored cell is a tile. A struck tile dissolves for good, so the
     board reads as the flat open water it always was wherever a shell landed. */
  .bs-cell {
    position: relative;
    -webkit-tap-highlight-color: transparent;
  }
  .bs-tile {
    position: absolute;
    inset: 0.5px;
    border: 1px solid rgba(49, 46, 129, 0.13);
    border-radius: 2.5px;
    background: linear-gradient(158deg, #fbfdff 0%, #e7eef7 55%, #d8e3f0 100%);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.95),
      0 1px 1px rgba(30, 41, 59, 0.1);
    /* Arming has to feel like the press itself, so only the dissolve is slow. */
    transition:
      opacity 220ms ease-out,
      transform 110ms ease-out,
      background 90ms linear,
      border-color 90ms linear;
  }
  /* Struck: no tile, no outline — just the water that was under it. */
  .bs-tile.is-gone {
    opacity: 0;
    transform: scale(0.74);
    box-shadow: none;
    transition-duration: 220ms, 220ms, 90ms, 90ms;
  }
  /* Mouse only, and never mid-aim: a captured pointer keeps :hover on the cell
     it started from — and touch browsers hold it there after the finger lifts. */
  @media (hover: hover) and (pointer: fine) {
    .bs-grid:not(.is-aiming) .bs-cell:enabled:hover .bs-tile {
      background: linear-gradient(158deg, #fffdf2 0%, #fef3c7 60%, #fde68a 100%);
      border-color: rgba(180, 83, 9, 0.35);
    }
  }
  /* Armed under the finger, waiting on the release. */
  .bs-tile.is-armed {
    background: linear-gradient(158deg, #fff6cc 0%, #fde047 55%, #fbbf24 100%);
    border-color: rgba(146, 64, 14, 0.6);
    transform: scale(1.06);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.8),
      0 2px 7px rgba(120, 53, 15, 0.35);
  }

  .bs-spray {
    position: absolute;
    inset: -40%;
    border-radius: 9999px;
    background: radial-gradient(closest-side, rgba(255,255,255,0.9), rgba(255,255,255,0.35) 55%, rgba(255,255,255,0) 78%);
  }

  /* Aim guides: the finger covers the cell, so the lane reads off the edges. */
  .bs-guide { background: rgba(217, 119, 6, 0.16); }
  .bs-reticle { animation: bs-reticle-in 150ms ease-out; }
  /* Four corner brackets from one element: eight hairlines, no extra nodes. */
  .bs-reticle-ring {
    --bs-aim: rgba(146, 64, 14, 0.95);
    --bs-arm: 32%;
    position: absolute;
    inset: -10%;
    background:
      linear-gradient(var(--bs-aim), var(--bs-aim)) 0 0 / var(--bs-arm) 2px no-repeat,
      linear-gradient(var(--bs-aim), var(--bs-aim)) 0 0 / 2px var(--bs-arm) no-repeat,
      linear-gradient(var(--bs-aim), var(--bs-aim)) 100% 0 / var(--bs-arm) 2px no-repeat,
      linear-gradient(var(--bs-aim), var(--bs-aim)) 100% 0 / 2px var(--bs-arm) no-repeat,
      linear-gradient(var(--bs-aim), var(--bs-aim)) 0 100% / var(--bs-arm) 2px no-repeat,
      linear-gradient(var(--bs-aim), var(--bs-aim)) 0 100% / 2px var(--bs-arm) no-repeat,
      linear-gradient(var(--bs-aim), var(--bs-aim)) 100% 100% / var(--bs-arm) 2px no-repeat,
      linear-gradient(var(--bs-aim), var(--bs-aim)) 100% 100% / 2px var(--bs-arm) no-repeat;
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35));
  }
  .bs-reticle-dot {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 34%;
    height: 34%;
    border-radius: 9999px;
    background: radial-gradient(circle, rgba(190,18,60,0.95) 0 38%, rgba(190,18,60,0.28) 56%, rgba(190,18,60,0) 72%);
    animation: bs-aim-pulse 900ms ease-in-out infinite;
  }

  /* Stacked on a phone: enemy waters on top, your own below. */
  .bs-stage {
    --bs-budget: calc(var(--app-height, 100dvh) - 148px);
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 0 10px;
  }
  .bs-enemy { width: 100%; max-width: min(470px, calc(var(--bs-budget) * 0.60)); }
  .bs-own   { width: 100%; max-width: min(300px, calc(var(--bs-budget) * 0.32)); }

  /* Wide screen: your own waters move alongside, so both get more room. */
  @media (min-width: 900px) {
    .bs-stage {
      --bs-budget: calc(var(--app-height, 100dvh) - 126px);
      flex-direction: row;
      align-items: flex-end;
      justify-content: center;
      gap: 34px;
    }
    .bs-enemy { max-width: min(560px, var(--bs-budget)); }
    .bs-own   { max-width: min(320px, calc(var(--bs-budget) * 0.46)); }
  }
`;

// ─── Ship silhouettes ────────────────────────────────────────────────────────
// One unbroken outline per class, drawn bow-right in a `length * 20` by `20`
// box — so one SVG unit is a twentieth of a cell and the art lines up with the
// grid at any board size. Turrets, bridges and masts are steps in that single
// profile rather than separate shapes, which is what keeps each hull reading as
// one solid object. A vertical hull reuses the same path through a quarter
// turn, so the two orientations can never drift apart.

const HULL_LINE = '#312e81';

/** Clockwise from the stern: deck line with its superstructure, bow, keel. */
const SHIP_PATH: Record<ShipId, string> = {
  // Carrier: Flat flight deck, detailed island with radar, ski-jump bow, rear antenna.
  carrier:
    'M 4,10 L 2,10 L 2,8 L 4,8 L 4,6 L 5,6 L 5,8 L 64,8 L 64,3 L 66,3 L 66,1 L 68,1 L 68,3 L 73,3 L 73,8 L 92,8 L 96,6 L 98,6 L 98,11 L 86,18 L 12,18 Z',
  // Battleship: Massive multi-stepped turrets with long projecting cannons, tall bridge, and funnel.
  battleship:
    'M 4,12 L 14,12 L 14,8 L 20,8 L 20,7 L 28,7 L 28,7.5 L 22,7.5 L 22,10 L 28,10 L 28,5 L 32,5 L 32,2 L 34,2 L 34,5 L 38,5 L 38,3 L 42,3 L 42,6 L 46,6 L 46,10 L 50,10 L 50,8 L 56,8 L 56,7 L 64,7 L 64,7.5 L 58,7.5 L 58,12 L 76,12 L 78,13 L 68,18 L 8,18 Z',
  // Cruiser: Dual turrets with projecting guns, central superstructure with masts and radar.
  cruiser:
    'M 4,12 L 10,12 L 10,9 L 16,9 L 16,8 L 22,8 L 22,8.5 L 18,8.5 L 18,10 L 24,10 L 24,6 L 26,6 L 26,2 L 28,2 L 28,6 L 34,6 L 34,4 L 36,4 L 36,7 L 38,10 L 42,10 L 42,9 L 46,9 L 46,8 L 52,8 L 52,8.5 L 48,8.5 L 48,12 L 56,12 L 58,14 L 50,18 L 10,18 Z',
  // Submarine: Rounded hull, lower fin, upper sail with twin periscopes.
  submarine:
    'M 6,14 L 6,11 L 8,11 L 8,12 L 16,11 L 26,11 L 26,6 L 26,2 L 27,2 L 27,6 L 29,3 L 30,3 L 30,6 L 32,6 L 32,11 L 48,11 L 56,13 L 54,16 L 12,16 L 10,18 L 8,18 L 8,15 Z',
  // Destroyer: Small turrets with forward-pointing guns, compact bridge and mast.
  destroyer:
    'M 3,12 L 8,12 L 8,10 L 11,10 L 11,9.5 L 14,9.5 L 14,10 L 12,10 L 12,11 L 14,11 L 14,6 L 16,6 L 16,3 L 17,3 L 17,6 L 20,6 L 20,11 L 23,11 L 23,10 L 26,10 L 26,9.5 L 30,9.5 L 30,10 L 27,10 L 27,12 L 36,12 L 38,13 L 32,17 L 8,17 Z',
};

const SHIP_DETAILS: Record<ShipId, string> = {
  carrier:
    'M 12,10 h8 m4,0 h8 m4,0 h8 m4,0 h8 m4,0 h8 m4,0 h8 m4,0 h8 ' +
    'M 65,5 L 72,5 M 65,7 L 72,7',
  battleship:
    'M 8,13 L 74,13 ' +
    'M 15,9 L 19,9 M 51,9 L 55,9 ' +
    'M 29,6 L 31,6 M 29,8 L 31,8 ' +
    'M 39,4 L 39,6 M 41,4 L 41,6',
  cruiser:
    'M 8,13 L 52,13 ' +
    'M 25,7 L 27,7 M 25,9 L 27,9 M 33,8 L 37,8',
  submarine:
    'M 12,13 L 50,13 ' +
    'M 28,7 L 31,7 M 28,9 L 31,9 M 40,11 L 44,11',
  destroyer:
    'M 6,13 L 34,13 ' +
    'M 15,7 L 19,7 M 15,9 L 19,9',
};

interface ShipArtProps {
  ship: ShipId;
  orientation?: Orientation;
  color: string;
  className?: string;
  style?: React.CSSProperties;
}

function ShipArt({ ship, orientation = 'h', color, className = '', style }: ShipArtProps) {
  const span = (SHIP_BY_ID[ship]?.length ?? 1) * 20;
  const horizontal = orientation === 'h';
  const gradId = `hull-shade-${ship}`;

  return (
    <svg
      viewBox={horizontal ? `0 0 ${span} 20` : `0 0 20 ${span}`}
      preserveAspectRatio="none"
      className={`w-full h-full ${className}`}
      style={style}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
          <stop offset="40%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.35" />
        </linearGradient>
      </defs>
      {/* A quarter turn about the origin, nudged back into the box. */}
      <g transform={horizontal ? undefined : 'translate(20,0) rotate(90)'}>
        {/* Base hull. The fill transitions so a hull going down on your own
            board darkens rather than snapping to black. */}
        <path
          d={SHIP_PATH[ship]}
          fill={color}
          stroke={HULL_LINE}
          strokeWidth="1.7"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          style={{ transition: 'fill 320ms ease' }}
        />
        {/* 3D Shading overlay */}
        <path
          d={SHIP_PATH[ship]}
          fill={`url(#${gradId})`}
          pointerEvents="none"
        />
        {/* Inner details */}
        {SHIP_DETAILS[ship] && (
          <path
            d={SHIP_DETAILS[ship]}
            fill="none"
            stroke={HULL_LINE}
            strokeWidth="1.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity="0.5"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </g>
    </svg>
  );
}

/**
 * Which of an owner's hulls are still afloat, as a row of silhouettes. Widths
 * are proportional to hull length and sized in flex units rather than pixels,
 * so the row always spans its board exactly — and the silhouettes stay the same
 * scale as the ships drawn on it.
 */
function FleetRoster({ sunk, color }: { sunk: ShipId[]; color: string }) {
  return (
    <div className="flex items-center justify-center gap-[2%] w-full">
      {FLEET.map((ship) => {
        const down = sunk.includes(ship.id);
        return (
          <div
            key={ship.id}
            className="transition-opacity duration-500"
            style={{
              flex: `${ship.length} 1 0`,
              aspectRatio: `${ship.length} / 1`,
              opacity: down ? 0.28 : 1,
            }}
          >
            <ShipArt
              ship={ship.id}
              color={down ? '#94a3b8' : color}
              style={{ filter: down ? undefined : 'drop-shadow(0 1px 1px rgba(0,0,0,0.25))' }}
            />
          </div>
        );
      })}
    </div>
  );
}

// ─── Board ───────────────────────────────────────────────────────────────────

interface BoardGridProps {
  /** Shots fired *at* this board. */
  shots: (ShotResult | null)[];
  /**
   * Hulls to draw. Only ever the viewer's own fleet, or an enemy hull that has
   * already been sunk and is therefore public knowledge.
   */
  hulls: Placement[];
  /** Ships that are sunk, used to turn them black and clear their hit marks. */
  sunkHulls?: ShipId[];
  color: string;
  /** Enemy water on your turn: tiles become fire buttons. */
  interactive?: boolean;
  onFire?: (cell: number) => void;
  /** The cell currently taking fire, if this is the board being shot at. */
  impact?: { cell: number; stage: 'firing' | 'splash'; result?: ShotResult } | null;
  /** Hulls that appear by being sunk surface out of the water. */
  revealHulls?: boolean;
  /** Placement hulls during setup, which manage their own drag state. */
  overlay?: React.ReactNode;
  gridRef?: React.RefObject<HTMLDivElement | null>;
}

/** A shot being lined up. `cell` is null whenever the finger is off a target. */
interface AimState {
  cell: number | null;
  pointerId: number;
}

function BoardGrid({
  shots,
  hulls,
  sunkHulls = [],
  color,
  interactive = false,
  onFire,
  impact = null,
  revealHulls = false,
  overlay,
  gridRef,
}: BoardGridProps) {
  // Cells of a sunk hull, bow first, so their scorch marks can burn off in
  // sequence rather than all at once as the wreck comes up.
  const sunkOrder = new Map<number, number>();
  hulls.forEach((placement) => {
    if (sunkHulls.includes(placement.ship)) {
      shipCells(placement).forEach((cell, index) => sunkOrder.set(cell, index));
    }
  });

  // ── Press to aim, release to fire ──────────────────────────────────────────
  // The shot is only committed on the release, so a finger that landed on the
  // wrong cell can slide to the right one — or off the grid to call it off.
  // A quick tap is still a press and a release, so it still fires.
  //
  // The aim deliberately never leaves this component: routing it up to the HUD
  // would re-render both boards on every cell the finger crosses.
  const waterRef = useRef<HTMLDivElement | null>(null);
  const [aim, setAim] = useState<AimState | null>(null);
  const aimRef = useRef<AimState | null>(null);

  const setAimState = (next: AimState | null) => {
    aimRef.current = next;
    setAim(next);
  };

  // The turn ending mid-press — a sync, a drop — must not leave a live reticle.
  useEffect(() => {
    if (!interactive && aimRef.current) setAimState(null);
  }, [interactive]);

  /** The open cell under a pointer; null off the grid, or on a spent cell. */
  const targetUnder = (clientX: number, clientY: number): number | null => {
    const rect = waterRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    const col = Math.floor(((clientX - rect.left) / rect.width) * GRID);
    const row = Math.floor(((clientY - rect.top) / rect.height) * GRID);
    if (row < 0 || row >= GRID || col < 0 || col >= GRID) return null;
    const cell = cellAt(row, col);
    return (shots[cell] ?? null) === null ? cell : null;
  };

  const armShot = (cell: number, e: React.PointerEvent<HTMLButtonElement>) => {
    if (!interactive) return;
    // Captured, so the drag keeps reporting here even once it leaves this cell.
    e.currentTarget.setPointerCapture(e.pointerId);
    feedback.pop();
    setAimState({ cell, pointerId: e.pointerId });
  };

  const moveShot = (e: React.PointerEvent<HTMLButtonElement>) => {
    const current = aimRef.current;
    if (!current || current.pointerId !== e.pointerId) return;
    const cell = targetUnder(e.clientX, e.clientY);
    if (cell === current.cell) return;
    // Silent tick per cell crossed: audible at this rate would be a rattle.
    if (cell !== null) feedback.customHaptic([{ duration: 10, intensity: 0.15 }]);
    setAimState({ ...current, cell });
  };

  const releaseShot = (e: React.PointerEvent<HTMLButtonElement>) => {
    const current = aimRef.current;
    if (!current || current.pointerId !== e.pointerId) return;
    setAimState(null);
    if (current.cell !== null) onFire?.(current.cell);
  };

  const cancelShot = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (aimRef.current?.pointerId !== e.pointerId) return;
    setAimState(null);
  };

  const aimed = aim?.cell ?? null;

  return (
    <div className="w-full aspect-square relative rounded-lg overflow-hidden select-none bg-[#8ed2ef]">
      <div ref={gridRef} className="absolute inset-0">
        {/* Unexplored water is a grid of tiles, and every tile is its own fire
            button. A struck tile dissolves and never comes back. */}
        <div
          ref={waterRef}
          className={`bs-grid absolute inset-0 grid grid-cols-10 grid-rows-10 touch-none ${
            aim ? 'is-aiming' : ''
          }`}
        >
          {Array.from({ length: CELLS }, (_, cell) => {
            const fired = shots[cell] ?? null;
            const open = interactive && fired === null;
            const armed = aimed === cell;
            return (
              <button
                key={cell}
                type="button"
                disabled={!open}
                // Pointers fire on their release. A click with a detail of 0 is
                // a keyboard activation, which has no release to wait for.
                onClick={(e) => {
                  if (e.detail === 0) onFire?.(cell);
                }}
                onPointerDown={(e) => armShot(cell, e)}
                onPointerMove={moveShot}
                onPointerUp={releaseShot}
                onPointerCancel={cancelShot}
                aria-label={open ? `Fire at ${cellName(cell)}` : `${cellName(cell)}${fired ? `, ${fired}` : ''}`}
                className={`bs-cell ${open ? 'cursor-pointer' : 'cursor-default'} ${
                  armed ? 'z-[1]' : ''
                }`}
              >
                <span
                  className={`bs-tile ${fired !== null ? 'is-gone' : ''} ${armed ? 'is-armed' : ''}`}
                />
              </button>
            );
          })}
        </div>

        {/* Hulls, above the water but below the shot markers */}
        <div className="absolute inset-0 pointer-events-none z-[2]">
          {hulls.map((placement) => {
            const down = sunkHulls.includes(placement.ship);
            const surfacing = revealHulls && down;
            return (
              <div key={placement.ship} className="absolute p-[2px]" style={shipBox(placement)}>
                {/* Sea whitening around a wreck on the way up. */}
                {surfacing && (
                  <span
                    className="bs-spray"
                    style={{ animation: `bs-spray ${SPRAY_MS}ms ease-out ${WRECK_DELAY_MS}ms both` }}
                  />
                )}
                <div
                  className="w-full h-full"
                  style={
                    surfacing
                      ? {
                          animation: `bs-surface ${WRECK_MS}ms cubic-bezier(0.22, 1, 0.36, 1) ${WRECK_DELAY_MS}ms both`,
                        }
                      : undefined
                  }
                >
                  {/* Dead in the water, so the hull lists as it settles. */}
                  <div
                    className="w-full h-full"
                    style={{
                      transform: down ? 'rotate(-1.6deg) scale(0.97)' : undefined,
                      transformOrigin: '50% 60%',
                      transition: 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
                    }}
                  >
                    <ShipArt
                      ship={placement.ship}
                      orientation={placement.orientation}
                      color={down ? '#111111' : color}
                      style={{ filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.3))' }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Hit marks. A miss leaves nothing at all: the gap where its tile used
            to be is the whole record of it. */}
        <div className="absolute inset-0 pointer-events-none z-[3]">
          {shots.map((result, cell) => {
            if (result !== 'hit') return null;
            const burningOff = sunkOrder.has(cell);
            const fresh = impact?.stage === 'splash' && impact.cell === cell;

            return (
              <div
                key={cell}
                className="absolute flex items-center justify-center"
                style={cellBox(cell)}
              >
                <div
                  className="w-[96%] h-[96%] bg-[#111111] rounded-[2px] flex items-center justify-center overflow-hidden"
                  style={{
                    boxShadow: '0 0 10px rgba(0,0,0,0.5)',
                    animation: burningOff
                      ? `bs-scorch-out ${SCORCH_OUT_MS}ms ease-in ${
                          (sunkOrder.get(cell) ?? 0) * SCORCH_STEP_MS
                        }ms forwards`
                      : 'bs-mark 180ms ease-out backwards',
                  }}
                >
                  {/* Smoke only on the cell that was just struck. One blurred,
                      blended layer per hit would sit on the board forever and
                      cost every frame after it, so this is a gradient that
                      unmounts with the splash. */}
                  {fresh && !burningOff && (
                    <span
                      className="absolute w-[180%] h-[180%] rounded-full"
                      style={{
                        background:
                          'radial-gradient(closest-side, rgba(203,213,225,0.55), rgba(203,213,225,0) 72%)',
                        animation: `bs-smoke ${SPLASH_HIT_MS}ms ease-out forwards`,
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* The shell in flight and its impact */}
        {impact && (
          <div
            className="absolute pointer-events-none z-[4] flex items-center justify-center"
            style={cellBox(impact.cell)}
          >
            {impact.stage === 'firing' ? (
              <span
                className="absolute left-1/2 top-1/2 w-[52%] h-[52%] rounded-full bg-indigo-900"
                style={{
                  boxShadow: '0 8px 12px rgba(0,0,0,0.45)',
                  animation: `bs-shell ${FIRE_MS}ms cubic-bezier(0.5, 0, 0.75, 0) forwards`,
                }}
              />
            ) : impact.result === 'hit' ? (
              <span
                className="absolute w-full h-full rounded-full bg-orange-400 border-4 border-rose-600"
                style={{ animation: `bs-blast ${SPLASH_HIT_MS}ms ease-out forwards` }}
              />
            ) : (
              <span
                className="absolute w-full h-full rounded-full border-4 border-white/90"
                style={{ animation: `bs-ripple ${SPLASH_MISS_MS}ms ease-out forwards` }}
              />
            )}
          </div>
        )}

        {/* The shot held under the finger, with lane guides the finger can't
            cover and a reticle on the cell itself. */}
        {aimed !== null && (
          <>
            <div
              className="bs-guide absolute inset-y-0 pointer-events-none z-[4]"
              style={{ left: `${colOf(aimed) * CELL_PCT}%`, width: `${CELL_PCT}%` }}
            />
            <div
              className="bs-guide absolute inset-x-0 pointer-events-none z-[4]"
              style={{ top: `${rowOf(aimed) * CELL_PCT}%`, height: `${CELL_PCT}%` }}
            />
            <div className="bs-reticle absolute pointer-events-none z-[5]" style={cellBox(aimed)}>
              <span className="bs-reticle-ring" />
              <span className="bs-reticle-dot" />
            </div>
          </>
        )}

        {overlay}
      </div>
    </div>
  );
}

// ─── Drag state for the placement screen ─────────────────────────────────────

interface DragState {
  ship: ShipId;
  /** Cells from the bow where the finger went down, so the hull keeps its grip. */
  grab: number;
  /** Snapped bow cell under the finger. */
  cell: number;
  orientation: Orientation;
  valid: boolean;
  /** Crossed the slop threshold, so this is a drag and not a tap-to-rotate. */
  moved: boolean;
  startX: number;
  startY: number;
  pointerId: number;
}

export default function Battleship({
  sendDataToPeers,
  incomingData,
  onGameEnd,
}: GameProps<BattleshipData>) {
  const { isHost, peers } = useNetworkStore();
  const { userId } = useUser();

  const [gameState, setGameState] = useState<BattleshipState | null>(null);

  // Mirror of the latest committed state. The timer effect and the incoming
  // message handler both need to read the newest snapshot synchronously, and
  // reading it here keeps sendDataToPeers out of a setState updater (React 19
  // StrictMode double-invokes updaters, which would double-send).
  const stateRef = useRef<BattleshipState | null>(null);
  const initialized = useRef(false);

  /** Host only: adopt a new snapshot, bump the step counter and broadcast it. */
  const commit = (next: BattleshipState) => {
    const stamped: BattleshipState = { ...next, step: next.step + 1 };
    stateRef.current = stamped;
    setGameState(stamped);
    sendDataToPeers({ type: 'SYNC', ...stamped });
  };

  /** Adopt an incoming snapshot without re-broadcasting it. */
  const applySync = (next: BattleshipState) => {
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
  // Keyed on `step` rather than on `phase`, so two identical-looking phases in a
  // row still re-fire instead of being swallowed by an unchanged object identity.
  useEffect(() => {
    if (!isHost) return;
    const s = stateRef.current;
    if (!s || s.status !== 'playing') return;

    const delay = phaseDelay(s.phase);
    if (delay === null) return; // aiming waits on the player

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
    if (!s) return;

    if (incomingData.type === 'DEPLOY') {
      const next = applyDeploy(s, incomingData.userId, incomingData.fleet);
      if (next !== s) commit(next);
    } else if (incomingData.type === 'FIRE') {
      if (canFireAt(s, incomingData.userId, incomingData.cell)) {
        commit(beginFire(s, incomingData.cell));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingData, isHost]);

  // ── Players leaving and returning mid-game (host only) ─────────────────────
  useEffect(() => {
    if (!isHost || !initialized.current) return;
    const s = stateRef.current;
    if (!s) return;

    // `droppedIds` is derived from the roster rather than accumulated, so a
    // player who reconnects is un-benched by the same pass that benched them.
    // A peer with `connected: false` is inside their grace window: still seated,
    // keeping their fleet and their damage, and the battle simply holds — with
    // only two captains there is nobody to rotate to, and letting the other one
    // keep firing at an absent fleet would decide the game by connection quality.
    const playable = new Set(peers.filter((p) => p.connected).map((p) => p.id));
    const seated = new Set(peers.map((p) => p.id));

    const droppedIds = s.players.filter((p) => !playable.has(p.id)).map((p) => p.id);

    const unchanged =
      droppedIds.length === s.droppedIds.length &&
      droppedIds.every((id) => s.droppedIds.includes(id));
    if (unchanged) return;

    // Only end the game once the host has actually released a seat. Someone who
    // is merely reconnecting must not collapse the match.
    if (s.players.filter((p) => seated.has(p.id)).length < 2) {
      onGameEnd();
      return;
    }

    commit({ ...s, droppedIds });
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

    if (phase.kind === 'firing') feedback.hit('light');
    else if (phase.kind === 'splash') {
      if (phase.sunk) feedback.score();
      else if (phase.result === 'hit') feedback.hit('heavy');
      else feedback.boop();
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

  // ── Placement (local until the player commits) ─────────────────────────────
  const [fleet, setFleet] = useState<Placement[]>(() => randomFleet());
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [deploySent, setDeploySent] = useState(false);

  // Entering placement — first mount or a rematch — hands back a fresh board.
  const prevStatusRef = useRef<BattleshipState['status'] | null>(null);
  useEffect(() => {
    const status = gameState?.status ?? null;
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (status === 'placing' && prev !== 'placing') {
      setDeploySent(false);
      setFleet(randomFleet());
    }
  }, [gameState?.status]);

  const setDragState = (next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  /** Grid cell under a pointer, clamped to the board so a hull never escapes. */
  const cellFromPointer = (clientX: number, clientY: number): number | null => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    const col = Math.floor(((clientX - rect.left) / rect.width) * GRID);
    const row = Math.floor(((clientY - rect.top) / rect.height) * GRID);
    return cellAt(clamp(row, 0, GRID - 1), clamp(col, 0, GRID - 1));
  };

  const startDrag = (placement: Placement, e: React.PointerEvent<HTMLDivElement>) => {
    if (deploySent) return;
    const under = cellFromPointer(e.clientX, e.clientY);
    const grab = under === null ? 0 : Math.max(0, shipCells(placement).indexOf(under));
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragState({
      ship: placement.ship,
      grab,
      cell: placement.cell,
      orientation: placement.orientation,
      valid: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
    });
  };

  const moveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== e.pointerId) return;

    const moved =
      current.moved ||
      Math.abs(e.clientX - current.startX) > TAP_SLOP ||
      Math.abs(e.clientY - current.startY) > TAP_SLOP;

    const under = cellFromPointer(e.clientX, e.clientY);
    if (under === null) return;

    // Keep the grip point under the finger, then pull the whole hull on-grid so
    // the preview is always a real placement and only collisions can invalidate it.
    const limit = maxBow(current.ship, current.orientation);
    const bowRow = current.orientation === 'v' ? rowOf(under) - current.grab : rowOf(under);
    const bowCol = current.orientation === 'h' ? colOf(under) - current.grab : colOf(under);
    const cell = cellAt(clamp(bowRow, 0, limit.row), clamp(bowCol, 0, limit.col));

    const others = fleet.filter((p) => p.ship !== current.ship);
    const valid = canPlace({ ship: current.ship, cell, orientation: current.orientation }, others);

    if (cell === current.cell && valid === current.valid && moved === current.moved) return;
    setDragState({ ...current, cell, valid, moved });
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== e.pointerId) return;
    setDragState(null);

    const target = fleet.find((p) => p.ship === current.ship);
    if (!target) return;
    const others = fleet.filter((p) => p.ship !== current.ship);

    // Barely moved: this was a tap, so spin the hull on the spot.
    if (!current.moved) {
      const turned = rotated(target, others);
      if (!turned) {
        feedback.hit('light');
        return;
      }
      feedback.pop();
      setFleet(fleet.map((p) => (p.ship === current.ship ? turned : p)));
      return;
    }

    if (!current.valid) {
      feedback.hit('light'); // bounced back to where it was
      return;
    }

    feedback.pop();
    setFleet(
      fleet.map((p) =>
        p.ship === current.ship
          ? { ...p, cell: current.cell, orientation: current.orientation }
          : p
      )
    );
  };

  const cancelDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const current = dragRef.current;
    if (!current || current.pointerId !== e.pointerId) return;
    setDragState(null);
  };

  const handleShuffle = () => {
    if (deploySent) return;
    feedback.tap();
    setFleet(randomFleet());
  };

  const handleDeploy = () => {
    if (deploySent || !validateFleet(fleet)) return;
    feedback.tap();
    setDeploySent(true);
    if (isHost) {
      const s = stateRef.current;
      if (s) {
        const next = applyDeploy(s, userId, fleet);
        if (next !== s) commit(next);
      }
    } else {
      sendDataToPeers({ type: 'DEPLOY', userId, fleet });
    }
  };

  // ── Firing ─────────────────────────────────────────────────────────────────
  const handleFire = (cell: number) => {
    const s = stateRef.current;
    if (!s || !canFireAt(s, userId, cell)) return;
    feedback.tap();
    if (isHost) {
      commit(beginFire(s, cell));
    } else {
      sendDataToPeers({ type: 'FIRE', userId, cell });
    }
  };

  const handleRestart = () => {
    if (!isHost) return;
    feedback.tap();
    if (peers.filter((p) => p.id !== userId).length === 0) return;
    const seats: PlayerInfo[] = peers.map((p) => ({ id: p.id, name: p.name }));
    commit(buildInitialState(seats, stateRef.current?.step ?? 0));
  };

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
  const myColor = playerColor(Math.max(0, seatOf(userId)));
  const opponentId = opponentOf(gameState, userId);
  const enemyColor = playerColor(opponentId ? Math.max(0, seatOf(opponentId)) : 1);
  const blankGrid = new Array<ShotResult | null>(CELLS).fill(null);

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
            className={`text-5xl sm:text-6xl font-black uppercase tracking-tight ${
              isWinner ? 'text-emerald-500' : 'text-red-500'
            }`}
          >
            {isWinner ? 'Victory!' : 'Defeat'}
          </h1>
          <p className="text-slate-600 font-bold mt-4 text-base uppercase tracking-wider">
            {isWinner ? 'Enemy fleet sunk!' : `${nameOf(gameState.winnerId ?? '')} sank your fleet.`}
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

  const reconnectBanner = gameState.droppedIds.length > 0 && (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 bg-amber-300 border-2 border-indigo-900 rounded-xl px-3 py-1.5 shadow-lg">
      <span className="text-[11px] font-black uppercase tracking-wider text-indigo-900 animate-pulse">
        Waiting for {gameState.droppedIds.map(nameOf).join(', ')} to reconnect
      </span>
    </div>
  );

  // ── Placement screen ───────────────────────────────────────────────────────
  if (gameState.status === 'placing') {
    const locked = deploySent || gameState.ready.includes(userId);

    return (
      <div className="flex flex-col items-center w-full h-[var(--app-height,100dvh)] font-mono relative overflow-hidden bg-slate-100">
        <style>{GAME_CSS}</style>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ backgroundColor: `${myColor}2E` }}
        />
        {isHost && <ExitButton onExit={onGameEnd} />}

        <div className="shrink-0 pt-5 pb-3 text-center relative z-10 px-4">
          <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight text-indigo-900">
            {locked ? 'Fleet Deployed' : 'Deploy Your Fleet'}
          </h1>
          <p className="text-indigo-900/60 font-bold text-[11px] sm:text-xs uppercase tracking-wider mt-1">
            {locked
              ? `Waiting for ${opponentId ? nameOf(opponentId) : 'opponent'}...`
              : 'Drag to move · Tap to rotate'}
          </p>
        </div>

        <div className="shrink-0 w-full flex justify-center px-3 relative z-0">
          <div
            className="w-full"
            style={{ maxWidth: 'min(520px, calc(var(--app-height, 100dvh) - 244px))' }}
          >
            <BoardGrid
              shots={blankGrid}
              hulls={[]}
              color={myColor}
              gridRef={gridRef}
              overlay={
                <div className={`absolute inset-0 z-[5] ${locked ? 'pointer-events-none' : ''}`}>
                  {fleet.map((placement) => {
                    const dragging = drag?.ship === placement.ship;
                    const shown: Placement = dragging
                      ? { ship: placement.ship, cell: drag.cell, orientation: drag.orientation }
                      : placement;
                    const invalid = dragging && !drag.valid;

                    return (
                      <div
                        key={placement.ship}
                        onPointerDown={(e) => startDrag(placement, e)}
                        onPointerMove={moveDrag}
                        onPointerUp={endDrag}
                        onPointerCancel={cancelDrag}
                        className={`absolute p-[2px] touch-none ${
                          locked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
                        }`}
                        style={{
                          ...shipBox(shown),
                          zIndex: dragging ? 3 : 1,
                          transitionProperty: 'left, top, width, height',
                          transitionDuration: dragging ? '110ms' : '260ms',
                          transitionTimingFunction: 'cubic-bezier(0.34, 1.3, 0.64, 1)',
                        }}
                      >
                        <div
                          className="w-full h-full transition-transform duration-200"
                          style={{ transform: `scale(${dragging ? 1.1 : 1})` }}
                        >
                          <ShipArt
                            ship={shown.ship}
                            orientation={shown.orientation}
                            color={invalid ? '#f43f5e' : myColor}
                            style={{
                              filter: dragging
                                ? 'drop-shadow(0 6px 8px rgba(0,0,0,0.45))'
                                : 'drop-shadow(0 2px 2px rgba(0,0,0,0.3))',
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              }
            />
          </div>
        </div>

        <div className="shrink min-h-0 w-full h-3" />

        <div className="shrink-0 w-full flex gap-3 px-4 pb-4 max-w-[440px] relative z-10">
          <button
            onClick={handleShuffle}
            disabled={locked}
            className={`flex-1 bg-white text-indigo-900 border-2 border-indigo-900 rounded-2xl py-3 font-black text-base uppercase transition-all ${
              locked
                ? 'opacity-50 cursor-default'
                : 'cursor-pointer shadow-[0_4px_0_theme(colors.indigo.900)] active:shadow-none active:translate-y-[4px]'
            }`}
          >
            Shuffle
          </button>
          <button
            onClick={handleDeploy}
            disabled={locked}
            className={`flex-1 border-2 border-indigo-900 rounded-2xl py-3 font-black text-base uppercase transition-all ${
              locked
                ? 'bg-slate-200 text-slate-400 cursor-default'
                : 'bg-indigo-600 hover:bg-indigo-700 text-white cursor-pointer shadow-[0_4px_0_theme(colors.indigo.900)] active:shadow-none active:translate-y-[4px]'
            }`}
            style={
              locked
                ? undefined
                : {
                    outline: '2px solid transparent',
                    animation: 'bs-ready 1.6s ease-in-out infinite',
                  }
            }
          >
            Ready
          </button>
        </div>

        {reconnectBanner}
      </div>
    );
  }

  // ── Battle screen ──────────────────────────────────────────────────────────
  const { phase } = gameState;
  const isMyTurn = gameState.currentTurnId === userId;
  const everyoneHere = gameState.droppedIds.length === 0;
  const turnColor = playerColor(Math.max(0, seatOf(gameState.currentTurnId)));

  const canFire = isMyTurn && phase.kind === 'aiming' && everyoneHere && opponentId !== null;
  const subLine = canFire ? 'Hold to aim · release to fire' : '';

  // The only enemy hulls ever drawn are the ones already on the bottom.
  const enemySunk = opponentId ? gameState.sunk[opponentId] ?? [] : [];
  const enemyWrecks = opponentId
    ? (gameState.fleets[opponentId] ?? []).filter((p) => enemySunk.includes(p.ship))
    : [];

  /** The shell overlay belongs to whichever board is being shot at. */
  const impactOn = (ownerId: string | null) =>
    ownerId !== null &&
    (phase.kind === 'firing' || phase.kind === 'splash') &&
    phase.targetId === ownerId
      ? {
          cell: phase.cell,
          stage: phase.kind,
          result: phase.kind === 'splash' ? phase.result : undefined,
        }
      : null;

  return (
    <div className="flex flex-col items-center w-full h-[var(--app-height,100dvh)] font-mono relative overflow-hidden bg-slate-100">
      <style>{GAME_CSS}</style>
      <div
        className="absolute inset-0 transition-colors duration-500 pointer-events-none"
        style={{ backgroundColor: `${turnColor}2E` }}
      />
      {isHost && <ExitButton onExit={onGameEnd} />}

      {/* Morphing turn indicator (absolute so it never shifts the boards) */}
      <div className="absolute top-0 left-0 w-full flex justify-center z-20 pointer-events-none">
        <div
          className={`
            transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)]
            flex flex-col items-center justify-end border-indigo-900
            ${
              isMyTurn
                ? 'w-[280px] h-[82px] sm:w-[340px] sm:h-[92px] rounded-b-[100%] shadow-[0_12px_24px_rgba(0,0,0,0.25)] border-b-8 border-x-8 pb-3'
                : 'w-[220px] h-[56px] sm:w-[260px] sm:h-[64px] rounded-b-[100%] shadow-md border-b-4 border-x-4 pb-1.5 opacity-90 -translate-y-1'
            }
          `}
          style={{ backgroundColor: turnColor }}
        >
          <span
            className={`transition-all duration-700 uppercase font-black tracking-widest text-indigo-900 truncate max-w-[88%] ${
              isMyTurn ? 'text-2xl sm:text-3xl' : 'text-sm sm:text-base'
            }`}
          >
            {isMyTurn ? 'Your Turn' : nameOf(gameState.currentTurnId)}
          </span>

          <div
            className={`transition-all duration-700 overflow-hidden ${
              subLine ? 'max-h-10 opacity-100 mt-0.5' : 'max-h-0 opacity-0 mt-0'
            }`}
          >
            <span className="text-indigo-900/70 font-bold text-xs sm:text-sm whitespace-nowrap">
              {subLine}
            </span>
          </div>
        </div>
      </div>

      {/* Both fleets at once: the enemy's waters, and your own. */}
      <div className="flex-1 min-h-0 w-full flex items-center justify-center pt-[86px] sm:pt-[96px] pb-3 relative z-0">
        <div className="bs-stage">
          <div className="bs-enemy">
            <div className="pb-2">
              <FleetRoster sunk={enemySunk} color={enemyColor} />
            </div>
            <BoardGrid
              shots={(opponentId && gameState.shots[opponentId]) || blankGrid}
              hulls={enemyWrecks}
              sunkHulls={enemySunk}
              color={enemyColor}
              interactive={canFire}
              onFire={handleFire}
              impact={impactOn(opponentId)}
              revealHulls
            />
          </div>

          <div className="bs-own">
            <div className="pb-2">
              <FleetRoster sunk={gameState.sunk[userId] ?? []} color={myColor} />
            </div>
            <BoardGrid
              shots={gameState.shots[userId] ?? blankGrid}
              hulls={gameState.fleets[userId] ?? []}
              sunkHulls={gameState.sunk[userId] ?? []}
              color={myColor}
              impact={impactOn(userId)}
            />
          </div>
        </div>
      </div>

      {reconnectBanner}
    </div>
  );
}
