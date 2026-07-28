export interface Vec2 {
  x: number;
  y: number;
}

export interface Puck {
  pos: Vec2;
  vel: Vec2;
}

export interface Paddle {
  pos: Vec2;
  vel: Vec2;
  targetPos: Vec2;
  grabbed: boolean;
  touchId: number | null; // Local use only, not synced
}

export interface GameState {
  puck: Puck;
  paddles: [Paddle, Paddle]; // [top (guest), bottom (host)]
  score: [number, number];   // [top player score, bottom player score]
  status: 'playing' | 'win';
  winnerIdx: number | null;
}

export type AirHockeyData = 
  | {
      type: 'SYNC';
      state: {
        puck: Puck;
        score: [number, number];
        status: 'playing' | 'win';
        winnerIdx: number | null;
        paddles: [
          { pos: Vec2; vel: Vec2 }, // Guest paddle state (Host echoes back to guest for sync, but guest largely predicts)
          { pos: Vec2; vel: Vec2 }  // Host paddle state
        ];
      };
    }
  | {
      type: 'PADDLE_UPDATE';
      targetPos: Vec2;
      grabbed: boolean;
    };
