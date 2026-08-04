import { useRef, useEffect, useState } from 'react';
import type { GameProps } from '../GameProps';
import { useNetworkStore } from '../../platform/store/useNetworkStore';
import { useUser } from '../../platform/store/useUserStore';
import { ExitButton } from '../components/ExitButton';
import { feedback } from '../../platform/feedback/feedbackManager';
import type { AirHockeyData, GameState, Vec2, Puck, Paddle } from './types';

// ─── Feedback Throttle Helper ────────────────────────────────────────────────

let lastHitFeedbackTime = 0;
function triggerHitFeedback(intensity: 'light' | 'medium' | 'heavy' = 'medium') {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - lastHitFeedbackTime > 75) {
    lastHitFeedbackTime = now;
    feedback.hit(intensity);
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TABLE_WIDTH = 400;
const TABLE_HEIGHT = 600;
const PUCK_RADIUS = 15;
const PADDLE_RADIUS = 30;
const GOAL_WIDTH = 140;

const PUCK_FRICTION = 0.998;        // Multiplicative drag per frame (at 60 fps base)
const WALL_RESTITUTION = 0.75;      // Energy kept on wall bounce
const PADDLE_RESTITUTION = 0.85;    // Energy kept on paddle hit
const MAX_PUCK_SPEED = 2000;        // px / s – hard cap
const PHYSICS_SUBSTEPS = 4;         // Subdivisions per frame for stable collision
const MAX_DT = 1 / 30;              // Cap delta-time to avoid physics explosion
const MIN_DT = 1 / 240;             // Floor delta-time to avoid velocity spikes
const PADDLE_VEL_LERP = 0.7;        // EMA weight for new paddle velocity sample
const VELOCITY_DEAD_ZONE = 0.5;     // Below this the puck is considered stopped
const SYNC_INTERVAL_MS = 16;        // ~60Hz network broadcast rate
const WIN_SCORE = 5;                // First to reach this score wins

// ─── Vector Helpers ──────────────────────────────────────────────────────────

const v2 = (x: number, y: number): Vec2 => ({ x, y });
const v2Add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
const v2Sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const v2Scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
const v2Dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
const v2Len = (a: Vec2): number => Math.sqrt(a.x * a.x + a.y * a.y);
const v2Dist = (a: Vec2, b: Vec2): number => v2Len(v2Sub(a, b));

function v2Normalize(a: Vec2): Vec2 {
  const l = v2Len(a);
  return l > 1e-8 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

function v2ClampLen(a: Vec2, max: number): Vec2 {
  const l = v2Len(a);
  return l > max ? v2Scale(v2Normalize(a), max) : a;
}

// ─── State Factory ───────────────────────────────────────────────────────────

function createInitialState(): GameState {
  const cx = TABLE_WIDTH / 2;
  return {
    puck: {
      pos: v2(cx, TABLE_HEIGHT / 2),
      vel: v2(0, 0),
    },
    paddles: [
      {
        pos: v2(cx, 80),
        vel: v2(0, 0),
        targetPos: v2(cx, 80),
        grabbed: false,
        touchId: null,
      },
      {
        pos: v2(cx, TABLE_HEIGHT - 80),
        vel: v2(0, 0),
        targetPos: v2(cx, TABLE_HEIGHT - 80),
        grabbed: false,
        touchId: null,
      },
    ],
    score: [0, 0],
    status: 'playing',
    winnerIdx: null,
  };
}

function resetPuck(state: GameState): void {
  const cx = TABLE_WIDTH / 2;
  state.puck.pos = v2(cx, TABLE_HEIGHT / 2);
  state.puck.vel = v2(0, 0);
}

// ─── Constraint & Collision Helpers ──────────────────────────────────────────

/** Clamp paddle to its half of the table (top or bottom). */
function constrainPaddle(paddle: Paddle, isTop: boolean): void {
  const minX = PADDLE_RADIUS;
  const maxX = TABLE_WIDTH - PADDLE_RADIUS;
  const minY = isTop ? PADDLE_RADIUS : TABLE_HEIGHT / 2 + PADDLE_RADIUS;
  const maxY = isTop ? TABLE_HEIGHT / 2 - PADDLE_RADIUS : TABLE_HEIGHT - PADDLE_RADIUS;

  paddle.pos.x = Math.max(minX, Math.min(maxX, paddle.pos.x));
  paddle.pos.y = Math.max(minY, Math.min(maxY, paddle.pos.y));
}

/** Bounce the puck off the table edges. Returns 'goal-top' or 'goal-bottom' if a goal is scored. */
function resolveWallCollision(puck: Puck): 'none' | 'goal-top' | 'goal-bottom' {
  const goalLeft = (TABLE_WIDTH - GOAL_WIDTH) / 2;
  const goalRight = (TABLE_WIDTH + GOAL_WIDTH) / 2;

  // ── Goal-post corner collision ────────────────────────────────────
  // Treat each goal-post inner corner as a point obstacle. If the puck
  // overlaps one, push it out and reflect velocity off the corner normal.
  // This prevents the puck from "slipping through" the edge at low speed.
  const goalPostCorners: Vec2[] = [
    v2(goalLeft, 0),               // top-left post
    v2(goalRight, 0),              // top-right post
    v2(goalLeft, TABLE_HEIGHT),    // bottom-left post
    v2(goalRight, TABLE_HEIGHT),   // bottom-right post
  ];

  for (const corner of goalPostCorners) {
    const dist = v2Dist(puck.pos, corner);
    if (dist < PUCK_RADIUS && dist > 1e-6) {
      const normal = v2Normalize(v2Sub(puck.pos, corner));
      const overlap = PUCK_RADIUS - dist;
      puck.pos = v2Add(puck.pos, v2Scale(normal, overlap));

      const velDotN = v2Dot(puck.vel, normal);
      if (velDotN < 0) {
        puck.vel = v2Sub(puck.vel, v2Scale(normal, (1 + WALL_RESTITUTION) * velDotN));
        triggerHitFeedback('light');
      }
    }
  }

  // ── Determine if the puck center is within the goal opening (X-axis) ─
  // Center-based check: if the center is past the post, the puck visually
  // fits inside the opening and should be allowed through. The goal-post
  // corner collisions above handle bouncing off the posts themselves.
  const inGoalX = puck.pos.x > goalLeft && puck.pos.x < goalRight;

  // ── Side walls ────────────────────────────────────────────────────
  if (puck.pos.x < PUCK_RADIUS) {
    puck.pos.x = PUCK_RADIUS;
    puck.vel.x = Math.abs(puck.vel.x) * WALL_RESTITUTION;
    triggerHitFeedback('light');
  } else if (puck.pos.x > TABLE_WIDTH - PUCK_RADIUS) {
    puck.pos.x = TABLE_WIDTH - PUCK_RADIUS;
    puck.vel.x = -Math.abs(puck.vel.x) * WALL_RESTITUTION;
    triggerHitFeedback('light');
  }

  // ── Top wall / top goal ───────────────────────────────────────────
  if (puck.pos.y < PUCK_RADIUS) {
    if (inGoalX) {
      if (puck.pos.y < -PUCK_RADIUS) return 'goal-top';
    } else {
      puck.pos.y = PUCK_RADIUS;
      puck.vel.y = Math.abs(puck.vel.y) * WALL_RESTITUTION;
      triggerHitFeedback('light');
    }
  }
  // ── Bottom wall / bottom goal ─────────────────────────────────────
  else if (puck.pos.y > TABLE_HEIGHT - PUCK_RADIUS) {
    if (inGoalX) {
      if (puck.pos.y > TABLE_HEIGHT + PUCK_RADIUS) return 'goal-bottom';
    } else {
      puck.pos.y = TABLE_HEIGHT - PUCK_RADIUS;
      puck.vel.y = -Math.abs(puck.vel.y) * WALL_RESTITUTION;
      triggerHitFeedback('light');
    }
  }

  return 'none';
}

function resolvePuckPaddleCollision(puck: Puck, paddle: Paddle): void {
  const d = v2Dist(puck.pos, paddle.pos);
  const minDist = PUCK_RADIUS + PADDLE_RADIUS;

  if (d >= minDist) return;

  if (d < 1e-6) {
    puck.pos = v2Add(paddle.pos, v2(0, minDist));
    return;
  }

  const normal = v2Normalize(v2Sub(puck.pos, paddle.pos));
  const overlap = minDist - d;

  const candidatePos = v2Add(puck.pos, v2Scale(normal, overlap));
  puck.pos = v2(
    Math.max(PUCK_RADIUS, Math.min(TABLE_WIDTH - PUCK_RADIUS, candidatePos.x)),
    Math.max(PUCK_RADIUS, Math.min(TABLE_HEIGHT - PUCK_RADIUS, candidatePos.y)),
  );

  const postD = v2Dist(puck.pos, paddle.pos);
  if (postD < minDist) {
    if (postD > 1e-6) {
      const pushDir = v2Normalize(v2Sub(paddle.pos, puck.pos));
      paddle.pos = v2Add(paddle.pos, v2Scale(pushDir, minDist - postD));
    } else {
      paddle.pos = v2Add(puck.pos, v2(0, minDist));
    }
  }

  const relVel = v2Sub(puck.vel, paddle.vel);
  const relVelN = v2Dot(relVel, normal);

  if (relVelN < 0) {
    const impulse = -(1 + PADDLE_RESTITUTION) * relVelN;
    puck.vel = v2Add(puck.vel, v2Scale(normal, impulse));
    const intensity = Math.abs(relVelN) > 400 ? 'heavy' : 'medium';
    triggerHitFeedback(intensity);
  }
}

// ─── Physics Tick ────────────────────────────────────────────────────────────

function updatePhysics(state: GameState, rawDt: number, isHost: boolean): void {
  const dt = Math.max(MIN_DT, Math.min(rawDt, MAX_DT));

  const paddleOldPos: Vec2[] = state.paddles.map((p) => ({ ...p.pos }));

  for (let i = 0; i < 2; i++) {
    const paddle = state.paddles[i];
    if (paddle.grabbed) {
      paddle.pos = { ...paddle.targetPos };
    } else {
      // Dead reckoning: extrapolate position using velocity for smooth movement between network syncs
      paddle.pos = v2Add(paddle.pos, v2Scale(paddle.vel, dt));
    }
    constrainPaddle(paddle, i === 0);
  }

  const paddleNewPos: Vec2[] = state.paddles.map((p) => ({ ...p.pos }));

  for (let i = 0; i < 2; i++) {
    const paddle = state.paddles[i];
    if (paddle.grabbed) {
      const instantVel = v2Scale(v2Sub(paddleNewPos[i], paddleOldPos[i]), 1 / dt);
      paddle.vel = v2Add(
        v2Scale(paddle.vel, 1 - PADDLE_VEL_LERP),
        v2Scale(instantVel, PADDLE_VEL_LERP),
      );
    } else {
      // Apply friction so it slows down naturally if packets are dropped
      paddle.vel = v2Scale(paddle.vel, 0.9);
    }
  }

  const subDt = dt / PHYSICS_SUBSTEPS;
  let goalScored = false;

  for (let step = 0; step < PHYSICS_SUBSTEPS; step++) {
    const t = (step + 1) / PHYSICS_SUBSTEPS;
    for (let i = 0; i < 2; i++) {
      state.paddles[i].pos = v2(
        paddleOldPos[i].x + (paddleNewPos[i].x - paddleOldPos[i].x) * t,
        paddleOldPos[i].y + (paddleNewPos[i].y - paddleOldPos[i].y) * t,
      );
    }

    state.puck.pos = v2Add(state.puck.pos, v2Scale(state.puck.vel, subDt));

    let goal = resolveWallCollision(state.puck);
    if (goal !== 'none') {
      if (isHost) {
        if (goal === 'goal-top') state.score[1]++; 
        if (goal === 'goal-bottom') state.score[0]++; 
        
        if (state.score[0] >= WIN_SCORE) {
          state.status = 'win';
          state.winnerIdx = 0;
        } else if (state.score[1] >= WIN_SCORE) {
          state.status = 'win';
          state.winnerIdx = 1;
        } else {
          feedback.score();
        }
      }
      resetPuck(state);
      goalScored = true;
      break;
    }

    resolvePuckPaddleCollision(state.puck, state.paddles[0]);
    resolvePuckPaddleCollision(state.puck, state.paddles[1]);
    
    goal = resolveWallCollision(state.puck);
    if (goal !== 'none') {
      if (isHost) {
        if (goal === 'goal-top') state.score[1]++;
        if (goal === 'goal-bottom') state.score[0]++;

        if (state.score[0] >= WIN_SCORE) {
          state.status = 'win';
          state.winnerIdx = 0;
        } else if (state.score[1] >= WIN_SCORE) {
          state.status = 'win';
          state.winnerIdx = 1;
        } else {
          feedback.score();
        }
      }
      resetPuck(state);
      goalScored = true;
      break;
    }

    state.puck.vel = v2ClampLen(state.puck.vel, MAX_PUCK_SPEED);
  }

  for (let i = 0; i < 2; i++) {
    state.paddles[i].pos = paddleNewPos[i];
  }

  if (!goalScored) {
    resolvePuckPaddleCollision(state.puck, state.paddles[0]);
    resolvePuckPaddleCollision(state.puck, state.paddles[1]);
    resolveWallCollision(state.puck);

    const frictionFactor = Math.pow(PUCK_FRICTION, dt * 60);
    state.puck.vel = v2Scale(state.puck.vel, frictionFactor);

    if (v2Len(state.puck.vel) < VELOCITY_DEAD_ZONE) {
      state.puck.vel = v2(0, 0);
    }
  }
}

// ─── Canvas Renderer ─────────────────────────────────────────────────────────

function render(ctx: CanvasRenderingContext2D, state: GameState, isGuest: boolean): void {
  ctx.save();
  
  if (isGuest) {
    ctx.translate(TABLE_WIDTH / 2, TABLE_HEIGHT / 2);
    ctx.rotate(Math.PI);
    ctx.translate(-TABLE_WIDTH / 2, -TABLE_HEIGHT / 2);
  }

  // Table surface
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, TABLE_WIDTH, TABLE_HEIGHT);

  // Score
  ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
  ctx.font = 'bold 120px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  ctx.save();
  ctx.translate(TABLE_WIDTH / 2, TABLE_HEIGHT / 4);
  if (isGuest) ctx.rotate(Math.PI); // Keep text right-side up
  ctx.fillText(state.score[0].toString(), 0, 0);
  ctx.restore();

  ctx.save();
  ctx.translate(TABLE_WIDTH / 2, (TABLE_HEIGHT / 4) * 3);
  if (isGuest) ctx.rotate(Math.PI);
  ctx.fillText(state.score[1].toString(), 0, 0);
  ctx.restore();

  // Table border
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(1, 1, TABLE_WIDTH - 2, TABLE_HEIGHT - 2, 12);
  ctx.stroke();

  // Goals
  const goalLeft = (TABLE_WIDTH - GOAL_WIDTH) / 2;
  ctx.lineWidth = 4;
  
  // Top goal line (Guest / Rose)
  ctx.strokeStyle = '#f43f5e';
  ctx.beginPath();
  ctx.moveTo(goalLeft, 2);
  ctx.lineTo(goalLeft + GOAL_WIDTH, 2);
  ctx.stroke();

  // Bottom goal line (Host / Indigo)
  ctx.strokeStyle = '#6366f1';
  ctx.beginPath();
  ctx.moveTo(goalLeft, TABLE_HEIGHT - 2);
  ctx.lineTo(goalLeft + GOAL_WIDTH, TABLE_HEIGHT - 2);
  ctx.stroke();

  // Center line & circle
  ctx.beginPath();
  ctx.moveTo(0, TABLE_HEIGHT / 2);
  ctx.lineTo(TABLE_WIDTH, TABLE_HEIGHT / 2);
  ctx.strokeStyle = '#999999';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(TABLE_WIDTH / 2, TABLE_HEIGHT / 2, 40, 0, Math.PI * 2);
  ctx.stroke();

  // Paddles
  for (let i = 0; i < 2; i++) {
    const paddle = state.paddles[i];

    // Base paddle
    ctx.beginPath();
    ctx.arc(paddle.pos.x, paddle.pos.y, PADDLE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? '#f43f5e' : '#6366f1'; 
    ctx.fill();
    
    // Glossy outer rim
    ctx.beginPath();
    ctx.arc(paddle.pos.x, paddle.pos.y, PADDLE_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner handle
    ctx.beginPath();
    ctx.arc(paddle.pos.x, paddle.pos.y, PADDLE_RADIUS * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? '#be123c' : '#4338ca'; // Darker shades
    ctx.fill();

    // Inner handle glossy ring
    ctx.beginPath();
    ctx.arc(paddle.pos.x, paddle.pos.y, PADDLE_RADIUS * 0.45, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Puck
  // Outer base
  ctx.beginPath();
  ctx.arc(state.puck.pos.x, state.puck.pos.y, PUCK_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = '#64748b'; // slate-500 - medium gray
  ctx.fill();

  // Subtle outer rim
  ctx.beginPath();
  ctx.arc(state.puck.pos.x, state.puck.pos.y, PUCK_RADIUS, 0, Math.PI * 2);
  ctx.strokeStyle = '#475569'; // slate-600
  ctx.lineWidth = 2;
  ctx.stroke();

  // Inner groove
  ctx.beginPath();
  ctx.arc(state.puck.pos.x, state.puck.pos.y, PUCK_RADIUS * 0.5, 0, Math.PI * 2);
  ctx.strokeStyle = '#94a3b8'; // slate-400
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.restore();
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AirHockey({ sendDataToPeers, incomingData, onGameEnd }: GameProps<AirHockeyData>) {
  const { isHost, peers } = useNetworkStore();
  const { userId, userName } = useUser();
  const isGuest = !isHost;
  const myPaddleIdx = isHost ? 1 : 0;
  
  const opponent = peers.find(p => p.id !== userId);
  const opponentName = opponent ? opponent.name : 'Opponent';

  const [winState, setWinState] = useState<{status: 'win', winnerIdx: number | null} | null>(null);
  const prevGuestScoreRef = useRef<[number, number]>([0, 0]);
  const prevWinStateRef = useRef<boolean>(false);

  // Trigger sensory feedback when match concludes (win/lose)
  useEffect(() => {
    if (winState && !prevWinStateRef.current) {
      prevWinStateRef.current = true;
      if (winState.winnerIdx === myPaddleIdx) {
        feedback.win();
      } else {
        feedback.lose();
      }
    } else if (!winState) {
      prevWinStateRef.current = false;
    }
  }, [winState, myPaddleIdx]);

  // Keep references to props/state to avoid re-running the main effect
  const latestPropsRef = useRef({ sendDataToPeers, isHost, isGuest, myPaddleIdx, setWinState });
  useEffect(() => {
    latestPropsRef.current = { sendDataToPeers, isHost, isGuest, myPaddleIdx, setWinState };
  }, [sendDataToPeers, isHost, isGuest, myPaddleIdx]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>(createInitialState());
  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const lastSyncTimeRef = useRef<number>(0);

  // End the game if the opponent disconnects
  useEffect(() => {
    if (!isHost) return;
    const otherPeers = peers.filter(p => p.id !== userId);
    if (peers.length < 2 || otherPeers.length === 0) {
      onGameEnd();
    }
  }, [peers, isHost, userId, onGameEnd]);

  // Network listener
  useEffect(() => {
    if (!incomingData) return;
    const state = stateRef.current;

    if (incomingData.type === 'SYNC' && isGuest) {
      // Detect a restart: status moves from 'win' back to 'playing'.
      const isRestarting = state.status === 'win' && incomingData.state.status === 'playing';

      // Detect goal/score for guest client
      const [prev0, prev1] = prevGuestScoreRef.current;
      const [new0, new1] = incomingData.state.score;
      if (new0 !== prev0 || new1 !== prev1) {
        prevGuestScoreRef.current = [new0, new1];
        if (incomingData.state.status !== 'win' && !isRestarting) {
          feedback.score();
        }
      }

      if (isRestarting) {
        prevGuestScoreRef.current = [0, 0];
      }

      // Snap to Host's authoritative state
      state.puck.pos = { ...incomingData.state.puck.pos };
      state.puck.vel = { ...incomingData.state.puck.vel };
      state.score = [...incomingData.state.score] as [number, number];
      state.status = incomingData.state.status;
      state.winnerIdx = incomingData.state.winnerIdx;
      
      if (state.status === 'win') {
        setWinState({ status: 'win', winnerIdx: state.winnerIdx });
      } else {
        setWinState(null);
      }
      
      // Update Host's paddle
      state.paddles[1].pos = { ...incomingData.state.paddles[1].pos };
      state.paddles[1].vel = { ...incomingData.state.paddles[1].vel };

      // On restart, also reset the guest's own paddle to the initial
      // position and clear any lingering input state. During normal play
      // the guest drives paddle[0] locally, so we skip it to avoid jitter.
      if (isRestarting) {
        state.paddles[0].pos = { ...incomingData.state.paddles[0].pos };
        state.paddles[0].vel = { ...incomingData.state.paddles[0].vel };
        state.paddles[0].targetPos = { ...incomingData.state.paddles[0].pos };
        state.paddles[0].grabbed = false;
        state.paddles[0].touchId = null;

        // Avoid a large dt spike on the first post-restart frame.
        lastTimeRef.current = 0;
      }
      
    } else if (incomingData.type === 'PADDLE_UPDATE' && isHost) {
      // Host receives guest input
      state.paddles[0].targetPos = { ...incomingData.targetPos };
      state.paddles[0].grabbed = incomingData.grabbed;
      if (!incomingData.grabbed) {
        state.paddles[0].vel = v2(0, 0);
      }
    }
  }, [incomingData, isHost, isGuest]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const state = stateRef.current;

    // ── Coordinate mapping ───────────────────────────────────────────
    function canvasPos(clientX: number, clientY: number): Vec2 {
      const rect = canvas!.getBoundingClientRect();
      let x = ((clientX - rect.left) / rect.width) * TABLE_WIDTH;
      let y = ((clientY - rect.top) / rect.height) * TABLE_HEIGHT;
      
      if (latestPropsRef.current.isGuest) {
        x = TABLE_WIDTH - x;
        y = TABLE_HEIGHT - y;
      }
      
      return v2(x, y);
    }

    /** Returns the index of the paddle under the given position, if it belongs to the player. */
    function paddleIndexAt(pos: Vec2): number {
      const myIdx = latestPropsRef.current.myPaddleIdx;
      if (v2Dist(pos, state.paddles[myIdx].pos) <= PADDLE_RADIUS) {
        return myIdx;
      }
      return -1;
    }

    // ── Mouse input ──────────────────────────────────────────────────
    let isMouseDown = false;

    function onMouseDown(e: MouseEvent) {
      const pos = canvasPos(e.clientX, e.clientY);
      const idx = paddleIndexAt(pos);
      if (idx !== -1) {
        isMouseDown = true;
        state.paddles[idx].grabbed = true;
        state.paddles[idx].targetPos = pos;
      }
    }

    function onMouseMove(e: MouseEvent) {
      if (isMouseDown) {
        state.paddles[latestPropsRef.current.myPaddleIdx].targetPos = canvasPos(e.clientX, e.clientY);
      }
    }

    function onMouseUp() {
      if (isMouseDown) {
        isMouseDown = false;
        const myIdx = latestPropsRef.current.myPaddleIdx;
        state.paddles[myIdx].grabbed = false;
        state.paddles[myIdx].vel = v2(0, 0);
      }
    }

    // ── Touch input ──────────────────────────────────────────────────
    function onTouchStart(e: TouchEvent) {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        const pos = canvasPos(touch.clientX, touch.clientY);
        const idx = paddleIndexAt(pos);
        if (idx !== -1 && !state.paddles[idx].grabbed) {
          state.paddles[idx].grabbed = true;
          state.paddles[idx].touchId = touch.identifier;
          state.paddles[idx].targetPos = pos;
        }
      }
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        const paddle = state.paddles[latestPropsRef.current.myPaddleIdx];
        if (paddle.grabbed && paddle.touchId === touch.identifier) {
          paddle.targetPos = canvasPos(touch.clientX, touch.clientY);
        }
      }
    }

    function onTouchEnd(e: TouchEvent) {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        const paddle = state.paddles[latestPropsRef.current.myPaddleIdx];
        if (paddle.touchId === touch.identifier) {
          paddle.grabbed = false;
          paddle.touchId = null;
          paddle.vel = v2(0, 0);
        }
      }
    }

    // ── Register events ──────────────────────────────────────────────
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);

    // ── Game loop ────────────────────────────────────────────────────
    function loop(timestamp: number) {
      if (lastTimeRef.current === 0) lastTimeRef.current = timestamp;
      const dt = (timestamp - lastTimeRef.current) / 1000;
      lastTimeRef.current = timestamp;

      const { isHost, isGuest, sendDataToPeers, setWinState } = latestPropsRef.current;

      const isPlaying = state.status === 'playing';
      if (isPlaying) {
        // Both run physics for client-side prediction, but Host is authoritative over scores.
        updatePhysics(state, dt, isHost);

        if (state.status === 'win' && isHost) {
          setWinState({ status: 'win', winnerIdx: state.winnerIdx });
        }
      }
      
      render(ctx!, state, isGuest);

      // ── Networking Broadcast ───────────────────────────────────────
      if (timestamp - lastSyncTimeRef.current > SYNC_INTERVAL_MS) {
        lastSyncTimeRef.current = timestamp;
        
        if (isHost) {
          sendDataToPeers({
            type: 'SYNC',
            state: {
              puck: { ...state.puck },
              score: [...state.score],
              status: state.status,
              winnerIdx: state.winnerIdx,
              paddles: [
                { pos: { ...state.paddles[0].pos }, vel: { ...state.paddles[0].vel } },
                { pos: { ...state.paddles[1].pos }, vel: { ...state.paddles[1].vel } }
              ]
            }
          });
        } else if (state.status === 'playing') {
          sendDataToPeers({
            type: 'PADDLE_UPDATE',
            targetPos: { ...state.paddles[0].targetPos },
            grabbed: state.paddles[0].grabbed
          });
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame(loop);

    // ── Cleanup ──────────────────────────────────────────────────────
    return () => {
      cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  const handleRestart = () => {
    if (!isHost) return;
    feedback.tap();

    // Mutate the existing state object in-place rather than replacing stateRef.
    // The game loop and input handlers captured `stateRef.current` via closure
    // at mount time — assigning a new object to the ref would leave the running
    // loop reading/writing the old stale state.
    const state = stateRef.current;
    const fresh = createInitialState();

    state.puck.pos = { ...fresh.puck.pos };
    state.puck.vel = { ...fresh.puck.vel };
    state.score = [0, 0];
    state.status = 'playing';
    state.winnerIdx = null;

    for (let i = 0; i < 2; i++) {
      state.paddles[i].pos = { ...fresh.paddles[i].pos };
      state.paddles[i].vel = { ...fresh.paddles[i].vel };
      state.paddles[i].targetPos = { ...fresh.paddles[i].targetPos };
      state.paddles[i].grabbed = false;
      state.paddles[i].touchId = null;
    }

    // Reset the frame timestamp so the loop doesn't see a huge dt spike.
    lastTimeRef.current = 0;

    setWinState(null);

    sendDataToPeers({
      type: 'SYNC',
      state: {
        puck: { ...state.puck },
        score: [...state.score],
        status: state.status,
        winnerIdx: state.winnerIdx,
        paddles: [
          { pos: { ...state.paddles[0].pos }, vel: { ...state.paddles[0].vel } },
          { pos: { ...state.paddles[1].pos }, vel: { ...state.paddles[1].vel } },
        ],
      },
    });
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center w-full h-full min-h-[var(--app-height,100dvh)] bg-slate-100 font-sans p-4 relative">
      {isHost && (
        <ExitButton 
          onExit={() => {
            feedback.tap();
            onGameEnd();
          }} 
        />
      )}
      <div className="flex items-center gap-4 text-slate-500 mb-6 tracking-widest uppercase font-bold text-sm sm:text-base">
        <span className={isHost ? "text-indigo-500" : "text-rose-500"}>{userName}</span>
        <span className="opacity-50">VS</span>
        <span className={!isHost ? "text-indigo-500" : "text-rose-500"}>{opponentName}</span>
      </div>
      
      <canvas
        ref={canvasRef}
        width={TABLE_WIDTH}
        height={TABLE_HEIGHT}
        style={{ 
          touchAction: 'none',
          maxWidth: '100%',
          maxHeight: 'calc(var(--app-height, 100dvh) - 120px)'
        }}
        className="bg-white rounded-xl shadow-2xl shrink-0"
      />

      {winState && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-100 p-4 animate-in fade-in duration-300">
          <div className="text-center mb-10 bg-white shadow-xl rounded-3xl p-8 sm:p-10 w-full max-w-[400px]">
            <h1 className={`text-5xl sm:text-6xl font-black uppercase tracking-tight ${winState.winnerIdx === myPaddleIdx ? 'text-emerald-500' : 'text-red-500'}`}>
              {winState.winnerIdx === myPaddleIdx ? 'Victory!' : 'Defeat'}
            </h1>
            <p className="mt-4 text-slate-500 font-bold uppercase tracking-widest">
              {winState.winnerIdx === myPaddleIdx ? `${userName} wins!` : `${opponentName} wins!`}
            </p>
          </div>
          
          {isHost ? (
            <div className="flex flex-col sm:flex-row gap-4 w-full max-w-[400px]">
              <button 
                onClick={() => {
                  feedback.tap();
                  onGameEnd();
                }}
                className="flex-1 bg-white text-slate-800 rounded-2xl p-4 font-black text-xl uppercase cursor-pointer shadow-sm border border-slate-200 hover:shadow-md hover:bg-slate-50 active:scale-95 transition-all"
              >
                Quit
              </button>
              <button 
                onClick={handleRestart}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl p-4 font-black text-xl uppercase cursor-pointer shadow hover:shadow-md active:scale-95 transition-all"
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
      )}
    </div>
  );
}
