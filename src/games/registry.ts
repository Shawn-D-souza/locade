import TicTacToe from './tictactoe/TicTacToe';
import DotsClash from './dots-clash/DotsClash';

export interface GameConfig {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  component: React.ComponentType<any> | null;
}

export const GAME_REGISTRY: Record<string, GameConfig> = {
  tictactoe: {
    id: 'tictactoe',
    name: 'Tic Tac Toe',
    minPlayers: 2,
    maxPlayers: 2,
    component: TicTacToe,
  },
  'dots-clash': {
    id: 'dots-clash',
    name: 'Dots Clash',
    minPlayers: 2,
    maxPlayers: 8,
    component: DotsClash,
  }
};
