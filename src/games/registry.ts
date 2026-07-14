import TicTacToe from './tictactoe/TicTacToe';

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
  }
};
