import TicTacToe from './tictactoe/TicTacToe';
import DotsClash from './dots-clash/DotsClash';
import tictactoeThumb from '../assets/thumbnails/tictactoe.png';

export interface GameConfig {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  component: React.ComponentType<any> | null;
  thumbnailUrl?: string;
}

export const GAME_REGISTRY: Record<string, GameConfig> = {
  tictactoe: {
    id: 'tictactoe',
    name: 'Tic Tac Toe',
    minPlayers: 2,
    maxPlayers: 2,
    component: TicTacToe,
    thumbnailUrl: tictactoeThumb,
  },
  'dots-clash': {
    id: 'dots-clash',
    name: 'Dots Clash',
    minPlayers: 2,
    maxPlayers: 8,
    component: DotsClash,
  }
};
