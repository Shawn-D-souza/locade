import { create } from 'zustand';

export interface PeerPlayer {
  id: string;
  name: string;
  isHost: boolean;
  /**
   * Whether this player's transport is currently live. A player who drops keeps
   * their roster entry (and therefore their seat, colour and tokens) flagged
   * `false` for the grace window, and is only removed if they fail to return.
   */
  connected: boolean;
}

/**
 * `reconnecting` is deliberately distinct from `connecting`: Lobby renders a
 * full-screen spinner for `connecting`, which would unmount GameShell and throw
 * away the in-progress game — exactly the bug the reconnect logic exists to fix.
 */
type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error';

interface NetworkState {
  lobbyId: string | null;
  isHost: boolean;
  status: ConnectionStatus;
  errorMessage: string | null;
  gameState: 'lobby' | 'game';
  activeGameId: string | null;
  setGameState: (state: 'lobby' | 'game', gameId?: string) => void;

  incomingGameData: any;
  clearIncomingGameData: () => void;

  // The Roster
  peers: PeerPlayer[];

  setLobbyDetails: (lobbyId: string, isHost: boolean) => void;
  setStatus: (status: ConnectionStatus, error?: string) => void;
  
  addPeer: (peer: PeerPlayer) => void;
  removePeer: (peerId: string) => void;
  updatePeerName: (peerId: string, newName: string) => void;
  markPeerConnected: (peerId: string, connected: boolean) => void;
  
  resetNetwork: () => void;
}

export const useNetworkStore = create<NetworkState>()((set) => ({
  lobbyId: null,
  isHost: true,
  status: 'idle',
  errorMessage: null,
  peers: [],
  gameState: 'lobby',
  activeGameId: null,
  incomingGameData: null,
  clearIncomingGameData: () => set({ incomingGameData: null }),

  setGameState: (gameState, activeGameId) => set((state) => ({ 
    gameState, 
    activeGameId: activeGameId !== undefined ? activeGameId : state.activeGameId 
  })),

  setLobbyDetails: (lobbyId, isHost) => set({ lobbyId, isHost }),
  
  setStatus: (status, errorMessage) => set({ status, errorMessage: errorMessage ?? null }),
  
  addPeer: (peer) => set((state) => ({
    // Upsert in place. A returning player must keep their original index: seat
    // order (and therefore board quadrant and colour) is derived from roster
    // position in both the Lobby and the games.
    peers: state.peers.some((p) => p.id === peer.id)
      ? state.peers.map((p) => (p.id === peer.id ? { ...p, ...peer } : p))
      : [...state.peers, peer]
  })),

  removePeer: (peerId) => set((state) => ({
    peers: state.peers.filter((p) => p.id !== peerId)
  })),

  updatePeerName: (peerId, newName) => set((state) => ({
    peers: state.peers.map((p) =>
      p.id === peerId ? { ...p, name: newName } : p
    )
  })),

  markPeerConnected: (peerId, connected) => set((state) => ({
    peers: state.peers.map((p) =>
      p.id === peerId ? { ...p, connected } : p
    )
  })),

  resetNetwork: () => set({
    lobbyId: null,
    isHost: true,
    status: 'idle',
    errorMessage: null,
    peers: [],
    incomingGameData: null,
    gameState: 'lobby',
    activeGameId: null
  }),
}));