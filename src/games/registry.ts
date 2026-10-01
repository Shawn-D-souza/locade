import AirHockey from './air-hockey/AirHockey';
import TicTacToe from './tictactoe/TicTacToe';
import DotsClash from './dots-clash/DotsClash';
import SnakesLadders from './snakes-ladders/SnakesLadders';
import Ludo from './ludo/Ludo';

export interface GameConfig {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers?: number;
  component: React.ComponentType<any> | null;
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
  },
  tictactoe: {
    id: 'tictactoe',
    name: 'Tic Tac Toe',
    minPlayers: 2,
    maxPlayers: 2,
    component: TicTacToe,
    thumbnailUrl: '/images/tictactoe.png',
  }
};
