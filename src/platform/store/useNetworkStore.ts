import { create } from 'zustand';

export interface PeerPlayer {
  id: string;
  name: string;
  isHost: boolean;
}

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'error';

interface NetworkState {
  lobbyId: string | null;
  isHost: boolean;
  status: ConnectionStatus;
  errorMessage: string | null;

  // The Roster
  peers: PeerPlayer[];

  setLobbyDetails: (lobbyId: string, isHost: boolean) => void;
  setStatus: (status: ConnectionStatus, error?: string) => void;
  
  addPeer: (peer: PeerPlayer) => void;
  removePeer: (peerId: string) => void;
  updatePeerName: (peerId: string, newName: string) => void;
  
  resetNetwork: () => void;
}

export const useNetworkStore = create<NetworkState>()((set) => ({
  lobbyId: null,
  isHost: true,
  status: 'idle',
  errorMessage: null,
  peers: [],

  setLobbyDetails: (lobbyId, isHost) => set({ lobbyId, isHost }),
  
  setStatus: (status, errorMessage) => set({ status, errorMessage: errorMessage ?? null }),
  
  addPeer: (peer) => set((state) => ({ 
    // Prevent duplicates
    peers: state.peers.some(p => p.id === peer.id) 
      ? state.peers 
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

  resetNetwork: () => set({
    lobbyId: null,
    isHost: true,
    status: 'idle',
    errorMessage: null,
    peers: []
  }),
}));