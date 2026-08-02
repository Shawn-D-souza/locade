import { Peer, type DataConnection } from 'peerjs';
import { useNetworkStore, type PeerPlayer } from '../store/useNetworkStore';
import { useUser } from '../store/useUserStore';
import { lobbyAudioManager } from '../audio/lobbyAudioManager';

// Strict typing for network data payloads
type PeerMessage =
  | { type: 'HELLO'; payload: { id: string; name: string } }
  | { type: 'ROSTER_UPDATE'; payload: PeerPlayer[] }
  | { type: 'START_GAME'; payload: { gameId: string } }
  | { type: 'END_GAME'; payload: null }
  | { type: 'AUDIO_SYNC'; payload: { trackPosition: number } }
  | { type: 'GAME_DATA'; payload: unknown };

class PeerService {
  private peer: Peer | null = null;
  private connections: Map<string, DataConnection> = new Map();
  private hostConnection: DataConnection | null = null;
  private audioSyncInterval: number | null = null;

  // Helper to generate the unique namespace key
  private getNetworkId(lobbyId: string): string {
    return `locade-${lobbyId.toUpperCase()}`;
  }

  /**
   * Initialize as Host
   */
  public initializeHost(lobbyId: string) {
    const { userId, userName } = useUser.getState();
    const networkStore = useNetworkStore.getState();

    networkStore.setStatus('connecting');

    const networkId = this.getNetworkId(lobbyId);

    const PEER_CONFIG = {
      debug: 2,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
        ]
      }
    };

    this.peer = new Peer(networkId, PEER_CONFIG);

    this.peer.on('open', () => {
      console.log('Host connection running with network ID:', networkId);
      networkStore.setLobbyDetails(lobbyId, true);
      networkStore.setStatus('connected');
      
      // Seed roster with the host themselves
      networkStore.addPeer({ id: userId, name: userName, isHost: true });

      // Start the lightweight audio synchronization heartbeat
      this.startAudioSync();
    });

    this.peer.on('connection', (conn) => {
      this.handleIncomingConnection(conn);
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS Host Error:', err);
      networkStore.setStatus('error', err.message);
    });
  }

  /**
   * Initialize as Guest & Connect to Host
   */
  public joinLobby(lobbyId: string) {
    const networkStore = useNetworkStore.getState();
    networkStore.setStatus('connecting');

    const PEER_CONFIG = {
      debug: 2,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' },
        ]
      }
    };

    // Guests let PeerJS generate a clean random cloud ID for their own node
    this.peer = new Peer(PEER_CONFIG);

    this.peer.on('open', (guestPeerId) => {
      console.log('Guest node initialized with cloud ID:', guestPeerId);
      
      const hostNetworkId = this.getNetworkId(lobbyId);
      const conn = this.peer!.connect(hostNetworkId);
      
      this.handleHostConnection(conn, lobbyId);
    });

    this.peer.on('error', (err) => {
      console.error('PeerJS Guest Error:', err);
      networkStore.setStatus('error', err.message);
    });
  }

  /**
   * Host handling incoming connections
   */
  private handleIncomingConnection(conn: DataConnection) {
    const networkStore = useNetworkStore.getState();

    conn.on('open', () => {
      console.log(`Connection established with node: ${conn.peer}`);
      this.connections.set(conn.peer, conn);
      
      // Temporary placeholder until handshake payload is received
      networkStore.addPeer({ id: conn.peer, name: 'Guest Joining...', isHost: false });
    });

    conn.on('data', (data) => {
      const message = data as PeerMessage;
      console.log('Host received message:', message);

      if (message.type === 'HELLO') {
        const { id: realUserId, name: realUserName } = message.payload;
        
        // Remap connection map key from the raw PeerJS ID to their true stable user UUID
        this.connections.delete(conn.peer);
        this.connections.set(realUserId, conn);

        // Update host's local Zustand state with true identification
        networkStore.removePeer(conn.peer); // Drop placeholder
        networkStore.addPeer({ id: realUserId, name: realUserName, isHost: false });

        // Broadcast updated full state roster to all connected guests
        this.broadcastToAllGuests({
          type: 'ROSTER_UPDATE',
          payload: useNetworkStore.getState().peers
        });

        // Immediately sync the joining guest to the current host audio timeline
        if (useNetworkStore.getState().gameState === 'lobby') {
          conn.send({
            type: 'AUDIO_SYNC',
            payload: { trackPosition: lobbyAudioManager.getCurrentPosition() }
          });
        }
      }

      if (message.type === 'GAME_DATA') {
        // Update local game state with incoming data
        useNetworkStore.setState({ incomingGameData: message.payload });
        
        // Relay game data to other connected clients
        this.connections.forEach((c) => {
          if (c.open && c.peer !== conn.peer) {
            c.send(message);
          }
        });
      }
    });

    conn.on('close', () => {
      console.log(`Connection dropped: ${conn.peer}`);
      
      // Find and remove connection reference using key lookup
      let targetUserId = conn.peer;
      for (const [userId, connection] of this.connections.entries()) {
        if (connection === conn) {
          targetUserId = userId;
          break;
        }
      }

      this.connections.delete(targetUserId);
      networkStore.removePeer(targetUserId);

      // Notify remaining guests of roster changes
      this.broadcastToAllGuests({
        type: 'ROSTER_UPDATE',
        payload: useNetworkStore.getState().peers
      });
    });
  }

  /**
   * Guest handling connection to Host
   */
  private handleHostConnection(conn: DataConnection, lobbyId: string) {
    const { userId, userName } = useUser.getState();
    const networkStore = useNetworkStore.getState();
    this.hostConnection = conn;

    conn.on('open', () => {
      console.log('Connected to Host data channel safely.');
      networkStore.setLobbyDetails(lobbyId, false);
      networkStore.setStatus('connected');

      // Listen for underlying WebRTC connection drops (e.g., Host closes tab)
      if (conn.peerConnection) {
        conn.peerConnection.oniceconnectionstatechange = () => {
          const state = conn.peerConnection.iceConnectionState;
          if (state === 'failed' || state === 'disconnected' || state === 'closed') {
            console.warn('Host ICE connection dropped.');
            this.disconnect();
            useNetworkStore.getState().setStatus('error', 'The host has disconnected.');
          }
        };
      }

      // Executing Handshake: Send true profile identity immediately
      const handshake: PeerMessage = {
        type: 'HELLO',
        payload: { id: userId, name: userName }
      };
      conn.send(handshake);
    });

    conn.on('data', (data) => {
      const message = data as PeerMessage;
      console.log('Guest received message:', message);

      if (message.type === 'ROSTER_UPDATE') {
        // Sync entire peer list directly to local store state from the authoritative source (Host)
        useNetworkStore.setState({ peers: message.payload });
      }

      if (message.type === 'AUDIO_SYNC') {
        const { gameState } = useNetworkStore.getState();
        // Only synchronize if in lobby state; zero impact during gameplay
        if (gameState === 'lobby') {
          lobbyAudioManager.syncTo(message.payload.trackPosition);
        }
      }

      if (message.type === 'START_GAME') {
        useNetworkStore.setState({ gameState: 'game', activeGameId: message.payload.gameId });
      }

      if (message.type === 'END_GAME') {
        useNetworkStore.setState({ gameState: 'lobby', activeGameId: null });
      }

      if (message.type === 'GAME_DATA') {
        useNetworkStore.setState({ incomingGameData: message.payload });
      }
    });

    conn.on('close', () => {
      console.warn('Host disconnected. Network session closing.');
      this.disconnect();
      networkStore.setStatus('error', 'The host has disconnected.');
    });
  }

  /**
   * Authoritative Audio Timeline Synchronization
   */
  public startAudioSync() {
    this.stopAudioSync();

    // Send an immediate sync pulse if guests are connected
    this.sendAudioSync();

    // 5-second lightweight heartbeat: sends ~40 bytes only while host is in lobby
    this.audioSyncInterval = window.setInterval(() => {
      const { gameState, isHost } = useNetworkStore.getState();
      if (isHost && gameState === 'lobby' && this.connections.size > 0) {
        this.sendAudioSync();
      }
    }, 5000);
  }

  public stopAudioSync() {
    if (this.audioSyncInterval !== null) {
      clearInterval(this.audioSyncInterval);
      this.audioSyncInterval = null;
    }
  }

  public sendAudioSync() {
    const { isHost, gameState } = useNetworkStore.getState();
    if (!isHost || gameState !== 'lobby' || this.connections.size === 0) return;

    const trackPosition = lobbyAudioManager.getCurrentPosition();
    this.broadcastToAllGuests({
      type: 'AUDIO_SYNC',
      payload: { trackPosition }
    });
  }

  /**
   * Utilities & Broadcasting 
   */
  public broadcast(message: PeerMessage) {
    const isHost = useNetworkStore.getState().isHost;
    
    // Automatically manage audio sync heartbeat state on game transitions
    if (message.type === 'START_GAME') {
      this.stopAudioSync();
    } else if (message.type === 'END_GAME') {
      this.startAudioSync();
    }

    if (isHost) {
      this.broadcastToAllGuests(message);
    } else {
      if (this.hostConnection && this.hostConnection.open) {
        this.hostConnection.send(message);
      }
    }
  }

  private broadcastToAllGuests(message: PeerMessage) {
    this.connections.forEach((conn) => {
      if (conn.open) {
        conn.send(message);
      }
    });
  }

  public disconnect() {
    this.stopAudioSync();

    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    if (this.hostConnection) {
      this.hostConnection.close();
      this.hostConnection = null;
    }
    this.connections.clear();
    useNetworkStore.getState().resetNetwork();
  }
}

export const peerService = new PeerService();
