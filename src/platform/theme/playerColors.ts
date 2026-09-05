/**
 * Seat colours, shared between the Lobby roster and any game that wants to keep
 * a player's identity consistent once the board loads. Indexed by the player's
 * position in the peer roster.
 */
export const PLAYER_COLORS = [
  '#FF6B6B', // P1: Action Red
  '#4D96FF', // P2: Player Blue
  '#6BCB77', // P3: Player Green
  '#FFD93D', // P4: Arcade Yellow
  '#9D4EDD', // P5: Purple
  '#FF9F43', // P6: Orange
  '#FF85B3', // P7: Pink
  '#00CFD6', // P8: Cyan
];

export const playerColor = (seatIndex: number) =>
  PLAYER_COLORS[seatIndex % PLAYER_COLORS.length];
