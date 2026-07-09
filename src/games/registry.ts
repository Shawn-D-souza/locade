import Ping from './ping/Ping';

export interface GameConfig {
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  component: React.ComponentType<any> | null;
}

export const GAME_REGISTRY: Record<string, GameConfig> = {
  ping: {
    id: 'ping',
    name: 'Ping Test',
    minPlayers: 2, 
    maxPlayers: 8,
    component: Ping,
  }
};
