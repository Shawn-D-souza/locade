import AirHockey from './air-hockey/AirHockey';
import TicTacToe from './tictactoe/TicTacToe';
import DotsClash from './dots-clash/DotsClash';
import SnakesLadders from './snakes-ladders/SnakesLadders';
import Ludo from './ludo/Ludo';
import Battleship from './battleship/Battleship';
import type { GameProps } from './GameProps';

/**
 * The registry is heterogeneous: every game is generic over its own wire-data
 * type, and `GameProps<T>` is invariant in `T` (it both consumes a `T` via
 * `sendDataToPeers` and produces one via `incomingData`). No single concrete
 * props type is assignable to all of them, so `any` is the deliberate bridge
 * here — GameShell re-narrows to the game's own `T` at the render site.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameComponent = React.ComponentType<GameProps<any>>;

export interface GameConfig {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers?: number;
  component: AnyGameComponent | null;
  thumbnailUrl?: string;
}

export const GAME_REGISTRY: Record<string, GameConfig> = {
  'air-hockey': {
    id: 'air-hockey',
    name: 'Air Hockey',
    minPlayers: 2,
    maxPlayers: 2,
    component: AirHockey,
    thumbnailUrl: '/images/airhockey.png',
  },
  'dots-clash': {
    id: 'dots-clash',
    name: 'Dots Clash',
    minPlayers: 2,
    component: DotsClash,
    thumbnailUrl: '/images/dotsclash.png',
  },
  'snakes-ladders': {
    id: 'snakes-ladders',
    name: 'Snakes & Ladders',
    minPlayers: 2,
    component: SnakesLadders,
    thumbnailUrl: '/images/snakesandladders.png',
  },
  ludo: {
    id: 'ludo',
    name: 'Ludo',
    minPlayers: 2,
    maxPlayers: 4,
    component: Ludo,
    thumbnailUrl: '/images/ludo.png',
  },
  tictactoe: {
    id: 'tictactoe',
    name: 'Tic Tac Toe',
    minPlayers: 2,
    maxPlayers: 2,
    component: TicTacToe,
    thumbnailUrl: '/images/tictactoe.png',
  },
  battleship: {
    id: 'battleship',
    name: 'Battleship',
    minPlayers: 2,
    maxPlayers: 2,
    component: Battleship,
  }
};
