/**
 * Represents the properties provided to a game instance by the platform.
 * These properties allow the game to communicate with other peers and the platform itself.
 */
export interface GameProps<T = unknown> {
  // The platform gives the game a way to send data out to peers.
  sendDataToPeers: (data: T) => void;

  // The platform passes incoming data down to the game.
  incomingData: T | null;

  // Let the game tell the platform when it's over.
  onGameEnd: () => void;
}
