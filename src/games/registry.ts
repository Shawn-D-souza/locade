import AirHockey from './air-hockey/AirHockey';
import TicTacToe from './tictactoe/TicTacToe';
import DotsClash from './dots-clash/DotsClash';

import tictactoeThumb from '../assets/thumbnails/tictactoe.png';
import dotsClashThumb from '../assets/thumbnails/dotsclash.png';

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
  },
  'dots-clash': {
    id: 'dots-clash',
    name: 'Dots Clash',
    minPlayers: 2,
    maxPlayers: 8,
    component: DotsClash,
    thumbnailUrl: dotsClashThumb,
  },
  tictactoe: {
    id: 'tictactoe',
    name: 'Tic Tac Toe',
    minPlayers: 2,
    maxPlayers: 2,
    component: TicTacToe,
    thumbnailUrl: tictactoeThumb,
  }
};
