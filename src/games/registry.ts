import AirHockey from './air-hockey/AirHockey';
import TicTacToe from './tictactoe/TicTacToe';
import DotsClash from './dots-clash/DotsClash';

export interface GameConfig {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
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
    thumbnailUrl: '/thumbnails/airhockey.png',
  },
  'dots-clash': {
    id: 'dots-clash',
    name: 'Dots Clash',
    minPlayers: 2,
    maxPlayers: 8,
    component: DotsClash,
    thumbnailUrl: '/thumbnails/dotsclash.png',
  },
  tictactoe: {
    id: 'tictactoe',
    name: 'Tic Tac Toe',
    minPlayers: 2,
    maxPlayers: 2,
    component: TicTacToe,
    thumbnailUrl: '/thumbnails/tictactoe.png',
  }
};
